/** Live smoke test for `dataset_version_create`'s note overwrite on reuse.
 *
 * The tool's description and reuse summary claim that, when the dataset is
 * unchanged since the previous snapshot, a passed `description` replaces the
 * existing version's note and an omitted one leaves it untouched. That is
 * platform behaviour, so this fails when the platform stops doing it.
 * Skipped without a key and excluded from `npm test`.
 *
 * `momox/coco8` is cloned into a disposable `zz-mcp-` dataset for one test,
 * then deleted and purged from trash in a `finally`. Versioning spends no
 * credits; the `creditsCents` delta is logged.
 */

import { beforeAll, describe, expect, test } from "vitest";

import { getApiBase } from "../../src/config.js";
import {
  datasetsDelete,
  datasetsGet,
  datasetVersionCreate,
} from "../../src/tools/datasets.js";
import {
  disposableSlug,
  lastStatus,
  purgeDatasetFromTrash,
  recordingClient,
  sweepStaleDatasets,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

beforeAll(async () => {
  if (apiKey) {
    await sweepStaleDatasets(recordingClient(apiKey, []), apiKey);
  }
}, 60_000);

async function creditsCents(key: string): Promise<number> {
  const response = await fetch(`${getApiBase()}/account/summary`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.creditsCents !== "number") {
    throw new Error("account summary did not report creditsCents");
  }
  return body.creditsCents;
}

async function versionNotes(
  client: ReturnType<typeof recordingClient>,
  ref: string,
): Promise<unknown[]> {
  const got = await datasetsGet(client, ref);
  const versions = (got.data as Record<string, unknown>).versions;
  return ((versions as Record<string, unknown>[] | undefined) ?? []).map(
    (version) => [version.version, version.description],
  );
}

describe.skipIf(!apiKey)("dataset_version_create live smoke", () => {
  test("a description passed on reuse replaces the note; an omitted one leaves it", async () => {
    const key = apiKey as string;
    const records: Parameters<typeof recordingClient>[1] = [];
    const client = recordingClient(key, records);
    const owner = (await client.getAccountOwner()) as string;
    const slug = disposableSlug("zz-mcp-throwaway-version-note");
    const ref = `${owner}/${slug}`;
    const creditsBefore = await creditsCents(key);

    let datasetId: string | null = null;
    try {
      const cloned = (await client.postJson("/datasets/momox/coco8/clone", {
        dataset: slug,
        visibility: "private",
      })) as Record<string, unknown>;
      expect(lastStatus(records)).toBe(201);
      datasetId = String(cloned.id);

      const readyDeadline = Date.now() + 60_000;
      let ready = false;
      while (!ready && Date.now() < readyDeadline) {
        const got = await datasetsGet(client, ref);
        ready = (got.data as Record<string, unknown>).status === "ready";
        if (!ready) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
      if (!ready) {
        throw new Error("clone never reached status=ready in time");
      }

      const created = await datasetVersionCreate(client, {
        dataset: ref,
        description: "zz first note",
      });
      expect(created.data).toMatchObject({ version: 1, reused: false });
      expect(await versionNotes(client, ref)).toEqual([[1, "zz first note"]]);

      const replaced = await datasetVersionCreate(client, {
        dataset: ref,
        description: "zz replaced note",
      });
      expect(replaced.data).toMatchObject({ version: 1, reused: true });
      expect(replaced.summary).toMatch(/replaced that version's existing note/);
      expect(await versionNotes(client, ref)).toEqual([
        [1, "zz replaced note"],
      ]);

      const untouched = await datasetVersionCreate(client, { dataset: ref });
      expect(untouched.data).toMatchObject({ version: 1, reused: true });
      expect(untouched.summary).not.toMatch(/existing note/);
      expect(await versionNotes(client, ref)).toEqual([
        [1, "zz replaced note"],
      ]);
    } finally {
      if (datasetId) {
        await datasetsDelete(client, ref);
        await purgeDatasetFromTrash(key, datasetId);
      }
    }

    const creditsAfter = await creditsCents(key);
    console.log(
      `[dataset_version_create live smoke] creditsCents delta: ${creditsAfter - creditsBefore} ` +
        `(before=${creditsBefore} after=${creditsAfter})`,
    );
  }, 180_000);
});
