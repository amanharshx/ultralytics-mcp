import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
} from "../../src/tools/datasets.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

function captureClient(responder: (url: string) => Response) {
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
    return responder(String(url));
  }) as unknown as typeof fetch;
  return {
    client: new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    }),
    calls,
  };
}

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

describe("datasetsCreate", () => {
  test("posts the dataset payload and validates task before network", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({
        dataset: { _id: "d".repeat(24), slug: "data", task: "detect" },
      }),
    );
    const result = await datasetsCreate(client, {
      name: "Dataset",
      task: "detect",
      slug: "data",
      visibility: "private",
      classNames: ["car", "person"],
    });
    await expect(
      datasetsCreate(client, {
        name: "Bad",
        task: "bad-task",
        slug: "bad",
      }),
    ).rejects.toThrow(/Unsupported dataset task/);
    await expect(
      datasetsCreate(client, { name: "Bad", task: "detect", slug: "" }),
    ).rejects.toThrow(/`slug` is required/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: `${BASE}/datasets`,
      method: "POST",
      body: {
        name: "Dataset",
        task: "detect",
        slug: "data",
        visibility: "private",
        classNames: ["car", "person"],
      },
    });
    expect(result.summary).toBe(
      `Created dataset ${"d".repeat(24)} slug=data task=detect.`,
    );
  });
});

describe("datasetsDelete", () => {
  test("resolves a reference and deletes the dataset", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({ deleted: true });
    });
    const result = await datasetsDelete(client, "user/data");
    expect(calls.at(-1)).toMatchObject({
      url: `${BASE}/datasets/${"d".repeat(24)}`,
      method: "DELETE",
    });
    expect(result.summary).toBe(
      `Deleted dataset ${"d".repeat(24)} (soft delete).`,
    );
  });
});

describe("datasetsIngest", () => {
  test("resolves a dataset and posts the ingest payload", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    });
    const result = await datasetsIngest(client, {
      dataset: "user/data",
      sourceUrl: "https://example.com/dataset.zip",
      targetSplit: "train",
    });
    expect(calls.at(-1)).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sourceUrl: "https://example.com/dataset.zip",
        targetSplit: "train",
      },
    });
    expect(result.summary).toBe(
      `Started dataset ingest job job_123 for dataset ${"d".repeat(24)}.`,
    );
    expect((result.data as Record<string, unknown>).status).toBe("queued");
  });

  test("validates inputs before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetsIngest(client, {
        dataset: "user/data",
        sourceUrl: "",
      }),
    ).rejects.toThrow(/`sourceUrl` is required/);
    await expect(
      datasetsIngest(client, {
        dataset: "user/data",
        sourceUrl: "https://example.com/dataset.zip",
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Unsupported targetSplit/);
  });
});
