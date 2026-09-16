/** Live smoke test for `auto_annotate_status`.
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
 * `momox/coco8` (public, detect, 8 images, all labelled) is cloned into a
 * disposable dataset for the duration of one test, since auto-annotation
 * cannot run against a dataset in the same workspace it was cloned from and
 * every image already carries a label (`includeAnnotated: true` is required
 * to get a run to actually process anything). `support-doe/pothole/exp-2`
 * is a 1-class detect model; `classMapping: [0]` bridges it onto coco8's
 * 80-class taxonomy for the success run, and is deliberately omitted for
 * the failure run. The clone is deleted and purged from trash in a
 * `finally`, and the run cost is reported as a `creditsCents` delta.
 */

import { describe, expect, test } from "vitest";

import { getApiBase } from "../../src/config.js";
import { autoAnnotateStatus } from "../../src/tools/auto-annotate.js";
import { datasetsDelete } from "../../src/tools/datasets.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const SOURCE_OWNER = "momox";
const SOURCE_DATASET = "coco8";
const MODEL_ID = "ul://support-doe/pothole/exp-2";

/** Permanently purge a trashed dataset. Not a shipped tool: this ticket
 * only ships a read, so the raw endpoint is called directly for cleanup. */
async function purgeDatasetFromTrash(key: string, id: string): Promise<void> {
  const response = await fetch(`${getApiBase()}/trash`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ id, type: "dataset" }),
  });
  if (!response.ok) {
    throw new Error(
      `trash purge failed for dataset '${id}': ${response.status} ${await response.text()}`,
    );
  }
}

async function creditsCents(key: string): Promise<number> {
  const response = await fetch(`${getApiBase()}/account/summary`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = (await response.json()) as Record<string, unknown>;
  const credits = body.creditsCents ?? body.credits;
  if (typeof credits !== "number") {
    throw new Error("account summary did not report creditsCents");
  }
  return credits;
}

describe.skipIf(!apiKey)("auto_annotate_status live smoke", () => {
  test("never-run, active, terminal-success, and terminal-failure states", async () => {
    const key = apiKey as string;
    const records: RecordedCall[] = [];
    const client = recordingClient(key, records);
    const owner = await client.getAccountOwner();

    const slug = disposableSlug("zz-mcp-throwaway-aa");
    const ref = `${owner}/${slug}`;
    const captures: Record<string, unknown> = {};
    const creditsBefore = await creditsCents(key);

    let datasetId: string | null = null;
    try {
      const cloned = (await client.postJson(
        `/datasets/${encodeURIComponent(SOURCE_OWNER)}/${encodeURIComponent(SOURCE_DATASET)}/clone`,
        { dataset: slug, visibility: "private" },
      )) as Record<string, unknown>;
      expect(lastStatus(records)).toBe(201);
      datasetId = String(cloned.id);
      expect(typeof cloned.id).toBe("string");

      // Never-run: a freshly cloned dataset has no auto-annotation history.
      const neverRun = await autoAnnotateStatus(client, ref);
      expect(lastStatus(records)).toBe(200);
      expect(neverRun.data).toEqual({ activeJob: null, lastRun: null });
      captures.neverRun = neverRun.data;

      // Start a run bridging the 1-class model onto coco8's 80 classes.
      // includeAnnotated is required: coco8 ships fully labelled.
      const started = (await client.postJson(
        `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/predict/batch`,
        { modelId: MODEL_ID, classMapping: [0], includeAnnotated: true },
      )) as Record<string, unknown>;
      expect(lastStatus(records)).toBe(202);
      expect(typeof started.jobId).toBe("string");

      // Tight-loop poll from the instant the 202 lands: an 8-image run can
      // finish in seconds, so this is a best-effort capture of the active
      // shape, not a required one.
      let active: Record<string, unknown> | null = null;
      for (let i = 0; i < 20; i++) {
        const status = await autoAnnotateStatus(client, ref);
        expect(lastStatus(records)).toBe(200);
        const data = status.data as Record<string, unknown>;
        if (data.activeJob !== null) {
          active = data;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (active) {
        captures.active = active;
        const activeJob = active.activeJob as Record<string, unknown>;
        expect(typeof activeJob.id).toBe("string");
        expect(typeof activeJob.stopping).toBe("boolean");
        const progress = activeJob.progress as Record<string, unknown>;
        expect(typeof progress.processed).toBe("number");
        expect(typeof progress.total).toBe("number");
        expect(typeof activeJob.startedAt).toBe("string");
      }

      // Poll to the terminal state.
      const deadline = Date.now() + 60_000;
      let terminalSuccess: Record<string, unknown> | null = null;
      while (Date.now() < deadline) {
        const status = await autoAnnotateStatus(client, ref);
        expect(lastStatus(records)).toBe(200);
        const data = status.data as Record<string, unknown>;
        if (data.activeJob === null && data.lastRun !== null) {
          terminalSuccess = data;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!terminalSuccess) {
        throw new Error("run did not reach a terminal state in time");
      }
      captures.terminalSuccess = terminalSuccess;
      const successRun = terminalSuccess.lastRun as Record<string, unknown>;
      expect(successRun.failed).toBe(false);
      expect(successRun.error).toBeNull();
      expect(successRun.results).not.toBeNull();

      // A second run with no classMapping mismatches the 1-class model
      // against coco8's 80 classes and fails.
      await client.postJson(
        `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/predict/batch`,
        { modelId: MODEL_ID, includeAnnotated: true },
      );
      expect(lastStatus(records)).toBe(202);

      const failDeadline = Date.now() + 60_000;
      let terminalFailure: Record<string, unknown> | null = null;
      while (Date.now() < failDeadline) {
        const status = await autoAnnotateStatus(client, ref);
        expect(lastStatus(records)).toBe(200);
        const data = status.data as Record<string, unknown>;
        if (data.activeJob === null && data.lastRun !== null) {
          const run = data.lastRun as Record<string, unknown>;
          if (run.failed === true) {
            terminalFailure = data;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!terminalFailure) {
        throw new Error("mismatched run did not fail in time");
      }
      captures.terminalFailure = terminalFailure;
      const failedRun = terminalFailure.lastRun as Record<string, unknown>;
      expect(failedRun.failed).toBe(true);
      expect(typeof failedRun.error).toBe("string");
      expect(failedRun.results).toBeNull();
    } finally {
      if (datasetId) {
        const deleted = await datasetsDelete(client, ref);
        const deletedData = deleted.data as Record<string, unknown>;
        expect(deletedData.success).toBe(true);
        await purgeDatasetFromTrash(key, datasetId);
      }
    }

    const creditsAfter = await creditsCents(key);
    console.log(
      `[auto_annotate_status live smoke] creditsCents delta: ${creditsAfter - creditsBefore} ` +
        `(before=${creditsBefore} after=${creditsAfter})`,
    );
    console.log(
      "[auto_annotate_status live smoke] captures:",
      JSON.stringify(captures, null, 2),
    );
  }, 180_000);
});
