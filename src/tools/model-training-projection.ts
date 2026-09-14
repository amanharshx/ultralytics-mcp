/** Shared projection over a model record's training data.
 *
 * `training_monitor` and `model_metrics` both read `trainResults`,
 * `metrics`, `bestEpoch`, `bestFitness`, `trainArgs`, and `computeCost` off
 * the same model detail response. A single projection keeps both tools
 * reading those fields the same way rather than drifting apart.
 */

import { asRecord } from "./shared.js";

export interface ModelTrainingProjection {
  trainResults: Record<string, unknown>[];
  metrics: Record<string, unknown> | null;
  bestEpoch: number | null;
  bestFitness: number | null;
  trainArgs: Record<string, unknown> | null;
  computeCost: Record<string, unknown> | null;
}

/** Project training data off a model detail response's `model` fields. */
export function projectModelTraining(
  fields: Record<string, unknown>,
): ModelTrainingProjection {
  const trainResults = Array.isArray(fields.trainResults)
    ? (fields.trainResults as Record<string, unknown>[])
    : [];
  const metrics =
    fields.metrics && typeof fields.metrics === "object"
      ? asRecord(fields.metrics)
      : null;
  const bestEpoch =
    typeof fields.bestEpoch === "number" ? fields.bestEpoch : null;
  const bestFitness =
    typeof fields.bestFitness === "number" ? fields.bestFitness : null;
  const trainArgs =
    fields.trainArgs && typeof fields.trainArgs === "object"
      ? asRecord(fields.trainArgs)
      : null;
  const computeCost =
    fields.computeCost && typeof fields.computeCost === "object"
      ? asRecord(fields.computeCost)
      : null;
  return {
    trainResults,
    metrics,
    bestEpoch,
    bestFitness,
    trainArgs,
    computeCost,
  };
}
