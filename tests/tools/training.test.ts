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
});
