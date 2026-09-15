/** Shared helpers for tool logic. */

/** Coerce unknown JSON into a record for safe field access. */
export function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}

/** Return `data[field]` as an array of records, or []. */
export function listField(
  data: unknown,
  field: string,
): Record<string, unknown>[] {
  const value = asRecord(data)[field];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Standard inference tuning knobs shared by every predict endpoint. */
export interface PredictParams {
  conf?: number;
  iou?: number;
  imgsz?: number;
}

export interface ProjectedPrediction {
  images: Record<string, unknown>[];
  metadata: Record<string, unknown> | null;
  detectionCount: number;
}

/** Project a predict endpoint's raw `{images[], metadata}` response.
 *
 * Shared by `model_predict` and `deployment_predict`: both endpoints return
 * this same shape, and both pass `images`/`metadata` through verbatim
 * (never re-keyed, so undocumented fields survive) while summing detections
 * across images for the summary line.
 */
export function projectPredictResult(result: unknown): ProjectedPrediction {
  const images = listField(result, "images");
  const metadataField = asRecord(result).metadata;
  const metadata =
    metadataField && typeof metadataField === "object"
      ? (metadataField as Record<string, unknown>)
      : null;
  const detectionCount = images.reduce(
    (total, image) =>
      total +
      (Array.isArray(asRecord(image).results)
        ? (asRecord(image).results as unknown[]).length
        : 0),
    0,
  );
  return { images, metadata, detectionCount };
}

/** Validate a positive-integer tool parameter, naming it in the error.
 *
 * Shared by `training_monitor` and `model_metrics`, both of which accept a
 * `history_last_n`-shaped parameter over the same `trainResults` history.
 */
export function validatePositiveInt(value: number, paramName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`\`${paramName}\` must be a positive integer.`);
  }
}

/** Render a summary field like Python's `dict.get(key)`: missing -> "None". */
export function pyField(value: unknown): string {
  return value === undefined || value === null ? "None" : String(value);
}

/** Render a count like Python's `dict.get(key, "?")`: absent -> "?", present-null -> "None". */
export function pyCount(fields: Record<string, unknown>, key: string): string {
  if (!(key in fields)) {
    return "?";
  }
  const value = fields[key];
  return value === undefined || value === null ? "None" : String(value);
}
