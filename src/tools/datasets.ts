/** Read-only dataset tools. */

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import type { UltralyticsClient } from "../client.js";
import { resolveDataset } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField, pyCount, pyField } from "./shared.js";

const DATASET_TASKS = new Set([
  "detect",
  "segment",
  "semantic",
  "classify",
  "pose",
  "obb",
]);

const TARGET_SPLITS = new Set(["train", "val", "test"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const UPLOAD_TYPES: Array<[suffix: string, contentType: string]> = [
  [".tar.gz", "application/gzip"],
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".tgz", "application/gzip"],
  [".ndjson", "application/x-ndjson"],
];

function resourceId(item: Record<string, unknown>, fallback?: string): string {
  const value = item._id ?? item.id ?? item.projectId ?? item.datasetId;
  return String(value ?? fallback ?? "None");
}

function validateTargetSplit(targetSplit?: string): void {
  if (targetSplit !== undefined && !TARGET_SPLITS.has(targetSplit)) {
    const allowed = Array.from(TARGET_SPLITS).sort().join(", ");
    throw new Error(
      `Unsupported targetSplit '${targetSplit}'. Expected one of: ${allowed}.`,
    );
  }
}

async function datasetUploadFileMeta(filePath: string): Promise<{
  filename: string;
  contentType: string;
  totalBytes: number;
}> {
  if (!filePath.trim()) {
    throw new Error("`filePath` is required.");
  }

  const info = await stat(filePath).catch(() => null);
  if (info === null) {
    throw new Error(`Upload file does not exist: ${filePath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Upload path is not a file: ${filePath}`);
  }
  if (info.size >= MAX_UPLOAD_BYTES) {
    throw new Error("Upload file must be smaller than 10 GB.");
  }

  const filename = basename(filePath);
  const lower = filename.toLowerCase();
  const matched = UPLOAD_TYPES.find(([suffix]) => lower.endsWith(suffix));
  if (!matched) {
    throw new Error(
      "Unsupported dataset upload file type. Expected one of: .zip, .tar, .tar.gz, .tgz, .ndjson.",
    );
  }

  return {
    filename,
    contentType: matched[1],
    totalBytes: info.size,
  };
}

/** List datasets in the workspace, optionally filtered by username. */
export async function datasetsList(
  client: UltralyticsClient,
  username?: string,
): Promise<NormalizedToolResult> {
  const data = await client.get(
    "/datasets",
    username ? { username } : undefined,
  );
  const items = listField(data, "datasets").map((dataset) => ({
    id: dataset._id ?? null,
    name: dataset.name ?? null,
    slug: dataset.slug ?? null,
    task: dataset.task ?? null,
    imageCount: dataset.imageCount ?? null,
    classCount: dataset.classCount ?? null,
    visibility: dataset.visibility ?? null,
  }));
  return { summary: `${items.length} dataset(s).`, data: items };
}

/** Get one dataset by id, slug, username/slug, or dataset ul:// URI. */
export async function datasetsGet(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const datasetId = await resolveDataset(client, dataset);
  const data = await client.get(`/datasets/${datasetId}`);
  const record = asRecord(data);
  const item = "dataset" in record ? record.dataset : data;
  const fields = asRecord(item);
  return {
    summary:
      `Dataset '${pyField(fields.name)}' [${pyField(fields.task)}], ` +
      `${pyCount(fields, "imageCount")} images, ${pyCount(fields, "classCount")} classes.`,
    data: item,
  };
}

export interface DatasetsCreateOptions {
  name: string;
  task: string;
  slug: string;
  description?: string;
  visibility?: string;
  classNames?: string[];
}

/** Create a dataset. */
export async function datasetsCreate(
  client: UltralyticsClient,
  options: DatasetsCreateOptions,
): Promise<NormalizedToolResult> {
  if (!DATASET_TASKS.has(options.task)) {
    const allowed = Array.from(DATASET_TASKS).sort().join(", ");
    throw new Error(
      `Unsupported dataset task '${options.task}'. Expected one of: ${allowed}.`,
    );
  }
  if (!options.slug.trim()) {
    throw new Error("`slug` is required.");
  }

  const payload: Record<string, unknown> = {
    name: options.name,
    task: options.task,
    slug: options.slug,
  };
  if (options.description !== undefined) {
    payload.description = options.description;
  }
  if (options.visibility !== undefined) {
    payload.visibility = options.visibility;
  }
  if (options.classNames !== undefined) {
    payload.classNames = options.classNames;
  }

  const data = await client.postJson("/datasets", payload);
  const record = asRecord(data);
  const item = asRecord("dataset" in record ? record.dataset : data);
  const id = resourceId(item);
  const slug = item.slug ?? options.slug;
  const task = item.task ?? options.task;
  return {
    summary: `Created dataset ${id} slug=${String(slug)} task=${String(task)}.`,
    data: item,
  };
}

export interface DatasetImagesListOptions {
  dataset: string;
  split?: string;
  search?: string;
  hasLabel?: boolean;
  classIds?: string[];
  limit?: number;
  offset?: number;
  includeImageUrls?: boolean;
}

/** List images in a dataset with optional filtering. */
export async function datasetImagesList(
  client: UltralyticsClient,
  options: DatasetImagesListOptions,
): Promise<NormalizedToolResult> {
  if (options.split !== undefined && !TARGET_SPLITS.has(options.split)) {
    const allowed = Array.from(TARGET_SPLITS).sort().join(", ");
    throw new Error(
      `Unsupported split '${options.split}'. Expected one of: ${allowed}.`,
    );
  }
  if (options.limit !== undefined) {
    if (options.limit <= 0) {
      throw new Error("`limit` must be greater than 0.");
    }
    if (options.limit > 5000) {
      throw new Error("`limit` must be at most 5000.");
    }
  }
  if (options.offset !== undefined && options.offset < 0) {
    throw new Error("`offset` must be greater than or equal to 0.");
  }

  const datasetId = await resolveDataset(client, options.dataset);
  const params: Record<string, unknown> = {};
  if (options.split !== undefined) {
    params.split = options.split;
  }
  if (options.search !== undefined) {
    params.search = options.search;
  }
  if (options.hasLabel !== undefined) {
    params.hasLabel = options.hasLabel;
  }
  if (options.classIds && options.classIds.length > 0) {
    params.classIds = options.classIds.join(",");
  }
  if (options.limit !== undefined) {
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    params.offset = options.offset;
  }
  if (options.includeImageUrls !== undefined) {
    params.includeImageUrls = options.includeImageUrls;
  }

  const data = await client.get(
    `/datasets/${datasetId}/images`,
    Object.keys(params).length > 0 ? params : undefined,
  );
  const record = asRecord(data);
  const images = listField(data, "images").map((image) => ({
    id: image._id ?? image.id ?? null,
    name: image.name ?? null,
    ext: image.ext ?? null,
    split: image.split ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    labelCount: image.labelCount ?? null,
    bytes: image.bytes ?? null,
    ...(image.imageUrl !== undefined ? { imageUrl: image.imageUrl } : {}),
    ...(image.thumbnailUrl !== undefined
      ? { thumbnailUrl: image.thumbnailUrl }
      : {}),
  }));
  return {
    summary: `${images.length} image(s) (total ${String(record.total ?? null)})`,
    data: {
      total: record.total ?? null,
      hasMore: record.hasMore ?? null,
      nextCursor: record.nextCursor ?? null,
      images,
    },
  };
}

/** Soft-delete a dataset by id, slug, username/slug, or dataset ul:// URI. */
export async function datasetsDelete(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const datasetId = await resolveDataset(client, dataset);
  const data = await client.delete(`/datasets/${datasetId}`);
  return {
    summary: `Deleted dataset ${datasetId} (soft delete).`,
    data: { id: datasetId, response: data },
  };
}

export interface DatasetsIngestOptions {
  dataset: string;
  sourceUrl: string;
  targetSplit?: string;
}

/** Start a remote URL ingest job for an existing dataset. */
export async function datasetsIngest(
  client: UltralyticsClient,
  options: DatasetsIngestOptions,
): Promise<NormalizedToolResult> {
  if (!options.sourceUrl.trim()) {
    throw new Error("`sourceUrl` is required.");
  }
  validateTargetSplit(options.targetSplit);

  const datasetId = await resolveDataset(client, options.dataset);
  const payload: Record<string, unknown> = {
    datasetId,
    sourceUrl: options.sourceUrl,
  };
  if (options.targetSplit !== undefined) {
    payload.targetSplit = options.targetSplit;
  }

  const data = await client.postJson("/datasets/ingest", payload);
  const item = asRecord(data);
  const jobId = item.jobId ?? item.id ?? "None";
  return {
    summary: `Started dataset ingest job ${String(jobId)} for dataset ${datasetId}.`,
    data: item,
  };
}

export interface DatasetUploadFileOptions {
  dataset: string;
  filePath: string;
  targetSplit?: string;
}

/** Upload a local dataset archive file, then start ingest for that upload. */
export async function datasetUploadFile(
  client: UltralyticsClient,
  options: DatasetUploadFileOptions,
): Promise<NormalizedToolResult> {
  validateTargetSplit(options.targetSplit);

  const meta = await datasetUploadFileMeta(options.filePath);
  const datasetId = await resolveDataset(client, options.dataset);
  const content = await readFile(options.filePath);

  const signed = asRecord(
    await client.postJson("/upload/signed-url", {
      assetType: "datasets",
      assetId: datasetId,
      filename: meta.filename,
      contentType: meta.contentType,
      totalBytes: meta.totalBytes,
    }),
  );
  const uploadUrl = String(signed.url ?? "");
  const sessionId = String(signed.sessionId ?? "");
  await client.uploadBytes(uploadUrl, content, meta.contentType);
  await client.postJson("/upload/complete", { sessionId });

  const ingestPayload: Record<string, unknown> = { datasetId, sessionId };
  if (options.targetSplit !== undefined) {
    ingestPayload.targetSplit = options.targetSplit;
  }
  const ingest = asRecord(
    await client.postJson("/datasets/ingest", ingestPayload),
  );
  const jobId = ingest.jobId ?? ingest.id ?? "None";

  return {
    summary: `Uploaded ${meta.filename} (${meta.totalBytes} bytes) and started dataset ingest job ${String(jobId)}.`,
    data: {
      datasetId,
      filename: meta.filename,
      bytes: meta.totalBytes,
      sessionId,
      ingest,
    },
  };
}

export interface DatasetExportOptions {
  dataset: string;
  version?: number;
}

/** Get dataset export link for latest or one frozen version. */
export async function datasetExport(
  client: UltralyticsClient,
  options: DatasetExportOptions,
): Promise<NormalizedToolResult> {
  if (options.version !== undefined && options.version <= 0) {
    throw new Error("`version` must be greater than 0.");
  }

  const datasetId = await resolveDataset(client, options.dataset);
  const data = asRecord(
    await client.get(
      `/datasets/${datasetId}/export`,
      options.version !== undefined ? { v: options.version } : undefined,
    ),
  );
  const cached =
    typeof data.cached === "boolean"
      ? String(data.cached)
      : String(data.cached ?? null);
  return {
    summary:
      `Export link for ${options.dataset} ` +
      `(version ${String(options.version ?? "latest")}, cached=${cached})`,
    data: {
      downloadUrl: data.downloadUrl ?? null,
      cached: data.cached ?? null,
    },
  };
}

export interface DatasetVersionCreateOptions {
  dataset: string;
  description?: string;
}

/** Create frozen dataset export version. */
export async function datasetVersionCreate(
  client: UltralyticsClient,
  options: DatasetVersionCreateOptions,
): Promise<NormalizedToolResult> {
  const datasetId = await resolveDataset(client, options.dataset);
  const payload: Record<string, unknown> = {};
  if (options.description !== undefined) {
    payload.description = options.description;
  }

  const data = asRecord(
    await client.postJson(`/datasets/${datasetId}/export`, payload),
  );
  return {
    summary: `Created dataset version ${String(data.version ?? null)}`,
    data: {
      version: data.version ?? null,
      downloadUrl: data.downloadUrl ?? null,
    },
  };
}
