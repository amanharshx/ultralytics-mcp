import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { UltralyticsApiError } from "../../src/errors.js";
import { trainingMonitor, trainingStart } from "../../src/tools/training.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

const ID = "a".repeat(24);

describe("trainingMonitor", () => {
  test("private fallback derives progress from trainResults when /training 404s", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: {
            status: "running",
            epochs: 100,
            trainResults: [
              { epoch: 0, metrics: { "metrics/mAP50(B)": 0.5 } },
              { epoch: 1, metrics: { "metrics/mAP50(B)": 0.6 } },
            ],
          },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID);
    expect(result.summary).toBe("Training status=running; epoch 2/100; ~2.0%");
    expect(result.data).toMatchObject({
      status: "running",
      epochsDone: 2,
      totalEpochs: 100,
      progressPercentage: 2,
      etaMs: null,
      progressSource: "model.trainResults",
      latestMetrics: { "metrics/mAP50(B)": 0.6 },
    });
  });

  test("public route supplies percentage and ETA", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: { status: "running", epochs: 100, trainResults: [] },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({
          job: { progress: { percentage: 42 }, timing: { etaMs: 600000 } },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID);
    expect(result.summary).toBe(
      "Training status=running; epoch 0/100; ~42%; ETA 10min",
    );
    expect(result.data).toMatchObject({
      progressPercentage: 42,
      etaMs: 600000,
      progressSource: "models/{id}/training",
    });
  });

  test("include_metrics returns full latest metrics with live extras", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: {
            status: "running",
            epochs: 100,
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
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({
          job: {
            progress: { percentage: 70 },
            timing: {
              etaMs: 432343,
              timePerEpochMs: 14411.4,
              elapsedMs: 1008800,
            },
          },
          instanceStatus: { status: "running", uptimeSeconds: 1012 },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID, undefined, {
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
      instanceStatus: { status: "running", uptimeSeconds: 1012 },
    });
  });

  test.each([
    401, 403, 404,
  ])("include_metrics falls back on /training %s", async (statusCode) => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: {
            status: "running",
            epochs: 100,
            trainResults: [
              {
                epoch: 0,
                metrics: {
                  "train/box_loss": 1.23,
                  "metrics/mAP50(B)": 0.5,
                },
              },
            ],
          },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({ error: "not available" }, statusCode);
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID, undefined, {
      includeMetrics: true,
    });
    expect(result.data).toMatchObject({
      progressSource: "model.trainResults",
      latestMetrics: {
        "train/box_loss": 1.23,
        "metrics/mAP50(B)": 0.5,
      },
      timing: null,
      instanceStatus: null,
    });
  });

  test("include_history returns recent verbatim series", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: {
            status: "running",
            epochs: 100,
            trainResults: [
              { epoch: 0, metrics: { lr: 0.01 } },
              { epoch: 1, metrics: { lr: 0.001 } },
              { epoch: 2, metrics: { lr: 0.0001 } },
              { epoch: 3, metrics: { "metrics/mAP50(B)": 0.6, lr: 0.00001 } },
            ],
          },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID, undefined, {
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
    const { client } = routeClient(() => jsonResponse({}, 500));
    await expect(
      trainingMonitor(client, ID, undefined, { historyLastN }),
    ).rejects.toThrow(/history_last_n/);
  });

  test("unknown epoch total skips percentage math", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: {
            status: "completed",
            epochs: -1,
            trainResults: [{ epoch: 0, metrics: {} }],
          },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });

    const result = await trainingMonitor(client, ID);
    expect(result.summary).toBe("Training status=completed; epoch 1/?");
    expect(result.data).toMatchObject({
      totalEpochs: null,
      progressPercentage: null,
    });
  });

  test("re-raises non-auth errors from /training (e.g. 500)", async () => {
    const { client } = routeClient((path) => {
      if (path === `/api/models/${ID}`) {
        return jsonResponse({
          model: { status: "running", epochs: 100, trainResults: [] },
        });
      }
      if (path === `/api/models/${ID}/training`) {
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({}, 404);
    });

    const error = await trainingMonitor(client, ID).catch(
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
        if (path === `/api/models/${ID}`) {
          return jsonResponse({
            model: { status: "running", epochs: 100, trainResults: [] },
          });
        }
        if (path === `/api/models/${ID}/training`) {
          return jsonResponse({ error: "slow down" }, 429);
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });

    const error = await trainingMonitor(client, ID).catch(
      (e) => e as UltralyticsApiError,
    );
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(429);
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
    expect(calls[0]).toMatchObject({
      url: `${BASE}/training/start`,
      method: "POST",
      body: {
        modelId: MODEL,
        projectId: PROJECT,
        gpuType: "rtx-4090",
        trainArgs: { data: DATASET, epochs: 100 },
      },
    });
  });

  test("merges train_args into trainArgs while preserving MCP fields", async () => {
    const calls: { body: unknown }[] = [];
    const impl = (async (_url: string | URL, init: RequestInit = {}) => {
      calls.push({
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
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

    expect(calls[0]).toMatchObject({
      body: {
        trainArgs: {
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
});
