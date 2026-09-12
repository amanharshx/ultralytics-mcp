/** Live smoke test for the dataset resource tools.
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
 * same variable the server reads. Creates one disposable `mcp-smoke-ds-*`
 * dataset and deletes it again, even when an assertion fails. The recording
 * and cleanup harness is shared with the projects suite (live-harness.ts).
 *
 * Version snapshots need ingested content, which a disposable dataset cannot
 * gain until the ingest tools land, so that coverage is a separate test
 * running against a pre-existing ready dataset. It skips when the workspace
 * has none, without skipping the disposable round-trip. With no intervening
 * changes the create reuses the current version, so it performs no workspace
 * mutation; the repeat-create check proves the reuse. In the unlikely event
 * the chosen dataset changed since its last snapshot, the API mints an
 * immutable, non-destructive snapshot version that no endpoint can delete.
 */

import { describe, expect, test } from "vitest";
import {
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsList,
  datasetVersionCreate,
} from "../../src/tools/datasets.js";
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
  list: 200,
  create: 201,
  get: 200,
  images: 200,
  export: 200,
  versionCreate: 200,
  delete: 200,
} as const;

describe.skipIf(!apiKey)("datasets live smoke", () => {
  test("version snapshots reuse the current version", async (ctx) => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

    const rawList = (await client.get(
      `/datasets/${encodeURIComponent(owner)}`,
    )) as { datasets?: unknown };
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(Array.isArray(rawList.datasets)).toBe(true);
    const rawEntries = rawList.datasets as Array<Record<string, unknown>>;
    // Prefer the smallest ready dataset so that, in the unlikely event it
    // changed since its last snapshot, a new snapshot touches the least
    // content. Never pick a disposable prefix from this or another run.
    const versionCandidate = rawEntries
      .filter(
        (entry) =>
          typeof entry.dataset === "string" &&
          !entry.dataset.startsWith("mcp-") &&
          entry.status === "ready" &&
          typeof entry.imageCount === "number" &&
          entry.imageCount > 0,
      )
      .sort((a, b) => (a.imageCount as number) - (b.imageCount as number))[0];
    if (!versionCandidate) {
      ctx.skip(
        "datasets live smoke needs one ready dataset with ingested images " +
          "for the version snapshot coverage; ingest a dataset and rerun.",
      );
    }
    const versionRef = `${owner}/${versionCandidate.dataset}`;
    const versioned = await datasetVersionCreate(client, {
      dataset: versionRef,
    });
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.versionCreate);
    const versionedData = versioned.data as Record<string, unknown>;
    expect(typeof versionedData.version).toBe("number");
    expect(typeof versionedData.downloadUrl).toBe("string");
    expect((versionedData.downloadUrl as string).length).toBeGreaterThan(0);

    // Creating a version twice without intervening changes returns the
    // same version rather than incrementing.
    const repeated = await datasetVersionCreate(client, {
      dataset: versionRef,
    });
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.versionCreate);
    const repeatedData = repeated.data as Record<string, unknown>;
    expect(repeatedData.version).toBe(versionedData.version);

    const versionedExport = await datasetExport(client, {
      dataset: versionRef,
      version: versionedData.version as number,
    });
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.export);
    const versionedExportData = versionedExport.data as Record<string, unknown>;
    expect(typeof versionedExportData.downloadUrl).toBe("string");
    expect((versionedExportData.downloadUrl as string).length).toBeGreaterThan(
      0,
    );
  }, 120_000);

  test("create, get, images, export, list, and delete round-trip", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);
    expect(typeof owner).toBe("string");
    expect(owner.length).toBeGreaterThan(0);

    const listBefore = await datasetsList(client);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(Array.isArray(listBefore.data)).toBe(true);
    expect(listBefore.summary).toContain(owner);

    const slug = disposableSlug("mcp-smoke-ds");
    const ref = `${owner}/${slug}`;
    await withDisposableCleanup(
      "dataset",
      ref,
      async () => {
        const cleanup = await datasetsDelete(client, ref);
        const cleanupData = cleanup.data as Record<string, unknown>;
        if (cleanupData.success !== true) {
          throw new Error(`cleanup delete reported success:false for '${ref}'`);
        }
      },
      async () => {
        const createdResult = await datasetsCreate(client, {
          name: "MCP smoke dataset (disposable)",
          dataset: slug,
          task: "detect",
        });
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);
        const createdRecord = createdResult.data as Record<string, unknown>;
        expect(typeof createdRecord.id).toBe("string");
        expect(createdRecord.owner).toBe(owner);
        expect(createdRecord.dataset).toBe(slug);

        const fetched = await datasetsGet(client, ref);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
        const fetchedData = fetched.data as Record<string, unknown>;
        // Identity fields: datasets name the resource `dataset` (slug) and
        // `owner`, matching projects but unlike other platform endpoints.
        expect(typeof fetchedData.id).toBe("string");
        expect(fetchedData.owner).toBe(owner);
        expect(fetchedData.dataset).toBe(slug);
        expect(typeof fetchedData.name).toBe("string");
        expect(typeof fetchedData.visibility).toBe("string");
        expect(fetchedData.visibility).toBe("private");
        expect(typeof fetchedData.task).toBe("string");
        expect(fetchedData.task).toBe("detect");
        expect(typeof fetchedData.imageCount).toBe("number");
        // A fresh dataset carries no class or ingest summary yet; those
        // fields arrive with ingested content and are pinned by unit tests
        // captured against non-empty datasets.

        // Raw contract the tool mapping depends on: the get response nests
        // the dataset under `dataset` with no additional data beside it. A
        // rename here must fail loudly instead of surfacing as nulls
        // downstream.
        const rawGet = (await client.get(
          `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
        )) as { dataset?: unknown };
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
        const rawDataset = rawGet.dataset as Record<string, unknown>;
        expect(typeof rawDataset.id).toBe("string");
        expect(rawDataset.owner).toBe(owner);
        expect(rawDataset.dataset).toBe(slug);

        const imagesResult = await datasetImagesList(client, { dataset: ref });
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.images);
        const imagesData = imagesResult.data as {
          total: unknown;
          hasMore: unknown;
          classes: unknown;
          errorCount: unknown;
          images: unknown;
        };
        expect(typeof imagesData.total).toBe("number");
        expect(typeof imagesData.hasMore).toBe("boolean");
        expect(Array.isArray(imagesData.classes)).toBe(true);
        expect(typeof imagesData.errorCount).toBe("number");
        expect(Array.isArray(imagesData.images)).toBe(true);

        const exported = await datasetExport(client, { dataset: ref });
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.export);
        const exportedData = exported.data as Record<string, unknown>;
        expect(typeof exportedData.downloadUrl).toBe("string");
        expect((exportedData.downloadUrl as string).length).toBeGreaterThan(0);

        // A dataset with no ingested content is not ready for a version
        // snapshot: the API rejects the create and the tool surfaces the
        // message. This pins the failure contract, not just the happy path.
        await expect(
          datasetVersionCreate(client, { dataset: ref }),
        ).rejects.toThrow(/must be ready/i);

        const listAfter = await datasetsList(client);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
        const entries = listAfter.data as Array<Record<string, unknown>>;
        const match = entries.find((entry) => entry.slug === slug);
        expect(match).toBeDefined();
        expect(typeof match?.id).toBe("string");
        expect(match?.username).toBe(owner);
        expect(typeof match?.name).toBe("string");
        expect(typeof match?.visibility).toBe("string");
        expect(typeof match?.task).toBe("string");
        expect(typeof match?.imageCount).toBe("number");
        // A fresh dataset carries no class summary yet; the tool maps the
        // missing field to null.

        // Raw contract the tool mapping depends on: the list response carries
        // `datasets[]` whose items name the resource via `id`, `dataset`
        // (slug), `owner`, `name`, `visibility`, and `task`. A rename here
        // must fail loudly instead of surfacing as nulls downstream.
        const rawList = (await client.get(
          `/datasets/${encodeURIComponent(owner)}`,
        )) as { datasets?: unknown };
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
        expect(Array.isArray(rawList.datasets)).toBe(true);
        const rawEntries = rawList.datasets as Array<Record<string, unknown>>;
        const rawMatch = rawEntries.find((entry) => entry.dataset === slug);
        expect(rawMatch).toBeDefined();
        expect(typeof rawMatch?.id).toBe("string");
        expect(rawMatch?.owner).toBe(owner);
        expect(typeof rawMatch?.name).toBe("string");
        expect(typeof rawMatch?.visibility).toBe("string");
        expect(typeof rawMatch?.imageCount).toBe("number");

        const deleted = await datasetsDelete(client, ref);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.delete);
        const deletedData = deleted.data as Record<string, unknown>;
        expect(deletedData.success).toBe(true);
        expect(deletedData.owner).toBe(owner);
        expect(deletedData.dataset).toBe(slug);
        // Unlike projects, dataset deletion reports no cascade summary.
        expect(deletedData).not.toHaveProperty("cascadedModels");
      },
    );
  }, 120_000);
});
