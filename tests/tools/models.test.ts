import { describe, expect, test } from "vitest";

import { modelsGet, modelsList } from "../../src/tools/models.js";
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
