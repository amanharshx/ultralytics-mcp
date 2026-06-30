/** Read-only dataset tools. */

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
