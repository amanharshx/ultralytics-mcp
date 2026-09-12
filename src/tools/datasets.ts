/** Read-only dataset tools. */

import { execFile as execFileCb } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import { zipSync } from "fflate";

import type { UltralyticsClient } from "../client.js";
import { resolveDataset, resolveLegacyDatasetId } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { exploreSearch, validateExploreTasks } from "./explore.js";
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
const IMAGE_SUFFIXES = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);
const VIDEO_SUFFIXES = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".m4v",
  ".avi",
]);
const UPLOAD_TYPES: Array<[suffix: string, contentType: string]> = [
  [".tar.gz", "application/gzip"],
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".tgz", "application/gzip"],
  [".ndjson", "application/x-ndjson"],
];
const execFile = promisify(execFileCb);

function validateTargetSplit(targetSplit?: string): void {
  if (targetSplit !== undefined && !TARGET_SPLITS.has(targetSplit)) {
    const allowed = Array.from(TARGET_SPLITS).sort().join(", ");
    throw new Error(
      `Unsupported targetSplit '${targetSplit}'. Expected one of: ${allowed}.`,
    );
  }
}

function findToolOnPath(name: string): string | null {
  const paths = process.env.PATH?.split(":") ?? [];
  for (const base of paths) {
    const candidate = resolve(base, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function probeVideoDuration(
  videoPath: string,
  ffprobePath: string,
): Promise<number> {
  const { stdout } = await execFile(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    videoPath,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function extractVideoFrames(options: {
  videoPath: string;
  outputDir: string;
  ffmpegPath: string;
  rate: number;
  maxFrames: number;
}): Promise<void> {
  await execFile(options.ffmpegPath, [
    "-i",
    options.videoPath,
    "-vf",
    `fps=${options.rate}`,
    "-frames:v",
    String(options.maxFrames),
    "-q:v",
    "2",
    join(options.outputDir, "frame_%06d.jpg"),
  ]);
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

/** Warn when an archive exceeds the free-tier single-upload limit.
 *
 * The caller's plan is not visible, so this never blocks: it names the
 * per-plan limits and the remote-URL and cloud-storage alternatives instead
 * of guessing whether the upload will succeed.
 */
export function archiveSizeWarning(
  filename: string,
  totalBytes: number,
): string | null {
  if (totalBytes <= MAX_UPLOAD_BYTES) {
    return null;
  }
  return (
    `Archive '${filename}' is ${totalBytes} bytes, exceeding the Free-tier 10 GB ` +
    `single-upload limit (Pro: 20 GB, Enterprise: 50 GB). Proceeding with the upload ` +
    `since your plan is not visible; if it fails, ingest the archive from a remote URL ` +
    `with dataset_ingest or from cloud storage instead.`
  );
}

function skipDatasetFolderPart(part: string): boolean {
  return part.startsWith(".") || part === "__MACOSX";
}

function hasSplitLikePath(path: string): boolean {
  return path.split("/").some((part) => TARGET_SPLITS.has(part.toLowerCase()));
}

async function datasetFolderImages(folderPath: string): Promise<{
  folderPath: string;
  files: Array<{ absolutePath: string; relativePath: string; size: number }>;
  hasSplitDirs: boolean;
}> {
  if (!folderPath.trim()) {
    throw new Error("`folderPath` is required.");
  }

  const resolvedFolder = resolve(folderPath);
  const info = await stat(resolvedFolder).catch(() => null);
  if (info === null) {
    throw new Error(`Upload folder does not exist: ${resolvedFolder}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Upload path is not a directory: ${resolvedFolder}`);
  }

  const files: Array<{
    absolutePath: string;
    relativePath: string;
    size: number;
  }> = [];
  let totalBytes = 0;
  let hasSplitDirs = false;

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (skipDatasetFolderPart(entry.name) || entry.name === ".DS_Store") {
        continue;
      }
      const absolutePath = resolve(currentPath, entry.name);
      const relativePath = relative(resolvedFolder, absolutePath).replaceAll(
        "\\",
        "/",
      );
      if (
        relativePath
          .split("/")
          .some((part) => skipDatasetFolderPart(part) || part === ".DS_Store")
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      const archiveSuffix = UPLOAD_TYPES.find(([candidate]) =>
        lower.endsWith(candidate),
      );
      if (archiveSuffix) {
        continue;
      }
      const imageSuffix = Array.from(IMAGE_SUFFIXES).find((candidate) =>
        lower.endsWith(candidate),
      );
      if (!imageSuffix) {
        continue;
      }
      const fileInfo = await stat(absolutePath);
      totalBytes += fileInfo.size;
      if (totalBytes >= MAX_UPLOAD_BYTES) {
        throw new Error(
          "Upload folder images must be smaller than 10 GB total.",
        );
      }
      if (hasSplitLikePath(relativePath)) {
        hasSplitDirs = true;
      }
      files.push({ absolutePath, relativePath, size: fileInfo.size });
    }
  }

  await walk(resolvedFolder);
  if (files.length === 0) {
    throw new Error("No images found in folder.");
  }

  return { folderPath: resolvedFolder, files, hasSplitDirs };
}

async function buildDatasetFolderZip(
  files: Array<{ absolutePath: string; relativePath: string }>,
): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.relativePath] = await readFile(file.absolutePath);
  }
  const zipBytes = zipSync(entries, { level: 6 });
  if (zipBytes.byteLength >= MAX_UPLOAD_BYTES) {
    throw new Error("Upload zip must be smaller than 10 GB.");
  }
  return zipBytes;
}

/** Open a fresh request body for one PUT attempt.
 *
 * A PUT consumes its body, so the factory runs again on retry: a consumed
 * stream cannot be re-read, while in-memory bytes return the same content.
 */
export type UploadBodyOpener = () => BodyInit;

/** Run one signed-upload session: PUT the content, then complete the session.
 *
 * Shared by every dataset upload tool. The PUT sends the runtime headers
 * from the signed-url response together with the declared content type and
 * the known content length, without buffering the content. On PUT failure
 * the retry requests a fresh signed-url session rather than reusing the same
 * URL, whose storage precondition makes same-URL retry unreliable.
 * Completion stays inside the session: a failed PUT is never completed.
 * Returns the session id whose bytes actually landed, so ingest always
 * references the live session.
 */
async function uploadThroughSignedSession(
  client: UltralyticsClient,
  options: {
    requestSigned: () => Promise<Record<string, unknown>>;
    openBody: UploadBodyOpener;
    contentType: string;
    contentLength: number;
  },
): Promise<{ sessionId: string }> {
  let signed = await options.requestSigned();
  const doUpload = async (upload: Record<string, unknown>): Promise<void> => {
    await client.putSignedBytes(
      String(upload.uploadUrl ?? upload.url),
      options.openBody(),
      options.contentType,
      {
        ...signedUploadHeaders(upload),
        "Content-Length": String(options.contentLength),
      },
    );
  };
  try {
    await doUpload(signed);
  } catch {
    signed = await options.requestSigned();
    await doUpload(signed);
  }
  const sessionId = String(signed.sessionId);
  await client.postJson("/upload/complete", { sessionId });
  return { sessionId };
}

/** Attach the oversize-archive guidance to an upload failure.
 *
 * Large archives usually fail at the storage or ingest layer with errors
 * that say nothing about plan limits. When the archive already exceeded the
 * free-tier limit, the original error keeps its text and gains the
 * plan-limit and alternative-upload guidance.
 */
function withSizeWarning(error: unknown, sizeWarning: string | null): unknown {
  if (sizeWarning === null || !(error instanceof Error)) {
    return error;
  }
  return new Error(`${error.message} ${sizeWarning}`, { cause: error });
}

/** Legacy signed-upload wrapper for the unmigrated video tool.
 *
 * Runs the shared session lifecycle but keeps the legacy id-based ingest
 * call. The video ticket migrates the ingest half with its own live
 * verification; do not extend this for new code.
 */
async function uploadDatasetContent(
  client: UltralyticsClient,
  options: {
    datasetId: string;
    filename: string;
    contentType: string;
    totalBytes: number;
    content: Uint8Array;
    targetSplit?: string;
    classMapping?: Record<string, string>;
  },
): Promise<{ sessionId: string; ingest: Record<string, unknown> }> {
  const { sessionId } = await uploadThroughSignedSession(client, {
    requestSigned: async () =>
      asRecord(
        await client.postJson("/upload/signed-url", {
          assetType: "datasets",
          assetId: options.datasetId,
          filename: options.filename,
          contentType: options.contentType,
          totalBytes: options.totalBytes,
        }),
      ),
    openBody: () => new Uint8Array(options.content),
    contentType: options.contentType,
    contentLength: options.totalBytes,
  });

  const ingestPayload: Record<string, unknown> = {
    datasetId: options.datasetId,
    sessionId,
  };
  if (options.targetSplit !== undefined) {
    ingestPayload.targetSplit = options.targetSplit;
  }
  if (
    options.classMapping !== undefined &&
    Object.keys(options.classMapping).length > 0
  ) {
    ingestPayload.classMapping = options.classMapping;
  }
  const ingest = asRecord(
    await client.postJson("/datasets/ingest", ingestPayload),
  );
  return { sessionId, ingest };
}

/** List datasets in the workspace, optionally filtered by owner.
 *
 * Reads the live owner-scoped endpoint. When no owner is given, the owner is
 * filled from the account summary and named in the summary output so the
 * caller can tell which workspace was read. An explicit `owner` always wins;
 * `username` remains as a compatibility alias for it.
 */
export async function datasetsList(
  client: UltralyticsClient,
  owner?: string,
  username?: string,
): Promise<NormalizedToolResult> {
  const explicitOwner = owner?.trim() || username?.trim() || undefined;
  const resolvedOwner = explicitOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/datasets/${encodeURIComponent(resolvedOwner)}`,
  );
  const items = listField(data, "datasets").map((dataset) => ({
    id: dataset.id ?? null,
    name: dataset.name ?? null,
    slug: dataset.dataset ?? null,
    username: dataset.owner ?? null,
    visibility: dataset.visibility ?? null,
    task: dataset.task ?? null,
    imageCount: dataset.imageCount ?? null,
    classCount: dataset.classCount ?? null,
  }));
  return {
    summary: `${items.length} dataset(s) for owner '${resolvedOwner}'.`,
    data: items,
  };
}

export interface ExploreDatasetsOptions {
  q: string;
  sort?: string;
  offset?: number;
  task?: string[];
}

/** Search public datasets on Explore. */
export async function exploreDatasets(
  client: UltralyticsClient,
  options: ExploreDatasetsOptions,
): Promise<NormalizedToolResult> {
  const data = await exploreSearch(client, "datasets", options.q, {
    sort: options.sort,
    offset: options.offset,
    task: validateExploreTasks(options.task),
  });
  const items = listField(data, "datasets").map((dataset) => ({
    id: dataset._id ?? null,
    name: dataset.name ?? null,
    slug: dataset.slug ?? null,
    username: dataset.username ?? null,
    task: dataset.task ?? null,
    imageCount: dataset.imageCount ?? null,
    classCount: dataset.classCount ?? null,
    starCount: dataset.starCount ?? null,
  }));
  const hasMore = Boolean(data.hasMore);
  return {
    summary: `Search '${options.q.trim()}': ${items.length} dataset(s)${hasMore ? " (more available)" : ""}`,
    data: {
      datasets: items,
      hasMore,
    },
  };
}

/** Get one dataset by slug, owner/slug, or dataset ul:// URI.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and reads the live
 * owner-scoped endpoint. The API nests the dataset under `dataset` with no
 * additional data beside it; the full dataset record (including task,
 * visibility, counts, class names, and ingest status fields) is surfaced.
 */
export async function datasetsGet(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, dataset: refSlug } = resolveDataset(dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
  );
  const record = asRecord(data);
  const fields = asRecord(record.dataset);
  return {
    summary:
      `Dataset '${pyField(fields.dataset)}' for owner '${resolvedOwner}': ` +
      `'${pyField(fields.name)}' (${pyField(fields.visibility)}) [${pyField(fields.task)}], ` +
      `${pyCount(fields, "imageCount")} images, ${pyCount(fields, "classCount")} classes.`,
    data: fields,
  };
}

export interface DatasetsCreateOptions {
  name: string;
  dataset: string;
  task: string;
  owner?: string;
  visibility?: string;
  description?: string;
  classNames?: string[];
}

/** Create a dataset safely without publishing by accident.
 *
 * Sends the URL slug as `dataset` (the API rejects `slug`), defaults
 * visibility to private, accepts an optional owner defaulting to the
 * account owner, and reads the flat create response. The summary names
 * the id, owner, and slug so the caller can tell what was created where.
 */
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
  if (!options.dataset?.trim()) {
    throw new Error("`dataset` is required.");
  }

  const explicitOwner = options.owner?.trim() || undefined;
  const resolvedOwner = explicitOwner ?? (await client.getAccountOwner());
  const visibility = options.visibility ?? "private";
  const payload: Record<string, unknown> = {
    dataset: options.dataset,
    name: options.name,
    task: options.task,
    visibility,
    owner: resolvedOwner,
  };
  if (options.description !== undefined) {
    payload.description = options.description;
  }
  if (options.classNames !== undefined) {
    payload.classNames = options.classNames;
  }

  const data = await client.postJson("/datasets", payload);
  const record = asRecord(data);
  return {
    summary:
      `Created dataset '${pyField(record.dataset ?? options.dataset)}' ` +
      `for owner '${pyField(record.owner ?? resolvedOwner)}' ` +
      `with id '${pyField(record.id)}' (${pyField(visibility)}).`,
    data: record,
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

/** List images in a dataset by slug, owner/slug, or dataset ul:// URI.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and reads the live
 * owner-scoped endpoint. Every filter the tool exposes is passed through
 * under the parameter names the endpoint accepts; the response surfaces the
 * total, whether more results remain, and the class information and error
 * count that tell whether the dataset ingested cleanly.
 */
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

  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
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
    `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}/images`,
    Object.keys(params).length > 0 ? params : undefined,
  );
  const record = asRecord(data);
  const images = listField(data, "images").map((image) => ({
    id: image.id ?? image._id ?? null,
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
      classes: record.classes ?? null,
      errorCount: record.errorCount ?? null,
      nextCursor: record.nextCursor ?? null,
      images,
    },
  };
}

/** Delete a dataset by slug, owner/slug, or dataset ul:// URI.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and deletes through the
 * live owner-scoped endpoint. The API reports only `{success: true}` with no
 * cascade summary; both the returned fields and the ref are surfaced so the
 * caller can tell what was removed. Deleting a dataset moves its images and
 * annotations to trash with it; models trained on it are unaffected.
 */
export async function datasetsDelete(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, dataset: refSlug } = resolveDataset(dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.delete(
    `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
  );
  const record = asRecord(data);
  return {
    summary:
      `Deleted dataset '${refSlug}' for owner '${resolvedOwner}' ` +
      `(soft delete; images and annotations moved to trash with the dataset; ` +
      `models trained on it are unaffected; restorable from trash).`,
    data: {
      owner: resolvedOwner,
      dataset: refSlug,
      ...record,
    },
  };
}

export interface DatasetsIngestOptions {
  dataset: string;
  sourceUrl: string;
  targetSplit?: string;
  conflictPolicy?: string;
}

const INGEST_CONFLICT_POLICIES: ReadonlySet<string> = new Set([
  "skip",
  "keep_both",
  "replace",
]);

/** Conflict policies the live ingest endpoint accepts. The platform default
 * is undocumented, so tools always send one explicitly. Option inputs stay
 * `string` because MCP arguments arrive unvalidated; this type names the
 * validated value. */
export type IngestConflictPolicy = "skip" | "keep_both" | "replace";

function validateIngestConflictPolicy(
  conflictPolicy?: string,
): IngestConflictPolicy {
  const effective = conflictPolicy ?? "skip";
  if (!INGEST_CONFLICT_POLICIES.has(effective)) {
    const allowed = Array.from(INGEST_CONFLICT_POLICIES).sort().join(", ");
    throw new Error(
      `Unsupported conflictPolicy '${effective}'. Expected one of: ${allowed}.`,
    );
  }
  return effective as IngestConflictPolicy;
}

/** Start a remote URL ingest job for an existing dataset.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and starts the ingest
 * through the live owner-scoped endpoint. The conflict policy is always sent
 * explicitly, defaulting to the non-destructive `skip` (the platform default
 * is undocumented). The queued job id is returned with the dataset's current
 * ingest status fields; use `datasets_get` to follow up, since ingest runs
 * asynchronously and this tool does not poll to completion.
 */
export async function datasetsIngest(
  client: UltralyticsClient,
  options: DatasetsIngestOptions,
): Promise<NormalizedToolResult> {
  if (!options.sourceUrl?.trim()) {
    throw new Error("`sourceUrl` is required.");
  }
  validateTargetSplit(options.targetSplit);
  const conflictPolicy = validateIngestConflictPolicy(options.conflictPolicy);

  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const encodedRef = `${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`;
  const payload: Record<string, unknown> = {
    sourceUrl: options.sourceUrl,
    conflictPolicy,
  };
  if (options.targetSplit !== undefined) {
    payload.targetSplit = options.targetSplit;
  }

  const ingest = asRecord(
    await client.postJson(`/datasets/${encodedRef}/ingest`, payload),
  );
  const jobId = ingest.jobId ?? ingest.id ?? null;
  // The ingest job is already queued at this point, so a transient failure
  // of the status lookup must not discard the issued job id and invite a
  // duplicate retry. Report the submission with unknown status instead.
  let fields: Record<string, unknown> = {};
  let statusLookupFailed = false;
  try {
    const datasetRecord = asRecord(await client.get(`/datasets/${encodedRef}`));
    fields = asRecord(datasetRecord.dataset);
  } catch {
    statusLookupFailed = true;
  }
  const datasetStatus = fields.status ?? null;
  const statusNote = statusLookupFailed
    ? `(dataset status: ${String(datasetStatus ?? "None")}; status lookup failed)`
    : `(dataset status: ${String(datasetStatus ?? "None")})`;
  return {
    summary:
      `Started dataset ingest job ${String(jobId ?? "None")} for dataset ` +
      `'${refSlug}' for owner '${resolvedOwner}' ` +
      `${statusNote}. ` +
      `Use datasets_get to follow up; ingest completes when lastIngestJobId matches ${String(jobId ?? "None")}.`,
    data: {
      jobId,
      status: ingest.status ?? null,
      conflictPolicy,
      targetSplit: options.targetSplit ?? null,
      owner: resolvedOwner,
      dataset: refSlug,
      datasetStatus,
      lastIngestJobId: fields.lastIngestJobId ?? null,
      lastIngestSummary: fields.lastIngestSummary ?? null,
      processingError: fields.processingError ?? null,
      errorCount: fields.errorCount ?? null,
    },
  };
}

export interface DatasetUploadFileOptions {
  dataset: string;
  filePath: string;
  targetSplit?: string;
  conflictPolicy?: string;
}

function signedUploadHeaders(
  signed: Record<string, unknown>,
): Record<string, string> {
  const raw = signed.headers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

/** Upload a local dataset archive file, then start ingest for that upload.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, fetches the dataset to
 * obtain its id, then runs the signed-upload flow: request a signed URL with
 * the dataset asset type and the file's real name, content type, and byte
 * size; stream the file with both the runtime headers and the declared
 * content type, so archives larger than the in-memory limit still upload;
 * complete the session before ingest; and start ingest from
 * the completed session through the live owner-scoped endpoint. The conflict
 * policy is always sent explicitly, defaulting to the non-destructive `skip`
 * (the platform default is undocumented). The queued job id is returned with
 * the dataset's current ingest status fields; use `datasets_get` to follow
 * up, since ingest runs asynchronously and this tool does not poll to
 * completion. On upload failure a fresh signed-url session is started rather
 * than retrying the same URL. Archives larger than the free-tier limit warn
 * instead of blocking, since the caller's plan is not visible; when such an
 * upload fails, the error keeps that guidance.
 */
export async function datasetUploadFile(
  client: UltralyticsClient,
  options: DatasetUploadFileOptions,
): Promise<NormalizedToolResult> {
  validateTargetSplit(options.targetSplit);
  const conflictPolicy = validateIngestConflictPolicy(options.conflictPolicy);

  const meta = await datasetUploadFileMeta(options.filePath);
  const sizeWarning = archiveSizeWarning(meta.filename, meta.totalBytes);

  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const encodedRef = `${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`;
  const datasetRecord = asRecord(await client.get(`/datasets/${encodedRef}`));
  const idFields = asRecord(datasetRecord.dataset);
  const datasetId =
    typeof idFields.id === "string" && idFields.id.trim() ? idFields.id : null;
  if (datasetId === null) {
    throw new Error(
      `Dataset '${refSlug}' for owner '${resolvedOwner}' did not include an id; cannot request an upload session.`,
    );
  }

  const requestSigned = async (): Promise<Record<string, unknown>> =>
    asRecord(
      await client.postJson("/upload/signed-url", {
        assetType: "datasets",
        assetId: datasetId,
        filename: meta.filename,
        contentType: meta.contentType,
        totalBytes: meta.totalBytes,
      }),
    );
  // The file stays on disk: each PUT attempt opens a fresh stream, so
  // archives larger than the in-memory limit upload without buffering.
  const openBody = (): BodyInit =>
    Readable.toWeb(createReadStream(options.filePath)) as BodyInit;

  let sessionId: string;
  let ingest: Record<string, unknown>;
  try {
    ({ sessionId } = await uploadThroughSignedSession(client, {
      requestSigned,
      openBody,
      contentType: meta.contentType,
      contentLength: meta.totalBytes,
    }));

    const ingestPayload: Record<string, unknown> = {
      sessionId,
      conflictPolicy,
    };
    if (options.targetSplit !== undefined) {
      ingestPayload.targetSplit = options.targetSplit;
    }
    ingest = asRecord(
      await client.postJson(`/datasets/${encodedRef}/ingest`, ingestPayload),
    );
  } catch (error) {
    throw withSizeWarning(error, sizeWarning);
  }
  const jobId = ingest.jobId ?? ingest.id ?? null;
  // The ingest job is already queued at this point, so a transient failure
  // of the status lookup must not discard the issued job id and invite a
  // duplicate retry. Report the submission with unknown status instead.
  let statusFields: Record<string, unknown> = {};
  let statusLookupFailed = false;
  try {
    const statusRecord = asRecord(await client.get(`/datasets/${encodedRef}`));
    statusFields = asRecord(statusRecord.dataset);
  } catch {
    statusLookupFailed = true;
  }
  const datasetStatus = statusFields.status ?? null;
  const statusNote = statusLookupFailed
    ? `(dataset status: ${String(datasetStatus ?? "None")}; status lookup failed)`
    : `(dataset status: ${String(datasetStatus ?? "None")})`;
  const warningNote = sizeWarning === null ? "" : ` Warning: ${sizeWarning}`;
  return {
    summary:
      `Uploaded ${meta.filename} (${meta.totalBytes} bytes) and started dataset ingest job ` +
      `${String(jobId ?? "None")} for dataset '${refSlug}' for owner '${resolvedOwner}' ` +
      `${statusNote}. ` +
      `Use datasets_get to follow up; ingest completes when lastIngestJobId matches ${String(jobId ?? "None")}.${warningNote}`,
    data: {
      jobId,
      status: ingest.status ?? null,
      conflictPolicy,
      targetSplit: options.targetSplit ?? null,
      owner: resolvedOwner,
      dataset: refSlug,
      datasetStatus,
      lastIngestJobId: statusFields.lastIngestJobId ?? null,
      lastIngestSummary: statusFields.lastIngestSummary ?? null,
      processingError: statusFields.processingError ?? null,
      errorCount: statusFields.errorCount ?? null,
      filename: meta.filename,
      bytes: meta.totalBytes,
      sessionId,
      sizeWarning,
    },
  };
}

export interface DatasetUploadFolderOptions {
  dataset: string;
  folderPath: string;
  targetSplit?: string;
  conflictPolicy?: string;
}

/** Upload a local image folder as a zip, then start ingest for that upload.
 *
 * Keeps the existing client-side zipping and local path safety checks
 * unchanged, then runs the signed-upload flow the archive tool established:
 * resolve the reference by pure string parsing (ids are not addressable),
 * fill a missing owner from the account summary, fetch the dataset to
 * obtain its id, request a signed URL with the dataset asset type and the
 * zipped folder's name, content type, and byte size; upload the zip with
 * both the runtime headers and the declared content type; complete the
 * session before ingest; and start ingest from the completed session
 * through the live owner-scoped endpoint. The conflict policy is always sent
 * explicitly, defaulting to the non-destructive `skip` (the platform default
 * is undocumented). The queued job id is returned with the dataset's current
 * ingest status fields; use `datasets_get` to follow up, since ingest runs
 * asynchronously and this tool does not poll to completion. On upload
 * failure a fresh signed-url session is started rather than retrying the
 * same URL.
 */
export async function datasetUploadFolder(
  client: UltralyticsClient,
  options: DatasetUploadFolderOptions,
): Promise<NormalizedToolResult> {
  validateTargetSplit(options.targetSplit);
  const conflictPolicy = validateIngestConflictPolicy(options.conflictPolicy);

  const folder = await datasetFolderImages(options.folderPath);
  if (options.targetSplit !== undefined && folder.hasSplitDirs) {
    throw new Error(
      "Folder has split directories (train/val/test); don't also pass targetSplit - it's ambiguous. Use one or the other.",
    );
  }

  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const encodedRef = `${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`;
  const datasetRecord = asRecord(await client.get(`/datasets/${encodedRef}`));
  const idFields = asRecord(datasetRecord.dataset);
  const datasetId =
    typeof idFields.id === "string" && idFields.id.trim() ? idFields.id : null;
  if (datasetId === null) {
    throw new Error(
      `Dataset '${refSlug}' for owner '${resolvedOwner}' did not include an id; cannot request an upload session.`,
    );
  }

  const content = await buildDatasetFolderZip(folder.files);
  const filename = `${basename(folder.folderPath)}.zip`;

  const requestSigned = async (): Promise<Record<string, unknown>> =>
    asRecord(
      await client.postJson("/upload/signed-url", {
        assetType: "datasets",
        assetId: datasetId,
        filename,
        contentType: "application/zip",
        totalBytes: content.byteLength,
      }),
    );
  // The zip lives in memory: each PUT attempt opens a fresh copy, since a
  // consumed body cannot be re-read on retry.
  const openBody = (): BodyInit => new Uint8Array(content);

  const { sessionId } = await uploadThroughSignedSession(client, {
    requestSigned,
    openBody,
    contentType: "application/zip",
    contentLength: content.byteLength,
  });

  const ingestPayload: Record<string, unknown> = {
    sessionId,
    conflictPolicy,
  };
  if (options.targetSplit !== undefined) {
    ingestPayload.targetSplit = options.targetSplit;
  }
  const ingest = asRecord(
    await client.postJson(`/datasets/${encodedRef}/ingest`, ingestPayload),
  );
  const jobId = ingest.jobId ?? ingest.id ?? null;
  // The ingest job is already queued at this point, so a transient failure
  // of the status lookup must not discard the issued job id and invite a
  // duplicate retry. Report the submission with unknown status instead.
  let statusFields: Record<string, unknown> = {};
  let statusLookupFailed = false;
  try {
    const statusRecord = asRecord(await client.get(`/datasets/${encodedRef}`));
    statusFields = asRecord(statusRecord.dataset);
  } catch {
    statusLookupFailed = true;
  }
  const datasetStatus = statusFields.status ?? null;
  const statusNote = statusLookupFailed
    ? `(dataset status: ${String(datasetStatus ?? "None")}; status lookup failed)`
    : `(dataset status: ${String(datasetStatus ?? "None")})`;
  return {
    summary:
      `Zipped ${folder.files.length} image(s) from ${folder.folderPath} as ${filename} ` +
      `(${content.byteLength} bytes) and started dataset ingest job ` +
      `${String(jobId ?? "None")} for dataset '${refSlug}' for owner '${resolvedOwner}' ` +
      `${statusNote}. ` +
      `Use datasets_get to follow up; ingest completes when lastIngestJobId matches ${String(jobId ?? "None")}.`,
    data: {
      jobId,
      status: ingest.status ?? null,
      conflictPolicy,
      targetSplit: options.targetSplit ?? null,
      owner: resolvedOwner,
      dataset: refSlug,
      datasetStatus,
      lastIngestJobId: statusFields.lastIngestJobId ?? null,
      lastIngestSummary: statusFields.lastIngestSummary ?? null,
      processingError: statusFields.processingError ?? null,
      errorCount: statusFields.errorCount ?? null,
      imageCount: folder.files.length,
      filename,
      bytes: content.byteLength,
      sessionId,
    },
  };
}

export interface DatasetUploadVideoOptions {
  dataset: string;
  videoPath: string;
  fps?: number;
  maxFrames?: number;
  targetSplit?: string;
  _findTool?: (name: string) => string | null;
  _probeDuration?: (videoPath: string, ffprobePath: string) => Promise<number>;
  _extractFrames?: (options: {
    videoPath: string;
    outputDir: string;
    ffmpegPath: string;
    rate: number;
    maxFrames: number;
  }) => Promise<void>;
}

/** Upload local video by extracting JPEG frames, then start dataset ingest. */
export async function datasetUploadVideo(
  client: UltralyticsClient,
  options: DatasetUploadVideoOptions,
): Promise<NormalizedToolResult> {
  validateTargetSplit(options.targetSplit);
  if (!options.videoPath.trim()) {
    throw new Error("`videoPath` is required.");
  }
  const fps = options.fps ?? 1;
  const maxFrames = options.maxFrames ?? 100;
  if (fps <= 0) {
    throw new Error("`fps` must be greater than 0.");
  }
  if (maxFrames <= 0) {
    throw new Error("`maxFrames` must be greater than 0.");
  }

  const resolvedVideo = resolve(options.videoPath);
  const info = await stat(resolvedVideo).catch(() => null);
  if (info === null) {
    throw new Error(`Upload video does not exist: ${resolvedVideo}`);
  }
  if (!info.isFile()) {
    throw new Error(`Upload path is not a file: ${resolvedVideo}`);
  }
  const lower = basename(resolvedVideo).toLowerCase();
  if (!Array.from(VIDEO_SUFFIXES).some((suffix) => lower.endsWith(suffix))) {
    throw new Error(
      `Unsupported video file type. Expected one of: ${Array.from(VIDEO_SUFFIXES).sort().join(", ")}.`,
    );
  }

  const findTool = options._findTool ?? findToolOnPath;
  const ffmpegPath = findTool("ffmpeg");
  const ffprobePath = findTool("ffprobe");
  if (!ffmpegPath || !ffprobePath) {
    throw new Error(
      "ffmpeg/ffprobe not found on PATH. Install ffmpeg, or extract frames yourself (ffmpeg -i video.mp4 -vf fps=1 frames/%06d.jpg) and use dataset_upload_folder.",
    );
  }

  let rate = fps;
  let usedProbeFallback = false;
  const probe = options._probeDuration ?? probeVideoDuration;
  try {
    const duration = await probe(resolvedVideo, ffprobePath);
    if (duration > 0) {
      rate = Math.min(fps, maxFrames / duration);
    }
  } catch {
    usedProbeFallback = true;
    rate = fps;
  }

  const extract = options._extractFrames ?? extractVideoFrames;
  const outputDir = await mkdtemp(join(process.cwd(), ".ultralytics-video-"));
  try {
    await extract({
      videoPath: resolvedVideo,
      outputDir,
      ffmpegPath,
      rate,
      maxFrames,
    });
    const folder = await datasetFolderImages(outputDir);
    const content = await buildDatasetFolderZip(folder.files);
    const datasetId = await resolveLegacyDatasetId(client, options.dataset);
    const filename = `${basename(resolvedVideo).replace(/\.[^.]+$/, "")}.zip`;
    const upload = await uploadDatasetContent(client, {
      datasetId,
      filename,
      contentType: "application/zip",
      totalBytes: content.byteLength,
      content,
      targetSplit: options.targetSplit,
    });
    const jobId = upload.ingest.jobId ?? upload.ingest.id ?? "None";
    return {
      summary: `Extracted ${folder.files.length} frame(s) at ~${Number(rate.toFixed(4))} fps from ${resolvedVideo}; started ingest job ${String(jobId)} for dataset ${datasetId}.${usedProbeFallback ? " probe fallback" : ""}`,
      data: {
        datasetId,
        frameCount: folder.files.length,
        fps,
        maxFrames,
        filename,
        bytes: content.byteLength,
        sessionId: upload.sessionId,
        ingest: upload.ingest,
      },
    };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

export interface DatasetExportOptions {
  dataset: string;
  version?: number;
}

/** Get dataset export link for latest or one frozen version.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and reads the live
 * owner-scoped endpoint. A specific saved version is requested with `?v=N`;
 * without a version the current dataset export is returned. The API returns
 * a signed, time-limited download URL; the summary says so explicitly.
 */
export async function datasetExport(
  client: UltralyticsClient,
  options: DatasetExportOptions,
): Promise<NormalizedToolResult> {
  if (options.version !== undefined && options.version <= 0) {
    throw new Error("`version` must be greater than 0.");
  }

  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = asRecord(
    await client.get(
      `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}/export`,
      options.version !== undefined ? { v: options.version } : undefined,
    ),
  );
  const versionLabel =
    options.version === undefined ? "latest" : String(options.version);
  const detail =
    typeof data.cached === "boolean"
      ? `version ${versionLabel}, cached=${String(data.cached)}`
      : `version ${versionLabel}`;
  return {
    summary:
      `Export link for dataset '${refSlug}' for owner '${resolvedOwner}' ` +
      `(${detail}). ` +
      `This link is time-limited and will expire.`,
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

/** Create a frozen dataset version snapshot.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and creates the version
 * through the live owner-scoped endpoint. The API returns the version number
 * with a signed, time-limited download URL; when the dataset is unchanged
 * since the previous snapshot it returns the existing version with
 * `reused: true` instead of creating a new one, which the summary reports
 * without claiming a new version was created. When the reuse flag is absent
 * the summary stays neutral so it never falsely claims a new version.
 */
export async function datasetVersionCreate(
  client: UltralyticsClient,
  options: DatasetVersionCreateOptions,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, dataset: refSlug } = resolveDataset(options.dataset);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const payload: Record<string, unknown> = {};
  if (options.description !== undefined) {
    payload.description = options.description;
  }

  const data = asRecord(
    await client.postJson(
      `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}/export`,
      payload,
    ),
  );
  const version = data.version ?? null;
  const reused = data.reused ?? null;
  const datasetRef = `dataset '${refSlug}' for owner '${resolvedOwner}'`;
  const expiryNote = `This link is time-limited and will expire.`;
  let summary: string;
  if (reused === true) {
    summary =
      `Dataset version ${String(version)} for ${datasetRef} ` +
      `already existed (no changes since the previous snapshot). ${expiryNote}`;
  } else if (reused === false) {
    summary = `Created dataset version ${String(version)} for ${datasetRef}. ${expiryNote}`;
  } else {
    summary = `Dataset version ${String(version)} for ${datasetRef}. ${expiryNote}`;
  }
  return {
    summary,
    data: {
      version,
      downloadUrl: data.downloadUrl ?? null,
      reused,
    },
  };
}
