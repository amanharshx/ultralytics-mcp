/** Live smoke test for the model, training, and export tools.
 *
 * Fails when the platform changes its contract underneath us (paths,
 * statuses, or response field names). Skipped silently without a key so
 * contributors without credentials are unaffected, and excluded from
 * `npm test` so ordinary development stays offline and fast.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npm run test:live
 * ```
 *
 * The key is read from the `ULTRALYTICS_API_KEY` environment variable, the
 * same variable the server reads. The round-trip test creates one disposable
 * `mcp-smoke-*` project and one model inside it, and deletes both again, even
 * when an assertion fails. Model creation is free (`POST /models` starts no
 * compute), so this suite reads through the tool functions but creates the
 * fixture with a direct `client.postJson` call, exactly as the projects and
 * datasets suites use direct calls for setup the tool surface doesn't expose.
 * The recording and cleanup harness is shared with those suites
 * (live-harness.ts).
 *
 * Starting training or creating an export bills the account, so neither is
 * exercised here: `training_start` and `export_create` keep their own live
 * verification. The surfaces that need a model with real weights and history
 * — `model_download`, `model_predict`, a terminal-status `training_cancel`
 * refusal, and the export tools' field shapes — are covered against one
 * existing fixture chosen out-of-band, opted into with
 * `ULTRALYTICS_SMOKE_EXPORT_REF=owner/project/model:exportId`. The fixture
 * must be a trained model with downloadable weights, a terminal training
 * status, and an export whose own job has also reached a terminal status.
 * This suite skips that coverage when the variable is absent, so it never
 * selects an arbitrary model or export on its own.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { modelDownload } from "../../src/tools/downloads.js";
import {
  exportCancel,
  exportStatus,
  exportsList,
} from "../../src/tools/exports.js";
import { modelsDelete, modelsGet, modelsList } from "../../src/tools/models.js";
import { modelPredict } from "../../src/tools/predict.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import { trainingCancel, trainingMonitor } from "../../src/tools/training.js";
import {
  assertDeleted,
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

/** Split `owner/project/model:exportId` into its model ref and export id. */
function parseExportFixtureRef(ref: string): {
  modelRef: string;
  exportId: string;
} {
  const separator = ref.lastIndexOf(":");
  if (separator === -1) {
    throw new Error(
      `ULTRALYTICS_SMOKE_EXPORT_REF must be 'owner/project/model:exportId', got '${ref}'.`,
    );
  }
  return {
    modelRef: ref.slice(0, separator),
    exportId: ref.slice(separator + 1),
  };
}

/** A public, stable sample image `model_predict` can fetch without a local
 * upload path or a base64 payload near the tool's argument-size limits. */
const SAMPLE_IMAGE_URL = "https://ultralytics.com/images/bus.jpg";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

/** Success statuses captured against the live API; a change fails loudly. */
const EXPECTED_STATUS = {
  accountSummary: 200,
  projectCreate: 201,
  modelCreate: 201,
  list: 200,
  get: 200,
  trainingGet: 200,
  exportsList: 200,
  modelDelete: 200,
  projectDelete: 200,
} as const;

describe.skipIf(!apiKey)(
  "models, training, and export tools live smoke",
  () => {
    test("model, training, and export reads round-trip on a disposable model", async () => {
      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);
      const owner = await client.getAccountOwner();
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

      const projectSlug = disposableSlug("mcp-smoke");
      const projectRef = `${owner}/${projectSlug}`;
      await withDisposableCleanup(
        "project",
        projectRef,
        async () => {
          assertDeleted(
            "project",
            projectRef,
            await projectsDelete(client, projectRef),
          );
        },
        async () => {
          const project = await projectsCreate(client, {
            name: "MCP smoke (disposable)",
            project: projectSlug,
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.projectCreate);
          expect((project.data as Record<string, unknown>).project).toBe(
            projectSlug,
          );

          // `models_create` is not a tool the server exposes; the only paths
          // that create a model are `training_start`'s checkpoint mode
          // (billable) and this direct call, exactly like the direct
          // `/upload/signed-url` probe the datasets suite uses for setup the
          // tool surface doesn't cover. Model creation itself starts no
          // compute and is free.
          const created = (await client.postJson("/models", {
            owner,
            project: projectSlug,
            task: "detect",
          })) as Record<string, unknown>;
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.modelCreate);
          const modelSlug = created.model as string;
          expect(typeof modelSlug).toBe("string");
          const modelRef = `${owner}/${projectSlug}/${modelSlug}`;

          await withDisposableCleanup(
            "model",
            modelRef,
            async () => {
              assertDeleted(
                "model",
                modelRef,
                await modelsDelete(client, modelRef),
              );
            },
            async () => {
              const listed = await modelsList(client, projectRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
              const listItems = listed.data as Array<Record<string, unknown>>;
              const listMatch = listItems.find(
                (item) => item.slug === modelSlug,
              );
              expect(listMatch).toBeDefined();
              expect(typeof listMatch?.id).toBe("string");
              expect(listMatch?.username).toBe(owner);
              expect(typeof listMatch?.status).toBe("string");
              expect(typeof listMatch?.task).toBe("string");

              const got = await modelsGet(client, modelRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
              const gotData = got.data as { model: Record<string, unknown> };
              // `training_start` depends on this exact field to resolve the
              // model's database id before posting to `/training/start`; a
              // rename here breaks that tool silently.
              expect(typeof gotData.model.id).toBe("string");
              expect((gotData.model.id as string).length).toBeGreaterThan(0);
              expect(gotData.model.owner).toBe(owner);
              expect(gotData.model.project).toBe(projectSlug);
              expect(gotData.model.slug).toBe(modelSlug);
              expect(gotData.model.status).toBe("untrained");
              expect(gotData.model.hasWeights).toBe(false);

              const monitored = await trainingMonitor(client, modelRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.trainingGet);
              const monitoredData = monitored.data as Record<string, unknown>;
              expect(monitoredData.modelId).toBe(gotData.model.id);
              expect(monitoredData.status).toBe("untrained");
              // A never-trained model still carries a job record rather than
              // a null one; its status names the same untrained state as the
              // model record.
              expect(monitoredData.jobStatus).toBe("untrained");
              expect(monitoredData.epochsDone).toBe(0);

              // The published contract disagrees with the platform twice over
              // (REST docs claim 409, the OpenAPI spec claims a `warning`
              // field); live behavior is a 400 whose message names the job's
              // actual status. This pins the refusal for a job that never
              // started; the fixture-backed test below pins the same
              // refusal for a job that already finished, since those are
              // different states and either could regress independently.
              await expect(trainingCancel(client, modelRef)).rejects.toThrow(
                /cannot cancel training with status: untrained/i,
              );

              const deletedModel = await modelsDelete(client, modelRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.modelDelete);
              assertDeleted("model", modelRef, deletedModel);
            },
          );

          const deletedProject = await projectsDelete(client, projectRef);
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.projectDelete);
          assertDeleted("project", projectRef, deletedProject);
        },
      );
    }, 120_000);

    test("download, predict, terminal cancel, and export shape on a trained fixture", async (ctx) => {
      // Explicit fixture only: never auto-select a model or export to read,
      // download, predict against, or cancel. The fixture must already be a
      // trained model with downloadable weights, a terminal training status,
      // and an export whose own job has also reached a terminal status —
      // creating any of that costs credits and belongs to training_start's
      // and export_create's own live verification, not this smoke test.
      const exportRef = process.env.ULTRALYTICS_SMOKE_EXPORT_REF?.trim();
      if (!exportRef) {
        ctx.skip(
          "this coverage needs ULTRALYTICS_SMOKE_EXPORT_REF=" +
            "owner/project/model:exportId pointing at a trained model with " +
            "downloadable weights, a terminal training status, and an " +
            "export whose job has also reached a terminal status.",
        );
      }
      const { modelRef, exportId } = parseExportFixtureRef(exportRef);

      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);

      // `model_download` reads real weights through the signed-URL flow.
      // The output goes to a disposable temp directory removed in `finally`,
      // since this test only proves the download path works, not a file the
      // suite wants to keep.
      const downloadDir = await mkdtemp(join(tmpdir(), "mcp-smoke-dl-"));
      try {
        const outputPath = join(downloadDir, "weights.pt");
        const downloaded = await modelDownload(client, modelRef, {
          outputPath,
        });
        const downloadedData = downloaded.data as Record<string, unknown>;
        expect(downloadedData.path).toBe(outputPath);
        expect(typeof downloadedData.bytes).toBe("number");
        expect(downloadedData.bytes as number).toBeGreaterThan(0);
      } finally {
        await rm(downloadDir, { recursive: true, force: true });
      }

      // `model_predict` runs real inference against a public sample image.
      const predicted = await modelPredict(client, modelRef, {
        source: SAMPLE_IMAGE_URL,
      });
      const predictedData = predicted.data as { images: unknown };
      expect(Array.isArray(predictedData.images)).toBe(true);
      const images = predictedData.images as Array<Record<string, unknown>>;
      expect(images.length).toBeGreaterThan(0);
      expect(Array.isArray(images[0].shape)).toBe(true);
      expect(typeof images[0].speed).toBe("object");
      expect(Array.isArray(images[0].results)).toBe(true);

      // `training_cancel` on a job that already finished must surface the
      // platform's own message naming that terminal status, not the
      // documented 409/warning shape — the case the untrained-model test
      // above cannot reach, since that job never started.
      const monitored = await trainingMonitor(client, modelRef);
      const monitoredData = monitored.data as Record<string, unknown>;
      const terminalJobStatus = monitoredData.jobStatus as string;
      expect(["completed", "failed", "cancelled"]).toContain(terminalJobStatus);
      await expect(trainingCancel(client, modelRef)).rejects.toThrow(
        new RegExp(
          `cannot cancel training with status: ${terminalJobStatus}`,
          "i",
        ),
      );

      // `exports_list` must actually contain this export id with its mapped
      // fields. A same-shaped empty array on a renamed `exports` field would
      // pass a check that only asserts an empty list on a fresh model, so
      // this asserts a real match instead.
      const listed = await exportsList(client, modelRef);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.exportsList);
      const listedItems = listed.data as Array<Record<string, unknown>>;
      const listedMatch = listedItems.find((item) => item.id === exportId);
      expect(listedMatch).toBeDefined();
      expect(typeof listedMatch?.format).toBe("string");
      expect(["completed", "failed", "cancelled"]).toContain(
        listedMatch?.status,
      );

      const status = await exportStatus(client, modelRef, exportId);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
      const statusData = status.data as Record<string, unknown>;
      expect(statusData.id).toBe(exportId);
      expect(statusData.format).toBe(listedMatch?.format);
      expect(typeof statusData.createdAt).toBe("string");
      // `export_cancel` reads exactly this field to decide whether the
      // destructive verb is safe to send; a terminal status here must refuse.
      const terminalExportStatus = statusData.status as string;
      expect(["completed", "cancelled", "failed"]).toContain(
        terminalExportStatus,
      );

      await expect(exportCancel(client, modelRef, exportId)).rejects.toThrow(
        /is not active/i,
      );
    }, 180_000);
  },
);
