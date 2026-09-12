import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
  datasetUploadFolder,
  datasetUploadVideo,
  datasetVersionCreate,
  exploreDatasets,
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
    fetchImpl: impl,
  };
}

describe("datasetsList", () => {
  /** Client whose datasets path answers 404 Owner not found for `ghost`. */
  function ghostOwnerClient() {
    return routeClient((path) => {
      if (path === "/api/datasets/ghost") {
        return jsonResponse({ error: "Owner not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
  }

  test("fills the owner from the account summary and reads live field names", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/datasets/alice") {
        return jsonResponse({
          datasets: [
            {
              id: "a".repeat(24),
              owner: "alice",
              dataset: "cars",
              name: "Cars",
              visibility: "private",
              task: "detect",
              imageCount: 100,
              classCount: 5,
              classNames: ["car"],
              status: "ready",
              errorCount: 0,
              extra: "omitted",
            },
            {
              id: "b".repeat(24),
              owner: "alice",
              dataset: "bare",
              name: "Bare",
              visibility: "public",
            },
          ],
          total: 2,
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await datasetsList(client);
    expect(result.summary).toBe("2 dataset(s) for owner 'alice'.");
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        name: "Cars",
        slug: "cars",
        username: "alice",
        visibility: "private",
        task: "detect",
        imageCount: 100,
        classCount: 5,
      },
      {
        id: "b".repeat(24),
        name: "Bare",
        slug: "bare",
        username: "alice",
        visibility: "public",
        task: null,
        imageCount: null,
        classCount: null,
      },
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice",
    ]);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/datasets/bob") {
        return jsonResponse({ datasets: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await datasetsList(client, "bob");
    expect(result.summary).toBe("0 dataset(s) for owner 'bob'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/datasets/bob"]);
  });

  test("accepts the owner through the username alias", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/datasets/bob") {
        return jsonResponse({ datasets: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await datasetsList(client, undefined, "bob");
    expect(result.summary).toBe("0 dataset(s) for owner 'bob'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/datasets/bob"]);
  });

  test("prefers owner over the username alias when both are given", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/datasets/alice") {
        return jsonResponse({ datasets: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await datasetsList(client, "alice", "bob");
    expect(result.summary).toBe("0 dataset(s) for owner 'alice'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/datasets/alice"]);
  });

  test("treats a blank owner as omitted", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/datasets/alice") {
        return jsonResponse({ datasets: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await datasetsList(client, "   ");
    expect(result.summary).toBe("0 dataset(s) for owner 'alice'.");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice",
    ]);
  });

  test("surfaces the API message for an owner that does not exist", async () => {
    const { client } = ghostOwnerClient();
    await expect(datasetsList(client, "ghost")).rejects.toThrow(
      /Owner not found/,
    );
  });

  test("attaches the static not-found hint through the tool", async () => {
    // Live capture: GET /api/datasets/{bad-owner} -> 404 {"error":"Owner not found"}
    const { client } = ghostOwnerClient();
    const err = await datasetsList(client, "ghost").catch((e) => e as Error);
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Owner not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
  });
});

describe("exploreDatasets", () => {
  test("builds query, validates task filter, and trims results", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/explore/search") {
        return jsonResponse({
          datasets: [
            {
              _id: "d".repeat(24),
              name: "Birds",
              slug: "birds",
              username: "user",
              task: "detect",
              imageCount: 65,
              classCount: 3,
              starCount: 7,
              extra: "omit",
            },
          ],
          hasMore: true,
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await exploreDatasets(client, {
      q: "bird",
      sort: "stars",
      offset: 20,
      task: ["detect", "segment"],
    });

    expect(calls[0]).toEqual({
      url:
        `${BASE}/explore/search` +
        "?type=datasets&q=bird&sort=stars&offset=20&task=detect%2Csegment",
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe("Search 'bird': 1 dataset(s) (more available)");
    expect(result.data).toEqual({
      datasets: [
        {
          id: "d".repeat(24),
          name: "Birds",
          slug: "birds",
          username: "user",
          task: "detect",
          imageCount: 65,
          classCount: 3,
          starCount: 7,
        },
      ],
      hasMore: true,
    });
  });

  test("validates q, sort, offset, and task before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as typeof fetch,
    });

    await expect(exploreDatasets(client, { q: "" })).rejects.toThrow(
      /q is required/,
    );
    await expect(
      exploreDatasets(client, { q: "bird", sort: "popular" }),
    ).rejects.toThrow(/Unsupported sort/);
    await expect(
      exploreDatasets(client, { q: "bird", offset: -1 }),
    ).rejects.toThrow(/offset/);
    await expect(
      exploreDatasets(client, { q: "bird", task: ["detect", "bad"] }),
    ).rejects.toThrow(/Unsupported dataset task/);
  });
});

describe("datasetsGet", () => {
  const baseDataset = {
    id: "a".repeat(24),
    owner: "alice",
    dataset: "cars",
    name: "Cars",
    visibility: "private",
    task: "detect",
    imageCount: 100,
    classCount: 5,
    classNames: ["car", "person"],
    status: "ready",
    errorCount: 0,
  };

  function clientForDatasetGet(
    response: unknown,
    options: { accountOwner?: string } = {},
  ) {
    return routeClient((path) => {
      if (options.accountOwner && path === "/api/account/summary") {
        return jsonResponse({ username: options.accountOwner });
      }
      return path === "/api/datasets/alice/cars"
        ? jsonResponse(response)
        : jsonResponse({}, 404);
    });
  }

  test("fetches through the owner-scoped path and reads the nested dataset", async () => {
    const { client, calls } = clientForDatasetGet({
      dataset: { ...baseDataset },
    });

    const result = await datasetsGet(client, "alice/cars");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars",
    ]);
    expect(result.summary).toBe(
      "Dataset 'cars' for owner 'alice': 'Cars' (private) [detect], 100 images, 5 classes.",
    );
    expect(result.data).toEqual({ ...baseDataset });
  });

  test("preserves class names and ingest status fields", async () => {
    const { client } = clientForDatasetGet({
      dataset: {
        ...baseDataset,
        lastIngestJobId: "job_123",
        lastIngestSummary: { added: 2, errors: 0, skippedCounts: {} },
        processingError: null,
      },
    });
    const result = await datasetsGet(client, "alice/cars");
    expect(result.data).toMatchObject({
      classNames: ["car", "person"],
      status: "ready",
      errorCount: 0,
      lastIngestJobId: "job_123",
      lastIngestSummary: { added: 2, errors: 0, skippedCounts: {} },
    });
  });

  test("renders missing fields like Python (None / ?) for sparse payloads", async () => {
    const { client } = clientForDatasetGet({ dataset: {} });
    const result = await datasetsGet(client, "alice/cars");
    expect(result.summary).toBe(
      "Dataset 'None' for owner 'alice': 'None' (None) [None], ? images, ? classes.",
    );
    expect(result.data).toEqual({});
  });

  test("succeeds for a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForDatasetGet({
      dataset: { ...baseDataset, visibility: "public" },
    });
    const result = await datasetsGet(client, "ul://alice/cars");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
    expect(result.data).toMatchObject({
      dataset: "cars",
      owner: "alice",
    });
  });

  test("falls back to the account owner for a bare slug", async () => {
    const { client, calls } = clientForDatasetGet(
      { dataset: { ...baseDataset } },
      { accountOwner: "alice" },
    );
    const result = await datasetsGet(client, "cars");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice/cars",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
    expect(result.data).toMatchObject({
      dataset: "cars",
      owner: "alice",
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 500));
    await expect(datasetsGet(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a dataset that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/datasets/alice/missing") {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(datasetsGet(client, "alice/missing")).rejects.toThrow(
      /Dataset not found/,
    );
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
  function clientForCreate(
    createResponse: unknown,
    options: { accountOwner?: string; status?: number } = {},
  ) {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        path: parsed.pathname,
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (
        parsed.pathname === "/api/datasets" &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        return jsonResponse(createResponse, options.status ?? 201);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });
    return { client, calls };
  }

  const flatCreate = {
    id: "a".repeat(24),
    owner: "alice",
    dataset: "cars",
    region: "eu",
  };

  test("sends the slug as dataset, defaults to private, and fills the owner", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    const result = await datasetsCreate(client, {
      name: "Cars",
      dataset: "cars",
      task: "detect",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/account/summary",
      "POST /api/datasets",
    ]);
    expect(calls[1].body).toEqual({
      dataset: "cars",
      name: "Cars",
      task: "detect",
      visibility: "private",
      owner: "alice",
    });
    expect(result.summary).toBe(
      `Created dataset 'cars' for owner 'alice' with id '${"a".repeat(24)}' (private).`,
    );
    expect(result.data).toEqual(flatCreate);
  });

  test("sends public visibility, description, and class names when requested", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    const result = await datasetsCreate(client, {
      name: "Cars",
      dataset: "cars",
      task: "detect",
      visibility: "public",
      description: "Detection dataset",
      classNames: ["car", "person"],
    });
    expect(calls[1].body).toEqual({
      dataset: "cars",
      name: "Cars",
      task: "detect",
      visibility: "public",
      owner: "alice",
      description: "Detection dataset",
      classNames: ["car", "person"],
    });
    expect(result.summary).toContain("(public)");
    expect(result.data).toEqual(flatCreate);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = clientForCreate(flatCreate);
    const result = await datasetsCreate(client, {
      name: "Cars",
      dataset: "cars",
      task: "detect",
      owner: "bob",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/datasets",
    ]);
    expect(calls[0].body).toMatchObject({ owner: "bob" });
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("treats a blank owner as omitted", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    await datasetsCreate(client, {
      name: "Cars",
      dataset: "cars",
      task: "detect",
      owner: "   ",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/account/summary",
      "POST /api/datasets",
    ]);
    expect(calls[1].body).toMatchObject({ owner: "alice" });
  });

  test("reports id, owner, and slug from the flat response", async () => {
    const { client } = clientForCreate(
      { id: "c".repeat(24), owner: "bob", dataset: "track", region: "us" },
      { accountOwner: "bob" },
    );
    const result = await datasetsCreate(client, {
      name: "Track",
      dataset: "track",
      task: "detect",
    });
    expect(result.summary).toContain(`'track'`);
    expect(result.summary).toContain(`'bob'`);
    expect(result.summary).toContain("c".repeat(24));
    expect(result.data).toEqual({
      id: "c".repeat(24),
      owner: "bob",
      dataset: "track",
      region: "us",
    });
  });

  test("validates task and dataset before network", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    await expect(
      datasetsCreate(client, { name: "Bad", dataset: "bad", task: "bad-task" }),
    ).rejects.toThrow(/Unsupported dataset task/);
    await expect(
      datasetsCreate(client, { name: "Bad", dataset: "", task: "detect" }),
    ).rejects.toThrow(/`dataset` is required/);
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for invalid visibility", async () => {
    const { client } = clientForCreate(
      { error: 'Invalid option: expected one of "public"|"private"' },
      { accountOwner: "alice", status: 400 },
    );
    await expect(
      datasetsCreate(client, {
        name: "Cars",
        dataset: "cars",
        task: "detect",
        visibility: "secret",
      }),
    ).rejects.toThrow(/Invalid option/);
  });

  test("surfaces the API message for an owner without access", async () => {
    const { client } = clientForCreate(
      { error: "Access denied" },
      { status: 403 },
    );
    await expect(
      datasetsCreate(client, {
        name: "Cars",
        dataset: "cars",
        task: "detect",
        owner: "ghost-owner",
      }),
    ).rejects.toThrow(/Access denied/);
  });

  test("surfaces the API invalid-input error", async () => {
    const { client } = clientForCreate(
      { error: "Invalid input: expected string, received undefined" },
      { accountOwner: "alice", status: 400 },
    );
    await expect(
      datasetsCreate(client, {
        name: "Cars",
        dataset: "cars",
        task: "detect",
        visibility: "private",
      }),
    ).rejects.toThrow(/Invalid input/);
  });
});

describe("datasetExport", () => {
  test("resolves dataset and returns export link", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        downloadUrl: "https://cdn.example.com/data-v3.ndjson",
        cached: false,
      });
    });

    const result = await datasetExport(client, {
      dataset: "user/data",
      version: 3,
    });

    expect(calls[1]).toEqual({
      url: `${BASE}/datasets/${"d".repeat(24)}/export?v=3`,
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe(
      "Export link for user/data (version 3, cached=false)",
    );
    expect(result.data).toEqual({
      downloadUrl: "https://cdn.example.com/data-v3.ndjson",
      cached: false,
    });
  });
});

describe("datasetVersionCreate", () => {
  test("resolves dataset and posts version snapshot payload", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        version: 4,
        downloadUrl: "https://cdn.example.com/data-v4.ndjson",
      });
    });

    const result = await datasetVersionCreate(client, {
      dataset: "user/data",
      description: "Quarterly snapshot",
    });

    expect(calls[1]).toEqual({
      url: `${BASE}/datasets/${"d".repeat(24)}/export`,
      method: "POST",
      body: {
        description: "Quarterly snapshot",
      },
    });
    expect(result.summary).toBe("Created dataset version 4");
    expect(result.data).toEqual({
      version: 4,
      downloadUrl: "https://cdn.example.com/data-v4.ndjson",
    });
  });
});

describe("datasetUploadFolder", () => {
  test("orchestrates folder zip upload and ingest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-dataset-folder-"));
    await writeFile(join(dir, "bird.jpg"), "jpg");
    await writeFile(join(dir, "bird.png"), "png");
    await writeFile(join(dir, ".DS_Store"), "junk");
    await writeFile(join(dir, "notes.txt"), "ignore");
    const nested = join(dir, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "bird.webp"), "webp");

    const uploadCalls: { url: string; init: RequestInit }[] = [];
    const uploadImpl = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({ url: String(url), init });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const apiCalls: { url: string; method: string; body: unknown }[] = [];
    const apiImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      apiCalls.push({
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
          sessionId: "session_123",
          uploadUrl: "https://signed.example/upload",
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

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: apiImpl,
      uploadFetchImpl: uploadImpl,
    });

    const result = await datasetUploadFolder(client, {
      dataset: "user/data",
      folderPath: dir,
      targetSplit: "train",
    });

    expect(apiCalls[1]).toMatchObject({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        contentType: "application/zip",
      },
    });
    expect(uploadCalls[0].url).toBe("https://signed.example/upload");
    expect(
      (uploadCalls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(apiCalls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(apiCalls[3]).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sessionId: "session_123",
        targetSplit: "train",
      },
    });
    expect(result.summary).toContain("Zipped 3 image(s)");
  });

  test("rejects targetSplit when folder already has split dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-dataset-folder-"));
    const trainDir = join(dir, "train");
    await mkdir(trainDir);
    await writeFile(join(trainDir, "bird.jpg"), "jpg");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFolder(client, {
        dataset: "d".repeat(24),
        folderPath: dir,
        targetSplit: "train",
      }),
    ).rejects.toThrow(/Folder has split directories/);
  });
});

describe("datasetUploadVideo", () => {
  test("extracts frames and uploads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");

    const uploadCalls: { url: string; init: RequestInit }[] = [];
    const uploadImpl = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({ url: String(url), init });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const apiCalls: { url: string; method: string; body: unknown }[] = [];
    const apiImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      apiCalls.push({
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
          sessionId: "session_123",
          uploadUrl: "https://signed.example/upload",
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

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: apiImpl,
      uploadFetchImpl: uploadImpl,
    });

    const result = await datasetUploadVideo(client, {
      dataset: "user/data",
      videoPath,
      targetSplit: "train",
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: async ({ outputDir, ffmpegPath, rate, maxFrames }) => {
        expect(ffmpegPath).toBe("/usr/bin/ffmpeg");
        expect(rate).toBe(0.5);
        expect(maxFrames).toBe(100);
        await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
        await writeFile(join(outputDir, "frame_000002.jpg"), "jpg");
        await writeFile(join(outputDir, "frame_000003.jpg"), "jpg");
      },
    });

    expect(apiCalls[1]).toMatchObject({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        filename: "birds.zip",
        contentType: "application/zip",
      },
    });
    expect(uploadCalls[0].url).toBe("https://signed.example/upload");
    expect(
      (uploadCalls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(result.summary).toBe(
      `Extracted 3 frame(s) at ~0.5 fps from ${videoPath}; started ingest job job_123 for dataset ${"d".repeat(24)}.`,
    );
    expect(result.data).toMatchObject({
      datasetId: "d".repeat(24),
      frameCount: 3,
      fps: 1,
      maxFrames: 100,
      filename: "birds.zip",
      sessionId: "session_123",
    });
  });

  test("falls back when probe fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/datasets") {
          return jsonResponse({
            datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
          });
        }
        if (parsed.pathname === "/api/upload/signed-url") {
          return jsonResponse({
            sessionId: "session_123",
            uploadUrl: "https://signed.example/upload",
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
      }) as unknown as typeof fetch,
      uploadFetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });

    const result = await datasetUploadVideo(client, {
      dataset: "user/data",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => {
        throw new Error("boom");
      },
      _extractFrames: async ({ outputDir, rate, maxFrames }) => {
        expect(rate).toBe(1);
        expect(maxFrames).toBe(100);
        await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
      },
    });

    expect(result.summary).toContain("probe fallback");
  });

  test("validates inputs and missing ffmpeg before network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");
    const badPath = join(dir, "birds.txt");
    await writeFile(badPath, "bad");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadVideo(client, { dataset: "d".repeat(24), videoPath: "" }),
    ).rejects.toThrow(/videoPath/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath: join(dir, "missing.mp4"),
      }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath: badPath,
      }),
    ).rejects.toThrow(/Unsupported video file type/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        fps: 0,
      }),
    ).rejects.toThrow(/fps/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        maxFrames: 0,
      }),
    ).rejects.toThrow(/maxFrames/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        _findTool: () => null,
      }),
    ).rejects.toThrow(/ffmpeg\/ffprobe not found on PATH/);
  });
});

describe("datasetsDelete", () => {
  function clientForDelete(
    deleteResponse: unknown,
    options: { accountOwner?: string } = {},
  ) {
    const calls: { path: string; method: string }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      calls.push({
        path: parsed.pathname,
        method: (init.method ?? "GET").toUpperCase(),
      });
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (
        parsed.pathname === "/api/datasets/alice/cars" &&
        (init.method ?? "GET").toUpperCase() === "DELETE"
      ) {
        return jsonResponse(deleteResponse);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });
    return { client, calls };
  }

  test("deletes through the owner-scoped path and reports what the API returns", async () => {
    const { client, calls } = clientForDelete({ success: true });
    const result = await datasetsDelete(client, "alice/cars");
    expect(calls).toEqual([
      { path: "/api/datasets/alice/cars", method: "DELETE" },
    ]);
    expect(result.summary).toBe(
      "Deleted dataset 'cars' for owner 'alice' (soft delete; images and annotations moved to trash with the dataset; models trained on it are unaffected; restorable from trash).",
    );
    expect(result.data).toEqual({
      owner: "alice",
      dataset: "cars",
      success: true,
    });
  });

  test("claims no cascade summary", async () => {
    const { client } = clientForDelete({ success: true });
    const result = await datasetsDelete(client, "alice/cars");
    expect(result.summary).not.toMatch(/model\(s\) removed/i);
    expect(result.summary).not.toMatch(/cascad/i);
    expect(result.data).not.toHaveProperty("cascadedModels");
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForDelete(
      { success: true },
      { accountOwner: "alice" },
    );
    const result = await datasetsDelete(client, "cars");
    expect(calls).toEqual([
      { path: "/api/account/summary", method: "GET" },
      { path: "/api/datasets/alice/cars", method: "DELETE" },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForDelete({ success: true });
    const result = await datasetsDelete(client, "ul://alice/cars");
    expect(calls).toEqual([
      { path: "/api/datasets/alice/cars", method: "DELETE" },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForDelete({ success: true });
    await expect(datasetsDelete(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a dataset that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/datasets/alice/missing") {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(datasetsDelete(client, "alice/missing")).rejects.toThrow(
      /Dataset not found/,
    );
  });

  test("surfaces the API message verbatim for an owner that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/datasets/ghost/cars") {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(datasetsDelete(client, "ghost/cars")).rejects.toThrow(
      /Dataset not found/,
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
  test("sends complete identity class mapping from indexed YOLO names", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, "coco8.zip");
    await writeFile(
      filePath,
      zipSync({
        "data.yaml": strToU8("names:\n  0: person\n  1: bicycle\n"),
      }),
    );

    const { calls, fetchImpl } = captureClient((url) => {
      const path = new URL(url).pathname;
      if (path === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      if (path === "/api/upload/signed-url") {
        return jsonResponse({
          sessionId: "session_123",
          uploadUrl: "https://signed.example/upload",
        });
      }
      return jsonResponse({ jobId: "job_123" });
    });
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });

    await datasetUploadFile(uploadClient, {
      dataset: "user/data",
      filePath,
    });

    expect(calls.at(-1)).toMatchObject({
      body: {
        classMapping: { person: "person", bicycle: "bicycle" },
      },
    });
  });

  test("sends complete identity class mapping from named YOLO ZIP", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, "dataset.ZIP");
    const archive = zipSync({
      "data.yaml": strToU8("names:\n  - person\n  - car\n"),
      "images/large-dummy.jpg": new Uint8Array(1024 * 1024),
    });
    await writeFile(filePath, archive);

    expect(
      Object.keys(
        unzipSync(archive, {
          filter: ({ name }) => /(^|\/)data\.ya?ml$/i.test(name),
        }),
      ),
    ).toEqual(["data.yaml"]);

    const calls: { url: string; method: string; body: unknown }[] = [];
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL, init: RequestInit = {}) => {
        const body =
          typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          body,
        });
        const path = new URL(String(url)).pathname;
        if (path === "/api/datasets") {
          return jsonResponse({
            datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
          });
        }
        if (path === "/api/upload/signed-url") {
          return jsonResponse({
            sessionId: "session_123",
            uploadUrl: "https://signed.example/upload",
          });
        }
        return jsonResponse({ jobId: "job_123" });
      }) as unknown as typeof fetch,
      uploadFetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });

    await datasetUploadFile(client, { dataset: "user/data", filePath });

    expect(calls.at(-1)).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sessionId: "session_123",
        classMapping: { person: "person", car: "car" },
      },
    });
  });

  test("omits class mapping for an archive with no readable YAML metadata", async () => {
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
      `${BASE}/datasets?username=user`,
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
