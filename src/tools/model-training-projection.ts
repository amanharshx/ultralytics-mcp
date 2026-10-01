/** Shared projection over a model record's training data.
 *
 * `training_monitor` reads `trainResults` and `computeCost` off a model
 * detail response's `model` fields through this projection; `model_metrics`
 * also reads `metrics`, `bestEpoch`, `bestFitness`, and `trainArgs`. Both
 * describe a `trainResults` history window through `describeResultHistory`,
 * so the two tools state the same caveats about the same records.
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

/** What a `trainResults` record is, and is not, guaranteed to be.
 *
 * Observed live: after training ends, Ultralytics re-validates the best
 * checkpoint and reports it through the same per-epoch callback, so a
 * history can end with a record that is not a training epoch — numbered one
 * past the last epoch, or (older trainers) duplicating it. Callbacks can
 * also arrive out of epoch order or not at all. The API marks none of this,
 * so this note is static rather than detected from a record's keys. */
const RESULT_RECORDS_NOTE =
  "Records are returned in API order. In observed Platform-trained " +
  "histories this follows timestamp order, but epoch values are not " +
  "guaranteed to be ordered, unique, or contiguous. A record may be a " +
  "post-training evaluation rather than a training epoch; the API does not " +
  "mark which. Uploaded/backfilled histories may lack timestamps.";

export interface ResultHistory {
  window: string;
  returnedRecords: number;
  totalRecords: number;
  minEpoch: number | null;
  maxEpoch: number | null;
  duplicateEpochs: number;
  missingEpochs: number;
  note: string;
  entries: { epoch: unknown; metrics: Record<string, unknown> }[];
}

/** Describe the last `lastN` `trainResults` records in API order.
 *
 * The window label is load-bearing: a truncated curve with no label reads
 * as "converged fine" when the omitted portion diverged. It reports record
 * counts rather than epoch counts, and its min/max are the numeric extremes
 * of the returned records, never the first and last array positions, since
 * those differ when records arrive out of order. Duplicate and missing epoch
 * numbers are counted only between that min and max, so an early-stopped
 * run's never-trained epochs are not reported as gaps. */
export function describeResultHistory(
  trainResults: Record<string, unknown>[],
  lastN: number,
): ResultHistory {
  const records = trainResults.slice(-lastN);
  const epochs = records
    .map((record) => record.epoch)
    .filter((epoch): epoch is number => Number.isInteger(epoch));
  const distinct = new Set(epochs);
  const minEpoch = epochs.length > 0 ? Math.min(...epochs) : null;
  const maxEpoch = epochs.length > 0 ? Math.max(...epochs) : null;
  const duplicateEpochs = epochs.length - distinct.size;
  const missingEpochs =
    minEpoch !== null && maxEpoch !== null
      ? maxEpoch - minEpoch + 1 - distinct.size
      : 0;

  const scope =
    trainResults.length === 0
      ? "no result records"
      : records.length === trainResults.length
        ? `all ${trainResults.length} record(s) in API order`
        : `last ${records.length} of ${trainResults.length} record(s) in API order`;
  const range =
    minEpoch !== null
      ? `; reported epochs ${minEpoch}-${maxEpoch}, ` +
        `${duplicateEpochs} duplicate and ${missingEpochs} missing epoch ` +
        `number(s) in that range`
      : "";

  return {
    window: `${scope}${range}`,
    returnedRecords: records.length,
    totalRecords: trainResults.length,
    minEpoch,
    maxEpoch,
    duplicateEpochs,
    missingEpochs,
    note: RESULT_RECORDS_NOTE,
    entries: records.map((record) => ({
      epoch: record.epoch ?? null,
      metrics: asRecord(record.metrics),
    })),
  };
}
