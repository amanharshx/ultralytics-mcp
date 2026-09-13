/** Training monitor, start, and cancel tools. */

import type { UltralyticsClient } from "../client.js";
import { UltralyticsApiError } from "../errors.js";
import {
  parseRef,
  resolveLegacyDatasetDetails,
  resolveLegacyDatasetId,
  resolveLegacyModelId,
  resolveLegacyProjectId,
  resolveModel,
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

function checkpointFromRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (BASE_CHECKPOINT_RE.test(trimmed)) {
    return normalizeCheckpointRef(trimmed);
  }

  const parsed = parseRef(trimmed);
  if (!parsed.isUlUri || parsed.parts.length !== 3) {
    return null;
  }
  const [owner, , checkpoint] = parsed.parts;
  if (owner !== "ultralytics" || !BASE_CHECKPOINT_RE.test(checkpoint)) {
    return null;
  }
  return normalizeCheckpointRef(checkpoint);
}

function inferCheckpointTask(checkpoint: string): string {
  const normalized = checkpoint.toLowerCase();
  for (const [suffix, task] of CHECKPOINT_TASK_SUFFIXES) {
    if (normalized.endsWith(`${suffix}.pt`)) {
      return task;
    }
  }
  return "detect";
}

function storedTrainModel(data: unknown): string | null {
  const record = asRecord(data);
  const item = asRecord("model" in record ? record.model : data);
  const trainArgs = asRecord(item.trainArgs);
  const model = trainArgs.model;
  return typeof model === "string" && model.trim() ? model : null;
}

function createdModelId(data: unknown): string {
  const record = asRecord(data);
  const model = asRecord(record.model);
  const nested = asRecord(record.data);
  const nestedModel = asRecord(nested.model);
  const candidates = [
    record.modelId,
    record._id,
    record.id,
    model.modelId,
    model._id,
    model.id,
    nested.modelId,
    nested._id,
    nested.id,
    nestedModel.modelId,
    nestedModel._id,
    nestedModel.id,
  ];
  const id = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (typeof id !== "string") {
    throw new Error("Create model response did not include a model id.");
  }
  return id;
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

interface TrainingMonitorOptions {
  includeMetrics?: boolean;
  includeHistory?: boolean;
  historyLastN?: number;
}

/** Report a model's training status and progress.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the model record and its training job through the live owner-scoped
 * endpoints. Per-epoch history and key metrics come from the model record's
 * `trainResults`; live progress and timing come from the training job. A
 * never-trained model reports a `pending` or `untrained` job with null args
 * and metrics, while an absent job (null or a 404 from the training endpoint) falls back
 * to `trainResults`-derived progress. The job status is surfaced verbatim so
 * a cancelled or failed run stays distinguishable from a running one. The
 * recorded compute cost and the training error are surfaced when present.
 * Evaluation plots are deliberately omitted: the platform disclaims their
 * shape as unstable.
 */
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

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const basePath = `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`;
  const data = await client.get(basePath);
  const fields = asRecord(asRecord(data).model);

  const status = fields.status ?? null;
  const totalEpochs = fields.epochs;
  const hasTotal = typeof totalEpochs === "number" && totalEpochs > 0;
  const trainResults = Array.isArray(fields.trainResults)
    ? fields.trainResults
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
  const computeCost =
    fields.computeCost && typeof fields.computeCost === "object"
      ? asRecord(fields.computeCost)
      : null;
  const modelTrainingError = fields.trainingError ?? null;

  let job: Record<string, unknown> | null = null;
  try {
    const trainingData = await client.get(`${basePath}/training`);
    const rawJob = asRecord(trainingData).job;
    job =
      rawJob && typeof rawJob === "object"
        ? (rawJob as Record<string, unknown>)
        : null;
  } catch (error) {
    if (!(error instanceof UltralyticsApiError) || error.statusCode !== 404) {
      throw error;
    }
    job = null;
  }

  const deriveFromHistory = (): {
    progressPct: number | null;
    progressText: string | null;
  } => {
    if (!hasTotal) {
      return { progressPct: null, progressText: null };
    }
    const progressPct =
      Math.round(((100 * epochsDone) / (totalEpochs as number)) * 10) / 10;
    return { progressPct, progressText: formatPercent(progressPct) };
  };

  let progressPct: number | null;
  let progressText: string | null;
  let etaMs: number | null;
  let source: string;
  let timing: Record<string, unknown> | null;
  let jobStatus: unknown;
  let trainingError: unknown;
  if (job === null) {
    jobStatus = null;
    trainingError = modelTrainingError;
    timing = null;
    source = "model.trainResults";
    ({ progressPct, progressText } = deriveFromHistory());
    etaMs = null;
  } else {
    const progress = asRecord(job.progress);
    const timingRecord = asRecord(job.timing);
    jobStatus = job.status ?? null;
    if (typeof progress.percentage === "number") {
      progressPct = progress.percentage;
      progressText = String(progress.percentage);
    } else {
      ({ progressPct, progressText } = deriveFromHistory());
    }
    etaMs = typeof timingRecord.etaMs === "number" ? timingRecord.etaMs : null;
    source = "models/{owner}/{project}/{model}/training";
    timing = {
      etaMs: timingRecord.etaMs ?? null,
      timePerEpochMs: timingRecord.timePerEpochMs ?? null,
      elapsedMs: timingRecord.elapsedMs ?? null,
    };
    trainingError = job.error ?? modelTrainingError ?? null;
  }

  const totalDisplay = hasTotal ? (totalEpochs as number) : "?";
  const summary =
    `Model '${resolved.model}' for owner '${resolvedOwner}' project '${resolved.project}': ` +
    `training status=${pyField(status)} job=${pyField(jobStatus)}; epoch ${epochsDone}/${totalDisplay}` +
    (progressPct !== null ? `; ~${progressText}%` : "") +
    (etaMs ? `; ETA ${Math.round(etaMs / 60000)}min` : "");

  return {
    summary,
    data: {
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      modelId: fields.id ?? null,
      status,
      jobStatus,
      epochsDone,
      totalEpochs: hasTotal ? (totalEpochs as number) : null,
      progressPercentage: progressPct,
      etaMs,
      bestEpoch: fields.bestEpoch ?? null,
      bestFitness: fields.bestFitness ?? null,
      latestMetrics: includeMetrics ? latestMetrics : keyMetrics,
      computeCost,
      trainingError,
      progressSource: source,
      ...(includeMetrics
        ? {
            timing,
          }
        : {}),
      ...(includeHistory ? { metricsHistory } : {}),
    },
  };
}

/** Cancel a running training job.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and cancels
 * through the live owner-scoped endpoint. The API's cancel response is
 * surfaced verbatim; when the job cannot be cancelled the API's own error
 * message propagates without branching on a status code or a warning field.
 * Cancelling releases the compute instance, elapsed GPU time is still
 * charged, and the most recently uploaded checkpoint is preserved rather
 * than discarded. This stops the job and does not delete the model.
 */
export async function trainingCancel(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.delete(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/training`,
  );
  const record = asRecord(data);
  return {
    summary:
      `Cancelled training job for model '${resolved.model}' for owner '${resolvedOwner}' ` +
      `project '${resolved.project}' (status=${pyField(record.status)}). ` +
      `Compute instance released; elapsed GPU time still charged; ` +
      `most recent checkpoint preserved. ` +
      `This stops the job and does not delete the model.`,
    data: {
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      ...record,
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
  if (epochs !== undefined && epochs <= 0) {
    throw new Error("`epochs` must be greater than 0.");
  }
  if (imgsz !== undefined && imgsz <= 0) {
    throw new Error("`imgsz` must be greater than 0.");
  }
  if (batch !== undefined && batch !== -1 && batch <= 0) {
    throw new Error("`batch` must be -1 for auto or greater than 0.");
  }

  const projectId = await resolveLegacyProjectId(client, project);
  const checkpoint = checkpointFromRef(model);
  const datasetDetails =
    checkpoint === null
      ? { id: await resolveLegacyDatasetId(client, dataset), task: null }
      : await resolveLegacyDatasetDetails(client, dataset);
  const datasetId = datasetDetails.id;

  let modelId: string;
  const trainArgs: Record<string, unknown> = {
    ...passthroughTrainArgs,
    data: datasetId,
  };
  if (checkpoint === null) {
    modelId = await resolveLegacyModelId(client, model, project);
    const modelData = await client.get(`/models/${modelId}`);
    const trainModel = storedTrainModel(modelData);
    if (trainModel === null) {
      throw new Error(
        "Resolved model has no stored base checkpoint; pass a base checkpoint like `yolo26x.pt` instead.",
      );
    }
    trainArgs.model = trainModel;
  } else {
    const checkpointTask = inferCheckpointTask(checkpoint);
    validateCheckpointCompatibility(datasetDetails.task, checkpointTask);
    const created = await client.postJson("/models", {
      projectId,
      task: checkpointTask,
      name: checkpointModelName(checkpoint),
    });
    modelId = createdModelId(created);
    trainArgs.model = checkpoint;
  }

  if (epochs !== undefined) {
    trainArgs.epochs = epochs;
  }
  if (imgsz !== undefined) {
    trainArgs.imgsz = imgsz;
  }
  if (batch !== undefined) {
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
