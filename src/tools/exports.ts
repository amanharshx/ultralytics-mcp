/** Export tools. `export_create` is state-changing and guarded by confirm_cost. */

import type { UltralyticsClient } from "../client.js";
import { looksLikeId, resolveModel } from "../resolve.js";
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

/** List exports for a model. */
export async function exportsList(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const modelId = await resolveModel(client, model, project);
  const data = await client.get("/exports", { modelId });
  const items = listField(data, "exports").map((entry) => ({
    id: entry._id ?? null,
    format: entry.format ?? null,
    status: entry.status ?? null,
  }));
  return { summary: `${items.length} export(s) for model.`, data: items };
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

  const modelId = await resolveModel(client, model, project);
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
