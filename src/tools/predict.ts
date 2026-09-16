/** Inference tool. Accepts only an image URL or base64 source (no local paths). */

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { type PredictParams, projectPredictResult } from "./shared.js";

/** Run inference from an image URL or base64 source. Local paths are not accepted.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and posts
 * through the live owner-scoped endpoint. The API returns `{images[],
 * metadata}`; each image carries `shape`, `speed`, and `results[]`, and the
 * metadata names the `task` and `classNames`. The response carries no model
 * identity of its own, so the resolved owner/project/model the prediction
 * was sent to is reported as the model used. A base64 `data:` URI is
 * normalized to its payload before posting; any other `data:` form or an
 * empty payload is rejected before any request. A model without weights fails
 * with `400 {"error":"Model has no trained weights"}` while an input the
 * endpoint rejects (oversized source, unreadable image) fails with its own
 * `400`, so the surfaced message tells a model problem from an input
 * problem. Zero detections are a normal `200` with empty `results`.
 * `conf`/`iou`/`imgsz` are optional and only sent when given, letting the
 * server apply its own default otherwise (verified live: identical
 * detections with and without the fields set to 0.25/0.7/640).
 */
export async function modelPredict(
  client: UltralyticsClient,
  model: string,
  options: PredictParams & {
    source: string;
    project?: string;
  },
): Promise<NormalizedToolResult> {
  const { source, project, conf, iou, imgsz } = options;
  if (!source?.trim()) {
    throw new Error(
      "`source` is required: an image URL or base64-encoded image.",
    );
  }
  // The endpoint accepts raw base64 but rejects the `data:` URI form, so a
  // base64 data URI is normalized to its payload before posting. Any other
  // `data:` form has no lossless reading and is rejected instead.
  let normalizedSource = source.trim();
  if (/^data:/i.test(normalizedSource)) {
    const payload =
      /^data:[^,]*;base64,(.*)$/is.exec(normalizedSource)?.[1]?.trim() ?? "";
    if (!payload) {
      throw new Error(
        "`source` data: URIs must be base64 with a non-empty payload " +
          "(`data:<mime>;base64,<payload>`); image URLs and raw base64 are also accepted.",
      );
    }
    normalizedSource = payload;
  }

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data: Record<string, unknown> = { source: normalizedSource };
  if (conf !== undefined) data.conf = String(conf);
  if (iou !== undefined) data.iou = String(iou);
  if (imgsz !== undefined) data.imgsz = String(imgsz);
  const result = await client.postMultipart(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/predict`,
    { data },
  );

  const { images, metadata, detectionCount } = projectPredictResult(result);
  return {
    summary:
      `Model '${resolved.model}' for owner '${resolvedOwner}' ` +
      `project '${resolved.project}': ${images.length} image(s), ` +
      `${detectionCount} detection(s).`,
    data: {
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      images,
      metadata,
    },
  };
}
