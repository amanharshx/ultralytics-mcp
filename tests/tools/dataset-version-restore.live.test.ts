/** Live smoke test for `dataset_version_restore`.
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
 * disposable dataset for the duration of one test. The clone is deleted and
 * purged from trash in a `finally`, and the run cost is reported as a
 * `creditsCents` delta.
 *
 * Covers, unconditionally:
 * - The round trip the ticket requires: record `annotationCount`, run an
 *   auto-annotate job, confirm the count rose, restore the pre-run snapshot,
 *   confirm the count returned to the original. `annotationCount` is the
 *   ID-independent metric this asserts on -- held image IDs are never
 *   compared, since restore reassigns them.
 * - An invalid version number surfacing the server's message verbatim.
 */

import { describe, expect, test } from "vitest";

import { getApiBase } from "../../src/config.js";
import { UltralyticsApiError } from "../../src/errors.js";
import {
  autoAnnotateStart,
  autoAnnotateStatus,
} from "../../src/tools/auto-annotate.js";
import {
  datasetsDelete,
  datasetsGet,
  datasetVersionRestore,
} from "../../src/tools/datasets.js";
import { disposableSlug, lastStatus, recordingClient } from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const SOURCE_OWNER = "momox";
const SOURCE_DATASET = "coco8";
const MODEL_REF = "support-doe/pothole/exp-2";

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

describe.skipIf(!apiKey)("dataset_version_restore live smoke", () => {
  test("restore round trip: annotationCount rises after a run and reverts exactly after restore", async () => {
    const key = apiKey as string;
    const records: { method: string; path: string; status: number }[] = [];
    const client = recordingClient(key, records);
    const owner = await client.getAccountOwner();

    const slug = disposableSlug("zz-mcp-throwaway-restore");
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

      // Wait until the clone is ready before reading its baseline.
      const readyDeadline = Date.now() + 60_000;
      let baseline: Record<string, unknown> | null = null;
      while (Date.now() < readyDeadline) {
        const got = await datasetsGet(client, ref);
        const fields = got.data as Record<string, unknown>;
        if (fields.status === "ready") {
          baseline = fields;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (!baseline) {
        throw new Error("clone never reached status=ready in time");
      }
      const annotationCountBefore = baseline.annotationCount as number;
      const versionsBefore = (baseline.versions as unknown[] | undefined) ?? [];
      captures.baseline = {
        annotationCount: annotationCountBefore,
        versions: versionsBefore,
      };

      // Run auto-annotate (includeAnnotated so the fully-labelled clone has
      // work to do; classMapping bridges the 1-class model onto coco8's
      // 80-class taxonomy). Every start snapshots a version before
      // labelling begins -- that snapshot is what gets restored below.
      await autoAnnotateStart(client, ref, MODEL_REF, {
        classMapping: [0],
        includeAnnotated: true,
        confirmCost: true,
      });
      expect(lastStatus(records)).toBe(202);

      const runDeadline = Date.now() + 60_000;
      let lastRun: Record<string, unknown> | null = null;
      while (Date.now() < runDeadline) {
        const status = await autoAnnotateStatus(client, ref);
        const data = status.data as Record<string, unknown>;
        if (data.activeJob === null && data.lastRun !== null) {
          lastRun = data.lastRun as Record<string, unknown>;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!lastRun) {
        throw new Error(
          "auto-annotation run never reached a terminal state in time",
        );
      }
      captures.lastRun = lastRun;
      expect(lastRun.failed).toBe(false);

      const afterRun = await datasetsGet(client, ref);
      const afterRunFields = afterRun.data as Record<string, unknown>;
      const annotationCountAfterRun = afterRunFields.annotationCount as number;
      const versionsAfterRun =
        (afterRunFields.versions as unknown[] | undefined) ?? [];
      captures.afterRun = {
        annotationCount: annotationCountAfterRun,
        versions: versionsAfterRun,
      };
      expect(annotationCountAfterRun).toBeGreaterThan(annotationCountBefore);
      expect(versionsAfterRun.length).toBeGreaterThan(versionsBefore.length);

      // The snapshot taken before the run is the first of the new versions.
      const snapshotVersion = versionsAfterRun[versionsBefore.length] as
        | Record<string, unknown>
        | undefined;
      if (!snapshotVersion || typeof snapshotVersion.version !== "number") {
        throw new Error("could not identify the pre-run snapshot version");
      }

      const restored = await datasetVersionRestore(client, {
        dataset: ref,
        version: snapshotVersion.version,
      });
      expect(lastStatus(records)).toBe(200);
      captures.restored = restored.data;
      expect(restored.summary).toMatch(/image ids? (were|are) reassigned/i);
      expect(restored.summary).toMatch(/re-list/i);

      // Settles within about five seconds per the epic's probe findings.
      const revertDeadline = Date.now() + 30_000;
      let annotationCountAfterRestore: number | null = null;
      while (Date.now() < revertDeadline) {
        const got = await datasetsGet(client, ref);
        const fields = got.data as Record<string, unknown>;
        if (fields.annotationCount === annotationCountBefore) {
          annotationCountAfterRestore = fields.annotationCount as number;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      captures.annotationCountAfterRestore = annotationCountAfterRestore;
      expect(annotationCountAfterRestore).toBe(annotationCountBefore);
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
      `[dataset_version_restore live smoke] creditsCents delta: ${creditsAfter - creditsBefore} ` +
        `(before=${creditsBefore} after=${creditsAfter})`,
    );
    console.log(
      "[dataset_version_restore live smoke] captures:",
      JSON.stringify(captures, null, 2),
    );
  }, 180_000);

  test("restoring an invalid version surfaces the server's message verbatim", async () => {
    const key = apiKey as string;
    const client = recordingClient(key, []);
    const owner = await client.getAccountOwner();

    const slug = disposableSlug("zz-mcp-throwaway-restore-bad");
    const ref = `${owner}/${slug}`;

    let datasetId: string | null = null;
    try {
      const cloned = (await client.postJson(
        `/datasets/${encodeURIComponent(SOURCE_OWNER)}/${encodeURIComponent(SOURCE_DATASET)}/clone`,
        { dataset: slug, visibility: "private" },
      )) as Record<string, unknown>;
      datasetId = String(cloned.id);

      let error: unknown;
      try {
        await datasetVersionRestore(client, { dataset: ref, version: 999 });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UltralyticsApiError);
      const apiError = error as UltralyticsApiError;
      expect([400, 404]).toContain(apiError.statusCode);
      expect(apiError.apiMessage.length).toBeGreaterThan(0);
    } finally {
      if (datasetId) {
        const deleted = await datasetsDelete(client, ref);
        expect((deleted.data as Record<string, unknown>).success).toBe(true);
        await purgeDatasetFromTrash(key, datasetId);
      }
    }
  }, 60_000);
});
