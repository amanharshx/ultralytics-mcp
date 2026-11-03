/** Live check that a checkpoint-mode start rejection other than a task
 * mismatch still leaves the created model behind, and the error names it.
 *
 * An invalid `gpu_type` is used because it is free and deterministic. The
 * dataset is also one that does not exist, so even if the platform ever
 * accepted the GPU value it would still have nothing to train on; should a
 * job start regardless, it is cancelled before the test fails. The project
 * is disposable and the named leftover model is deleted by the test.
 *
 * Skipped silently without `ULTRALYTICS_API_KEY` and excluded from
 * `npm test`, like the other live smoke suites.
 */

import { describe, expect, test } from "vitest";
import { UltralyticsApiError } from "../../src/errors.js";
import { modelsDelete } from "../../src/tools/models.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import { trainingCancel, trainingStart } from "../../src/tools/training.js";
import {
  disposableSlug,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

describe.skipIf(!apiKey)("training_start leftover model live smoke", () => {
  test("an invalid gpu_type rejection names the model it created, which the test then deletes", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();
    const before = (await client.get("/account/summary")) as {
      creditsCents: number;
    };
    const projectSlug = disposableSlug("zz-mcp-smoke-leftover");
    const projectRef = `${owner}/${projectSlug}`;

    await withDisposableCleanup(
      "project",
      projectRef,
      async () => {
        await projectsDelete(client, projectRef);
      },
      async () => {
        await projectsCreate(client, {
          name: "zz MCP smoke leftover model (disposable)",
          project: projectSlug,
        });

        const outcome = await trainingStart(client, {
          model: "yolo26n.pt",
          project: projectRef,
          dataset: `${owner}/zz-no-such-dataset`,
          gpuType: "zz-not-a-gpu",
          epochs: 1,
          confirmCost: true,
        }).then(
          (started) => ({ started }),
          (error: unknown) => ({ error }),
        );
        if ("started" in outcome) {
          // Unexpected success: stop the job before failing loudly.
          const data = outcome.started.data as {
            owner: string;
            project: string;
            model: string;
          };
          await trainingCancel(
            client,
            `${data.owner}/${data.project}/${data.model}`,
          );
          throw new Error(
            `expected an invalid gpu_type to be rejected, but training started (cancelled): ${outcome.started.summary}`,
          );
        }
        const { error } = outcome;
        expect(error).toBeInstanceOf(UltralyticsApiError);
        const apiError = error as UltralyticsApiError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.apiMessage).not.toMatch(/task mismatch/i);

        const named = apiError.message.match(
          /Model '([^']+)' was created for this run and was not deleted/,
        );
        expect(named).not.toBeNull();
        const leftoverRef = (named as RegExpMatchArray)[1];
        expect(leftoverRef.startsWith(`${projectRef}/`)).toBe(true);

        const modelsBefore = (await client.get(
          `/models/${owner}/${projectSlug}`,
        )) as { models?: { model?: string }[] };
        expect(modelsBefore.models?.map((model) => model.model)).toEqual([
          leftoverRef.split("/")[2],
        ]);

        await modelsDelete(client, leftoverRef);
        const modelsAfter = (await client.get(
          `/models/${owner}/${projectSlug}`,
        )) as { models?: unknown[] };
        expect(modelsAfter.models).toEqual([]);

        const after = (await client.get("/account/summary")) as {
          creditsCents: number;
        };
        expect(after.creditsCents).toBe(before.creditsCents);

        await projectsDelete(client, projectRef);
      },
    );
  }, 60_000);
});
