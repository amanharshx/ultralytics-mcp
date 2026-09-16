/** Live smoke test asserting the platform still enforces the rules four
 * removed client-side allowlists used to cache locally.
 *
 * Housekeeping ticket 2 removed `DATASET_TASKS` (explore.ts and datasets.ts,
 * duplicated), `TARGET_SPLITS`' use as an input validator, `IngestConflictPolicy`'s
 * enum check, and `DATASET_TASK_COMPATIBILITY` (training.ts). Each was
 * verified live before removal per "verify, then delete": this suite is that
 * verification recorded as a live regression check, exactly like
 * `export-format.live.test.ts` did for the export-format allowlist. One
 * finding surfaced during verification: the removed dataset-task allowlist
 * excluded `depth`, a task value the server accepts — this suite asserts
 * that acceptance too, so the finding stays pinned.
 *
 * Every case here is either a GET or a rejected write (400 before any
 * resource is created, or against a disposable resource cleaned up in a
 * `finally`). The checkpoint/dataset task-mismatch case needs a ready,
 * labeled dataset (task compatibility is only checked once the dataset has
 * content), which a disposable dataset cannot gain synchronously; like the
 * version-snapshot coverage in `datasets.live.test.ts`, it opts in via
 * `ULTRALYTICS_SMOKE_DATASET_REF=owner/slug` and skips without it, so this
 * suite never selects or mutates an arbitrary dataset. The referenced
 * project/model are created fresh and deleted; the dataset itself is only
 * read. Training is expected to be rejected before billing; if the platform
 * ever accepts it instead, the test fails loudly on the credits assertion
 * rather than silently leaving a job running.
 *
 * Skipped silently without `ULTRALYTICS_API_KEY` and excluded from
 * `npm test`, exactly like the other live smoke suites.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * export ULTRALYTICS_SMOKE_DATASET_REF=owner/a-ready-detect-dataset
 * npm run test:live
 * ```
 */

import { describe, expect, test } from "vitest";
import { UltralyticsApiError } from "../../src/errors.js";
import {
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsIngest,
  exploreDatasets,
} from "../../src/tools/datasets.js";
import { modelsDelete } from "../../src/tools/models.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

async function catchApiError(
  promise: Promise<unknown>,
): Promise<UltralyticsApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UltralyticsApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject with an UltralyticsApiError");
}

describe.skipIf(!apiKey)("enum cache removal live smoke", () => {
  test("explore task filter: rejects a bogus task and accepts `depth`, which the removed allowlist excluded", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    const badTaskError = await catchApiError(
      exploreDatasets(client, {
        q: "mcp-smoke-not-a-real-query",
        task: ["mcp-smoke-not-a-real-task"],
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(badTaskError.statusCode).toBe(400);

    // `depth` is a valid dataset task the removed client-side allowlist
    // (detect/segment/semantic/classify/pose/obb) did not include: sending
    // it must reach the network and return 200, not a locally-thrown error.
    const depthResult = await exploreDatasets(client, {
      q: "mcp-smoke-not-a-real-query",
      task: ["depth"],
    });
    expect(lastStatus(records)).toBe(200);
    expect(depthResult.data).toMatchObject({ datasets: [] });
  }, 30_000);

  test("dataset create: rejects an unrecognized task with the server's own message, naming `depth` among the valid values", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    const slug = disposableSlug("mcp-smoke-enum-ds");

    const error = await catchApiError(
      datasetsCreate(client, {
        name: "MCP smoke enum probe (disposable)",
        dataset: slug,
        task: "mcp-smoke-not-a-real-task",
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(error.statusCode).toBe(400);
    expect(error.apiMessage.toLowerCase()).toContain("depth");

    // No dataset was created: the create-then-verify-then-delete round trip
    // never gets a resource to delete.
    const listing = await client.get(`/datasets/${owner}`);
    const datasets = (listing as { datasets?: Array<{ dataset?: string }> })
      .datasets;
    expect(datasets?.some((entry) => entry.dataset === slug)).toBe(false);
  }, 30_000);

  test("dataset images/ingest: rejects an unrecognized split and conflictPolicy with the server's own message", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    const slug = disposableSlug("mcp-smoke-enum-ds");
    const ref = `${owner}/${slug}`;

    await withDisposableCleanup(
      "dataset",
      ref,
      async () => {
        await datasetsDelete(client, ref);
      },
      async () => {
        await datasetsCreate(client, {
          name: "MCP smoke enum probe (disposable)",
          dataset: slug,
          task: "detect",
        });

        const splitError = await catchApiError(
          datasetImagesList(client, {
            dataset: ref,
            split: "mcp-smoke-not-a-real-split",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(splitError.statusCode).toBe(400);
        expect(splitError.apiMessage).toMatch(/train.*val.*test/i);

        const targetSplitError = await catchApiError(
          datasetsIngest(client, {
            dataset: ref,
            sourceUrl: "https://example.invalid/never-fetched.zip",
            targetSplit: "mcp-smoke-not-a-real-split",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(targetSplitError.statusCode).toBe(400);
        // The ingest endpoint's request body is validated as one of several
        // anyOf branches, so an unrecognized enum value surfaces as a
        // generic rejection rather than naming the field — still the
        // server's own message, surfaced verbatim rather than substituted.
        expect(targetSplitError.apiMessage).toBe("Invalid input");

        const conflictPolicyError = await catchApiError(
          datasetsIngest(client, {
            dataset: ref,
            sourceUrl: "https://example.invalid/never-fetched.zip",
            conflictPolicy: "mcp-smoke-not-a-real-policy",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(conflictPolicyError.statusCode).toBe(400);
        expect(conflictPolicyError.apiMessage).toBe("Invalid input");

        await datasetsDelete(client, ref);
      },
    );
  }, 60_000);

  test("training start: rejects a checkpoint/dataset task mismatch before any compute runs", async (ctx) => {
    const datasetRef = process.env.ULTRALYTICS_SMOKE_DATASET_REF?.trim();
    if (!datasetRef) {
      ctx.skip(
        "task-mismatch coverage needs ULTRALYTICS_SMOKE_DATASET_REF=" +
          "owner/slug pointing at a ready, labeled dataset.",
      );
    }
    const [datasetOwner, datasetSlug] = (datasetRef as string).split("/");

    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();
    const before = (await client.get("/account/summary")) as {
      creditsCents: number;
    };

    const datasetDetail = (await client.get(
      `/datasets/${datasetOwner}/${datasetSlug}`,
    )) as { dataset: { task: string } };
    const datasetTask = datasetDetail.dataset.task;
    // Any checkpoint task other than the dataset's own is a mismatch; a
    // classify checkpoint is used unless the dataset itself is classify.
    const mismatchedCheckpoint =
      datasetTask === "classify" ? "yolo26n.pt" : "yolo26n-cls.pt";

    const projectSlug = disposableSlug("mcp-smoke-enum-mismatch");
    const projectRef = `${owner}/${projectSlug}`;

    await withDisposableCleanup(
      "project",
      projectRef,
      async () => {
        await projectsDelete(client, projectRef);
      },
      async () => {
        await projectsCreate(client, {
          name: "MCP smoke enum mismatch (disposable)",
          project: projectSlug,
        });

        const created = (await client.postJson("/models", {
          owner,
          project: projectSlug,
          task: mismatchedCheckpoint === "yolo26n.pt" ? "detect" : "classify",
        })) as { model: string };
        const modelSlug = created.model;
        const modelRef = `${owner}/${projectSlug}/${modelSlug}`;

        await withDisposableCleanup(
          "model",
          modelRef,
          async () => {
            await modelsDelete(client, modelRef);
          },
          async () => {
            // Direct call, not through trainingStart: this pins the
            // server's own pre-flight message, independent of the tool.
            const modelDetail = (await client.get(
              `/models/${owner}/${projectSlug}/${modelSlug}`,
            )) as { model: { id: string } };
            const modelId = modelDetail.model.id;

            const mismatchError = await catchApiError(
              client.postJson("/training/start", {
                modelId,
                gpuType: "rtx-2000-ada",
                trainArgs: {
                  model: mismatchedCheckpoint,
                  data: `ul://${datasetOwner}/datasets/${datasetSlug}`,
                  epochs: 1,
                },
              }),
            );
            expect(mismatchError.statusCode).toBe(400);
            expect(mismatchError.apiMessage.toLowerCase()).toContain(
              "task mismatch",
            );

            const after = (await client.get("/account/summary")) as {
              creditsCents: number;
            };
            expect(after.creditsCents).toBe(before.creditsCents);

            await modelsDelete(client, modelRef);
          },
        );

        await projectsDelete(client, projectRef);
      },
    );
  }, 60_000);
});
