/** Read-only dataset tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveDataset } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField, pyCount, pyField } from "./shared.js";

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
