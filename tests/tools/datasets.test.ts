import { describe, expect, test } from "vitest";

import { datasetsGet, datasetsList } from "../../src/tools/datasets.js";
import { jsonResponse, routeClient } from "../helpers.js";

describe("datasetsList", () => {
  test("normalizes items and summarizes count", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/datasets") {
        return jsonResponse({
          datasets: [
            {
              _id: "d".repeat(24),
              name: "Cars",
              slug: "cars",
              task: "detect",
              imageCount: 100,
              classCount: 5,
              visibility: "private",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await datasetsList(client);
    expect(result.summary).toBe("1 dataset(s).");
    expect(result.data).toEqual([
      {
        id: "d".repeat(24),
        name: "Cars",
        slug: "cars",
        task: "detect",
        imageCount: 100,
        classCount: 5,
        visibility: "private",
      },
    ]);
  });
});

describe("datasetsGet", () => {
  test("returns the dataset record and a summary", async () => {
    const id = "d".repeat(24);
    const { client } = routeClient((path) => {
      if (path === `/api/datasets/${id}`) {
        return jsonResponse({
          dataset: {
            _id: id,
            name: "Cars",
            task: "detect",
            imageCount: 100,
            classCount: 5,
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await datasetsGet(client, id);
    expect(result.summary).toBe(
      "Dataset 'Cars' [detect], 100 images, 5 classes.",
    );
    expect(result.data).toEqual({
      _id: id,
      name: "Cars",
      task: "detect",
      imageCount: 100,
      classCount: 5,
    });
  });

  test("renders missing fields like Python (None / ?) for sparse payloads", async () => {
    const id = "d".repeat(24);
    const { client } = routeClient((path) =>
      path === `/api/datasets/${id}`
        ? jsonResponse({ dataset: {} })
        : jsonResponse({}, 404),
    );
    const result = await datasetsGet(client, id);
    expect(result.summary).toBe("Dataset 'None' [None], ? images, ? classes.");
  });
});
