import { describe, expect, test } from "vitest";

import { modelsDelete, modelsGet, modelsList } from "../../src/tools/models.js";
import { jsonResponse, routeClient } from "../helpers.js";

describe("modelsList", () => {
  test("resolves the project id and summarizes the models", async () => {
    const projectId = "b".repeat(24);
    const { client, calls } = routeClient((path, params) => {
      if (path === "/api/models" && params.get("projectId") === projectId) {
        return jsonResponse({
          models: [
            {
              _id: "a".repeat(24),
              name: "exp",
              slug: "exp",
              status: "completed",
              task: "detect",
              epochs: 100,
              bestFitness: 0.9,
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelsList(client, projectId);
    expect(result.summary).toBe("1 model(s) in project.");
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        name: "exp",
        slug: "exp",
        status: "completed",
        task: "detect",
        epochs: 100,
        bestFitness: 0.9,
      },
    ]);
    expect(calls[0].params.get("projectId")).toBe(projectId);
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
