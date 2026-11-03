/** Live check that `training_start` routes base checkpoints by shape and
 * ownership rather than a local list of model families.
 *
 * The platform publishes YOLOv5 only as `yolov5nu` … `yolov5xu`; a cached
 * family regex once rejected both `yolov5nu.pt` and
 * `ul://ultralytics/yolov5/yolov5nu`, and routed the second to the
 * history-loss prompt on Ultralytics' own public model. This suite trains
 * each form for one epoch in a disposable project and waits for the run to
 * finish, so it proves the server accepted the checkpoint and not merely
 * the start request. It then retrains one of those just-trained models
 * without `confirm_history_loss`, which must still be refused before any
 * start: an owned model with history keeps its consent gate.
 *
 * Billable: about 1¢ per form. Like the task-mismatch case in
 * `enum-cache-removal.live.test.ts`, it needs a ready, labeled detect
 * dataset and opts in via `ULTRALYTICS_SMOKE_DATASET_REF=owner/slug`,
 * skipping without it, so it never selects an arbitrary dataset. The
 * dataset is only read. The project and every model it holds are deleted
 * afterwards, even when an assertion fails.
 *
 * Skipped silently without `ULTRALYTICS_API_KEY` and excluded from
 * `npm test`, exactly like the other live smoke suites.
 */

import { describe, expect, test } from "vitest";
import { modelsDelete } from "../../src/tools/models.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import {
  trainingCancel,
  trainingMonitor,
  trainingStart,
} from "../../src/tools/training.js";
import {
  disposableSlug,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 15_000;
const RUN_TIMEOUT_MS = 12 * 60_000;

describe.skipIf(!apiKey)("training_start checkpoint routing (live)", () => {
  test(
    "trains yolov5nu.pt and ul://ultralytics/yolov5/yolov5nu, and still gates an owned model with history",
    async (ctx) => {
      const datasetRef = process.env.ULTRALYTICS_SMOKE_DATASET_REF?.trim();
      if (!datasetRef) {
        ctx.skip(
          "checkpoint routing coverage needs ULTRALYTICS_SMOKE_DATASET_REF=" +
            "owner/slug pointing at a ready, labeled detect dataset.",
        );
      }

      const client = recordingClient(apiKey as string, []);
      const owner = await client.getAccountOwner();
      const projectSlug = disposableSlug("zz-mcp-smoke-v5u");
      const projectRef = `${owner}/${projectSlug}`;
      const started: string[] = [];

      const stopAndDeleteModels = async () => {
        for (const ref of started) {
          const monitor = await trainingMonitor(client, ref);
          const status = (monitor.data as { status: unknown }).status;
          if (!TERMINAL_STATUSES.has(String(status))) {
            await trainingCancel(client, ref);
          }
          await modelsDelete(client, ref);
        }
      };

      await withDisposableCleanup(
        "project",
        projectRef,
        async () => {
          await stopAndDeleteModels();
          await projectsDelete(client, projectRef);
        },
        async () => {
          await projectsCreate(client, {
            name: "zz MCP smoke yolov5u checkpoints (disposable)",
            project: projectSlug,
          });

          for (const model of [
            "yolov5nu.pt",
            "ul://ultralytics/yolov5/yolov5nu",
          ]) {
            // No confirm_history_loss: Ultralytics' public model is a
            // completed run, so this would fail if it reached the gate.
            const result = await trainingStart(client, {
              model,
              project: projectRef,
              dataset: datasetRef as string,
              gpuType: "rtx-a6000",
              epochs: 1,
              imgsz: 320,
              confirmCost: true,
            });
            const data = result.data as {
              owner: string;
              project: string;
              model: string;
            };
            expect(data.project).toBe(projectSlug);
            started.push(`${data.owner}/${data.project}/${data.model}`);
          }

          // An owned model with a recorded run (a job already past
          // pending/untrained counts) still needs confirm_history_loss, and
          // is refused before anything is started.
          await expect(
            trainingStart(client, {
              model: started[0] as string,
              project: projectRef,
              dataset: datasetRef as string,
              gpuType: "rtx-a6000",
              epochs: 1,
              confirmCost: true,
            }),
          ).rejects.toThrow(
            /already has a recorded run.*confirm_history_loss/s,
          );

          const deadline = Date.now() + RUN_TIMEOUT_MS;
          const finalStatus = new Map<string, string>();
          while (finalStatus.size < started.length && Date.now() < deadline) {
            for (const ref of started) {
              if (finalStatus.has(ref)) continue;
              const monitor = await trainingMonitor(client, ref);
              const status = String(
                (monitor.data as { status: unknown }).status,
              );
              if (TERMINAL_STATUSES.has(status)) finalStatus.set(ref, status);
            }
            if (finalStatus.size < started.length) {
              await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            }
          }
          expect(Object.fromEntries(finalStatus)).toEqual(
            Object.fromEntries(started.map((ref) => [ref, "completed"])),
          );

          await stopAndDeleteModels();
          started.length = 0;
          await projectsDelete(client, projectRef);
        },
      );
    },
    RUN_TIMEOUT_MS + 120_000,
  );
});
