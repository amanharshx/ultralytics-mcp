/** Live smoke test asserting the platform still enforces the rules four
 * removed client-side allowlists used to cache locally.
 *
 * Housekeeping ticket 2 removed `DATASET_TASKS` (explore.ts and datasets.ts,
 * duplicated), `TARGET_SPLITS`' use as an input validator, the ingest
 * conflict-policy enum check, and `DATASET_TASK_COMPATIBILITY`
 * (training.ts). Each was verified live before removal per "verify, then
 * delete": this suite is that verification recorded as a live regression
 * check, exactly like `export-format.live.test.ts` did for the
 * export-format allowlist. One finding surfaced during verification: the
 * removed dataset-task allowlist excluded `depth`, a task value the server
 * accepts — this suite asserts that acceptance too, so the finding stays
 * pinned.
 *
 * "Surfaces verbatim" is proved the same way `export-format.live.test.ts`
 * proves it: an independent, direct call to the same endpoint captures the
 * server's raw message, and the tool's surfaced message is compared for
 * exact equality against that raw capture — not a substring or a regex,
 * which would pass even if the tool substituted or reformatted the message.
 *
 * Every case here is either a GET, a rejected write (400 before any
 * resource is created), or a disposable resource cleaned up in a
 * `finally`. The checkpoint/dataset task-mismatch case needs a ready,
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
import { trainingStart } from "../../src/tools/training.js";
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
  test("explore task filter: rejects a bogus task with the server's own message and accepts `depth`, which the removed allowlist excluded", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    // Independent raw call to the same endpoint: pins the server's own
    // message, uncoupled from exploreDatasets's own handling.
    const rawBadTaskError = await catchApiError(
      client.get("/explore/search", {
        type: "datasets",
        q: "mcp-smoke-not-a-real-query",
        sort: "newest",
        offset: 0,
        task: "mcp-smoke-not-a-real-task",
      }),
    );
    expect(rawBadTaskError.statusCode).toBe(400);

    const badTaskError = await catchApiError(
      exploreDatasets(client, {
        q: "mcp-smoke-not-a-real-query",
        task: ["mcp-smoke-not-a-real-task"],
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(badTaskError.statusCode).toBe(400);
    // The tool surfaces the server's own message rather than substituting
    // its own: exact match against the independent raw call above.
    expect(badTaskError.apiMessage).toBe(rawBadTaskError.apiMessage);

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

    // Independent raw call: pins the server's own message, uncoupled from
    // datasetsCreate's own handling.
    const rawError = await catchApiError(
      client.postJson("/datasets", {
        dataset: disposableSlug("mcp-smoke-enum-ds-raw"),
        name: "MCP smoke enum probe raw (disposable)",
        task: "mcp-smoke-not-a-real-task",
      }),
    );
    expect(rawError.statusCode).toBe(400);
    expect(rawError.apiMessage.toLowerCase()).toContain("depth");

    const error = await catchApiError(
      datasetsCreate(client, {
        name: "MCP smoke enum probe (disposable)",
        dataset: slug,
        task: "mcp-smoke-not-a-real-task",
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(error.statusCode).toBe(400);
    expect(error.apiMessage).toBe(rawError.apiMessage);

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
    const encodedRef = `${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;

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

        const rawSplitError = await catchApiError(
          client.get(`/datasets/${encodedRef}/images`, {
            split: "mcp-smoke-not-a-real-split",
          }),
        );
        expect(rawSplitError.statusCode).toBe(400);
        expect(rawSplitError.apiMessage).toMatch(/train.*val.*test/i);

        const splitError = await catchApiError(
          datasetImagesList(client, {
            dataset: ref,
            split: "mcp-smoke-not-a-real-split",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(splitError.statusCode).toBe(400);
        expect(splitError.apiMessage).toBe(rawSplitError.apiMessage);

        const rawTargetSplitError = await catchApiError(
          client.postJson(`/datasets/${encodedRef}/ingest`, {
            sourceUrl: "https://example.invalid/never-fetched.zip",
            targetSplit: "mcp-smoke-not-a-real-split",
            conflictPolicy: "skip",
          }),
        );
        expect(rawTargetSplitError.statusCode).toBe(400);

        const targetSplitError = await catchApiError(
          datasetsIngest(client, {
            dataset: ref,
            sourceUrl: "https://example.invalid/never-fetched.zip",
            targetSplit: "mcp-smoke-not-a-real-split",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(targetSplitError.statusCode).toBe(400);
        expect(targetSplitError.apiMessage).toBe(
          rawTargetSplitError.apiMessage,
        );

        const rawConflictPolicyError = await catchApiError(
          client.postJson(`/datasets/${encodedRef}/ingest`, {
            sourceUrl: "https://example.invalid/never-fetched.zip",
            conflictPolicy: "mcp-smoke-not-a-real-policy",
          }),
        );
        expect(rawConflictPolicyError.statusCode).toBe(400);

        const conflictPolicyError = await catchApiError(
          datasetsIngest(client, {
            dataset: ref,
            sourceUrl: "https://example.invalid/never-fetched.zip",
            conflictPolicy: "mcp-smoke-not-a-real-policy",
          }),
        );
        expect(lastStatus(records)).toBe(400);
        expect(conflictPolicyError.statusCode).toBe(400);
        expect(conflictPolicyError.apiMessage).toBe(
          rawConflictPolicyError.apiMessage,
        );

        await datasetsDelete(client, ref);
      },
    );
  }, 60_000);

  test("training start: rejects a checkpoint/dataset task mismatch before any compute runs, and deletes the model it created", async (ctx) => {
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
    const mismatchedModelTask =
      mismatchedCheckpoint === "yolo26n.pt" ? "detect" : "classify";

    // --- Raw probe: pins the server's own pre-flight message, independent
    // of trainingStart's own handling, in its own disposable project/model.
    const rawProjectSlug = disposableSlug("mcp-smoke-enum-mismatch-raw");
    const rawProjectRef = `${owner}/${rawProjectSlug}`;
    let rawMismatchMessage = "";

    await withDisposableCleanup(
      "project",
      rawProjectRef,
      async () => {
        await projectsDelete(client, rawProjectRef);
      },
      async () => {
        await projectsCreate(client, {
          name: "MCP smoke enum mismatch raw (disposable)",
          project: rawProjectSlug,
        });

        const created = (await client.postJson("/models", {
          owner,
          project: rawProjectSlug,
          task: mismatchedModelTask,
        })) as { model: string };
        const modelRef = `${owner}/${rawProjectSlug}/${created.model}`;

        await withDisposableCleanup(
          "model",
          modelRef,
          async () => {
            await modelsDelete(client, modelRef);
          },
          async () => {
            const modelDetail = (await client.get(
              `/models/${owner}/${rawProjectSlug}/${created.model}`,
            )) as { model: { id: string } };

            const rawMismatchError = await catchApiError(
              client.postJson("/training/start", {
                modelId: modelDetail.model.id,
                gpuType: "rtx-2000-ada",
                trainArgs: {
                  model: mismatchedCheckpoint,
                  data: `ul://${datasetOwner}/datasets/${datasetSlug}`,
                  epochs: 1,
                },
              }),
            );
            expect(rawMismatchError.statusCode).toBe(400);
            expect(rawMismatchError.apiMessage.toLowerCase()).toContain(
              "task mismatch",
            );
            rawMismatchMessage = rawMismatchError.apiMessage;

            await modelsDelete(client, modelRef);
          },
        );

        await projectsDelete(client, rawProjectRef);
      },
    );

    // --- Through the real tool: proves trainingStart itself surfaces the
    // same message verbatim, and that it deletes the model it created
    // rather than leaving it behind on this provable (4xx) rejection.
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

        const mismatchError = await catchApiError(
          trainingStart(client, {
            model: mismatchedCheckpoint,
            project: projectRef,
            dataset: datasetRef as string,
            gpuType: "rtx-2000-ada",
            epochs: 1,
            confirmCost: true,
          }),
        );
        expect(mismatchError.statusCode).toBe(400);
        expect(mismatchError.apiMessage).toBe(rawMismatchMessage);

        // trainingStart deletes the model it created for this run once the
        // server rejects it: nothing is left behind to clean up here.
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
