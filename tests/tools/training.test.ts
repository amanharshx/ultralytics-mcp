import { describe, expect, test } from "vitest";

import { UltralyticsApiError } from "../../src/errors.js";
import { trainingMonitor } from "../../src/tools/training.js";
import { jsonResponse, routeClient } from "../helpers.js";

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
