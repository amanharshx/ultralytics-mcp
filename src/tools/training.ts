/** Training monitor, start, and cancel tools. */

import type { UltralyticsClient } from "../client.js";
import { UltralyticsApiError } from "../errors.js";
import {
  parseRef,
  resolveDataset,
  resolveModel,
  resolveProject,
} from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { projectModelTraining } from "./model-training-projection.js";
import { asRecord, pyField, validatePositiveInt } from "./shared.js";

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

/** Read the database id off a model detail response (`{model: {id, ...}}`). */
function modelDatabaseId(data: unknown): string {
  const fields = asRecord(asRecord(data).model);
  const id = fields.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Model detail response did not include a database id.");
  }
  return id;
}

const UNTRAINED_STATUSES = new Set(["pending", "untrained"]);

interface ModelHistorySummary {
  hasHistory: boolean;
  status: string | null;
  epochsRecorded: number;
}

/** Decide, from the model record alone, whether restarting training would
 * destroy a recorded run. A model is treated as having history once it has
 * left the untrained states or already carries per-epoch results — both
 * signals the platform clears (status, epoch count, `trainResults`) the
 * moment a new job starts. This makes no network call beyond the model fetch
 * the caller already made, so the decision is free to check. */
function modelHistorySummary(data: unknown): ModelHistorySummary {
  const fields = asRecord(asRecord(data).model);
  const status = typeof fields.status === "string" ? fields.status : null;
  const trainResults = Array.isArray(fields.trainResults)
    ? fields.trainResults
    : [];
  const hasHistory =
    trainResults.length > 0 ||
    (status !== null && !UNTRAINED_STATUSES.has(status));
  return { hasHistory, status, epochsRecorded: trainResults.length };
}

/** Read the database id off a model create response: flat `{id, ...}`. */
function createdModelId(data: unknown): string {
  const id = asRecord(data).id;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Create model response did not include an id.");
  }
  return id;
}

/** Build the three-segment `ul://owner/datasets/slug` URI training's `data`
 * argument requires. The middle `datasets` segment is mandatory and this is
 * the only tool that emits it, so the formatter lives here rather than on
 * the pure, shape-agnostic dataset resolver. */
function formatDatasetUri(dataset: { owner: string; dataset: string }): string {
  return `ul://${dataset.owner}/datasets/${dataset.dataset}`;
}

function validateCheckpointCompatibility(
  datasetTask: string | null,
  checkpointTask: string,
  datasetLabel: string,
): void {
  if (datasetTask === null) {
    throw new Error(
      `Dataset '${datasetLabel}' is missing a task; cannot select a base checkpoint.`,
    );
  }
  const allowedTasks = DATASET_TASK_COMPATIBILITY[datasetTask];
  if (!allowedTasks) {
    throw new Error(
      `Unsupported dataset task '${datasetTask}' for dataset '${datasetLabel}'.`,
    );
  }
  if (!allowedTasks.includes(checkpointTask)) {
    throw new Error(
      `Checkpoint task '${checkpointTask}' is not compatible with dataset task ` +
        `'${datasetTask}' for dataset '${datasetLabel}'.`,
    );
  }
}

interface TrainingMonitorOptions {
  includeHistory?: boolean;
  historyLastN?: number;
}

/** Report a model's training status and progress.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the model record and its training job through the live owner-scoped
 * endpoints. Per-epoch history and key metrics come from the model record's
 * `trainResults` via the shared training projection; live progress and
 * timing come from the training job. A never-trained model reports a
 * `pending` or `untrained` job with null args and metrics, while an absent
 * job (null or a 404 from the training endpoint) falls back to
 * `trainResults`-derived progress. The job status is surfaced verbatim so a
 * cancelled or failed run stays distinguishable from a running one. The
 * recorded compute cost and the training error are surfaced when present.
 * This tool answers "how is this training run going right now?" only: the
 * top-level `metrics` object and `trainArgs` belong to `model_metrics`.
 * `timing.elapsedMs` is wall-clock since model creation, evaluated at
 * request time: it tracks elapsed run time while training is active, but
 * for a finished model it reflects the model's age, not training duration.
 * Billed training time is `computeCost.durationMs`.
 * Evaluation plots are deliberately omitted: the platform disclaims their
 * shape as unstable.
 */
export async function trainingMonitor(
  client: UltralyticsClient,
  model: string,
  project?: string,
  options: TrainingMonitorOptions = {},
): Promise<NormalizedToolResult> {
  const { includeHistory = false, historyLastN = 20 } = options;
  validatePositiveInt(historyLastN, "history_last_n");

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const basePath = `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`;
  const data = await client.get(basePath);
  const fields = asRecord(asRecord(data).model);
  const projection = projectModelTraining(fields);

  const status = fields.status ?? null;
  const totalEpochs = fields.epochs;
  const hasTotal = typeof totalEpochs === "number" && totalEpochs > 0;
  const trainResults = projection.trainResults;
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
  const computeCost = projection.computeCost;
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
      bestEpoch: projection.bestEpoch,
      bestFitness: projection.bestFitness,
      latestMetrics: keyMetrics,
      computeCost,
      trainingError,
      progressSource: source,
      timing,
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

/** Start cloud training from an existing model or a base checkpoint. This is
 * state-changing and may cost credits.
 *
 * Resolves the model, project, and dataset references by pure string parsing
 * (ids are not addressable on any of them) and fills a missing owner from the
 * account summary. `trainArgs.data` is built from the three-segment
 * `ul://owner/datasets/slug` URI the platform requires; a bare dataset id is
 * not accepted. `dataset` accepts either one ref or a list of refs for
 * sequential fine-tuning, matching the platform's own `trainArgs.data`
 * contract: a single ref becomes a single URI string, a list becomes a list
 * of URIs in the given order. Training from an existing model fetches it
 * through the live owner-scoped endpoint to read its database id — the start
 * endpoint takes an id by design while every other endpoint takes owner and
 * slug — and reuses its own stored base checkpoint for `trainArgs.model`
 * verbatim. Checkpoint mode creates a project model first from owner and
 * project slug (the platform assigns the new model's slug; it no longer
 * accepts a requested name) and validates the checkpoint's inferred task
 * against every dataset's task before creating anything, so a list with one
 * incompatible entry is refused up front rather than partway through. The
 * endpoint validates at creation, so an unusable dataset is rejected before
 * any compute starts; use `training_cancel` to stop a job that is already
 * running. Starting is billable immediately: the platform has no cost
 * preview before that, so the projected cost and remaining balance are only
 * known from the start response, and are surfaced verbatim rather than
 * discarded. Training an existing model that already has a recorded run
 * (any status past pending/untrained, or existing `trainResults`) replaces
 * that run's status, epoch count, and per-epoch metric history the moment
 * the new job starts; the previously uploaded weights survive but the
 * metric history does not, and the API has no way to recover it. This is a
 * separate consent from spending money, so it needs its own
 * `confirmHistoryLoss` flag rather than piggybacking on `confirmCost`.
 * Checkpoint mode always creates a new model, so nothing is ever destroyed
 * there.
 */
export async function trainingStart(
  client: UltralyticsClient,
  options: {
    model: string;
    project: string;
    dataset: string | string[];
    gpuType: string;
    trainArgs?: Record<string, unknown>;
    epochs?: number;
    imgsz?: number;
    batch?: number;
    name?: string;
    confirmCost?: boolean;
    confirmHistoryLoss?: boolean;
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
    confirmHistoryLoss = false,
  } = options;
  if (!confirmCost) {
    throw new Error(
      "Set confirm_cost=true to start a cloud training job. Starting is " +
        "billable immediately; the platform has no cost preview before that. " +
        "The estimated cost and remaining balance are reported after the job starts.",
    );
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
  const datasetRefs = Array.isArray(dataset) ? dataset : [dataset];
  if (datasetRefs.length === 0) {
    throw new Error("`dataset` must include at least one dataset reference.");
  }

  const resolvedProject = resolveProject(project);
  const resolvedDatasets = datasetRefs.map((ref) => resolveDataset(ref));
  const checkpoint = checkpointFromRef(model);

  const datasetOwners: string[] = [];
  for (const resolved of resolvedDatasets) {
    datasetOwners.push(resolved.owner ?? (await client.getAccountOwner()));
  }
  const datasetUris = resolvedDatasets.map((resolved, i) =>
    formatDatasetUri({ owner: datasetOwners[i], dataset: resolved.dataset }),
  );
  const trainArgs: Record<string, unknown> = {
    ...passthroughTrainArgs,
    data: Array.isArray(dataset) ? datasetUris : datasetUris[0],
  };

  let modelId: string;
  let modelOwnerDisplay: string;
  let modelProjectDisplay: string;
  let modelSlugDisplay: string;
  if (checkpoint === null) {
    const resolvedModel = resolveModel(model, project);
    const modelOwner = resolvedModel.owner ?? (await client.getAccountOwner());
    const modelData = await client.get(
      `/models/${encodeURIComponent(modelOwner)}/${encodeURIComponent(resolvedModel.project)}/${encodeURIComponent(resolvedModel.model)}`,
    );
    modelId = modelDatabaseId(modelData);
    const trainModel = storedTrainModel(modelData);
    if (trainModel === null) {
      throw new Error(
        "Resolved model has no stored base checkpoint; pass a base checkpoint like `yolo26x.pt` instead.",
      );
    }
    const history = modelHistorySummary(modelData);
    if (history.hasHistory && !confirmHistoryLoss) {
      throw new Error(
        `Model '${resolvedModel.model}' already has a recorded run (status=${history.status}, ` +
          `${history.epochsRecorded} recorded epoch(s)). Starting training again replaces this ` +
          "model's status, epoch count, and per-epoch metric history, and that history cannot be " +
          "recovered through the API; the previously uploaded weights survive. Set " +
          "confirm_history_loss=true to proceed. This is separate from confirm_cost.",
      );
    }
    trainArgs.model = trainModel;
    modelOwnerDisplay = modelOwner;
    modelProjectDisplay = resolvedModel.project;
    modelSlugDisplay = resolvedModel.model;
  } else {
    const checkpointTask = inferCheckpointTask(checkpoint);
    for (let i = 0; i < resolvedDatasets.length; i++) {
      const owner = datasetOwners[i];
      const resolved = resolvedDatasets[i];
      const datasetDetail = await client.get(
        `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(resolved.dataset)}`,
      );
      const datasetFields = asRecord(asRecord(datasetDetail).dataset);
      const datasetTask =
        typeof datasetFields.task === "string" ? datasetFields.task : null;
      validateCheckpointCompatibility(
        datasetTask,
        checkpointTask,
        `${owner}/${resolved.dataset}`,
      );
    }
    const projectOwner =
      resolvedProject.owner ?? (await client.getAccountOwner());
    const created = await client.postJson("/models", {
      owner: projectOwner,
      project: resolvedProject.project,
      task: checkpointTask,
    });
    const createdFields = asRecord(created);
    modelId = createdModelId(created);
    trainArgs.model = checkpoint;
    modelOwnerDisplay =
      typeof createdFields.owner === "string"
        ? createdFields.owner
        : projectOwner;
    modelProjectDisplay =
      typeof createdFields.project === "string"
        ? createdFields.project
        : resolvedProject.project;
    modelSlugDisplay =
      typeof createdFields.model === "string" ? createdFields.model : "?";
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
    gpuType,
    trainArgs,
  });
  const record = asRecord(data);
  const status = record.status ?? null;
  const responseGpuType = record.gpuType ?? gpuType;
  const estimatedCost =
    record.estimatedCost && typeof record.estimatedCost === "object"
      ? asRecord(record.estimatedCost)
      : null;
  const billing =
    record.billing && typeof record.billing === "object"
      ? asRecord(record.billing)
      : null;
  const balanceDisplay =
    typeof billing?.balanceCents === "number"
      ? `$${(billing.balanceCents / 100).toFixed(2)}`
      : null;

  return {
    summary:
      `Started training for model '${modelSlugDisplay}' for owner '${modelOwnerDisplay}' ` +
      `project '${modelProjectDisplay}': status=${pyField(status)} on ${pyField(responseGpuType)}. ` +
      `Estimated cost ${pyField(billing?.estimatedCostDisplay)} (${pyField(estimatedCost?.pricePerHour)}/hr); ` +
      `balance after start ${pyField(balanceDisplay)}.`,
    data: {
      owner: modelOwnerDisplay,
      project: modelProjectDisplay,
      model: modelSlugDisplay,
      modelId: record.modelId ?? modelId,
      status,
      gpuType: responseGpuType,
      estimatedCost,
      billing,
    },
  };
}
