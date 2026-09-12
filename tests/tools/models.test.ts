import { describe, expect, test } from "vitest";

import { modelsDelete, modelsGet, modelsList } from "../../src/tools/models.js";
import { jsonResponse, routeClient } from "../helpers.js";

/** Client whose owner-scoped models path answers 404 Project not found. */
function clientForMissingProject() {
  return routeClient((path) =>
    path === "/api/models/alice/missing"
      ? jsonResponse({ error: "Project not found" }, 404)
      : jsonResponse({}, 404),
  );
}

describe("modelsList", () => {
  test("fills the owner from the account summary and reads live field names", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/models/alice/road") {
        return jsonResponse({
          models: [
            {
              id: "a".repeat(24),
              owner: "alice",
              project: "road",
              model: "exp",
              name: "exp",
              visibility: "private",
              status: "completed",
              task: "detect",
              epochs: 100,
              bestFitness: 0.9,
              extra: "omitted",
            },
            {
              id: "b".repeat(24),
              owner: "alice",
              project: "road",
              model: "bare",
              name: "Bare",
              visibility: "public",
            },
          ],
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsList(client, "road");
    expect(result.summary).toBe(
      "2 model(s) for project 'road' for owner 'alice'.",
    );
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        name: "exp",
        slug: "exp",
        username: "alice",
        visibility: "private",
        status: "completed",
        task: "detect",
        epochs: 100,
        bestFitness: 0.9,
      },
      {
        id: "b".repeat(24),
        name: "Bare",
        slug: "bare",
        username: "alice",
        visibility: "public",
        status: null,
        task: null,
        epochs: null,
        bestFitness: null,
      },
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/models/alice/road",
    ]);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/models/bob/road") {
        return jsonResponse({ models: [], region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await modelsList(client, "bob/road");
    expect(result.summary).toBe(
      "0 model(s) for project 'road' for owner 'bob'.",
    );
    expect(result.data).toEqual([]);
    expect(calls.map((call) => call.path)).toEqual(["/api/models/bob/road"]);
  });

  test("accepts a ul:// project URI without an account lookup", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/models/bob/road") {
        return jsonResponse({ models: [], region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await modelsList(client, "ul://bob/road");
    expect(result.summary).toBe(
      "0 model(s) for project 'road' for owner 'bob'.",
    );
    expect(calls.map((call) => call.path)).toEqual(["/api/models/bob/road"]);
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 500));
    await expect(modelsList(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a project that does not exist", async () => {
    const { client } = clientForMissingProject();
    await expect(modelsList(client, "alice/missing")).rejects.toThrow(
      /Project not found/,
    );
  });

  test("attaches the static not-found hint through the tool", async () => {
    // Live capture: GET /api/models/{owner}/{bad-project} -> 404 {"error":"Project not found"}
    const { client } = clientForMissingProject();
    const err = await modelsList(client, "alice/missing").catch(
      (e) => e as Error,
    );
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Project not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
  });
});

describe("modelsGet", () => {
  const liveModel = {
    id: "c".repeat(24),
    owner: "alice",
    project: "road",
    model: "exp",
    name: "exp",
    visibility: "private",
    task: "detect",
    status: "completed",
    epochs: 100,
    bestEpoch: 79,
    bestFitness: 0.40382,
    hasWeights: true,
    dataset: { owner: "alice", dataset: "road-data" },
    datasetId: "d".repeat(24),
    computeCost: {
      gpuType: "rtx-pro-6000",
      pricePerHour: 1.89,
      totalCost: 0.13,
      durationMs: 238633,
    },
    metrics: { mAP50: 0.7 },
    plots: [{ type: "pr_curve" }],
    trainResults: [{ epoch: 0 }],
  };

  test("fetches through the owner/project/model path for a full reference", async () => {
    const { client, calls } = routeClient((path) =>
      path === "/api/models/alice/road/exp"
        ? jsonResponse({ model: liveModel, isOwner: true })
        : jsonResponse({}, 404),
    );

    const result = await modelsGet(client, "alice/road/exp");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/models/alice/road/exp",
    ]);
    expect(result.data).toEqual({
      model: {
        id: "c".repeat(24),
        name: "exp",
        slug: "exp",
        owner: "alice",
        project: "road",
        visibility: "private",
        task: "detect",
        status: "completed",
        epochs: 100,
        bestEpoch: 79,
        bestFitness: 0.40382,
        hasWeights: true,
        dataset: { owner: "alice", dataset: "road-data" },
        datasetId: "d".repeat(24),
        datasetVersion: null,
        computeCost: {
          gpuType: "rtx-pro-6000",
          pricePerHour: 1.89,
          totalCost: 0.13,
          durationMs: 238633,
        },
      },
      isOwner: true,
    });
    expect(result.summary).toContain("Model 'exp' for owner 'alice'");
    expect(result.summary).toContain("project 'road'");
    expect(result.summary).toContain("hasWeights=true");
    expect(result.summary).toContain("0.13");
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = routeClient((path) =>
      path === "/api/models/alice/road/exp"
        ? jsonResponse({ model: liveModel, isOwner: true })
        : jsonResponse({}, 404),
    );

    await modelsGet(client, "ul://alice/road/exp");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/models/alice/road/exp",
    ]);
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/models/alice/road/exp") {
        return jsonResponse({ model: liveModel, isOwner: true });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsGet(client, "exp", "road");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/models/alice/road/exp",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("leaves evaluation plots and training history out of the result", async () => {
    const { client } = routeClient((path) =>
      path === "/api/models/alice/road/exp"
        ? jsonResponse({ model: liveModel, isOwner: false })
        : jsonResponse({}, 404),
    );

    const result = await modelsGet(client, "alice/road/exp");

    expect(JSON.stringify(result.data)).not.toContain("plots");
    expect(JSON.stringify(result.data)).not.toContain("trainResults");
    expect(JSON.stringify(result.data)).not.toContain("metrics/mAP50");
    expect(result.data).toMatchObject({ isOwner: false });
  });

  test("surfaces null compute cost and dataset version when absent", async () => {
    const sparse = {
      id: "e".repeat(24),
      owner: "alice",
      project: "road",
      model: "bare",
      name: "bare",
      task: "detect",
      status: "untrained",
      epochs: 0,
      hasWeights: false,
    };
    const { client } = routeClient((path) =>
      path === "/api/models/alice/road/bare"
        ? jsonResponse({ model: sparse, isOwner: true })
        : jsonResponse({}, 404),
    );

    const result = await modelsGet(client, "alice/road/bare");

    expect(result.data).toEqual({
      model: {
        id: "e".repeat(24),
        name: "bare",
        slug: "bare",
        owner: "alice",
        project: "road",
        visibility: null,
        task: "detect",
        status: "untrained",
        epochs: 0,
        bestEpoch: null,
        bestFitness: null,
        hasWeights: false,
        dataset: null,
        datasetId: null,
        datasetVersion: null,
        computeCost: null,
      },
      isOwner: true,
    });
    expect(result.summary).toContain("hasWeights=false");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 500));
    await expect(modelsGet(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*owner\/project\/model.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 500));
    await expect(modelsGet(client, "exp")).rejects.toThrow(
      /project is required/,
    );
    expect(calls).toHaveLength(0);
  });

  test("attaches the static not-found hint through the tool", async () => {
    // Live capture: GET /api/models/{owner}/{project}/{bad-model} -> 404 {"error":"Model not found"}
    const { client } = routeClient((path) =>
      path === "/api/models/alice/road/missing"
        ? jsonResponse({ error: "Model not found" }, 404)
        : jsonResponse({}, 404),
    );
    const err = await modelsGet(client, "alice/road/missing").catch(
      (e) => e as Error,
    );
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Model not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
  });
});

describe("modelsDelete", () => {
  test("deletes a model by id", async () => {
    const id = "a".repeat(24);
    const { client, calls } = routeClient((path) => {
      if (path === `/api/models/${id}`) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsDelete(client, id);

    expect(result.summary).toBe(`Deleted model ${id}.`);
    expect(result.data).toEqual({
      id,
      response: { success: true },
    });
    expect(calls[0].path).toBe(`/api/models/${id}`);
  });

  test("resolves slug plus project before deleting", async () => {
    const projectId = "b".repeat(24);
    const modelId = "c".repeat(24);
    const { client, calls } = routeClient((path, params) => {
      if (path === "/api/projects" && params.get("username") === "user") {
        return jsonResponse({
          projects: [{ _id: projectId, slug: "proj", username: "user" }],
        });
      }
      if (path === "/api/models" && params.get("projectId") === projectId) {
        return jsonResponse({
          models: [{ _id: modelId, slug: "exp" }],
        });
      }
      if (path === `/api/models/${modelId}`) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsDelete(client, "exp", "user/proj");

    expect(result.summary).toBe(`Deleted model ${modelId}.`);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/projects",
      "/api/models",
      `/api/models/${modelId}`,
    ]);
  });
});
