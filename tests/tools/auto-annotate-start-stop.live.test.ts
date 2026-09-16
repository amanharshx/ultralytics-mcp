/** Live smoke test for `auto_annotate_start` and `auto_annotate_stop`.
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
 * cannot run against a dataset in the same workspace it was cloned from.
 * `support-doe/pothole/exp-2` is a 1-class detect model; `classMapping: [0]`
 * bridges it onto coco8's 80-class taxonomy. The clone is deleted and purged
 * from trash in a `finally`, and the run cost is reported as a
 * `creditsCents` delta.
 *
 * Covers, unconditionally:
 * - `start` refusing on a fully-labelled dataset with `includeAnnotated`
 *   left unset (409 "No images left to annotate", surfaced verbatim).
 * - `stop` refusing fail-closed on a never-run dataset without issuing the
 *   `DELETE`.
 * - `start` succeeding once `classMapping` bridges the taxonomy mismatch.
 * - `stop` cancelling that run, surfacing `action` verbatim.
 *
 * The last of those is inherently racy: an 8-image run can finish inside
 * the round trip between `start`'s `202` and the immediate `stop` call that
 * follows it, in which case `stop` would legitimately (and correctly)
 * report "no active run" instead of cancelling one already finished. Rather
 * than assert a possibly-false "cancelled" outcome, or make the assertion
 * conditional and silently accept less coverage (the mistake ticket 1's
 * review caught), this test retries the start+immediate-stop pair a bounded
 * number of times until it actually observes an active run to cancel,
 * spending at most a few extra cents shown in the reported delta.
 *
 * The spec's `422 Dataset has no classes` start failure is not exercised
 * here: the epic's own probes never observed it live despite dedicated
 * attempts, and reproducing it would need a dataset shape not otherwise
 * needed by this ticket. `start`'s error handling is untyped and generic
 * (surface verbatim, never branch on the code), so the 409 case above
 * already exercises the only behavior that matters.
 */

import { describe, expect, test } from "vitest";

import { getApiBase } from "../../src/config.js";
import { UltralyticsApiError } from "../../src/errors.js";
import {
  autoAnnotateStart,
  autoAnnotateStatus,
  autoAnnotateStop,
} from "../../src/tools/auto-annotate.js";
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
const MODEL_REF = "support-doe/pothole/exp-2";
const MAX_CANCEL_ATTEMPTS = 3;

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

describe.skipIf(!apiKey)("auto_annotate start/stop live smoke", () => {
  test("start refuses on a fully-labelled dataset, stop refuses fail-closed, then start+stop an active run end to end", async () => {
    const key = apiKey as string;
    const records: RecordedCall[] = [];
    const client = recordingClient(key, records);
    const owner = await client.getAccountOwner();

    const slug = disposableSlug("zz-mcp-throwaway-aa2");
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

      // Fully-labelled dataset, includeAnnotated left unset: nothing to do.
      let refusedNoImages = false;
      try {
        await autoAnnotateStart(client, ref, MODEL_REF, {
          classMapping: [0],
          confirmCost: true,
        });
      } catch (error) {
        refusedNoImages = true;
        expect(error).toBeInstanceOf(UltralyticsApiError);
        expect((error as UltralyticsApiError).statusCode).toBe(409);
        expect(String((error as Error).message)).toContain(
          "No images left to annotate",
        );
      }
      expect(refusedNoImages).toBe(true);
      captures.noImagesError = (
        (await autoAnnotateStatus(client, ref)).data as Record<string, unknown>
      ).lastRun;

      // Never run yet (the refused start above made no job): stop must
      // refuse fail-closed without ever calling DELETE.
      const callsBeforeStopRefusal = records.length;
      await expect(autoAnnotateStop(client, ref)).rejects.toThrow(
        /no active auto-annotation run/,
      );
      const callsDuringStopRefusal = records.slice(callsBeforeStopRefusal);
      expect(callsDuringStopRefusal.map((call) => call.method)).toEqual([
        "GET",
      ]);

      // Start (bridging the taxonomy mismatch and including already-
      // annotated images so there is work to do) and immediately try to
      // cancel it, retrying a bounded number of times if the 8-image run
      // finished before the cancel request landed.
      let cancelled: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < MAX_CANCEL_ATTEMPTS; attempt++) {
        const started = await autoAnnotateStart(client, ref, MODEL_REF, {
          classMapping: [0],
          includeAnnotated: true,
          confirmCost: true,
        });
        expect(lastStatus(records)).toBe(202);
        expect(typeof (started.data as Record<string, unknown>).jobId).toBe(
          "string",
        );

        try {
          const stopped = await autoAnnotateStop(client, ref);
          expect(lastStatus(records)).toBe(200);
          cancelled = stopped.data as Record<string, unknown>;
          break;
        } catch (error) {
          if (!/no active auto-annotation run/.test(String(error))) {
            throw error;
          }
          // Raced: the run finished before the stop call landed. Let the
          // run settle to a terminal state before retrying so the next
          // start does not collide with an in-flight one, then try again.
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            const status = await autoAnnotateStatus(client, ref);
            const data = status.data as Record<string, unknown>;
            if (data.activeJob === null) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
      if (!cancelled) {
        throw new Error(
          `could not observe an active run to cancel in ${MAX_CANCEL_ATTEMPTS} attempts`,
        );
      }
      captures.cancelled = cancelled;
      expect(cancelled.action).toBe("cancelled");
      expect(typeof cancelled.jobId).toBe("string");
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
      `[auto_annotate start/stop live smoke] creditsCents delta: ${creditsAfter - creditsBefore} ` +
        `(before=${creditsBefore} after=${creditsAfter})`,
    );
    console.log(
      "[auto_annotate start/stop live smoke] captures:",
      JSON.stringify(captures, null, 2),
    );
  }, 180_000);
});
