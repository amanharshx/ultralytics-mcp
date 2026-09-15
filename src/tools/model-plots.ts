/** Model evaluation plots: per-class PR/F1/precision/recall curves and the confusion matrix. */

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord } from "./shared.js";

interface ModelPlotsOptions {
  type?: string;
}

/** Summarise one array-valued plot field by its shape, never its values.
 *
 * A flat array (`x`, or `confusion_matrix`'s `matrix` row) reports only its
 * `length`; a nested array (`y`, `ap`, or `matrix` itself) additionally
 * reports the first row's `innerLength`, matching the fixture warning that
 * every row of a given field is observed the same length live.
 */
function summarizeField(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  if (value.length > 0 && Array.isArray(value[0])) {
    return { length: value.length, innerLength: value[0].length };
  }
  return { length: value.length };
}

/** Summarise one plot entry: its `type`, plus the shape of every other field.
 *
 * Deliberately generic rather than hard-coded to `x`/`y`/`ap`: observed live
 * on `carparts/exp-2` (23 classes), `confusion_matrix` carries a `matrix`
 * field instead, with no `x`/`y`/`ap` at all -- the overview's shorthand
 * (`{type, x[], y[][], ap[][]}` for every plot) does not hold for it. Also
 * observed live: `pr_curve`'s `y` (22 per-class curves) can undercount its
 * own `ap` (23 per-class AP rows) by one, so the two are reported separately
 * rather than collapsed into a single "class count" that would silently pick
 * one and disagree with the other.
 */
function summarizePlot(plot: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { type: plot.type ?? null };
  for (const key of Object.keys(plot)) {
    if (key === "type") {
      continue;
    }
    summary[key] = summarizeField(plot[key]);
  }
  return summary;
}

/** Report a model's evaluation plots: a lean shape listing by default, or one
 * named plot's full data on request.
 *
 * `plots` is large -- a 23-class model's `pr_curve` alone carries thousands
 * of numbers -- so the default lists each plot's `type` and the shape of its
 * fields (see `summarizePlot`) rather than the arrays themselves. Passing
 * `type` returns that one plot's data exactly as the platform returned it,
 * with no reshaping.
 *
 * Reads the same model detail endpoint `model_metrics` and `training_monitor`
 * use, but only the `plots` field: nothing from `trainResults`, `metrics`, or
 * `bestEpoch` is read or re-derived here, since that is ticket 11's and
 * `training_monitor`'s job. Plot presence is independent of training
 * history -- `eggs-and-bowls/exp` (`plots: 5`, `trainResults: 0`) lists
 * normally -- and an empty `plots: []` (`pothole/yolo26s`,
 * `butterfly2/yolo26x`) is a legible empty result, not an error.
 */
export async function modelPlots(
  client: UltralyticsClient,
  model: string,
  project?: string,
  options: ModelPlotsOptions = {},
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const basePath = `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`;
  const data = await client.get(basePath);
  const fields = asRecord(asRecord(data).model);
  const plots = Array.isArray(fields.plots)
    ? (fields.plots as Record<string, unknown>[])
    : [];

  const modelLabel = `Model '${resolved.model}' for owner '${resolvedOwner}' project '${resolved.project}'`;

  if (options.type !== undefined) {
    const match = plots.find((plot) => plot.type === options.type);
    if (!match) {
      if (plots.length === 0) {
        throw new Error(
          `${modelLabel} has no plots available; requested type '${options.type}'.`,
        );
      }
      const available = plots.map((plot) => String(plot.type)).join(", ");
      throw new Error(
        `Plot type '${options.type}' not found for ${modelLabel}; available types: ${available}.`,
      );
    }
    return {
      summary: `${modelLabel}: plot '${options.type}', returned unmodified.`,
      data: match,
    };
  }

  const listing = plots.map(summarizePlot);
  return {
    summary:
      plots.length === 0
        ? `${modelLabel}: no plots available.`
        : `${modelLabel}: ${plots.length} plot(s) available (${plots.map((plot) => plot.type).join(", ")}).`,
    data: { plots: listing },
  };
}
