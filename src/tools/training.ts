/** Training monitor tool (private-safe: derives progress from model trainResults). */

import type { UltralyticsClient } from "../client.js";
import { UltralyticsApiError } from "../errors.js";
import {
  resolveDataset,
  resolveDatasetDetails,
  resolveModel,
  resolveProject,
} from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, pyField } from "./shared.js";

const KEY_METRICS = [
  "metrics/mAP50(B)",
  "metrics/mAP50-95(B)",
  "metrics/mAP50(M)",
  "metrics/mAP50-95(M)",
];
const RESERVED_TRAIN_ARG_KEYS = ["data", "model"] as const;
const CHECKPOINT_TASK_SUFFIXES = [
  ["-seg", "segment"],
  ["-sem", "semantic"],
  ["-pose", "pose"],
  ["-obb", "obb"],
  ["-cls", "classify"],
] as const;
const BASE_CHECKPOINT_RE =
  /^yolo(?:26|11|v8|v5)[nslmx](?:-(?:seg|sem|pose|obb|cls))?(?:\.pt)?$/i;
const DATASET_TASK_COMPATIBILITY: Record<string, string[]> = {
  detect: ["detect"],
  segment: ["segment", "semantic"],
  semantic: ["semantic"],
  pose: ["pose"],
  obb: ["obb"],
  classify: ["classify"],
};

/** Format a percentage like Python's `str(round(x, 1))` (whole numbers keep `.0`). */
function formatPercent(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function validateHistoryLastN(historyLastN: number): void {
  if (!Number.isInteger(historyLastN) || historyLastN <= 0) {
    throw new Error("`history_last_n` must be a positive integer.");
  }
}

function validateTrainArgs(trainArgs: Record<string, unknown>): void {
  for (const key of RESERVED_TRAIN_ARG_KEYS) {
    if (key in trainArgs) {
      throw new Error(
        `\`train_args.${key}\` is reserved; use top-level tool inputs instead.`,
      );
    }
  }
}

function normalizeCheckpointRef(ref: string): string {
  const trimmed = ref.trim();
  return trimmed.toLowerCase().endsWith(".pt") ? trimmed : `${trimmed}.pt`;
}

function inferCheckpointTask(ref: string): string | null {
  const trimmed = ref.trim();
  if (!BASE_CHECKPOINT_RE.test(trimmed)) {
    return null;
  }
  const normalized = normalizeCheckpointRef(trimmed).toLowerCase();
  for (const [suffix, task] of CHECKPOINT_TASK_SUFFIXES) {
    if (normalized.endsWith(`${suffix}.pt`)) {
      return task;
    }
  }
  return "detect";
}

function checkpointModelName(ref: string): string {
  return normalizeCheckpointRef(ref).replace(/\.pt$/i, "");
}

function validateCheckpointCompatibility(
  datasetTask: string | null,
  checkpointTask: string,
): void {
  if (datasetTask === null) {
    throw new Error(
      "Resolved dataset is missing a task; cannot select a base checkpoint.",
    );
  }
  const allowedTasks = DATASET_TASK_COMPATIBILITY[datasetTask];
  if (!allowedTasks) {
    throw new Error(`Unsupported dataset task '${datasetTask}'.`);
  }
  if (!allowedTasks.includes(checkpointTask)) {
    throw new Error(
      `Checkpoint task '${checkpointTask}' is not compatible with dataset task '${datasetTask}'.`,
    );
  }
}

function createdModelId(data: unknown): string {
  const record = asRecord(data);
  const item = asRecord("model" in record ? record.model : data);
  const id = item._id;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Create model response did not include a model id.");
  }
  return id;
}

interface TrainingMonitorOptions {
  includeMetrics?: boolean;
  includeHistory?: boolean;
  historyLastN?: number;
}

/** Report model training status using private-safe model trainResults. */
export async function trainingMonitor(
  client: UltralyticsClient,
  model: string,
  project?: string,
  options: TrainingMonitorOptions = {},
): Promise<NormalizedToolResult> {
  const {
    includeMetrics = false,
    includeHistory = false,
    historyLastN = 20,
  } = options;
  validateHistoryLastN(historyLastN);

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
  const metricsHistory = trainResults.slice(-historyLastN).map((entry) => {
    const record = asRecord(entry);
    return {
      epoch: record.epoch ?? null,
      metrics: asRecord(record.metrics),
    };
  });

  let progressPct: number | null = null;
  let progressText: string | null = null;
  let etaMs: number | null = null;
  let source = "model.trainResults";
  let timing: Record<string, unknown> | null = null;
  let instanceStatus: Record<string, unknown> | null = null;

  try {
    const trainingData = await client.get(`/models/${modelId}/training`);
    const trainingRecord = asRecord(trainingData);
    const job = asRecord(trainingRecord.job);
    const progress = asRecord(job.progress);
    const timingRecord = asRecord(job.timing);
    progressPct = (progress.percentage as number | undefined) ?? null;
    progressText = progressPct === null ? null : String(progressPct);
    etaMs = (timingRecord.etaMs as number | undefined) ?? null;
    source = "models/{id}/training";
    timing = {
      etaMs: timingRecord.etaMs ?? null,
      timePerEpochMs: timingRecord.timePerEpochMs ?? null,
      elapsedMs: timingRecord.elapsedMs ?? null,
    };
    instanceStatus =
      "instanceStatus" in trainingRecord
        ? asRecord(trainingRecord.instanceStatus)
        : null;
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
      latestMetrics: includeMetrics ? latestMetrics : keyMetrics,
      progressSource: source,
      ...(includeMetrics
        ? {
            timing,
            instanceStatus,
          }
        : {}),
      ...(includeHistory ? { metricsHistory } : {}),
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
    trainArgs?: Record<string, unknown>;
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
    trainArgs: passthroughTrainArgs = {},
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
  validateTrainArgs(passthroughTrainArgs);

  const projectId = await resolveProject(client, project);
  const checkpointTask = inferCheckpointTask(model);
  const datasetDetails =
    checkpointTask === null
      ? { id: await resolveDataset(client, dataset), task: null }
      : await resolveDatasetDetails(client, dataset);
  const datasetId = datasetDetails.id;

  let modelId: string;
  const trainArgs: Record<string, unknown> = {
    ...passthroughTrainArgs,
    data: datasetId,
  };
  if (checkpointTask === null) {
    modelId = await resolveModel(client, model, project);
  } else {
    validateCheckpointCompatibility(datasetDetails.task, checkpointTask);
    const checkpoint = normalizeCheckpointRef(model);
    const created = await client.postJson("/models", {
      projectId,
      task: checkpointTask,
      name: checkpointModelName(checkpoint),
    });
    modelId = createdModelId(created);
    trainArgs.model = checkpoint;
  }

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
