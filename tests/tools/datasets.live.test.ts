/** Live smoke test for the dataset tools.
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
 * same variable the server reads. Each test creates its own disposable
 * `mcp-smoke-ds-*` dataset and deletes it again, even when an assertion
 * fails. The recording and cleanup harness is shared with the projects
 * suite (live-harness.ts).
 *
 * Version snapshots need ingested content, which a disposable dataset cannot
 * gain until the ingest tools land, so that coverage is a separate test
 * running against an explicitly configured ready dataset,
 * `ULTRALYTICS_SMOKE_DATASET_REF=owner/slug`. It skips when the variable is
 * absent, so the suite never selects or mutates an arbitrary dataset: with
 * no intervening changes the create reuses the current version, but an
 * opted-in fixture that changed since its last snapshot gains an immutable,
 * non-destructive snapshot version that no endpoint can delete.
 *
 * The ingest coverage uploads two generated 128px PNGs through the folder
 * tool, which exercises the shared signed-upload flow (signed URL, storage
 * transfer, completion, ingest) that the file and video tools reuse. It
 * stays fast by keeping the upload to two small images and polling the
 * dataset until the submitted job id appears as the last completed one.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { describe, expect, test } from "vitest";
import {
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsList,
  datasetUploadFolder,
  datasetVersionCreate,
} from "../../src/tools/datasets.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  type RecordedUpload,
  recordingClient,
  recordingClientWithUploads,
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
  signedUrl: 200,
  complete: 200,
  ingest: 201,
  ingestGate: 400,
  delete: 200,
} as const;

/** PNG CRC table shared by the smoke-image generator below. */
let smokeCrcTable: Uint32Array | null = null;

function smokeCrc32(data: Uint8Array): number {
  smokeCrcTable ??= (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  })();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (smokeCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function smokePngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(smokeCrc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Two generated images are enough to prove the ingest outcome fields.
 *
 * No ffmpeg or binary fixture is needed: a valid 128px truecolor PNG is
 * built from Node's zlib. A 1px image ingests as skipped, so this stays at
 * 128px, which the live API accepts as two added images.
 */
function makeSmokePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[y * stride + 1 + x * 3] = r;
      raw[y * stride + 1 + x * 3 + 1] = g;
      raw[y * stride + 1 + x * 3 + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    smokePngChunk("IHDR", ihdr),
    smokePngChunk("IDAT", deflateSync(raw)),
    smokePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Latest recorded status for one method and path suffix. */
function statusFor(
  records: RecordedCall[],
  method: string,
  pathSuffix: string,
): number {
  const match = records
    .filter(
      (record) => record.method === method && record.path.endsWith(pathSuffix),
    )
    .at(-1);
  if (!match) {
    throw new Error(`expected a recorded ${method} ${pathSuffix} call`);
  }
  return match.status;
}

describe.skipIf(!apiKey)("datasets live smoke", () => {
  test("version snapshots reuse the current version", async (ctx) => {
    // Explicit fixture only: never auto-select a dataset to write to.
    const versionRef = process.env.ULTRALYTICS_SMOKE_DATASET_REF?.trim();
    if (!versionRef) {
      ctx.skip(
        "version snapshot coverage needs ULTRALYTICS_SMOKE_DATASET_REF=" +
          "owner/slug pointing at a ready dataset with ingested images.",
      );
    }
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
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

    // Read-only drift coverage on non-empty data: the disposable round-trip
    // below only sees a fresh dataset, which carries no class summary and
    // no images. These calls mutate nothing.
    const fixtureFetched = await datasetsGet(client, versionRef);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
    const fixtureData = fixtureFetched.data as Record<string, unknown>;
    expect(typeof fixtureData.id).toBe("string");
    expect(typeof fixtureData.owner).toBe("string");
    expect(typeof fixtureData.dataset).toBe("string");
    expect(typeof fixtureData.name).toBe("string");
    expect(typeof fixtureData.visibility).toBe("string");
    expect(typeof fixtureData.task).toBe("string");
    expect(typeof fixtureData.imageCount).toBe("number");
    expect(typeof fixtureData.classCount).toBe("number");
    expect(Array.isArray(fixtureData.classNames)).toBe(true);
    expect(typeof fixtureData.status).toBe("string");
    expect(typeof fixtureData.errorCount).toBe("number");

    const fixtureImages = await datasetImagesList(client, {
      dataset: versionRef,
    });
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.images);
    const fixtureImagesData = fixtureImages.data as {
      total: unknown;
      hasMore: unknown;
      classes: unknown;
      errorCount: unknown;
      images: unknown;
    };
    expect(typeof fixtureImagesData.total).toBe("number");
    expect(typeof fixtureImagesData.hasMore).toBe("boolean");
    expect(Array.isArray(fixtureImagesData.classes)).toBe(true);
    expect(typeof fixtureImagesData.errorCount).toBe("number");
    expect(Array.isArray(fixtureImagesData.images)).toBe(true);
    const fixtureItems = fixtureImagesData.images as Array<
      Record<string, unknown>
    >;
    expect(fixtureItems.length).toBeGreaterThan(0);
    const firstItem = fixtureItems[0];
    expect(typeof firstItem.id).toBe("string");
    expect(typeof firstItem.name).toBe("string");
    expect(typeof firstItem.ext).toBe("string");
    expect(typeof firstItem.split).toBe("string");
    expect(typeof firstItem.width).toBe("number");
    expect(typeof firstItem.height).toBe("number");
    expect(typeof firstItem.labelCount).toBe("number");
    expect(typeof firstItem.bytes).toBe("number");
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

  test("upload chain, completion gate, headers, and ingest outcome", async () => {
    const records: RecordedCall[] = [];
    const uploads: RecordedUpload[] = [];
    const client = recordingClientWithUploads(
      apiKey as string,
      records,
      uploads,
    );
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

    // Two small images keep the check fast while proving the outcome fields.
    const uploadDir = await mkdtemp(join(tmpdir(), "mcp-smoke-ds-up-"));
    try {
      await writeFile(
        join(uploadDir, "smoke-a.png"),
        makeSmokePng(128, 128, (x, y) => [
          (x * 2) % 256,
          (y * 2) % 256,
          ((x + y) * 2) % 256,
        ]),
      );
      await writeFile(
        join(uploadDir, "smoke-b.png"),
        makeSmokePng(128, 128, (x, y) => [
          (x * 3 + 50) % 256,
          (y * 3 + 80) % 256,
          (x * y) % 256,
        ]),
      );

      const slug = disposableSlug("mcp-smoke-ds-up");
      const ref = `${owner}/${slug}`;
      const encodedRef = `${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
      await withDisposableCleanup(
        "dataset",
        ref,
        async () => {
          const cleanup = await datasetsDelete(client, ref);
          const cleanupData = cleanup.data as Record<string, unknown>;
          if (cleanupData.success !== true) {
            throw new Error(
              `cleanup delete reported success:false for '${ref}'`,
            );
          }
        },
        async () => {
          const createdResult = await datasetsCreate(client, {
            name: "MCP smoke dataset upload (disposable)",
            dataset: slug,
            task: "detect",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);
          expect(createdResult.data).toMatchObject({
            owner,
            dataset: slug,
          });

          // The resolver does no I/O, so the signed-upload flow fetches the
          // dataset to obtain its id first. Pin the id the flow depends on.
          const rawDataset = (await client.get(`/datasets/${encodedRef}`)) as {
            dataset?: unknown;
          };
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
          const datasetId = (rawDataset.dataset as Record<string, unknown>)?.id;
          expect(typeof datasetId).toBe("string");

          // A dedicated probe session keeps the gate assertion from
          // consuming the session the upload tool later ingests. The
          // platform exposes no session-delete endpoint: a signed URL
          // without a transfer creates no GCS object and expires via
          // expiresAt, so the dataset delete plus the local temp-dir
          // removal is the complete cleanup.
          const probeSigned = (await client.postJson("/upload/signed-url", {
            assetType: "datasets",
            assetId: datasetId,
            filename: "smoke-probe.zip",
            contentType: "application/zip",
            totalBytes: 1024,
          })) as Record<string, unknown>;
          expect(statusFor(records, "POST", "/upload/signed-url")).toBe(
            EXPECTED_STATUS.signedUrl,
          );
          expect(typeof probeSigned.sessionId).toBe("string");
          expect((probeSigned.sessionId as string).length).toBeGreaterThan(0);
          const probeUrl = String(
            probeSigned.uploadUrl ?? probeSigned.url ?? "",
          );
          expect(probeUrl.startsWith("https://")).toBe(true);
          expect(typeof probeSigned.expiresAt).toBe("string");
          expect(
            Number.isNaN(Date.parse(probeSigned.expiresAt as string)),
          ).toBe(false);
          expect(Date.parse(probeSigned.expiresAt as string) > Date.now()).toBe(
            true,
          );

          // The runtime headers are what every upload tool sends with its
          // storage transfer. A rename here breaks all three at once.
          const probeHeaders = probeSigned.headers as Record<
            string,
            unknown
          > | null;
          expect(probeHeaders).not.toBeNull();
          expect(typeof probeHeaders).toBe("object");
          expect(probeHeaders?.["x-goog-if-generation-match"]).toBe("0");

          // Completion gates ingest: a session that has not been completed
          // is rejected with an explicit ordering message.
          await expect(
            client.postJson(`/datasets/${encodedRef}/ingest`, {
              sessionId: probeSigned.sessionId,
              conflictPolicy: "skip",
            }),
          ).rejects.toThrow(/not ready.*complete/i);
          expect(statusFor(records, "POST", "/ingest")).toBe(
            EXPECTED_STATUS.ingestGate,
          );

          // The probe ran no transfer, so it landed no asset: the dataset
          // still holds no images before the real upload runs.
          const beforeUpload = await datasetsGet(client, ref);
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
          expect(
            (beforeUpload.data as Record<string, unknown>).imageCount,
          ).toBe(0);

          // The full chain through the shared flow: signed URL, storage
          // transfer, completion, and ingest.
          const uploaded = await datasetUploadFolder(client, {
            dataset: ref,
            folderPath: uploadDir,
            targetSplit: "train",
          });
          expect(statusFor(records, "POST", "/upload/signed-url")).toBe(
            EXPECTED_STATUS.signedUrl,
          );
          expect(statusFor(records, "POST", "/upload/complete")).toBe(
            EXPECTED_STATUS.complete,
          );
          expect(statusFor(records, "POST", "/ingest")).toBe(
            EXPECTED_STATUS.ingest,
          );

          // The transfer actually sent both the runtime headers and the
          // declared content type, without forwarding API credentials. A
          // change here breaks every upload tool at once.
          expect(uploads.length).toBeGreaterThan(0);
          for (const upload of uploads) {
            expect(upload.method).toBe("PUT");
            expect(upload.url.startsWith("https://")).toBe(true);
            expect(upload.contentType).toBe("application/zip");
            expect(upload.generationMatch).toBe("0");
            expect(upload.auth).toBeNull();
          }
          const uploadedData = uploaded.data as Record<string, unknown>;
          expect(typeof uploadedData.jobId).toBe("string");
          expect((uploadedData.jobId as string).length).toBeGreaterThan(0);
          expect(uploadedData.status).toBe("queued");
          expect(uploadedData.conflictPolicy).toBe("skip");
          expect(uploadedData.targetSplit).toBe("train");
          expect(typeof uploadedData.sessionId).toBe("string");
          expect(typeof uploadedData.datasetStatus).toBe("string");
          const jobId = uploadedData.jobId as string;

          // Ingest runs asynchronously: the unambiguous completion signal
          // is the submitted job id appearing as the last completed one.
          const deadline = Date.now() + 150_000;
          let terminal: Record<string, unknown> | null = null;
          let polls = 0;
          while (Date.now() < deadline) {
            polls += 1;
            const fetched = await datasetsGet(client, ref);
            expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
            const fields = fetched.data as Record<string, unknown>;
            if (fields.lastIngestJobId === jobId) {
              terminal = fields;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
          if (terminal === null) {
            throw new Error(
              `ingest ${jobId} did not complete after ${polls} poll(s)`,
            );
          }
          expect(terminal.status).toBe("ready");
          expect(terminal.imageCount).toBe(2);
          expect(terminal.errorCount).toBe(0);
          // Absent when healthy: the API omits the field rather than
          // sending an explicit null.
          expect(terminal.processingError ?? null).toBeNull();
          expect(terminal.lastIngestJobId).toBe(jobId);
          expect(terminal.lastIngestSummary).toMatchObject({
            added: 2,
            errors: 0,
          });

          const imagesResult = await datasetImagesList(client, {
            dataset: ref,
            split: "train",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.images);
          const imagesData = imagesResult.data as {
            total: unknown;
            images: unknown;
          };
          expect(imagesData.total).toBe(2);
          expect(Array.isArray(imagesData.images)).toBe(true);
          expect((imagesData.images as Array<unknown>).length).toBe(2);

          const deleted = await datasetsDelete(client, ref);
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.delete);
          const deletedData = deleted.data as Record<string, unknown>;
          expect(deletedData.success).toBe(true);
        },
      );
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  }, 180_000);
});
