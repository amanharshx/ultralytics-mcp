import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
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

describe("datasetImagesList", () => {
  test("resolves dataset, builds query, and normalizes images", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        images: [
          {
            _id: "i".repeat(24),
            name: "frame-001",
            ext: ".jpg",
            split: "train",
            width: 1280,
            height: 720,
            labelCount: 3,
            bytes: 12345,
            imageUrl: "https://cdn.example.com/frame-001.jpg",
            thumbnailUrl: "https://cdn.example.com/frame-001-thumb.jpg",
            hash: "omit",
          },
        ],
        total: 10,
        hasMore: true,
        classes: [],
        errorCount: 0,
        nextCursor: "cursor_2",
      });
    });

    const result = await datasetImagesList(client, {
      dataset: "user/data",
      split: "train",
      search: "frame",
      hasLabel: true,
      classIds: ["car", "person"],
      limit: 25,
      offset: 50,
      includeImageUrls: true,
    });

    expect(calls[1]).toEqual({
      url:
        `${BASE}/datasets/${"d".repeat(24)}/images` +
        "?split=train&search=frame&hasLabel=true&classIds=car%2Cperson&limit=25&offset=50&includeImageUrls=true",
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe("1 image(s) (total 10)");
    expect(result.data).toEqual({
      total: 10,
      hasMore: true,
      nextCursor: "cursor_2",
      images: [
        {
          id: "i".repeat(24),
          name: "frame-001",
          ext: ".jpg",
          split: "train",
          width: 1280,
          height: 720,
          labelCount: 3,
          bytes: 12345,
          imageUrl: "https://cdn.example.com/frame-001.jpg",
          thumbnailUrl: "https://cdn.example.com/frame-001-thumb.jpg",
        },
      ],
    });
  });

  test("validates split, limit, and offset before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as typeof fetch,
    });

    await expect(
      datasetImagesList(client, { dataset: "data", split: "bogus" }),
    ).rejects.toThrow(/Unsupported split/);
    await expect(
      datasetImagesList(client, { dataset: "data", limit: 5001 }),
    ).rejects.toThrow(/at most 5000/);
    await expect(
      datasetImagesList(client, { dataset: "data", offset: -1 }),
    ).rejects.toThrow(/greater than or equal to 0/);
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

describe("datasetUploadFile", () => {
  test("uploads file through signed URL flow and starts ingest", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, "dataset.zip");
    await writeFile(filePath, "archive");

    const calls: { url: string; method: string; body: unknown }[] = [];
    const uploadCalls: Array<{
      url: string;
      method: string;
      body: string;
      contentType: string | null;
      auth: string | null;
    }> = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse({
          url: "https://signed.example/upload",
          sessionId: "session_123",
        });
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    }) as unknown as typeof fetch;

    const uploadFetch = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body: await new Response(init.body).text(),
        contentType: new Headers(init.headers).get("Content-Type"),
        auth: new Headers(init.headers).get("Authorization"),
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });

    const result = await datasetUploadFile(uploadClient, {
      dataset: "user/data",
      filePath,
      targetSplit: "train",
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets?slug=data&username=user`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/ingest`,
    ]);
    expect(calls[1]).toEqual({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        filename: "dataset.zip",
        contentType: "application/zip",
        totalBytes: 7,
      },
    });
    expect(uploadCalls).toEqual([
      {
        url: "https://signed.example/upload",
        method: "PUT",
        body: "archive",
        contentType: "application/zip",
        auth: null,
      },
    ]);
    expect(calls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(calls[3]).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sessionId: "session_123",
        targetSplit: "train",
      },
    });
    expect(result.summary).toBe(
      "Uploaded dataset.zip (7 bytes) and started dataset ingest job job_123.",
    );
    expect(result.data).toEqual({
      datasetId: "d".repeat(24),
      filename: "dataset.zip",
      bytes: 7,
      sessionId: "session_123",
      ingest: {
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      },
    });
  });

  test("validates file path and target split before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: "",
      }),
    ).rejects.toThrow(/`filePath` is required/);
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: join(tmpdir(), "missing-dataset.zip"),
      }),
    ).rejects.toThrow(/does not exist/);

    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const badPath = join(tmp, "dataset.txt");
    await writeFile(badPath, "bad");
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: badPath,
      }),
    ).rejects.toThrow(/Unsupported dataset upload file type/);

    const goodPath = join(tmp, "dataset.zip");
    await writeFile(goodPath, "archive");
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: goodPath,
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Unsupported targetSplit/);
  });
});
