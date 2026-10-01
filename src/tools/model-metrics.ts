/** Model evaluation metrics: validated best epoch vs. the platform's reported metrics. */

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import {
  describeResultHistory,
  projectModelTraining,
} from "./model-training-projection.js";
import { asRecord, pyField, validatePositiveInt } from "./shared.js";

interface ModelMetricsOptions {
  includeHistory?: boolean;
  historyLastN?: number;
  includeTrainArgs?: boolean;
}

interface BestEpochResolution {
  bestEpoch: number | null;
  bestFitness: number | null;
  metrics: Record<string, unknown> | null;
  note: string | null;
}

/** Where the model-level `metrics` field comes from, stated statically
 * because the API does not say. Verified live 2026-10-01: on every
 * finished (completed or cancelled) Platform-trained model checked, `metrics` equals the post-training
 * evaluation record (the best checkpoint re-validated after training ends),
 * not the last training epoch; on the uploaded `pothole/yolo26s` it equals
 * the last recorded epoch. */
const REPORTED_METRICS_NOTE =
  "The platform's model-level metrics, passed through verbatim; the API " +
  "does not say which evaluation produced them. On finished " +
  "Platform-trained runs observed live they match the post-training evaluation of the best " +
  "checkpoint, not the last training epoch. On uploaded models they can " +
  "match the last recorded epoch.";

/** Validate the model's reported best epoch against its `trainResults`.
 *
 * The reported pair is trusted only when exactly one record carries
 * `epoch === bestEpoch` and that record's `fitness` exactly equals
 * `bestFitness`. Anything else is reported as `null`, with the platform's
 * raw values kept only in `note`, since fields literally named `bestEpoch`
 * and `bestFitness` would otherwise state an incoherent value as fact.
 * Observed live (17-model workspace scan, 2026-10-01):
 *
 * - no matching record: `eggs-and-bowls/exp` reports `bestEpoch: 99` beside
 *   zero `trainResults`;
 * - several matching records: before v8.4.52 the post-training evaluation
 *   record reused the last epoch's number, and before v8.4.48 `bestEpoch`
 *   itself was the last epoch (fixed upstream in #24425). So `pothole/exp-2`
 *   reports epoch 99 — matched by two records — while its `bestFitness`
 *   belongs to epoch 66, and on `eggs-and-bowls/exp-2` both epoch-99
 *   records even carry the reported fitness.
 *
 * The fitness check is not observed deciding a case on its own: it guards a
 * pre-v8.4.48 history whose duplicate record never arrived, which would
 * leave the wrong `bestEpoch` with exactly one match (records do go
 * missing: `butterfly2/exp` lacks epochs 60 and 63).
 *
 * Exact equality, no tolerance: both sides come from the same rounded
 * values, and a near-miss is not evidence of the same record.
 */
function resolveBestEpoch(
  trainResults: Record<string, unknown>[],
  reportedBestEpoch: number | null,
  reportedBestFitness: number | null,
): BestEpochResolution {
  const unresolved = (note: string): BestEpochResolution => ({
    bestEpoch: null,
    bestFitness: null,
    metrics: null,
    note,
  });
  if (reportedBestEpoch === null) {
    return unresolved(
      reportedBestFitness === null
        ? "bestEpoch is not recorded for this model."
        : `bestEpoch is not recorded for this model, but it reports ` +
            `bestFitness ${reportedBestFitness}; not treated as fact.`,
    );
  }
  const reported =
    `the model reports bestEpoch ${reportedBestEpoch} ` +
    `(bestFitness ${pyField(reportedBestFitness)}), but `;
  const matches = trainResults.filter(
    (record) => record.epoch === reportedBestEpoch,
  );
  if (matches.length === 0) {
    return unresolved(
      `${reported}none of the ${trainResults.length} result record(s) ` +
        `reports epoch ${reportedBestEpoch}; not treated as fact.`,
    );
  }
  if (matches.length > 1) {
    return unresolved(
      `${reported}${matches.length} result records report epoch ` +
        `${reportedBestEpoch}, so which one it refers to is ambiguous; ` +
        `not treated as fact.`,
    );
  }
  const [match] = matches;
  if (match.fitness !== reportedBestFitness) {
    return unresolved(
      `${reported}the result record for epoch ${reportedBestEpoch} reports ` +
        `fitness ${pyField(match.fitness)}; not treated as fact.`,
    );
  }
  return {
    bestEpoch: reportedBestEpoch,
    bestFitness: reportedBestFitness,
    metrics: asRecord(match.metrics),
    note: null,
  };
}

/** Report a model's validated best epoch and its reported metrics.
 *
 * Built on the shared training projection (`trainResults`, top-level
 * `metrics`, `bestEpoch`, `bestFitness`, `trainArgs`). `bestEpochMetrics`
 * is the single `trainResults` record validated by `resolveBestEpoch`,
 * found regardless of any `include_history` window, with its raw per-epoch
 * keys (`metrics/mAP50(B)`, etc.) verbatim. `reportedMetrics` is the
 * model-level `metrics` field verbatim under a name that claims no epoch:
 * `trainResults` cannot say which record produced it, and a last-record
 * "final epoch" label was observed live to pair an epoch with metrics from
 * a different record. `resultRecordCount` counts records, not epochs.
 *
 * `include_train_args` surfaces `trainArgs` verbatim (111 keys observed
 * live); omitted by default as too heavy, not because it would be wrong.
 * `include_history` returns the last N records described by
 * `describeResultHistory`, whose window label is what keeps a truncated
 * curve legible as incomplete rather than silently "converged fine".
 */
export async function modelMetrics(
  client: UltralyticsClient,
  model: string,
  project?: string,
  options: ModelMetricsOptions = {},
): Promise<NormalizedToolResult> {
  const {
    includeHistory = false,
    historyLastN = 20,
    includeTrainArgs = false,
  } = options;
  validatePositiveInt(historyLastN, "history_last_n");

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const basePath = `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`;
  const data = await client.get(basePath);
  const fields = asRecord(asRecord(data).model);
  const projection = projectModelTraining(fields);

  const trainResults = projection.trainResults;
  const rawTotalEpochs = fields.epochs;
  const totalEpochs =
    typeof rawTotalEpochs === "number" && rawTotalEpochs > 0
      ? rawTotalEpochs
      : null;

  const {
    bestEpoch,
    bestFitness,
    metrics: bestEpochMetrics,
    note: bestEpochNote,
  } = resolveBestEpoch(
    trainResults,
    projection.bestEpoch,
    projection.bestFitness,
  );
  const reportedMetrics = projection.metrics;

  const result: Record<string, unknown> = {
    owner: resolvedOwner,
    project: resolved.project,
    model: resolved.model,
    modelId: fields.id ?? null,
    status: fields.status ?? null,
    epochs: totalEpochs,
    resultRecordCount: trainResults.length,
    bestEpoch,
    bestFitness,
    bestEpochMetrics,
    bestEpochNote,
    reportedMetrics,
    reportedMetricsNote: REPORTED_METRICS_NOTE,
  };

  if (includeTrainArgs) {
    result.trainArgs = projection.trainArgs;
  }

  if (includeHistory) {
    result.history = describeResultHistory(trainResults, historyLastN);
  }

  const bestLabel =
    bestEpoch !== null
      ? `best epoch ${bestEpoch} (fitness ${pyField(bestFitness)})`
      : `best epoch unavailable (${pyField(bestEpochNote)})`;
  const reportedLabel =
    reportedMetrics !== null
      ? "reported metrics available"
      : "reported metrics unavailable";

  return {
    summary:
      `Model '${resolved.model}' for owner '${resolvedOwner}' project '${resolved.project}': ` +
      `${bestLabel}; ${reportedLabel}; ${trainResults.length} result record(s).`,
    data: result,
  };
}
