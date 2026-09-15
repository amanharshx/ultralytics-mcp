/** Model evaluation metrics: best-epoch vs. final-epoch, never confused. */

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { projectModelTraining } from "./model-training-projection.js";
import { asRecord, pyField } from "./shared.js";

interface ModelMetricsOptions {
  includeHistory?: boolean;
  historyLastN?: number;
  includeTrainArgs?: boolean;
}

function validateHistoryLastN(historyLastN: number): void {
  if (!Number.isInteger(historyLastN) || historyLastN <= 0) {
    throw new Error("`history_last_n` must be a positive integer.");
  }
}

/** Find the recorded epoch entry matching `bestEpoch` by its `epoch` field,
 * never by array position: early stopping and gaps mean array index and
 * epoch number are not the same thing, and a model can report a `bestEpoch`
 * with no matching entry at all (see `eggs-and-bowls/exp`, observed live
 * with `bestEpoch: 99` beside zero `trainResults`). Returns `null` plus a
 * reason rather than throwing or reporting the mismatch as fact. */
function findBestEpochMetrics(
  trainResults: Record<string, unknown>[],
  bestEpoch: number | null,
  totalEpochs: number | null,
): { metrics: Record<string, unknown> | null; note: string | null } {
  if (bestEpoch === null) {
    return {
      metrics: null,
      note: "bestEpoch is not recorded for this model.",
    };
  }
  const match = trainResults.find((entry) => entry.epoch === bestEpoch);
  if (!match) {
    return {
      metrics: null,
      note:
        `bestEpoch ${bestEpoch} has no matching entry among the ` +
        `${trainResults.length} recorded epoch(s)` +
        (totalEpochs !== null ? ` (epochs: ${totalEpochs})` : "") +
        "; not treated as fact.",
    };
  }
  return { metrics: asRecord(match.metrics), note: null };
}

/** Format the `include_history` window label. Load-bearing per the ticket: a
 * truncated curve with no window label reads as "converged fine" when the
 * omitted portion actually diverged, so this is never left off, even when
 * the requested window happens to cover every recorded epoch. */
function formatWindowLabel(
  windowEntries: Record<string, unknown>[],
  epochsDone: number,
  totalEpochs: number | null,
): string {
  const totalLabel = totalEpochs !== null ? String(totalEpochs) : "?";
  if (windowEntries.length === 0) {
    return `no recorded epochs (0 of ${totalLabel})`;
  }
  const start = windowEntries[0].epoch ?? "?";
  const end = windowEntries[windowEntries.length - 1].epoch ?? "?";
  return `epochs ${pyField(start)}-${pyField(end)} of ${totalLabel} (${epochsDone} recorded)`;
}

/** Report a model's best-epoch and final-epoch evaluation metrics.
 *
 * Built on the shared training projection from ticket 1 (`trainResults`,
 * top-level `metrics`, `bestEpoch`, `bestFitness`, `trainArgs`) with no
 * second reading of `trainResults`: `training_monitor` and this tool import
 * the same helper.
 *
 * Verified live 2026-09-15 against `fish/exp-2`, `carparts/exp-2`,
 * `pothole/exp-2`, and `road-safety-101/exp-3`: on every one, the Model's
 * top-level `metrics` is byte-identical to the *last* recorded
 * `trainResults` entry's cleaned metric names, never the best-epoch entry.
 * So `metrics` answers "how did it end up", not "how good did it get" —
 * `finalEpochMetrics` below is that field, surfaced under a name that says
 * what it is. `bestEpochMetrics` is pulled explicitly from `trainResults` by
 * matching its `epoch` field against `bestEpoch`, retrievable regardless of
 * any `include_history` window, and carries the entry's raw per-epoch keys
 * (`metrics/mAP50(B)`, etc.) verbatim rather than invented clean names,
 * since which suffixes exist depends on task and was not verified for every
 * task type. The two are never merged, so best cannot be read as final or
 * vice versa.
 *
 * Both degenerate shapes observed live survive without throwing:
 * `pothole/yolo26s` (`bestEpoch: null`, `epochs: -1`, 70 results, top-level
 * `metrics` still present) reports `bestEpochMetrics: null` with a note, and
 * `finalEpochMetrics` from the top-level field as usual; `eggs-and-bowls/exp`
 * (`bestEpoch: 99` beside zero `trainResults` and a null top-level `metrics`)
 * reports both `bestEpochMetrics` and `finalEpochMetrics` as `null`, each
 * with an explanatory note, and never asserts "best epoch 99" as fact.
 *
 * `include_train_args` surfaces `trainArgs` verbatim (111 keys, observed
 * live); omitted by default since it is too heavy for a default payload,
 * not because it would be wrong to include.
 *
 * `include_history` returns a slice of `trainResults` and always states the
 * window it covers, including when the full curve is returned — the label
 * is what keeps a truncated curve legible as "incomplete" rather than
 * silently "converged fine".
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
  validateHistoryLastN(historyLastN);

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const basePath = `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`;
  const data = await client.get(basePath);
  const fields = asRecord(asRecord(data).model);
  const projection = projectModelTraining(fields);

  const trainResults = projection.trainResults;
  const epochsDone = trainResults.length;
  const rawTotalEpochs = fields.epochs;
  const totalEpochs =
    typeof rawTotalEpochs === "number" && rawTotalEpochs > 0
      ? rawTotalEpochs
      : null;

  const { metrics: bestEpochMetrics, note: bestEpochNote } =
    findBestEpochMetrics(trainResults, projection.bestEpoch, totalEpochs);
  const finalEpoch =
    epochsDone > 0 ? (trainResults[epochsDone - 1].epoch ?? null) : null;
  const finalEpochMetrics = projection.metrics;

  const result: Record<string, unknown> = {
    owner: resolvedOwner,
    project: resolved.project,
    model: resolved.model,
    modelId: fields.id ?? null,
    status: fields.status ?? null,
    epochs: totalEpochs,
    epochsDone,
    bestEpoch: projection.bestEpoch,
    bestFitness: projection.bestFitness,
    bestEpochMetrics,
    bestEpochNote,
    finalEpoch,
    finalEpochMetrics,
  };

  if (includeTrainArgs) {
    result.trainArgs = projection.trainArgs;
  }

  if (includeHistory) {
    const windowEntries = trainResults.slice(-historyLastN);
    result.history = {
      window: formatWindowLabel(windowEntries, epochsDone, totalEpochs),
      entries: windowEntries.map((entry) => ({
        epoch: entry.epoch ?? null,
        metrics: asRecord(entry.metrics),
      })),
    };
  }

  const bestLabel =
    projection.bestEpoch !== null && bestEpochMetrics !== null
      ? `best epoch ${projection.bestEpoch} (fitness ${pyField(projection.bestFitness)})`
      : `best epoch unavailable (${pyField(bestEpochNote)})`;
  const finalLabel =
    finalEpoch !== null && finalEpochMetrics !== null
      ? `final epoch ${finalEpoch}`
      : "final epoch unavailable";

  return {
    summary:
      `Model '${resolved.model}' for owner '${resolvedOwner}' project '${resolved.project}': ` +
      `${bestLabel}; ${finalLabel} of ${epochsDone} recorded epoch(s).`,
    data: result,
  };
}
