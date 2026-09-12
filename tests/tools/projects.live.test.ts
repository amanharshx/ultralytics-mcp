/** Live smoke test for the project and dataset resource tools.
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
 * same variable the server reads. Creates one disposable `mcp-smoke-*`
 * project and one disposable `mcp-smoke-ds-*` dataset and deletes them again,
 * even when an assertion fails. The dataset version snapshot coverage
 * additionally needs one pre-existing ready dataset with ingested images: a
 * disposable dataset cannot gain content until the ingest tools land, and
 * re-creating an unchanged version is a no-op, so that coverage performs no
 * workspace mutation.
 */

import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { UltralyticsApiError } from "../../src/errors.js";
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
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "../../src/tools/projects.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

/** Success statuses captured against the live API; a change fails loudly. */
const EXPECTED_STATUS = {
  accountSummary: 200,
  list: 200,
  create: 201,
  get: 200,
  delete: 200,
  datasetList: 200,
  datasetCreate: 201,
  datasetGet: 200,
  datasetImages: 200,
  datasetExport: 200,
  datasetVersionCreate: 200,
  datasetDelete: 200,
} as const;

interface RecordedCall {
  method: string;
  path: string;
  status: number;
}

/** Build a client that records one entry per HTTP call it makes. */
function recordingClient(key: string, records: RecordedCall[]) {
  const recordingFetch = (async (url: string | URL, init: RequestInit = {}) => {
    const response = await fetch(url, init);
    records.push({
      method: (init.method ?? "GET").toUpperCase(),
      path: new URL(String(url)).pathname,
      status: response.status,
    });
    return response;
  }) as unknown as typeof fetch;
  return new UltralyticsClient({ apiKey: key, fetchImpl: recordingFetch });
}

/** Status of the most recent recorded call. */
function lastStatus(records: RecordedCall[]): number {
  const last = records[records.length - 1];
  if (!last) {
    throw new Error("expected at least one recorded API call");
  }
  return last.status;
}

describe.skipIf(!apiKey)("projects live smoke", () => {
  test("list, create, get, and delete round-trip", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);
    expect(typeof owner).toBe("string");
    expect(owner.length).toBeGreaterThan(0);

    const listBefore = await projectsList(client);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(Array.isArray(listBefore.data)).toBe(true);
    expect(listBefore.summary).toContain(owner);

    const slug = `mcp-smoke-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const ref = `${owner}/${slug}`;
    // Marked before the call: a timeout after server-side creation must
    // still clean up. Cleared only after the delete response validates.
    let created = false;
    let bodyError: unknown;
    try {
      created = true;
      const createdResult = await projectsCreate(client, {
        name: "MCP smoke (disposable)",
        project: slug,
      });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);
      const createdRecord = createdResult.data as Record<string, unknown>;
      expect(typeof createdRecord.id).toBe("string");
      expect(createdRecord.owner).toBe(owner);
      expect(createdRecord.project).toBe(slug);

      const fetched = await projectsGet(client, ref);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
      const fetchedData = fetched.data as {
        project: Record<string, unknown>;
        models: unknown;
        isOwner: unknown;
      };
      expect(typeof fetchedData.project.id).toBe("string");
      expect(fetchedData.project.owner).toBe(owner);
      expect(fetchedData.project.project).toBe(slug);
      expect(typeof fetchedData.project.name).toBe("string");
      expect(typeof fetchedData.project.visibility).toBe("string");
      expect(fetchedData.project.visibility).toBe("private");
      expect(typeof fetchedData.project.modelCount).toBe("number");
      expect(Array.isArray(fetchedData.models)).toBe(true);
      expect(typeof fetchedData.isOwner).toBe("boolean");

      const listAfter = await projectsList(client);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
      const entries = listAfter.data as Array<Record<string, unknown>>;
      const listed = entries.find((entry) => entry.slug === slug);
      expect(listed).toBeDefined();
      expect(typeof listed?.id).toBe("string");
      expect(listed?.username).toBe(owner);
      expect(typeof listed?.name).toBe("string");
      expect(typeof listed?.visibility).toBe("string");
      expect(typeof listed?.modelCount).toBe("number");

      // Raw contract the tool mapping depends on: the list response carries
      // `projects[]` whose items name the resource via `id`, `project`
      // (slug), `owner`, `name`, `visibility`, and `modelCount`. A rename
      // here must fail loudly instead of surfacing as nulls downstream.
      const rawList = (await client.get(
        `/projects/${encodeURIComponent(owner)}`,
      )) as { projects?: unknown };
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
      expect(Array.isArray(rawList.projects)).toBe(true);
      const rawEntries = rawList.projects as Array<Record<string, unknown>>;
      const rawMatch = rawEntries.find((entry) => entry.project === slug);
      expect(rawMatch).toBeDefined();
      expect(typeof rawMatch?.id).toBe("string");
      expect(rawMatch?.owner).toBe(owner);
      expect(typeof rawMatch?.name).toBe("string");
      expect(typeof rawMatch?.visibility).toBe("string");
      expect(typeof rawMatch?.modelCount).toBe("number");

      const deleted = await projectsDelete(client, ref);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.delete);
      const deletedData = deleted.data as Record<string, unknown>;
      expect(deletedData.success).toBe(true);
      expect(typeof deletedData.cascadedModels).toBe("number");
      created = false;
    } catch (error) {
      bodyError = error;
    }
    if (created) {
      try {
        const cleanup = await projectsDelete(client, ref);
        const cleanupData = cleanup.data as Record<string, unknown>;
        if (cleanupData.success !== true) {
          throw new Error(`cleanup delete reported success:false for '${ref}'`);
        }
        created = false;
      } catch (cleanupError) {
        // A 404 means the project is already gone: nothing left behind.
        const alreadyGone =
          cleanupError instanceof UltralyticsApiError &&
          cleanupError.statusCode === 404;
        if (!alreadyGone) {
          throw new Error(
            `cleanup failed for disposable project '${ref}' (it may still exist in the workspace): ${String(cleanupError)}` +
              (bodyError === undefined
                ? ""
                : `; original failure: ${String(bodyError)}`),
          );
        }
        created = false;
      }
    }
    if (bodyError !== undefined) {
      throw bodyError;
    }
  }, 120_000);
});

describe.skipIf(!apiKey)("datasets live smoke", () => {
  test("create, get, images, export, version, list, and delete round-trip", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);
    expect(typeof owner).toBe("string");
    expect(owner.length).toBeGreaterThan(0);

    const listBefore = await datasetsList(client);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetList);
    expect(Array.isArray(listBefore.data)).toBe(true);
    expect(listBefore.summary).toContain(owner);

    const slug = `mcp-smoke-ds-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const ref = `${owner}/${slug}`;
    // Marked before the call: a timeout after server-side creation must
    // still clean up. Cleared only after the delete response validates.
    let created = false;
    let bodyError: unknown;
    try {
      created = true;
      const createdResult = await datasetsCreate(client, {
        name: "MCP smoke dataset (disposable)",
        dataset: slug,
        task: "detect",
      });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetCreate);
      const createdRecord = createdResult.data as Record<string, unknown>;
      expect(typeof createdRecord.id).toBe("string");
      expect(createdRecord.owner).toBe(owner);
      expect(createdRecord.dataset).toBe(slug);

      const fetched = await datasetsGet(client, ref);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetGet);
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
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetGet);
      const rawDataset = rawGet.dataset as Record<string, unknown>;
      expect(typeof rawDataset.id).toBe("string");
      expect(rawDataset.owner).toBe(owner);
      expect(rawDataset.dataset).toBe(slug);

      const listed = await datasetImagesList(client, { dataset: ref });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetImages);
      const listedData = listed.data as {
        total: unknown;
        hasMore: unknown;
        classes: unknown;
        errorCount: unknown;
        images: unknown;
      };
      expect(typeof listedData.total).toBe("number");
      expect(typeof listedData.hasMore).toBe("boolean");
      expect(Array.isArray(listedData.classes)).toBe(true);
      expect(typeof listedData.errorCount).toBe("number");
      expect(Array.isArray(listedData.images)).toBe(true);

      const exported = await datasetExport(client, { dataset: ref });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetExport);
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
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetList);
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
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetList);
      expect(Array.isArray(rawList.datasets)).toBe(true);
      const rawEntries = rawList.datasets as Array<Record<string, unknown>>;
      const rawMatch = rawEntries.find((entry) => entry.dataset === slug);
      expect(rawMatch).toBeDefined();
      expect(typeof rawMatch?.id).toBe("string");
      expect(rawMatch?.owner).toBe(owner);
      expect(typeof rawMatch?.name).toBe("string");
      expect(typeof rawMatch?.visibility).toBe("string");
      expect(typeof rawMatch?.imageCount).toBe("number");

      // Version snapshots need ingested content, which a disposable dataset
      // cannot gain until the ingest tools land. Cover the success path
      // against a pre-existing ready dataset instead: with no intervening
      // changes the create reuses the current version, so this performs no
      // workspace mutation.
      const versionCandidate = rawEntries.find(
        (entry) =>
          typeof entry.dataset === "string" &&
          !entry.dataset.startsWith("mcp-") &&
          entry.status === "ready" &&
          typeof entry.imageCount === "number" &&
          entry.imageCount > 0,
      );
      if (!versionCandidate) {
        throw new Error(
          "datasets live smoke needs one ready dataset with ingested images " +
            "for the version snapshot coverage (none found); ingest a dataset and rerun.",
        );
      }
      const versionRef = `${owner}/${versionCandidate.dataset}`;
      const versioned = await datasetVersionCreate(client, {
        dataset: versionRef,
      });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetVersionCreate);
      const versionedData = versioned.data as Record<string, unknown>;
      expect(typeof versionedData.version).toBe("number");
      expect(typeof versionedData.downloadUrl).toBe("string");
      expect((versionedData.downloadUrl as string).length).toBeGreaterThan(0);

      // Creating a version twice without intervening changes returns the
      // same version rather than incrementing.
      const repeated = await datasetVersionCreate(client, {
        dataset: versionRef,
      });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetVersionCreate);
      const repeatedData = repeated.data as Record<string, unknown>;
      expect(repeatedData.version).toBe(versionedData.version);

      const versionedExport = await datasetExport(client, {
        dataset: versionRef,
        version: versionedData.version as number,
      });
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetExport);
      const versionedExportData = versionedExport.data as Record<
        string,
        unknown
      >;
      expect(typeof versionedExportData.downloadUrl).toBe("string");
      expect(
        (versionedExportData.downloadUrl as string).length,
      ).toBeGreaterThan(0);

      const deleted = await datasetsDelete(client, ref);
      expect(lastStatus(records)).toBe(EXPECTED_STATUS.datasetDelete);
      const deletedData = deleted.data as Record<string, unknown>;
      expect(deletedData.success).toBe(true);
      expect(deletedData.owner).toBe(owner);
      expect(deletedData.dataset).toBe(slug);
      // Unlike projects, dataset deletion reports no cascade summary.
      expect(deletedData).not.toHaveProperty("cascadedModels");
      created = false;
    } catch (error) {
      bodyError = error;
    }
    if (created) {
      try {
        const cleanup = await datasetsDelete(client, ref);
        const cleanupData = cleanup.data as Record<string, unknown>;
        if (cleanupData.success !== true) {
          throw new Error(`cleanup delete reported success:false for '${ref}'`);
        }
        created = false;
      } catch (cleanupError) {
        // A 404 means the dataset is already gone: nothing left behind.
        const alreadyGone =
          cleanupError instanceof UltralyticsApiError &&
          cleanupError.statusCode === 404;
        if (!alreadyGone) {
          throw new Error(
            `cleanup failed for disposable dataset '${ref}' (it may still exist in the workspace): ${String(cleanupError)}` +
              (bodyError === undefined
                ? ""
                : `; original failure: ${String(bodyError)}`),
          );
        }
        created = false;
      }
    }
    if (bodyError !== undefined) {
      throw bodyError;
    }
  }, 180_000);
});
