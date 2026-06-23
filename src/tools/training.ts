/** Training monitor tool (private-safe: derives progress from model trainResults). */

import type { UltralyticsClient } from "../client.js";
import { UltralyticsApiError } from "../errors.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord } from "./shared.js";

const KEY_METRICS = [
  "metrics/mAP50(B)",
  "metrics/mAP50-95(B)",
  "metrics/mAP50(M)",
  "metrics/mAP50-95(M)",
];

/** Format a percentage like Python's `str(round(x, 1))` (whole numbers keep `.0`). */
function formatPercent(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/** Report model training status using private-safe model trainResults. */
export async function trainingMonitor(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const modelId = await resolveModel(client, model, project);
  const data = await client.get(`/models/${modelId}`);
  const record = asRecord(data);
  const item = asRecord("model" in record ? record.model : data);

  const status = item.status ?? null;
  const totalEpochs = item.epochs;
  const hasTotal = typeof totalEpochs === "number" && totalEpochs > 0;
  const trainResults = Array.isArray(item.trainResults)
    ? item.trainResults
    : [];
  const epochsDone = trainResults.length;
  const latestMetrics =
    epochsDone > 0
      ? asRecord(asRecord(trainResults[epochsDone - 1]).metrics)
      : {};
  const keyMetrics: Record<string, unknown> = {};
  for (const key of KEY_METRICS) {
    if (key in latestMetrics) {
      keyMetrics[key] = latestMetrics[key];
    }
  }

  let progressPct: number | null = null;
  let progressText: string | null = null;
  let etaMs: number | null = null;
  let source = "model.trainResults";

  try {
    const trainingData = await client.get(`/models/${modelId}/training`);
    const job = asRecord(asRecord(trainingData).job);
    const progress = asRecord(job.progress);
    const timing = asRecord(job.timing);
    progressPct = (progress.percentage as number | undefined) ?? null;
    progressText = progressPct === null ? null : String(progressPct);
    etaMs = (timing.etaMs as number | undefined) ?? null;
    source = "models/{id}/training";
  } catch (error) {
    if (
      !(error instanceof UltralyticsApiError) ||
      ![401, 403, 404].includes(error.statusCode)
    ) {
      throw error;
    }
    if (hasTotal) {
      progressPct =
        Math.round(((100 * epochsDone) / (totalEpochs as number)) * 10) / 10;
      progressText = formatPercent(progressPct);
    }
  }

  const totalDisplay = hasTotal ? (totalEpochs as number) : "?";
  const summary =
    `Training status=${status}; epoch ${epochsDone}/${totalDisplay}` +
    (progressPct !== null ? `; ~${progressText}%` : "") +
    (etaMs ? `; ETA ${Math.round(etaMs / 60000)}min` : "");

  return {
    summary,
    data: {
      modelId,
      status,
      epochsDone,
      totalEpochs: hasTotal ? (totalEpochs as number) : null,
      progressPercentage: progressPct,
      etaMs,
      bestEpoch: item.bestEpoch ?? null,
      bestFitness: item.bestFitness ?? null,
      latestMetrics: keyMetrics,
      progressSource: source,
    },
  };
}
