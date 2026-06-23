/** Inference tool. Accepts only an image URL or base64 source (no local paths). */

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField } from "./shared.js";

/** Run inference from an image URL or base64 source. Local paths are not accepted. */
export async function modelPredict(
  client: UltralyticsClient,
  model: string,
  options: {
    source: string;
    project?: string;
    conf?: number;
    iou?: number;
    imgsz?: number;
  },
): Promise<NormalizedToolResult> {
  const { source, project, conf = 0.25, iou = 0.7, imgsz = 640 } = options;
  if (!source?.trim()) {
    throw new Error(
      "`source` is required: an image URL or base64-encoded image.",
    );
  }

  const modelId = await resolveModel(client, model, project);
  const result = await client.postMultipart(`/models/${modelId}/predict`, {
    data: {
      source,
      conf: String(conf),
      iou: String(iou),
      imgsz: String(imgsz),
    },
  });

  const images = listField(result, "images");
  const detectionCount = images.reduce(
    (total, image) =>
      total +
      (Array.isArray(asRecord(image).results)
        ? (asRecord(image).results as unknown[]).length
        : 0),
    0,
  );
  return {
    summary: `${images.length} image(s), ${detectionCount} detection(s).`,
    data: result,
  };
}
