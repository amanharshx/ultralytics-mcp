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
  const MODEL = "a".repeat(24);
  const PROJECT = "b".repeat(24);
  const DATASET = "c".repeat(24);

  function throwingClient() {
    return new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });
  }

  test("rejects when confirm_cost is false before any network call", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
      }),
    ).rejects.toThrow(/Set confirm_cost=true/);
  });

  test("requires gpu_type", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "  ",
        confirmCost: true,
      }),
    ).rejects.toThrow(/`gpu_type` is required/);
  });

  test("validates positive epochs (ids resolve without network)", async () => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
        epochs: 0,
        confirmCost: true,
      }),
    ).rejects.toThrow(/`epochs` must be greater than 0/);
  });

  test("posts the training payload and summarizes the job", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/models/${MODEL}`) {
        return jsonResponse({
          model: { _id: MODEL, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    const result = await trainingStart(client, {
      model: MODEL,
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      epochs: 100,
      confirmCost: true,
    });

    expect(result.summary).toBe(
      `Started training job ${"j".repeat(24)} status=queued.`,
    );
    expect(calls[1]).toMatchObject({
      url: `${BASE}/training/start`,
      method: "POST",
      body: {
        modelId: MODEL,
        projectId: PROJECT,
        gpuType: "rtx-4090",
        trainArgs: { model: "yolo26n.pt", data: DATASET, epochs: 100 },
      },
    });
  });

  test("merges train_args into trainArgs while preserving MCP fields", async () => {
    const calls: { body: unknown }[] = [];
    const impl = (async (_url: string | URL, init: RequestInit = {}) => {
      calls.push({
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      const path = new URL(String(_url)).pathname;
      if (path === `/api/models/${MODEL}`) {
        return jsonResponse({
          model: { _id: MODEL, trainArgs: { model: "yolo26n.pt" } },
        });
      }
      return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
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
      gpuType: "rtx-4090",
      epochs: 100,
      trainArgs: {
        mosaic: 0,
        mixup: 0,
        copy_paste: 0,
      },
      confirmCost: true,
    });

    expect(calls[1]).toMatchObject({
      body: {
        trainArgs: {
          model: "yolo26n.pt",
          data: DATASET,
          epochs: 100,
          mosaic: 0,
          mixup: 0,
          copy_paste: 0,
        },
      },
    });
  });

  test.each([
    "data",
    "model",
  ])("rejects reserved train_args key %s", async (key) => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
        trainArgs: { [key]: "x" },
        confirmCost: true,
      }),
    ).rejects.toThrow(/train_args/);
  });

  test("keeps model and data reserved in train_args", async () => {
    for (const key of ["data", "model"]) {
      await expect(
        trainingStart(throwingClient(), {
          model: MODEL,
          project: PROJECT,
          dataset: DATASET,
          gpuType: "rtx-4090",
          trainArgs: { [key]: "x" },
          confirmCost: true,
        }),
      ).rejects.toThrow(/reserved/);
    }
  });

  test("reuses stored trainArgs.model when training from an existing model id", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/models/${MODEL}`) {
        return jsonResponse({
          model: {
            _id: MODEL,
            trainArgs: { model: "ul://ultralytics/yolo26/yolo26x" },
          },
        });
      }
      if (path === "/api/training/start") {
        return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
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
      gpuType: "rtx-4090",
      epochs: 100,
      confirmCost: true,
    });

    expect(calls).toMatchObject([
      {
        url: `${BASE}/models/${MODEL}`,
        method: "GET",
      },
      {
        url: `${BASE}/training/start`,
        method: "POST",
        body: {
          modelId: MODEL,
          projectId: PROJECT,
          gpuType: "rtx-4090",
          trainArgs: {
            model: "ul://ultralytics/yolo26/yolo26x",
            data: DATASET,
            epochs: 100,
          },
        },
      },
    ]);
  });

  test("errors clearly when an existing model has no stored base checkpoint", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${MODEL}`) {
        return jsonResponse({ model: { _id: MODEL, trainArgs: {} } });
      }
      return jsonResponse({}, 404);
    });

    await expect(
      trainingStart(client, {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
        confirmCost: true,
      }),
    ).rejects.toThrow(/no stored base checkpoint/);
  });

  test("creates a model record before starting training from a detect checkpoint", async () => {
    const createdModelId = "m".repeat(24);
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/datasets/${DATASET}`) {
        return jsonResponse({ dataset: { _id: DATASET, task: "detect" } });
      }
      if (path === "/api/models") {
        return jsonResponse({ model: { _id: createdModelId, task: "detect" } });
      }
      if (path === "/api/training/start") {
        return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
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
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      epochs: 100,
      confirmCost: true,
    });

    expect(calls).toMatchObject([
      {
        url: `${BASE}/datasets/${DATASET}`,
        method: "GET",
      },
      {
        url: `${BASE}/models`,
        method: "POST",
        body: {
          projectId: PROJECT,
          task: "detect",
          name: "yolo26n",
        },
      },
      {
        url: `${BASE}/training/start`,
        method: "POST",
        body: {
          modelId: createdModelId,
          projectId: PROJECT,
          gpuType: "rtx-4090",
          trainArgs: {
            model: "yolo26n.pt",
            data: DATASET,
            epochs: 100,
          },
        },
      },
    ]);
  });

  test("reads top-level modelId from the real create-model response shape", async () => {
    const createdModelId = "m".repeat(24);
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/datasets/${DATASET}`) {
        return jsonResponse({ dataset: { _id: DATASET, task: "detect" } });
      }
      if (path === "/api/models") {
        return jsonResponse({
          modelId: createdModelId,
          slug: "yolo26x",
          region: "eu",
        });
      }
      if (path === "/api/training/start") {
        return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: "yolo26x.pt",
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      confirmCost: true,
    });

    expect(calls[2]).toMatchObject({
      body: { modelId: createdModelId },
    });
  });

  test("routes official ultralytics ul:// refs through checkpoint mode", async () => {
    const createdModelId = "m".repeat(24);
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/datasets/${DATASET}`) {
        return jsonResponse({ dataset: { _id: DATASET, task: "detect" } });
      }
      if (path === "/api/models") {
        return jsonResponse({ modelId: createdModelId, slug: "yolo26x" });
      }
      if (path === "/api/training/start") {
        return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
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
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      batch: -1,
      confirmCost: true,
    });

    expect(calls).toMatchObject([
      {
        url: `${BASE}/datasets/${DATASET}`,
        method: "GET",
      },
      {
        url: `${BASE}/models`,
        method: "POST",
        body: {
          projectId: PROJECT,
          task: "detect",
          name: "yolo26x",
        },
      },
      {
        url: `${BASE}/training/start`,
        method: "POST",
        body: {
          modelId: createdModelId,
          projectId: PROJECT,
          gpuType: "rtx-4090",
          trainArgs: {
            model: "yolo26x.pt",
            data: DATASET,
            batch: -1,
          },
        },
      },
    ]);
  });

  test("does not treat user-owned ul:// models as checkpoints", async () => {
    const projectId = "p".repeat(24);
    const calls: { path: string; params: URLSearchParams }[] = [];
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL, _init: RequestInit = {}) => {
        const parsed = new URL(String(url));
        calls.push({ path: parsed.pathname, params: parsed.searchParams });
        const path = parsed.pathname;
        if (path === "/api/projects") {
          return jsonResponse({
            projects: [
              { _id: projectId, username: "aman-harsh", slug: "jellyfish" },
            ],
          });
        }
        if (path === "/api/models") {
          return jsonResponse({
            models: [{ _id: MODEL, slug: "yolo26x" }],
          });
        }
        if (path === `/api/models/${MODEL}`) {
          return jsonResponse({
            model: { _id: MODEL, trainArgs: { model: "yolo26n.pt" } },
          });
        }
        if (path === "/api/training/start") {
          return jsonResponse({
            job: { _id: "j".repeat(24), status: "queued" },
          });
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });

    await trainingStart(client, {
      model: "ul://aman-harsh/jellyfish/yolo26x",
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      confirmCost: true,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/projects",
      "/api/models",
      `/api/models/${MODEL}`,
      "/api/training/start",
    ]);
  });

  test("allows semantic checkpoints for segment datasets and creates a semantic model", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const path = new URL(String(url)).pathname;
      if (path === `/api/datasets/${DATASET}`) {
        return jsonResponse({ dataset: { _id: DATASET, task: "segment" } });
      }
      if (path === "/api/models") {
        return jsonResponse({
          model: { _id: "m".repeat(24), task: "semantic" },
        });
      }
      if (path === "/api/training/start") {
        return jsonResponse({ job: { _id: "j".repeat(24), status: "queued" } });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await trainingStart(client, {
      model: "yolo26n-sem.pt",
      project: PROJECT,
      dataset: DATASET,
      gpuType: "rtx-4090",
      confirmCost: true,
    });

    expect(calls[1]).toMatchObject({
      url: `${BASE}/models`,
      method: "POST",
      body: {
        projectId: PROJECT,
        task: "semantic",
        name: "yolo26n-sem",
      },
    });
  });

  test("rejects incompatible checkpoint and dataset task combinations", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === `/api/datasets/${DATASET}`) {
        return jsonResponse({ dataset: { _id: DATASET, task: "semantic" } });
      }
      return jsonResponse({}, 404);
    });

    await expect(
      trainingStart(client, {
        model: "yolo26n-seg.pt",
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
        confirmCost: true,
      }),
    ).rejects.toThrow(/not compatible/);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(`/api/datasets/${DATASET}`);
  });

  test.each([0, -2])("rejects invalid batch=%s", async (batch) => {
    await expect(
      trainingStart(throwingClient(), {
        model: MODEL,
        project: PROJECT,
        dataset: DATASET,
        gpuType: "rtx-4090",
        batch,
        confirmCost: true,
      }),
    ).rejects.toThrow(/batch/);
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
