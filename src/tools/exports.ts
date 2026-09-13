/** Export tools. `export_create` is state-changing and guarded by confirm_cost. */

import type { UltralyticsClient } from "../client.js";
import { resolveLegacyModelId, resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField, pyField } from "./shared.js";

const EXPORT_FORMATS = new Set([
  "onnx",
  "torchscript",
  "openvino",
  "engine",
  "coreml",
  "tflite",
  "saved_model",
  "pb",
  "paddle",
  "ncnn",
  "edgetpu",
  "tfjs",
  "mnn",
  "rknn",
  "qnn",
  "imx",
  "axelera",
  "executorch",
  "deepx",
]);

/** List exports for a model.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and lists
 * the model's exports through the live owner-scoped endpoint. The API
 * returns `{exports[], region}`; each entry names the job via `id`,
 * `format`, and `status`, with lifecycle timestamps, the export `args`, and
 * the artifact's size and filename when the job produced one. The signed
 * download URL is deliberately omitted. A model with no exports reports an
 * empty list. The timestamps and artifact presence tell a finished export
 * from a running or failed one without a second call.
 */
export async function exportsList(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/exports`,
  );
  const items = listField(data, "exports").map((entry) => {
    const file = asRecord(entry.file);
    const args =
      entry.args && typeof entry.args === "object" ? entry.args : null;
    return {
      id: entry.id ?? null,
      format: entry.format ?? null,
      status: entry.status ?? null,
      createdAt: entry.createdAt ?? null,
      startedAt: entry.startedAt ?? null,
      completedAt: entry.completedAt ?? null,
      updatedAt: entry.updatedAt ?? null,
      fileSize: file.size ?? null,
      downloadFilename: file.downloadFilename ?? null,
      args,
    };
  });
  return {
    summary:
      `Model '${resolved.model}' for owner '${resolvedOwner}' ` +
      `project '${resolved.project}': ${items.length} export(s).`,
    data: items,
  };
}

/** Get status for one export job.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the export through the live model-scoped endpoint. The export id is
 * itself a 24-character id and a legitimate input, so it passes through
 * untouched with no id rejection. The API returns the job nested as
 * `{export}`; the curated result reports the status, format, lifecycle
 * timestamps, the export `args`, and the artifact's size, filename, and
 * download link when the job produced one, plus the error when present.
 * The status is surfaced verbatim so a failed export stays distinguishable
 * from a cancelled one.
 */
export async function exportStatus(
  client: UltralyticsClient,
  model: string,
  exportId: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/exports/${encodeURIComponent(exportId)}`,
  );
  const record = asRecord(data);
  const item = "export" in record ? record.export : data;
  const fields = asRecord(item);
  const file = asRecord(fields.file);
  const args =
    fields.args && typeof fields.args === "object" ? fields.args : null;
  const status = fields.status ?? null;
  const format = fields.format ?? null;
  const error = fields.error ?? null;
  const downloadFilename = file.downloadFilename ?? null;
  let summary =
    `Export '${String(fields.id ?? exportId)}' for model '${resolved.model}' ` +
    `for owner '${resolvedOwner}' project '${resolved.project}': ` +
    `status=${pyField(status)} format=${pyField(format)}.`;
  if (error !== null) {
    summary += ` Error: ${String(error)}.`;
  } else if (status === "completed" && downloadFilename !== null) {
    summary += ` Download: ${String(downloadFilename)}.`;
  } else if (status === "cancelled") {
    summary += " No artifact produced.";
  }
  return {
    summary,
    data: {
      id: fields.id ?? null,
      format,
      status,
      createdAt: fields.createdAt ?? null,
      startedAt: fields.startedAt ?? null,
      completedAt: fields.completedAt ?? null,
      updatedAt: fields.updatedAt ?? null,
      fileSize: file.size ?? null,
      downloadUrl: file.downloadUrl ?? null,
      downloadFilename,
      args,
      error,
    },
  };
}

/** Create a model export job. This is state-changing and may cost credits. */
export async function exportCreate(
  client: UltralyticsClient,
  model: string,
  format: string,
  options: {
    project?: string;
    gpuType?: string;
    imgsz?: number;
    half?: boolean;
    dynamic?: boolean;
    confirmCost?: boolean;
  } = {},
): Promise<NormalizedToolResult> {
  const {
    project,
    gpuType,
    imgsz,
    half,
    dynamic,
    confirmCost = false,
  } = options;
  if (!confirmCost) {
    throw new Error("Set confirm_cost=true to create an export job.");
  }

  const exportFormat = format.trim().toLowerCase();
  if (!EXPORT_FORMATS.has(exportFormat)) {
    throw new Error(`Unsupported export format '${format}'.`);
  }
  if (exportFormat === "engine" && !gpuType) {
    throw new Error("`gpu_type` is required for TensorRT engine exports.");
  }

  const modelId = await resolveLegacyModelId(client, model, project);
  const payload: Record<string, unknown> = { modelId, format: exportFormat };
  if (gpuType) {
    payload.gpuType = gpuType;
  }

  const args: Record<string, unknown> = {};
  if (imgsz !== undefined) {
    if (imgsz <= 0) {
      throw new Error("`imgsz` must be greater than 0.");
    }
    args.imgsz = imgsz;
  }
  if (half !== undefined) {
    args.half = half;
  }
  if (dynamic !== undefined) {
    args.dynamic = dynamic;
  }
  if (Object.keys(args).length > 0) {
    payload.args = args;
  }

  const data = await client.postJson("/exports", payload);
  const record = asRecord(data);
  const item = "export" in record ? record.export : data;
  const fields = asRecord(item);
  return {
    summary: `Created export ${pyField(fields._id)} status=${pyField(fields.status)} format=${pyField(fields.format)}.`,
    data: item,
  };
}
