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
  test("returns the model record and a summary", async () => {
    const id = "a".repeat(24);
    const { client } = routeClient((path) => {
      if (path === `/api/models/${id}`) {
        return jsonResponse({
          model: {
            _id: id,
            name: "YOLO",
            task: "detect",
            status: "completed",
            epochs: 100,
            modelInfo: { parameters: 123 },
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsGet(client, id);
    expect(result.summary).toBe(
      "Model 'YOLO' [detect] status=completed, epochs=100, params=123.",
    );
    expect(result.data).toEqual({
      _id: id,
      name: "YOLO",
      task: "detect",
      status: "completed",
      epochs: 100,
      modelInfo: { parameters: 123 },
    });
  });

  test("renders missing fields like Python (None) for sparse payloads", async () => {
    const id = "a".repeat(24);
    const { client } = routeClient((path) =>
      path === `/api/models/${id}`
        ? jsonResponse({ model: {} })
        : jsonResponse({}, 404),
    );
    const result = await modelsGet(client, id);
    expect(result.summary).toBe(
      "Model 'None' [None] status=None, epochs=None, params=None.",
    );
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
