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
 * verification in their tickets. Export status shape is instead covered
 * against an existing export chosen out-of-band, opted into with
 * `ULTRALYTICS_SMOKE_EXPORT_REF=owner/project/model:exportId`. It skips when
 * the variable is absent, so this suite never selects or cancels an
 * arbitrary export.
 */

import { describe, expect, test } from "vitest";
import {
  exportCancel,
  exportStatus,
  exportsList,
} from "../../src/tools/exports.js";
import { modelsDelete, modelsGet, modelsList } from "../../src/tools/models.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import { trainingCancel, trainingMonitor } from "../../src/tools/training.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

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
          const cleanup = await projectsDelete(client, projectRef);
          const cleanupData = cleanup.data as Record<string, unknown>;
          if (cleanupData.success !== true) {
            throw new Error(
              `cleanup delete reported success:false for '${projectRef}'`,
            );
          }
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
              const cleanup = await modelsDelete(client, modelRef);
              const cleanupData = cleanup.data as Record<string, unknown>;
              if (cleanupData.success !== true) {
                throw new Error(
                  `cleanup delete reported success:false for '${modelRef}'`,
                );
              }
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
              // actual status. `training_cancel` must surface that message
              // verbatim rather than branch on either documented shape.
              await expect(trainingCancel(client, modelRef)).rejects.toThrow(
                /cannot cancel training with status: untrained/i,
              );

              const exported = await exportsList(client, modelRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.exportsList);
              expect(exported.data).toEqual([]);

              const deletedModel = await modelsDelete(client, modelRef);
              expect(lastStatus(records)).toBe(EXPECTED_STATUS.modelDelete);
              expect(
                (deletedModel.data as Record<string, unknown>).success,
              ).toBe(true);
            },
          );

          const deletedProject = await projectsDelete(client, projectRef);
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.projectDelete);
          expect((deletedProject.data as Record<string, unknown>).success).toBe(
            true,
          );
        },
      );
    }, 120_000);

    test("export status shape and cancel refusal on a terminal export", async (ctx) => {
      // Explicit fixture only: never auto-select an export to read or cancel.
      // Creating one costs credits and belongs to export_create's own live
      // verification, not this smoke test.
      const exportRef = process.env.ULTRALYTICS_SMOKE_EXPORT_REF?.trim();
      if (!exportRef) {
        ctx.skip(
          "export status coverage needs ULTRALYTICS_SMOKE_EXPORT_REF=" +
            "owner/project/model:exportId pointing at an export whose job has " +
            "reached a terminal status (completed or cancelled).",
        );
      }
      const separator = (exportRef as string).lastIndexOf(":");
      if (separator === -1) {
        throw new Error(
          `ULTRALYTICS_SMOKE_EXPORT_REF must be 'owner/project/model:exportId', got '${exportRef}'.`,
        );
      }
      const modelRef = (exportRef as string).slice(0, separator);
      const exportId = (exportRef as string).slice(separator + 1);

      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);

      const status = await exportStatus(client, modelRef, exportId);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
      const statusData = status.data as Record<string, unknown>;
      expect(statusData.id).toBe(exportId);
      expect(typeof statusData.format).toBe("string");
      expect(typeof statusData.status).toBe("string");
      expect(typeof statusData.createdAt).toBe("string");
      // `export_cancel` reads exactly this field to decide whether the
      // destructive verb is safe to send; a terminal status here must refuse.
      const terminalStatus = statusData.status as string;
      expect(["completed", "cancelled", "failed"]).toContain(terminalStatus);

      await expect(exportCancel(client, modelRef, exportId)).rejects.toThrow(
        /is not active/i,
      );
    }, 60_000);
  },
);
