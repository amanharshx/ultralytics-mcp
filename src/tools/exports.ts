/** Export tools. `export_create` is state-changing and guarded by confirm_cost. */

import type { UltralyticsClient } from "../client.js";
import { looksLikeId, resolveLegacyModelId, resolveModel } from "../resolve.js";
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

/** Get status for one export job. */
export async function exportStatus(
  client: UltralyticsClient,
  exportId: string,
): Promise<NormalizedToolResult> {
  if (!looksLikeId(exportId)) {
    throw new Error("`export_id` must be a 24-character export id.");
  }
  const data = await client.get(`/exports/${exportId}`);
  const record = asRecord(data);
  const item = "export" in record ? record.export : data;
  const fields = asRecord(item);
  const idText = "_id" in fields ? pyField(fields._id) : exportId;
  return {
    summary: `Export ${idText} status=${pyField(fields.status)} format=${pyField(fields.format)}.`,
    data: item,
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
