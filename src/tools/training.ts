/** Training monitor tool (private-safe: derives progress from model trainResults). */

import type { UltralyticsClient } from "../client.js";
import { UltralyticsApiError } from "../errors.js";
import { resolveDataset, resolveModel, resolveProject } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, pyField } from "./shared.js";

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

/** Start cloud training. This is state-changing and may cost credits. */
export async function trainingStart(
  client: UltralyticsClient,
  options: {
    model: string;
    project: string;
    dataset: string;
    gpuType: string;
    epochs?: number;
    imgsz?: number;
    batch?: number;
    name?: string;
    confirmCost?: boolean;
  },
): Promise<NormalizedToolResult> {
  const {
    model,
    project,
    dataset,
    gpuType,
    epochs,
    imgsz,
    batch,
    name,
    confirmCost = false,
  } = options;
  if (!confirmCost) {
    throw new Error("Set confirm_cost=true to start a cloud training job.");
  }
  if (!gpuType?.trim()) {
    throw new Error("`gpu_type` is required.");
  }

  const modelId = await resolveModel(client, model, project);
  const projectId = await resolveProject(client, project);
  const datasetId = await resolveDataset(client, dataset);

  const trainArgs: Record<string, unknown> = { data: datasetId };
  if (epochs !== undefined) {
    if (epochs <= 0) {
      throw new Error("`epochs` must be greater than 0.");
    }
    trainArgs.epochs = epochs;
  }
  if (imgsz !== undefined) {
    if (imgsz <= 0) {
      throw new Error("`imgsz` must be greater than 0.");
    }
    trainArgs.imgsz = imgsz;
  }
  if (batch !== undefined) {
    if (batch <= 0) {
      throw new Error("`batch` must be greater than 0.");
    }
    trainArgs.batch = batch;
  }
  if (name) {
    trainArgs.name = name;
  }

  const data = await client.postJson("/training/start", {
    modelId,
    projectId,
    gpuType,
    trainArgs,
  });
  const record = asRecord(data);
  const item = "job" in record ? record.job : data;
  const fields = asRecord(item);
  return {
    summary: `Started training job ${pyField(fields._id)} status=${pyField(fields.status)}.`,
    data: item,
  };
}
