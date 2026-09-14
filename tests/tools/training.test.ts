import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { UltralyticsApiError } from "../../src/errors.js";
import {
  trainingCancel,
  trainingMonitor,
  trainingStart,
} from "../../src/tools/training.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

describe("trainingMonitor", () => {
  const OWNER = "alice";
  const PROJECT = "road";
  const MODEL = "exp";
  const REF = `${OWNER}/${PROJECT}/${MODEL}`;
  const MODEL_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}`;
  const TRAINING_PATH = `${MODEL_PATH}/training`;
  const LIVE_SOURCE = "models/{owner}/{project}/{model}/training";

  const completedModel = {
    id: "c".repeat(24),
    owner: OWNER,
    project: PROJECT,
    model: MODEL,
    name: MODEL,
    visibility: "private",
    task: "detect",
    status: "completed",
    epochs: 100,
    bestEpoch: 78,
    bestFitness: 0.38792,
    hasWeights: true,
    dataset: { owner: OWNER, dataset: "road-data" },
    computeCost: {
      gpuType: "rtx-pro-6000",
      pricePerHour: 1.89,
      totalCost: 0.09,
      durationMs: 139413,
    },
    trainResults: [
      { epoch: 0, metrics: { "metrics/mAP50(B)": 0.5 } },
      { epoch: 1, metrics: { "metrics/mAP50(B)": 0.6 } },
    ],
  };

  const completedJob = {
    id: "c".repeat(24),
    status: "completed",
    progress: { currentEpoch: 101, totalEpochs: 100, percentage: 101 },
    timing: { elapsedMs: 139413, timePerEpochMs: 1322.8, etaMs: 0 },
    compute: null,
    trainArgs: { model: "yolo26n.pt", epochs: 100 },
    epochMetrics: { "metrics/mAP50(B)": 0.6 },
    error: null,
  };

  /** Client serving the owner-scoped model + training paths with live field names. */
  function monitorClient(
    options: {
      modelBody?: unknown;
      modelStatus?: number;
      jobBody?: unknown;
      jobStatus?: number;
      accountOwner?: string;
    } = {},
  ) {
    const {
      modelBody = {
        model: { status: "completed", epochs: 100, trainResults: [] },
      },
      modelStatus = 200,
      jobBody = { job: null },
      jobStatus = 200,
      accountOwner,
    } = options;
    const calls: { path: string; method: string }[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      const method = (init.method ?? "GET").toUpperCase();
      calls.push({ path: parsed.pathname, method });
      if (parsed.pathname === "/api/account/summary") {
        if (accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: accountOwner });
      }
      if (parsed.pathname === MODEL_PATH) {
        return jsonResponse(modelBody, modelStatus);
      }
      if (parsed.pathname === TRAINING_PATH) {
        return jsonResponse(jobBody, jobStatus);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
    });
    return { client, calls };
  }

  test("reads the model and training job through the owner-scoped path for a full reference", async () => {
    const { client, calls } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: completedJob },
    });

    const result = await trainingMonitor(client, REF);

    expect(calls.map((call) => call.path)).toEqual([MODEL_PATH, TRAINING_PATH]);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': training status=completed job=completed; epoch 2/100; ~101%",
    );
    expect(result.data).toEqual({
      owner: OWNER,
      project: PROJECT,
      model: MODEL,
      modelId: "c".repeat(24),
      status: "completed",
      jobStatus: "completed",
      epochsDone: 2,
      totalEpochs: 100,
      progressPercentage: 101,
      etaMs: 0,
      bestEpoch: 78,
      bestFitness: 0.38792,
      latestMetrics: { "metrics/mAP50(B)": 0.6 },
      computeCost: {
        gpuType: "rtx-pro-6000",
        pricePerHour: 1.89,
        totalCost: 0.09,
        durationMs: 139413,
      },
      trainingError: null,
      progressSource: LIVE_SOURCE,
    });
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: completedJob },
    });

    const result = await trainingMonitor(client, "ul://alice/road/exp");

    expect(calls.map((call) => call.path)).toEqual([MODEL_PATH, TRAINING_PATH]);
    expect(result.data).toMatchObject({ jobStatus: "completed" });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const withOwner = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: completedJob },
      accountOwner: OWNER,
    });

    const result = await trainingMonitor(withOwner.client, MODEL, PROJECT);

    expect(withOwner.calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      MODEL_PATH,
      TRAINING_PATH,
    ]);
    expect(result.data).toMatchObject({
      owner: OWNER,
      project: PROJECT,
      model: MODEL,
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: completedJob },
    });
    await expect(trainingMonitor(client, "b".repeat(24))).rejects.toThrow(
      /not addressable.*owner\/project\/model.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = monitorClient();
    await expect(trainingMonitor(client, MODEL)).rejects.toThrow(
      /project is required/,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a model that does not exist", async () => {
    const { client } = monitorClient({
      modelBody: { error: "Model not found" },
      modelStatus: 404,
    });
    await expect(trainingMonitor(client, REF)).rejects.toThrow(
      /Model not found/,
    );
  });

  test("reports a cancelled job verbatim with its progress and timing", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: {
          ...completedModel,
          status: "cancelled",
          task: "segment",
          bestEpoch: 7,
          bestFitness: 0.97451,
          computeCost: {
            gpuType: "unknown",
            gpuDisplayName: "RTX PRO 6000",
            pricePerHour: 2.09,
            totalCost: 0.16,
            durationMs: 271194,
          },
        },
        isOwner: true,
      },
      jobBody: {
        job: {
          id: "c".repeat(24),
          status: "cancelled",
          progress: { currentEpoch: 10, totalEpochs: 100, percentage: 10 },
          timing: {
            elapsedMs: 271194,
            timePerEpochMs: 26700.9,
            etaMs: 2403081,
          },
          compute: null,
          trainArgs: { model: "yolo26m-seg.pt", epochs: 100 },
          epochMetrics: { "metrics/mAP50(B)": 0.59 },
          error: null,
        },
      },
    });

    const result = await trainingMonitor(client, REF);

    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': training status=cancelled job=cancelled; epoch 2/100; ~10%; ETA 40min",
    );
    expect(result.data).toMatchObject({
      status: "cancelled",
      jobStatus: "cancelled",
      progressPercentage: 10,
      etaMs: 2403081,
      trainingError: null,
      progressSource: LIVE_SOURCE,
    });
  });

  test("reports a failed job verbatim and surfaces its training error", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: { ...completedModel, status: "failed" },
        isOwner: true,
      },
      jobBody: {
        job: {
          ...completedJob,
          status: "failed",
          progress: { currentEpoch: 45, totalEpochs: 100, percentage: 45 },
          timing: { elapsedMs: 500000, timePerEpochMs: 11000, etaMs: 100000 },
          error: "CUDA out of memory",
        },
      },
    });

    const result = await trainingMonitor(client, REF);

    expect(result.summary).toContain("job=failed");
    expect(result.data).toMatchObject({
      status: "failed",
      jobStatus: "failed",
      trainingError: "CUDA out of memory",
    });
  });

  test("handles a never-trained model with null train args and metrics", async () => {
    const freshClient = (() => {
      const freshModelPath = "/api/models/alice/road/fresh";
      const freshTrainingPath = `${freshModelPath}/training`;
      const calls: { path: string; method: string }[] = [];
      const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
        const parsed = new URL(String(url));
        const method = (init.method ?? "GET").toUpperCase();
        calls.push({ path: parsed.pathname, method });
        if (parsed.pathname === freshModelPath) {
          return jsonResponse({
            model: {
              id: "d".repeat(24),
              owner: OWNER,
              project: PROJECT,
              model: "fresh",
              name: "fresh",
              visibility: "private",
              task: "detect",
              status: "untrained",
              hasWeights: false,
            },
            isOwner: true,
          });
        }
        if (parsed.pathname === freshTrainingPath) {
          return jsonResponse({
            job: {
              id: "d".repeat(24),
              status: "untrained",
              progress: { currentEpoch: 0, totalEpochs: 0, percentage: 0 },
              timing: { elapsedMs: 0, timePerEpochMs: 0, etaMs: 0 },
              compute: null,
              trainArgs: null,
              epochMetrics: null,
              error: null,
            },
          });
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch;
      return {
        client: new UltralyticsClient({
          apiKey: KEY,
          baseUrl: BASE,
          fetchImpl,
        }),
        calls,
      };
    })();

    const result = await trainingMonitor(
      freshClient.client,
      "alice/road/fresh",
    );

    expect(result.summary).toBe(
      "Model 'fresh' for owner 'alice' project 'road': training status=untrained job=untrained; epoch 0/?; ~0%",
    );
    expect(result.data).toEqual({
      owner: OWNER,
      project: PROJECT,
      model: "fresh",
      modelId: "d".repeat(24),
      status: "untrained",
      jobStatus: "untrained",
      epochsDone: 0,
      totalEpochs: null,
      progressPercentage: 0,
      etaMs: 0,
      bestEpoch: null,
      bestFitness: null,
      latestMetrics: {},
      computeCost: null,
      trainingError: null,
      progressSource: LIVE_SOURCE,
    });
  });

  test("handles an absent job by falling back to trainResults", async () => {
    const { client } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: null },
    });

    const result = await trainingMonitor(client, REF);

    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': training status=completed job=None; epoch 2/100; ~2.0%",
    );
    expect(result.data).toMatchObject({
      status: "completed",
      jobStatus: null,
      epochsDone: 2,
      totalEpochs: 100,
      progressPercentage: 2,
      etaMs: null,
      progressSource: "model.trainResults",
      latestMetrics: { "metrics/mAP50(B)": 0.6 },
    });
  });

  test("falls back to trainResults when the training endpoint 404s", async () => {
    const { client } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { error: "Job not found" },
      jobStatus: 404,
    });

    const result = await trainingMonitor(client, REF);

    expect(result.data).toMatchObject({
      jobStatus: null,
      progressPercentage: 2,
      progressSource: "model.trainResults",
    });
  });

  test("re-raises auth errors from the training endpoint", async () => {
    const { client } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { error: "Forbidden" },
      jobStatus: 401,
    });

    const error = await trainingMonitor(client, REF).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(401);
  });

  test("re-raises non-auth errors from /training (e.g. 500)", async () => {
    const { client } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { error: "boom" },
      jobStatus: 500,
    });

    const error = await trainingMonitor(client, REF).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(500);
  });

  test("re-raises rate limit errors from /training", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      maxRetries: 0,
      fetchImpl: (async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        if (path === MODEL_PATH) {
          return jsonResponse({ model: completedModel, isOwner: true });
        }
        if (path === TRAINING_PATH) {
          return jsonResponse({ error: "slow down" }, 429);
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });

    const error = await trainingMonitor(client, REF).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(429);
  });

  test("include_metrics returns full latest metrics with live timing", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: {
          ...completedModel,
          trainResults: [
            {
              epoch: 69,
              metrics: {
                "train/box_loss": 0.72179,
                "metrics/mAP50(B)": 0.58282,
                "metrics/mAP50-95(M)": 0.48394,
                lr: 0.000114,
              },
            },
          ],
        },
        isOwner: true,
      },
      jobBody: {
        job: {
          ...completedJob,
          progress: { currentEpoch: 70, totalEpochs: 100, percentage: 70 },
          timing: {
            elapsedMs: 1008800,
            timePerEpochMs: 14411.4,
            etaMs: 432343,
          },
        },
      },
    });

    const result = await trainingMonitor(client, REF, undefined, {
      includeMetrics: true,
    });
    expect(result.data).toMatchObject({
      latestMetrics: {
        "train/box_loss": 0.72179,
        "metrics/mAP50(B)": 0.58282,
        "metrics/mAP50-95(M)": 0.48394,
        lr: 0.000114,
      },
      timing: {
        etaMs: 432343,
        timePerEpochMs: 14411.4,
        elapsedMs: 1008800,
      },
    });
    expect(result.data).not.toHaveProperty("instanceStatus");
  });

  test("include_history returns recent verbatim series", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: {
          ...completedModel,
          trainResults: [
            { epoch: 0, metrics: { lr: 0.01 } },
            { epoch: 1, metrics: { lr: 0.001 } },
            { epoch: 2, metrics: { lr: 0.0001 } },
            { epoch: 3, metrics: { "metrics/mAP50(B)": 0.6, lr: 0.00001 } },
          ],
        },
        isOwner: true,
      },
      jobBody: { job: null },
    });

    const result = await trainingMonitor(client, REF, undefined, {
      includeHistory: true,
      historyLastN: 2,
    });
    expect(result.data).toMatchObject({
      latestMetrics: { "metrics/mAP50(B)": 0.6 },
      metricsHistory: [
        { epoch: 2, metrics: { lr: 0.0001 } },
        { epoch: 3, metrics: { "metrics/mAP50(B)": 0.6, lr: 0.00001 } },
      ],
    });
  });

  test.each([
    0, -1, 2.5,
  ])("rejects invalid historyLastN=%s", async (historyLastN) => {
    const { client, calls } = monitorClient({
      modelBody: { model: completedModel, isOwner: true },
      jobBody: { job: completedJob },
    });
    await expect(
      trainingMonitor(client, REF, undefined, { historyLastN }),
    ).rejects.toThrow(/history_last_n/);
    expect(calls).toHaveLength(0);
  });

  test("unknown epoch total skips percentage math", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: {
          ...completedModel,
          epochs: -1,
          trainResults: [{ epoch: 0, metrics: {} }],
        },
        isOwner: true,
      },
      jobBody: { job: null },
    });

    const result = await trainingMonitor(client, REF);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': training status=completed job=None; epoch 1/?",
    );
    expect(result.data).toMatchObject({
      totalEpochs: null,
      progressPercentage: null,
    });
  });

  test("surfaces null compute cost and training error when absent", async () => {
    const { client } = monitorClient({
      modelBody: {
        model: {
          id: "e".repeat(24),
          owner: OWNER,
          project: PROJECT,
          model: MODEL,
          name: MODEL,
          task: "detect",
          status: "running",
          epochs: 50,
          hasWeights: false,
          trainResults: [],
        },
        isOwner: true,
      },
      jobBody: {
        job: {
          id: "e".repeat(24),
          status: "running",
          progress: { currentEpoch: 3, totalEpochs: 50, percentage: 5 },
          timing: { elapsedMs: 1000, timePerEpochMs: 500, etaMs: 20000 },
          compute: null,
          trainArgs: { model: "yolo26n.pt" },
          epochMetrics: {},
          error: null,
        },
      },
    });

    const result = await trainingMonitor(client, REF);
    expect(result.data).toMatchObject({
      jobStatus: "running",
      computeCost: null,
      trainingError: null,
      latestMetrics: {},
    });
  });
});

describe("trainingStart", () => {
  const OWNER = "alice";
  const PROJECT = "road";
  const MODEL = "exp";
  const DATASET = "road-data";
  const MODEL_REF = `${OWNER}/${PROJECT}/${MODEL}`;
  const PROJECT_REF = `${OWNER}/${PROJECT}`;
  const DATASET_REF = `${OWNER}/${DATASET}`;
  const DATASET_URI = `ul://${OWNER}/datasets/${DATASET}`;
  const MODEL_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}`;
  const DATASET_PATH = `/api/datasets/${OWNER}/${DATASET}`;
  const CREATE_MODEL_PATH = "/api/models";
  const START_PATH = "/api/training/start";
  const MODEL_DB_ID = "d".repeat(24);
  const ORIGIN = "https://platform.ultralytics.com";

  function throwingClient() {
    return new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });
  }

  function startResponse(overrides: Record<string, unknown> = {}) {
    return {
      modelId: MODEL_DB_ID,
      status: "starting",
      gpuType: "l4",
      estimatedCost: { pricePerHour: 0.39, gpuMemoryGb: 24 },
      billing: {
        estimatedCostCents: 10,
        estimatedCostDisplay: "$0.10",
        balanceCents: 1790,
      },
      ...overrides,
    };
  }

  test("rejects when confirm_cost is false before any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
      }),
    ).rejects.toThrow(/Set confirm_cost=true/);
  });

  test("requires gpu_type", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "  ",
        confirmCost: true,
      }),
    ).rejects.toThrow(/`gpu_type` is required/);
  });

  test("validates positive epochs before any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        epochs: 0,
        confirmCost: true,
      }),
    ).rejects.toThrow(/`epochs` must be greater than 0/);
  });

  test.each([
    0, -2,
  ])("rejects invalid batch=%s before any network call", async (batch) => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        batch,
        confirmCost: true,
      }),
    ).rejects.toThrow(/batch/);
  });

  test("allows batch=-1 for auto-batch", async () => {
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const path = new URL(String(url)).pathname;
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      if (path === START_PATH) {
        const body = JSON.parse(String(init.body));
        expect(body.trainArgs.batch).toBe(-1);
        return jsonResponse(startResponse());
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: MODEL_REF,
      project: PROJECT_REF,
      dataset: DATASET_REF,
      gpuType: "l4",
      batch: -1,
      confirmCost: true,
    });
  });

  test.each([
    "data",
    "model",
  ])("rejects reserved train_args key %s before any network call", async (key) => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        trainArgs: { [key]: "x" },
        confirmCost: true,
      }),
    ).rejects.toThrow(/reserved/);
  });

  test("rejects a bare model id without any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: "b".repeat(24),
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      }),
    ).rejects.toThrow(/not addressable/);
  });

  test("rejects a bare project id without any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: "b".repeat(24),
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      }),
    ).rejects.toThrow(/not addressable/);
  });

  test("rejects a bare dataset id without any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: "c".repeat(24),
        gpuType: "l4",
        confirmCost: true,
      }),
    ).rejects.toThrow(/not addressable/);
  });

  test("starts training from an existing model through the owner-scoped path", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") body = JSON.parse(init.body);
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: {
            id: MODEL_DB_ID,
            trainArgs: { model: "ul://ultralytics/yolo26/yolo26x" },
          },
          isOwner: true,
        });
      }
      if (path === START_PATH) {
        return jsonResponse(startResponse());
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    const result = await trainingStart(client, {
      model: MODEL_REF,
      project: PROJECT_REF,
      dataset: DATASET_REF,
      gpuType: "l4",
      epochs: 1,
      confirmCost: true,
    });

    expect(calls).toMatchObject([
      { url: `${ORIGIN}${MODEL_PATH}`, method: "GET" },
      {
        url: `${ORIGIN}${START_PATH}`,
        method: "POST",
        body: {
          modelId: MODEL_DB_ID,
          gpuType: "l4",
          trainArgs: {
            data: DATASET_URI,
            model: "ul://ultralytics/yolo26/yolo26x",
            epochs: 1,
          },
        },
      },
    ]);
    expect(result.summary).toBe(
      "Started training for model 'exp' for owner 'alice' project 'road': " +
        "status=starting on l4. Estimated cost $0.10 (0.39/hr); balance after start $17.90.",
    );
    expect(result.data).toEqual({
      owner: OWNER,
      project: PROJECT,
      model: MODEL,
      modelId: MODEL_DB_ID,
      status: "starting",
      gpuType: "l4",
      estimatedCost: { pricePerHour: 0.39, gpuMemoryGb: 24 },
      billing: {
        estimatedCostCents: 10,
        estimatedCostDisplay: "$0.10",
        balanceCents: 1790,
      },
    });
  });

  test("accepts a ul:// model URI and a ul:// dataset URI without network for resolution", async () => {
    const calls: { path: string }[] = [];
    const impl = (async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path });
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      if (path === START_PATH) {
        return jsonResponse(startResponse());
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: `ul://${OWNER}/${PROJECT}/${MODEL}`,
      project: `ul://${OWNER}/${PROJECT}`,
      dataset: `ul://${OWNER}/${DATASET}`,
      gpuType: "l4",
      confirmCost: true,
    });

    expect(calls.map((call) => call.path)).toEqual([MODEL_PATH, START_PATH]);
  });

  test("fills a missing owner from the account summary for bare slugs", async () => {
    const calls: { path: string }[] = [];
    const impl = (async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path });
      if (path === "/api/account/summary") {
        return jsonResponse({ username: OWNER });
      }
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      if (path === START_PATH) {
        return jsonResponse(startResponse());
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: MODEL,
      project: PROJECT,
      dataset: DATASET,
      gpuType: "l4",
      confirmCost: true,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      MODEL_PATH,
      START_PATH,
    ]);
  });

  test("errors clearly when an existing model has no stored base checkpoint", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: { id: MODEL_DB_ID, trainArgs: {} } });
      }
      return jsonResponse({}, 404);
    });

    await expect(
      trainingStart(client, {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      }),
    ).rejects.toThrow(/no stored base checkpoint/);
  });

  test("surfaces the API message for a model that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ error: "Model not found" }, 404);
      }
      return jsonResponse({}, 404);
    });

    await expect(
      trainingStart(client, {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      }),
    ).rejects.toThrow(/Model not found/);
  });

  test("merges train_args into trainArgs while preserving resolved data and model", async () => {
    const calls: { body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      const path = new URL(String(url)).pathname;
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      return jsonResponse(startResponse());
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: MODEL_REF,
      project: PROJECT_REF,
      dataset: DATASET_REF,
      gpuType: "l4",
      epochs: 100,
      trainArgs: { mosaic: 0, mixup: 0, copy_paste: 0 },
      confirmCost: true,
    });

    expect(calls[1]).toMatchObject({
      body: {
        trainArgs: {
          model: "yolo26n.pt",
          data: DATASET_URI,
          epochs: 100,
          mosaic: 0,
          mixup: 0,
          copy_paste: 0,
        },
      },
    });
  });

  describe("checkpoint mode", () => {
    const CREATED_MODEL_ID = "m".repeat(24);
    const CREATED_SLUG = "exp-2";

    test("creates a project model from owner and project slug, then starts training", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        let body: unknown;
        if (typeof init.body === "string") body = JSON.parse(init.body);
        calls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          body,
        });
        const path = new URL(String(url)).pathname;
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({
            id: CREATED_MODEL_ID,
            owner: OWNER,
            project: PROJECT,
            model: CREATED_SLUG,
            region: "eu",
          });
        }
        if (path === START_PATH) {
          return jsonResponse(startResponse({ modelId: CREATED_MODEL_ID }));
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      const result = await trainingStart(client, {
        model: "yolo26n.pt",
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        epochs: 1,
        confirmCost: true,
      });

      expect(calls).toMatchObject([
        { url: `${ORIGIN}${DATASET_PATH}`, method: "GET" },
        {
          url: `${ORIGIN}${CREATE_MODEL_PATH}`,
          method: "POST",
          body: { owner: OWNER, project: PROJECT, task: "detect" },
        },
        {
          url: `${ORIGIN}${START_PATH}`,
          method: "POST",
          body: {
            modelId: CREATED_MODEL_ID,
            gpuType: "l4",
            trainArgs: {
              model: "yolo26n.pt",
              data: DATASET_URI,
              epochs: 1,
            },
          },
        },
      ]);
      expect(result.data).toMatchObject({
        owner: OWNER,
        project: PROJECT,
        model: CREATED_SLUG,
        modelId: CREATED_MODEL_ID,
      });
    });

    test("does not send a name field to the create-model endpoint", async () => {
      const calls: { body: unknown }[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        const path = new URL(String(url)).pathname;
        if (path === CREATE_MODEL_PATH) {
          calls.push({
            body: typeof init.body === "string" ? JSON.parse(init.body) : null,
          });
        }
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({
            id: CREATED_MODEL_ID,
            owner: OWNER,
            project: PROJECT,
            model: CREATED_SLUG,
          });
        }
        return jsonResponse(startResponse({ modelId: CREATED_MODEL_ID }));
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: "yolo26n.pt",
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        name: "my-run",
        confirmCost: true,
      });

      expect(calls[0]?.body).not.toHaveProperty("name");
    });

    test("routes official ultralytics ul:// refs through checkpoint mode", async () => {
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        let body: unknown;
        if (typeof init.body === "string") body = JSON.parse(init.body);
        const path = new URL(String(url)).pathname;
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({
            id: CREATED_MODEL_ID,
            owner: OWNER,
            project: PROJECT,
            model: CREATED_SLUG,
          });
        }
        if (path === START_PATH) {
          expect(body).toMatchObject({
            trainArgs: { model: "yolo26x.pt" },
          });
          return jsonResponse(startResponse({ modelId: CREATED_MODEL_ID }));
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: "ul://ultralytics/yolo26/yolo26x",
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      });
    });

    test("does not treat a user-owned ul:// model as a checkpoint", async () => {
      const calls: { path: string }[] = [];
      const impl = (async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path });
        if (path === MODEL_PATH) {
          return jsonResponse({
            model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
          });
        }
        return jsonResponse(startResponse());
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: `ul://${OWNER}/${PROJECT}/${MODEL}`,
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      });

      expect(calls.map((call) => call.path)).toEqual([MODEL_PATH, START_PATH]);
    });

    test("allows semantic checkpoints for segment datasets", async () => {
      const calls: { url: string; body: unknown }[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        let body: unknown;
        if (typeof init.body === "string") body = JSON.parse(init.body);
        calls.push({ url: String(url), body });
        const path = new URL(String(url)).pathname;
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "segment" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({
            id: CREATED_MODEL_ID,
            owner: OWNER,
            project: PROJECT,
            model: CREATED_SLUG,
          });
        }
        return jsonResponse(startResponse({ modelId: CREATED_MODEL_ID }));
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: "yolo26n-sem.pt",
        project: PROJECT_REF,
        dataset: DATASET_REF,
        gpuType: "l4",
        confirmCost: true,
      });

      expect(calls[1]).toMatchObject({
        url: `${ORIGIN}${CREATE_MODEL_PATH}`,
        body: { task: "semantic" },
      });
    });

    test("rejects incompatible checkpoint and dataset task combinations", async () => {
      const { client, calls } = routeClient((path) => {
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "semantic" } });
        }
        return jsonResponse({}, 404);
      });

      await expect(
        trainingStart(client, {
          model: "yolo26n-seg.pt",
          project: PROJECT_REF,
          dataset: DATASET_REF,
          gpuType: "l4",
          confirmCost: true,
        }),
      ).rejects.toThrow(/not compatible/);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.path).toBe(DATASET_PATH);
    });

    test("throws clearly when the create-model response has no id", async () => {
      const { client } = routeClient((path) => {
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({ owner: OWNER, project: PROJECT });
        }
        return jsonResponse({}, 404);
      });

      await expect(
        trainingStart(client, {
          model: "yolo26n.pt",
          project: PROJECT_REF,
          dataset: DATASET_REF,
          gpuType: "l4",
          confirmCost: true,
        }),
      ).rejects.toThrow(/did not include an id/);
    });
  });

  describe("multiple datasets", () => {
    const DATASET_2 = "road-data-2";
    const DATASET_2_REF = `${OWNER}/${DATASET_2}`;
    const DATASET_2_URI = `ul://${OWNER}/datasets/${DATASET_2}`;
    const DATASET_2_PATH = `/api/datasets/${OWNER}/${DATASET_2}`;

    test("rejects an empty dataset list before any network call", async () => {
      await expect(
        trainingStart(throwingClient(), {
          model: MODEL_REF,
          project: PROJECT_REF,
          dataset: [],
          gpuType: "l4",
          confirmCost: true,
        }),
      ).rejects.toThrow(/`dataset` must include at least one/);
    });

    test("builds trainArgs.data as a list of URIs, in order, for an existing model", async () => {
      const calls: { body: unknown }[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({
          body: typeof init.body === "string" ? JSON.parse(init.body) : null,
        });
        const path = new URL(String(url)).pathname;
        if (path === MODEL_PATH) {
          return jsonResponse({
            model: { id: MODEL_DB_ID, trainArgs: { model: "yolo26n.pt" } },
          });
        }
        return jsonResponse(startResponse());
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: MODEL_REF,
        project: PROJECT_REF,
        dataset: [DATASET_REF, DATASET_2_REF],
        gpuType: "l4",
        confirmCost: true,
      });

      expect(calls[1]).toMatchObject({
        body: { trainArgs: { data: [DATASET_URI, DATASET_2_URI] } },
      });
    });

    test("checkpoint mode fetches and task-validates every dataset before creating the model", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        let body: unknown;
        if (typeof init.body === "string") body = JSON.parse(init.body);
        calls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          body,
        });
        const path = new URL(String(url)).pathname;
        if (path === DATASET_PATH || path === DATASET_2_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === CREATE_MODEL_PATH) {
          return jsonResponse({
            id: "m".repeat(24),
            owner: OWNER,
            project: PROJECT,
            model: "exp-2",
          });
        }
        if (path === START_PATH) {
          return jsonResponse(startResponse({ modelId: "m".repeat(24) }));
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch;
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await trainingStart(client, {
        model: "yolo26n.pt",
        project: PROJECT_REF,
        dataset: [DATASET_REF, DATASET_2_REF],
        gpuType: "l4",
        confirmCost: true,
      });

      expect(calls[0]?.url).toBe(`${ORIGIN}${DATASET_PATH}`);
      expect(calls[1]?.url).toBe(`${ORIGIN}${DATASET_2_PATH}`);
      expect(calls[3]).toMatchObject({
        url: `${ORIGIN}${START_PATH}`,
        body: {
          trainArgs: {
            data: [DATASET_URI, DATASET_2_URI],
            model: "yolo26n.pt",
          },
        },
      });
    });

    test("refuses when one dataset in the list is task-incompatible, naming it", async () => {
      const { client, calls } = routeClient((path) => {
        if (path === DATASET_PATH) {
          return jsonResponse({ dataset: { task: "detect" } });
        }
        if (path === DATASET_2_PATH) {
          return jsonResponse({ dataset: { task: "classify" } });
        }
        return jsonResponse({}, 404);
      });

      await expect(
        trainingStart(client, {
          model: "yolo26n.pt",
          project: PROJECT_REF,
          dataset: [DATASET_REF, DATASET_2_REF],
          gpuType: "l4",
          confirmCost: true,
        }),
      ).rejects.toThrow(
        new RegExp(
          `not compatible.*${OWNER}/${DATASET_2}`.replace(/\//g, "\\/"),
        ),
      );

      expect(calls).toHaveLength(2);
      expect(calls[1]?.path).toBe(DATASET_2_PATH);
    });
  });
});

describe("trainingCancel", () => {
  const OWNER = "alice";
  const PROJECT = "road";
  const MODEL = "exp";
  const REF = `${OWNER}/${PROJECT}/${MODEL}`;
  const TRAINING_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}/training`;

  function cancelClient(
    options: {
      cancelBody?: unknown;
      cancelStatus?: number;
      accountOwner?: string;
    } = {},
  ) {
    const {
      cancelBody = { success: true, status: "cancelled" },
      cancelStatus = 200,
      accountOwner,
    } = options;
    const calls: { path: string; method: string }[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      const method = (init.method ?? "GET").toUpperCase();
      calls.push({ path: parsed.pathname, method });
      if (parsed.pathname === "/api/account/summary") {
        if (accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: accountOwner });
      }
      if (parsed.pathname === TRAINING_PATH) {
        return jsonResponse(cancelBody, cancelStatus);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
    });
    return { client, calls };
  }

  test("cancels through the owner-scoped path and reports the API response", async () => {
    const { client, calls } = cancelClient();

    const result = await trainingCancel(client, REF);

    expect(calls).toEqual([{ path: TRAINING_PATH, method: "DELETE" }]);
    expect(result.summary).toContain("Cancelled");
    expect(result.summary).toContain("'exp'");
    expect(result.summary).toContain("cancelled");
    expect(result.data).toEqual({
      owner: OWNER,
      project: PROJECT,
      model: MODEL,
      success: true,
      status: "cancelled",
    });
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = cancelClient();

    const result = await trainingCancel(client, "ul://alice/road/exp");

    expect(calls).toEqual([{ path: TRAINING_PATH, method: "DELETE" }]);
    expect(result.data).toMatchObject({ status: "cancelled" });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = cancelClient({ accountOwner: OWNER });

    const result = await trainingCancel(client, MODEL, PROJECT);

    expect(calls).toEqual([
      { path: "/api/account/summary", method: "GET" },
      { path: TRAINING_PATH, method: "DELETE" },
    ]);
    expect(result.data).toMatchObject({
      owner: OWNER,
      project: PROJECT,
      model: MODEL,
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = cancelClient();
    await expect(trainingCancel(client, "b".repeat(24))).rejects.toThrow(
      /not addressable.*owner\/project\/model.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = cancelClient();
    await expect(trainingCancel(client, MODEL)).rejects.toThrow(
      /project is required/,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a model that does not exist", async () => {
    const { client } = cancelClient({
      cancelBody: { error: "Model not found" },
      cancelStatus: 404,
    });
    await expect(trainingCancel(client, REF)).rejects.toThrow(
      /Model not found/,
    );
  });

  test("reports the API message when the job cannot be cancelled", async () => {
    // Live capture: DELETE /api/models/{owner}/{project}/{model}/training
    // -> 400 {"error":"Cannot cancel training with status: cancelled"}
    const { client } = cancelClient({
      cancelBody: { error: "Cannot cancel training with status: cancelled" },
      cancelStatus: 400,
    });
    const error = await trainingCancel(client, REF).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(400);
    expect(String(error)).toMatch(
      /Cannot cancel training with status: cancelled/,
    );
  });

  test("does not translate other failure statuses into a custom message", async () => {
    const { client } = cancelClient({
      cancelBody: { error: "Training is no longer active" },
      cancelStatus: 409,
    });
    const error = await trainingCancel(client, REF).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(409);
    expect(String(error)).toMatch(/Training is no longer active/);
  });

  test("surfaces a warning field verbatim instead of branching on it", async () => {
    const { client } = cancelClient({
      cancelBody: { success: true, status: "cancelled", warning: "note" },
    });
    const result = await trainingCancel(client, REF);
    expect(result.data).toMatchObject({
      success: true,
      status: "cancelled",
      warning: "note",
    });
    expect(result.summary).toContain("cancelled");
  });
});
