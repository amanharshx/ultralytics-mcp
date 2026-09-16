import { closeSync, ftruncateSync, openSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  datasetClassStats,
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
  datasetVersionRestore,
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
  test("builds query, joins the task filter, and trims results", async () => {
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

  test("validates q, sort, and offset before network", async () => {
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
  });

  test("passes an unrecognized task filter through to the server rather than rejecting it locally", async () => {
    // No local task allowlist: the server rejects an unrecognized task
    // itself (verified live: `?task=notarealtask` on `/explore/search`
    // returns 400 `"Invalid task filter"`), and it accepts values the old
    // client-side allowlist used to exclude, e.g. `depth` (verified live:
    // `?task=depth` returns 200 with an empty result set).
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/explore/search") {
        return jsonResponse({ datasets: [], hasMore: false });
      }
      return jsonResponse({}, 404);
    });

    await exploreDatasets(client, { q: "bird", task: ["depth"] });

    expect(calls[0]?.url).toBe(
      `${BASE}/explore/search?type=datasets&q=bird&sort=newest&offset=0&task=depth`,
    );
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
  const liveImagesResponse = {
    images: [
      {
        id: "a".repeat(24),
        hash: "omit",
        name: "000000000034",
        ext: "jpg",
        split: "train",
        width: 640,
        height: 425,
        labelCount: 1,
        bytes: 147010,
        thumbnailUrl: "https://cdn.example.com/t-1.webp",
        imageUrl: "https://cdn.example.com/i-1.jpg",
      },
    ],
    total: 4,
    hasMore: false,
    classes: ["Zebra", "Giraffe"],
    errorCount: 0,
  };

  function clientForImagesList(
    response: unknown,
    options: { accountOwner?: string } = {},
  ) {
    return routeClient((path) => {
      if (options.accountOwner && path === "/api/account/summary") {
        return jsonResponse({ username: options.accountOwner });
      }
      return path === "/api/datasets/alice/cars/images"
        ? jsonResponse(response)
        : jsonResponse({}, 404);
    });
  }

  test("fetches through the owner-scoped path and reads live field names", async () => {
    const { client, calls } = clientForImagesList(liveImagesResponse);

    const result = await datasetImagesList(client, {
      dataset: "alice/cars",
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars/images",
    ]);
    expect(result.summary).toBe("1 image(s) (total 4)");
    expect(result.data).toEqual({
      total: 4,
      hasMore: false,
      classes: ["Zebra", "Giraffe"],
      errorCount: 0,
      nextCursor: null,
      images: [
        {
          id: "a".repeat(24),
          name: "000000000034",
          ext: "jpg",
          split: "train",
          width: 640,
          height: 425,
          labelCount: 1,
          bytes: 147010,
          imageUrl: "https://cdn.example.com/i-1.jpg",
          thumbnailUrl: "https://cdn.example.com/t-1.webp",
        },
      ],
    });
  });

  test("surfaces the pagination cursor the live API returns with a limit", async () => {
    const { client } = clientForImagesList({
      images: [],
      total: 4,
      hasMore: true,
      classes: ["Zebra"],
      errorCount: 0,
      nextCursor: "b".repeat(24),
    });
    const result = await datasetImagesList(client, {
      dataset: "alice/cars",
      limit: 1,
    });
    expect(result.data).toMatchObject({
      total: 4,
      hasMore: true,
      nextCursor: "b".repeat(24),
    });
  });

  test.each([
    [{ split: "train" }, "split", "train"],
    [{ search: "000000000034" }, "search", "000000000034"],
    [{ hasLabel: true }, "hasLabel", "true"],
    [{ hasLabel: false }, "hasLabel", "false"],
    [{ classIds: ["0"] }, "classIds", "0"],
    [{ classIds: ["0", "1"] }, "classIds", "0,1"],
    [{ limit: 1 }, "limit", "1"],
    [{ offset: 1 }, "offset", "1"],
    [{ includeImageUrls: true }, "includeImageUrls", "true"],
  ])("passes filter %j as %s", async (filter, key, expected) => {
    const { client, calls } = clientForImagesList(liveImagesResponse);
    await datasetImagesList(client, {
      dataset: "alice/cars",
      ...filter,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/datasets/alice/cars/images");
    expect(calls[0].params.get(key)).toBe(expected);
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForImagesList(liveImagesResponse, {
      accountOwner: "alice",
    });
    const result = await datasetImagesList(client, { dataset: "cars" });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice/cars/images",
    ]);
    expect(result.summary).toBe("1 image(s) (total 4)");
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForImagesList(liveImagesResponse);
    const result = await datasetImagesList(client, {
      dataset: "ul://alice/cars",
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars/images",
    ]);
    expect(result.summary).toBe("1 image(s) (total 4)");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForImagesList(liveImagesResponse);
    await expect(
      datasetImagesList(client, { dataset: "a".repeat(24) }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("returns an empty result with classes and error count for a dataset with no images", async () => {
    const { client } = clientForImagesList({
      images: [],
      total: 0,
      hasMore: false,
      classes: [],
      errorCount: 0,
    });
    const result = await datasetImagesList(client, { dataset: "alice/cars" });
    expect(result.summary).toBe("0 image(s) (total 0)");
    expect(result.data).toEqual({
      total: 0,
      hasMore: false,
      classes: [],
      errorCount: 0,
      nextCursor: null,
      images: [],
    });
  });

  test("omits image URLs the API did not return", async () => {
    const { client } = clientForImagesList({
      images: [
        {
          id: "a".repeat(24),
          name: "000000000034",
          ext: "jpg",
          split: "train",
          width: 640,
          height: 425,
          labelCount: 1,
          bytes: 147010,
          thumbnailUrl: "https://cdn.example.com/t-1.webp",
        },
      ],
      total: 1,
      hasMore: false,
      classes: ["Zebra"],
      errorCount: 0,
    });
    const result = await datasetImagesList(client, { dataset: "alice/cars" });
    expect(result.data).toEqual({
      total: 1,
      hasMore: false,
      classes: ["Zebra"],
      errorCount: 0,
      nextCursor: null,
      images: [
        {
          id: "a".repeat(24),
          name: "000000000034",
          ext: "jpg",
          split: "train",
          width: 640,
          height: 425,
          labelCount: 1,
          bytes: 147010,
          thumbnailUrl: "https://cdn.example.com/t-1.webp",
        },
      ],
    });
  });

  test.each([
    "alice/missing",
    "ghost/cars",
  ])("surfaces the API message for %s", async (ref) => {
    const { client } = routeClient((path) => {
      if (path === `/api/datasets/${ref}/images`) {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(datasetImagesList(client, { dataset: ref })).rejects.toThrow(
      /Dataset not found/,
    );
  });

  test("validates limit and offset before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as typeof fetch,
    });

    await expect(
      datasetImagesList(client, { dataset: "data", limit: 5001 }),
    ).rejects.toThrow(/at most 5000/);
    await expect(
      datasetImagesList(client, { dataset: "data", offset: -1 }),
    ).rejects.toThrow(/greater than or equal to 0/);
  });

  test("passes an unrecognized split through to the server rather than rejecting it locally", async () => {
    // No local split allowlist: the server rejects an unrecognized split
    // itself (verified live: `?split=notarealsplit` on
    // `/datasets/{owner}/{dataset}/images` returns 400 `"Invalid option:
    // expected one of \"train\"|\"val\"|\"test\""`), and that message
    // surfaces verbatim.
    const { client } = routeClient((path) => {
      if (path === "/api/datasets/alice/cars/images") {
        return jsonResponse(
          { error: 'Invalid option: expected one of "train"|"val"|"test"' },
          400,
        );
      }
      return jsonResponse({}, 404);
    });

    await expect(
      datasetImagesList(client, { dataset: "alice/cars", split: "bogus" }),
    ).rejects.toThrow(/Invalid option: expected one of/);
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

  test("validates dataset before network", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    await expect(
      datasetsCreate(client, { name: "Bad", dataset: "", task: "detect" }),
    ).rejects.toThrow(/`dataset` is required/);
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for an unrecognized task rather than rejecting it locally", async () => {
    // No local task allowlist: the server rejects an unrecognized task
    // itself (verified live: `task: "notarealtask"` on `POST /datasets`
    // returns 400 `"Invalid option: expected one of \"detect\"|\"segment\"|
    // \"semantic\"|\"depth\"|\"classify\"|\"pose\"|\"obb\""` — a superset of
    // the removed allowlist, which omitted the valid `depth` task), and that
    // message surfaces verbatim.
    const { client } = clientForCreate(
      {
        error:
          'Invalid option: expected one of "detect"|"segment"|"semantic"|"depth"|"classify"|"pose"|"obb"',
      },
      { accountOwner: "alice", status: 400 },
    );
    await expect(
      datasetsCreate(client, {
        name: "Bad",
        dataset: "bad",
        task: "bad-task",
      }),
    ).rejects.toThrow(/Invalid option: expected one of/);
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
  const liveCurrentResponse = {
    downloadUrl: "https://storage.googleapis.com/example-exports/cars.ndjson",
    cached: false,
  };
  const liveVersionedResponse = {
    downloadUrl:
      "https://storage.googleapis.com/example-exports/version-example/cars-v1.ndjson",
  };

  function clientForExport(
    response: unknown,
    options: { accountOwner?: string; status?: number } = {},
  ) {
    return routeClient((path) => {
      if (options.accountOwner && path === "/api/account/summary") {
        return jsonResponse({ username: options.accountOwner });
      }
      if (path === "/api/datasets/alice/cars/export") {
        return jsonResponse(response, options.status ?? 200);
      }
      return jsonResponse({}, 404);
    });
  }

  function clientForExportError(path: string, message: string) {
    return routeClient((actual) =>
      actual === path
        ? jsonResponse({ error: message }, 404)
        : jsonResponse({}, 404),
    );
  }

  function expectExportPaths(calls: Array<{ path: string }>, paths: string[]) {
    expect(calls.map((call) => call.path)).toEqual(paths);
  }

  test("fetches the current export through the owner-scoped path", async () => {
    const { client, calls } = clientForExport(liveCurrentResponse);

    const result = await datasetExport(client, { dataset: "alice/cars" });

    expectExportPaths(calls, ["/api/datasets/alice/cars/export"]);
    expect(calls[0].params.get("v")).toBeNull();
    expect(result.summary).toBe(
      "Export link for dataset 'cars' for owner 'alice' (version latest, cached=false). " +
        "This link is time-limited and will expire.",
    );
    expect(result.data).toEqual({
      downloadUrl: "https://storage.googleapis.com/example-exports/cars.ndjson",
      cached: false,
    });
  });

  test("requests a specific saved version with ?v and surfaces it", async () => {
    const { client, calls } = clientForExport(liveVersionedResponse);

    const result = await datasetExport(client, {
      dataset: "alice/cars",
      version: 1,
    });

    expectExportPaths(calls, ["/api/datasets/alice/cars/export"]);
    expect(calls[0].params.get("v")).toBe("1");
    expect(result.summary).toBe(
      "Export link for dataset 'cars' for owner 'alice' (version 1). " +
        "This link is time-limited and will expire.",
    );
    expect(result.data).toEqual({
      downloadUrl:
        "https://storage.googleapis.com/example-exports/version-example/cars-v1.ndjson",
      cached: null,
    });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForExport(liveCurrentResponse, {
      accountOwner: "alice",
    });

    const result = await datasetExport(client, { dataset: "cars" });

    expectExportPaths(calls, [
      "/api/account/summary",
      "/api/datasets/alice/cars/export",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForExport(liveCurrentResponse);

    const result = await datasetExport(client, { dataset: "ul://alice/cars" });

    expectExportPaths(calls, ["/api/datasets/alice/cars/export"]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForExport(liveCurrentResponse);
    await expect(
      datasetExport(client, { dataset: "a".repeat(24) }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("validates version before any network call", async () => {
    const { client, calls } = clientForExport(liveCurrentResponse);
    await expect(
      datasetExport(client, { dataset: "alice/cars", version: 0 }),
    ).rejects.toThrow(/`version` must be greater than 0/);
    expect(calls).toHaveLength(0);
  });

  test.each([
    "alice/missing",
    "ghost/cars",
  ])("surfaces the API message for %s", async (ref) => {
    const { client } = clientForExportError(
      `/api/datasets/${ref}/export`,
      "Dataset not found",
    );
    await expect(datasetExport(client, { dataset: ref })).rejects.toThrow(
      /Dataset not found/,
    );
  });

  test("surfaces the API message for a version that does not exist", async () => {
    const { client } = clientForExportError(
      "/api/datasets/alice/cars/export",
      "Version not found",
    );
    await expect(
      datasetExport(client, { dataset: "alice/cars", version: 999999 }),
    ).rejects.toThrow(/Version not found/);
  });
});

describe("datasetClassStats", () => {
  const liveResponse = {
    classes: [
      { classId: 0, count: 10, imageCount: 8 },
      { classId: 1, count: 5, imageCount: 5 },
    ],
    imageStats: {
      widthHistogram: [{ bin: 600, count: 12, size: 100 }],
      heightHistogram: [{ bin: 600, count: 12, size: 100 }],
      pointsHistogram: [],
      formatDistribution: { jpg: 12 },
      fileSizeHistogram: [{ bin: 0, count: 12, size: 100000 }],
      objectsPerImageHistogram: [{ bin: 0, count: 12, size: 2 }],
      bboxWidthHistogram: [],
      bboxHeightHistogram: [],
      bboxWidthNormHistogram: [],
      bboxHeightNormHistogram: [],
    },
    locationHeatmap: { bins: [[0]], maxCount: 0 },
    dimensionHeatmap: {
      bins: [[12]],
      maxCount: 12,
      minWidth: 640,
      maxWidth: 640,
      minHeight: 640,
      maxHeight: 640,
    },
    classNames: ["car", "truck"],
    cached: true,
  };

  function clientForClassStats(
    response: unknown,
    options: { accountOwner?: string } = {},
  ) {
    return routeClient((path) => {
      if (options.accountOwner && path === "/api/account/summary") {
        return jsonResponse({ username: options.accountOwner });
      }
      if (path === "/api/datasets/alice/cars/class-stats") {
        return jsonResponse(response);
      }
      return jsonResponse({}, 404);
    });
  }

  test("default omits the histogram and heatmap groups, naming them in the summary", async () => {
    const { client, calls } = clientForClassStats(liveResponse);

    const result = await datasetClassStats(client, { dataset: "alice/cars" });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars/class-stats",
    ]);
    expect(result.summary).toBe(
      "Class stats for dataset 'cars' for owner 'alice': 2 class(es), " +
        "15 total annotation(s). Omitted histogram/heatmap groups " +
        "(pass include_histograms: true to include): widthHistogram, " +
        "heightHistogram, pointsHistogram, formatDistribution, " +
        "fileSizeHistogram, objectsPerImageHistogram, bboxWidthHistogram, " +
        "bboxHeightHistogram, bboxWidthNormHistogram, bboxHeightNormHistogram, " +
        "locationHeatmap, dimensionHeatmap.",
    );
    expect(result.data).toEqual({
      classes: liveResponse.classes,
      classNames: liveResponse.classNames,
      cached: true,
      sampleSize: null,
    });
  });

  test("include_histograms passes the server payload through unmodified", async () => {
    const { client } = clientForClassStats(liveResponse);

    const result = await datasetClassStats(client, {
      dataset: "alice/cars",
      includeHistograms: true,
    });

    expect(result.summary).toBe(
      "Class stats for dataset 'cars' for owner 'alice': 2 class(es), " +
        "15 total annotation(s). Full histogram and heatmap payload included.",
    );
    expect(result.data).toEqual(liveResponse);
  });

  test("a dataset with no annotations reports zero counts without throwing", async () => {
    const emptyResponse = {
      ...liveResponse,
      classes: [{ classId: 0, count: 0, imageCount: 0 }],
      classNames: ["fish"],
      cached: false,
    };
    const { client } = clientForClassStats(emptyResponse);

    const result = await datasetClassStats(client, { dataset: "alice/cars" });

    expect(result.summary).toContain("1 class(es), 0 total annotation(s)");
    expect(result.data).toEqual({
      classes: [{ classId: 0, count: 0, imageCount: 0 }],
      classNames: ["fish"],
      cached: false,
      sampleSize: null,
    });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForClassStats(liveResponse, {
      accountOwner: "alice",
    });

    const result = await datasetClassStats(client, { dataset: "cars" });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice/cars/class-stats",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForClassStats(liveResponse);
    await expect(
      datasetClassStats(client, { dataset: "a".repeat(24) }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });
});

describe("datasetVersionCreate", () => {
  const liveDownloadUrl =
    "https://storage.googleapis.com/example-bucket/exports/example-id/example-dataset-1-v1.ndjson";
  const liveNewResponse = {
    version: 1,
    downloadUrl: liveDownloadUrl,
    reused: false,
  };
  const liveReusedResponse = {
    version: 1,
    downloadUrl: liveDownloadUrl,
    reused: true,
  };

  function clientForVersionCreate(
    response: unknown,
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
        parsed.pathname === "/api/datasets/alice/cars/export" &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        return jsonResponse(response, options.status ?? 200);
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

  test("creates a version through the owner-scoped path and reports it", async () => {
    const { client, calls } = clientForVersionCreate(liveNewResponse);

    const result = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });

    expect(calls).toEqual([
      { path: "/api/datasets/alice/cars/export", method: "POST", body: {} },
    ]);
    expect(result.summary).toBe(
      "Created dataset version 1 for dataset 'cars' for owner 'alice'. " +
        "This link is time-limited and will expire.",
    );
    expect(result.data).toEqual({
      version: 1,
      downloadUrl:
        "https://storage.googleapis.com/example-bucket/exports/example-id/example-dataset-1-v1.ndjson",
      reused: false,
    });
  });

  test("sends the description when provided", async () => {
    const { client, calls } = clientForVersionCreate(liveNewResponse);

    const result = await datasetVersionCreate(client, {
      dataset: "alice/cars",
      description: "Quarterly snapshot",
    });

    expect(calls).toEqual([
      {
        path: "/api/datasets/alice/cars/export",
        method: "POST",
        body: { description: "Quarterly snapshot" },
      },
    ]);
    expect(result.data).toMatchObject({ version: 1, reused: false });
  });

  test("reports an unchanged dataset without claiming a new version", async () => {
    const { client, calls } = clientForVersionCreate(liveReusedResponse);

    const result = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });

    expect(calls).toEqual([
      { path: "/api/datasets/alice/cars/export", method: "POST", body: {} },
    ]);
    expect(result.summary).toBe(
      "Dataset version 1 for dataset 'cars' for owner 'alice' already existed " +
        "(no changes since the previous snapshot). " +
        "This link is time-limited and will expire.",
    );
    expect(result.summary).not.toMatch(/Created/);
    expect(result.data).toEqual({
      version: 1,
      downloadUrl:
        "https://storage.googleapis.com/example-bucket/exports/example-id/example-dataset-1-v1.ndjson",
      reused: true,
    });
  });

  test("does not claim a new version when the reuse flag is missing", async () => {
    const { client } = clientForVersionCreate({
      version: 1,
      downloadUrl:
        "https://storage.googleapis.com/example-bucket/exports/example-id/example-dataset-1-v1.ndjson",
    });

    const result = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });

    expect(result.summary).toBe(
      "Dataset version 1 for dataset 'cars' for owner 'alice'. " +
        "This link is time-limited and will expire.",
    );
    expect(result.summary).not.toMatch(/Created/);
    expect(result.data).toEqual({
      version: 1,
      downloadUrl:
        "https://storage.googleapis.com/example-bucket/exports/example-id/example-dataset-1-v1.ndjson",
      reused: null,
    });
  });

  test("returns the same version when created twice with no changes", async () => {
    let posts = 0;
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      if (
        parsed.pathname === "/api/datasets/alice/cars/export" &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        posts += 1;
        return jsonResponse(posts === 1 ? liveNewResponse : liveReusedResponse);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    const first = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });
    const second = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });

    expect(first.data).toMatchObject({ version: 1, reused: false });
    expect(second.data).toMatchObject({ version: 1, reused: true });
    expect(second.data).toMatchObject({ version: first.data.version });
    expect(first.summary).toMatch(/Created/);
    expect(second.summary).not.toMatch(/Created/);
  });

  test("the created version downloads through the export tool", async () => {
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      const method = (init.method ?? "GET").toUpperCase();
      if (
        parsed.pathname === "/api/datasets/alice/cars/export" &&
        method === "POST"
      ) {
        return jsonResponse(liveNewResponse);
      }
      if (
        parsed.pathname === "/api/datasets/alice/cars/export" &&
        method === "GET"
      ) {
        expect(parsed.searchParams.get("v")).toBe("1");
        return jsonResponse({ downloadUrl: liveDownloadUrl, version: 1 });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    const created = await datasetVersionCreate(client, {
      dataset: "alice/cars",
    });
    const exported = await datasetExport(client, {
      dataset: "alice/cars",
      version: created.data.version as number,
    });

    expect(created.data).toMatchObject({ version: 1 });
    expect(exported.summary).toContain("(version 1)");
    expect(exported.data).toMatchObject({ downloadUrl: liveDownloadUrl });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForVersionCreate(liveNewResponse, {
      accountOwner: "alice",
    });

    const result = await datasetVersionCreate(client, { dataset: "cars" });

    expect(calls).toEqual([
      { path: "/api/account/summary", method: "GET", body: undefined },
      { path: "/api/datasets/alice/cars/export", method: "POST", body: {} },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForVersionCreate(liveNewResponse);

    const result = await datasetVersionCreate(client, {
      dataset: "ul://alice/cars",
    });

    expect(calls).toEqual([
      { path: "/api/datasets/alice/cars/export", method: "POST", body: {} },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForVersionCreate(liveNewResponse);
    await expect(
      datasetVersionCreate(client, { dataset: "a".repeat(24) }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test.each([
    "alice/missing",
    "ghost/cars",
  ])("surfaces the API message for %s", async (ref) => {
    const calls: { path: string; method: string }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      calls.push({
        path: parsed.pathname,
        method: (init.method ?? "GET").toUpperCase(),
      });
      if (
        parsed.pathname === `/api/datasets/${ref}/export` &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });
    await expect(
      datasetVersionCreate(client, { dataset: ref }),
    ).rejects.toThrow(/Dataset not found/);
  });

  test("surfaces the API message when the dataset is not ready", async () => {
    const { client } = clientForVersionCreate(
      { error: "Dataset must be ready to create a version" },
      { status: 409 },
    );
    await expect(
      datasetVersionCreate(client, { dataset: "alice/cars" }),
    ).rejects.toThrow(/Dataset must be ready to create a version/);
  });
});

describe("datasetVersionRestore", () => {
  function clientForVersionRestore(
    response: unknown,
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
        parsed.pathname === "/api/datasets/alice/cars/restore" &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        return jsonResponse(response, options.status ?? 200);
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

  test("restores by dataset ref and version, sending the version and surfacing the response verbatim", async () => {
    const { client, calls } = clientForVersionRestore({
      version: 1,
      imageCount: 8,
    });

    const result = await datasetVersionRestore(client, {
      dataset: "alice/cars",
      version: 1,
    });

    expect(calls).toEqual([
      {
        path: "/api/datasets/alice/cars/restore",
        method: "POST",
        body: { version: 1 },
      },
    ]);
    expect(result.data).toEqual({ version: 1, imageCount: 8 });
  });

  test("summary states the image-ID reassignment trap", async () => {
    const { client } = clientForVersionRestore({ version: 1, imageCount: 8 });

    const result = await datasetVersionRestore(client, {
      dataset: "alice/cars",
      version: 1,
    });

    expect(result.summary).toMatch(/image ids? (were|are) reassigned/i);
    expect(result.summary).toMatch(/re-list/i);
  });

  test("fills a missing owner from the account summary", async () => {
    const { client, calls } = clientForVersionRestore(
      { version: 1, imageCount: 8 },
      { accountOwner: "alice" },
    );

    const result = await datasetVersionRestore(client, {
      dataset: "cars",
      version: 1,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice/cars/restore",
    ]);
    expect(result.summary).toContain("owner 'alice'");
  });

  test("surfaces the server's message for an invalid or nonexistent version", async () => {
    const { client } = clientForVersionRestore(
      { error: "Version not found" },
      { status: 404 },
    );

    await expect(
      datasetVersionRestore(client, { dataset: "alice/cars", version: 99 }),
    ).rejects.toThrow("Version not found");
  });

  test("surfaces the server's message for an out-of-range version", async () => {
    const { client } = clientForVersionRestore(
      { error: "Invalid version" },
      { status: 400 },
    );

    await expect(
      datasetVersionRestore(client, { dataset: "alice/cars", version: 0 }),
    ).rejects.toThrow("Invalid version");
  });
});

describe("datasetUploadFolder", () => {
  const liveJobId = "c".repeat(24);
  const liveDatasetId = "a".repeat(24);
  const liveSignedHeaders = { "x-goog-if-generation-match": "0" };
  const liveSignedResponse = {
    sessionId: "session_123",
    uploadUrl: "https://signed.example/upload",
    expiresAt: "2026-09-12T04:00:00.000Z",
    headers: liveSignedHeaders,
  };
  const liveCompleteResponse = {
    success: true,
    file: { size: 1234, contentType: "application/zip" },
  };
  const liveIngestResponse = { jobId: liveJobId, status: "queued" };
  const liveDatasetWithStatus = {
    dataset: {
      id: liveDatasetId,
      owner: "alice",
      dataset: "cars",
      name: "Cars",
      visibility: "private",
      task: "detect",
      imageCount: 0,
      status: "processing",
      lastIngestJobId: null,
      lastIngestSummary: null,
      processingError: null,
      errorCount: 0,
    },
  };

  async function writeImageFolder(
    files: Record<string, string> = {
      "bird.jpg": "jpg",
      "bird.png": "png",
      "nested/bird.webp": "webp",
    },
  ) {
    const dir = await mkdtemp(join(tmpdir(), "ul-dataset-folder-"));
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(dir, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    return dir;
  }

  function clientForFolderUpload(
    options: {
      datasetResponse?: unknown;
      signedResponse?: unknown;
      completeResponse?: unknown;
      completeStatus?: number;
      ingestResponse?: unknown;
      ingestStatus?: number;
      accountOwner?: string;
      uploadImpl?: typeof fetch;
      onUpload?: (headers: Headers, url: string) => void;
      failStatusLookup?: boolean;
    } = {},
  ) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const uploadCalls: Array<{
      url: string;
      method: string;
      contentType: string | null;
      contentLength: string | null;
      generationMatch: string | null;
      auth: string | null;
    }> = [];
    const signedResponse = options.signedResponse ?? liveSignedResponse;
    let datasetGets = 0;
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
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (parsed.pathname === "/api/datasets/alice/cars") {
        datasetGets += 1;
        if (options.failStatusLookup && datasetGets > 1) {
          return jsonResponse({ error: "Server error" }, 500);
        }
        if (datasetGets === 1) {
          const first = options.datasetResponse ?? {
            dataset: { id: liveDatasetId, owner: "alice", dataset: "cars" },
          };
          return jsonResponse(first);
        }
        return jsonResponse(options.datasetResponse ?? liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse(signedResponse);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse(
          options.completeResponse ?? liveCompleteResponse,
          options.completeStatus ?? 200,
        );
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(
          options.ingestResponse ?? liveIngestResponse,
          options.ingestStatus ?? 201,
        );
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch =
      options.uploadImpl ??
      ((async (url: string | URL, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        options.onUpload?.(headers, String(url));
        uploadCalls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          contentType: headers.get("Content-Type"),
          contentLength: headers.get("Content-Length"),
          generationMatch: headers.get("x-goog-if-generation-match"),
          auth: headers.get("Authorization"),
        });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch);
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });
    return { client: uploadClient, calls, uploadCalls };
  }

  function findIngestCall(calls: { url: string; body: unknown }[]) {
    return calls.find((call) =>
      call.url.endsWith("/datasets/alice/cars/ingest"),
    );
  }

  test("uploads through the owner-scoped flow with both storage headers and reports ingest status", async () => {
    const dir = await writeImageFolder();
    const { client, calls, uploadCalls } = clientForFolderUpload();
    const result = await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
      targetSplit: "train",
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
    const signedCall = calls[1];
    expect(signedCall.method).toBe("POST");
    expect(signedCall.body).toMatchObject({
      assetType: "datasets",
      assetId: liveDatasetId,
      contentType: "application/zip",
    });
    expect(typeof (signedCall.body as Record<string, unknown>).filename).toBe(
      "string",
    );
    expect(
      (
        (signedCall.body as Record<string, unknown>).filename as string
      ).endsWith(".zip"),
    ).toBe(true);
    expect(typeof (signedCall.body as Record<string, unknown>).totalBytes).toBe(
      "number",
    );
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      url: "https://signed.example/upload",
      method: "PUT",
      contentType: "application/zip",
      generationMatch: "0",
      auth: null,
    });
    expect(calls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(calls[3]).toEqual({
      url: `${BASE}/datasets/alice/cars/ingest`,
      method: "POST",
      body: {
        sessionId: "session_123",
        conflictPolicy: "skip",
        targetSplit: "train",
      },
    });
    expect(result.summary).toContain("Zipped 3 image(s)");
    expect(result.summary).toContain(liveJobId);
    expect(result.summary).toContain("datasets_get");
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      status: "queued",
      conflictPolicy: "skip",
      targetSplit: "train",
      owner: "alice",
      dataset: "cars",
      datasetStatus: "processing",
      imageCount: 3,
      sessionId: "session_123",
    });
    expect(typeof (result.data as Record<string, unknown>).bytes).toBe(
      "number",
    );
  });

  test("keeps client-side zipping filters: skips dotfiles and non-images", async () => {
    const dir = await writeImageFolder({
      "bird.jpg": "jpg",
      ".DS_Store": "junk",
      "notes.txt": "ignore",
      ".hidden/secret.jpg": "hidden",
      "nested/bird.webp": "webp",
    });
    const seenBodies: Uint8Array[] = [];
    const { client } = clientForFolderUpload({
      onUpload: undefined,
      uploadImpl: (async (_url: string | URL, init: RequestInit = {}) => {
        seenBodies.push(
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const result = await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
    });
    expect(result.data).toMatchObject({ imageCount: 2 });
    expect(seenBodies).toHaveLength(1);
    const { unzipSync } = await import("fflate");
    const files = Object.keys(unzipSync(seenBodies[0])).sort();
    expect(files).toEqual(["bird.jpg", "nested/bird.webp"]);
  });

  test("sends an explicit replace policy and omits targetSplit when absent", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    const result = await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
      conflictPolicy: "replace",
    });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toEqual({
      sessionId: "session_123",
      conflictPolicy: "replace",
    });
    expect(result.data).toMatchObject({
      conflictPolicy: "replace",
      targetSplit: null,
    });
  });

  test("sends the keep_both policy the live API accepts", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    const result = await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
      conflictPolicy: "keep_both",
    });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toMatchObject({ conflictPolicy: "keep_both" });
    expect(result.data).toMatchObject({ conflictPolicy: "keep_both" });
  });

  test("never sends class mapping, image metadata, or a dataset id to ingest", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
    });
    const ingestCall = findIngestCall(calls);
    // Without targetSplit the ingest payload carries only the session and policy.
    expect(ingestCall?.body).toEqual({
      sessionId: "session_123",
      conflictPolicy: "skip",
    });
  });

  test("starts a fresh signed-url session when the first upload fails", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const signedResponses = [
      {
        sessionId: "session_old",
        uploadUrl: "https://signed.example/old",
        expiresAt: "2026-09-12T04:00:00.000Z",
        headers: liveSignedHeaders,
      },
      {
        sessionId: "session_new",
        uploadUrl: "https://signed.example/new",
        expiresAt: "2026-09-12T04:01:00.000Z",
        headers: liveSignedHeaders,
      },
    ];
    let signedCount = 0;
    const putUrls: string[] = [];
    const calls: { url: string; method: string; body: unknown }[] = [];
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
      if (parsed.pathname === "/api/datasets/alice/cars") {
        return jsonResponse(liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse(signedResponses[Math.min(signedCount++, 1)]);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse(liveCompleteResponse);
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(liveIngestResponse, 201);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch = (async () => {
      putUrls.push("called");
      if (putUrls.length === 1) {
        return new Response("precondition failed", { status: 412 });
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    // Track URLs separately since the body is consumed on retry.
    const seenUrls: string[] = [];
    const trackingUploadFetch = (async (
      url: string | URL,
      init: RequestInit = {},
    ) => {
      seenUrls.push(String(url));
      return (
        uploadFetch as (u: string | URL, i: RequestInit) => Promise<Response>
      )(url, init);
    }) as unknown as typeof fetch;
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: trackingUploadFetch,
    });

    const result = await datasetUploadFolder(uploadClient, {
      dataset: "alice/cars",
      folderPath: dir,
    });

    expect(seenUrls).toEqual([
      "https://signed.example/old",
      "https://signed.example/new",
    ]);
    const completeCall = calls.find((call) =>
      call.url.endsWith("/upload/complete"),
    );
    expect(completeCall?.body).toEqual({ sessionId: "session_new" });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toMatchObject({ sessionId: "session_new" });
    expect(result.data).toMatchObject({ sessionId: "session_new" });
  });

  test("completes the upload session before starting ingest, in order", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
  });

  test("never starts ingest when completion is rejected", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload({
      completeResponse: {
        error:
          "Upload session not ready (status: pending). Call /api/upload/complete first.",
      },
      completeStatus: 400,
    });
    await expect(
      datasetUploadFolder(client, {
        dataset: "alice/cars",
        folderPath: dir,
      }),
    ).rejects.toThrow(/Upload session not ready/);
    expect(
      calls.some((call) => call.url.endsWith("/datasets/alice/cars/ingest")),
    ).toBe(false);
  });

  test("still returns the job id when the status lookup fails", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload({ failStatusLookup: true });
    const result = await datasetUploadFolder(client, {
      dataset: "alice/cars",
      folderPath: dir,
    });
    expect(
      calls.filter((call) => call.url === `${BASE}/datasets/alice/cars`),
    ).toHaveLength(2);
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      datasetStatus: null,
      lastIngestJobId: null,
    });
    expect(result.summary).toContain("status lookup failed");
    expect(result.summary).toContain("datasets_get");
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload({ accountOwner: "alice" });
    const result = await datasetUploadFolder(client, {
      dataset: "cars",
      folderPath: dir,
    });
    expect(calls[0].url).toBe(`${BASE}/account/summary`);
    expect(calls[1].url).toBe(`${BASE}/datasets/alice/cars`);
    expect(result.data).toMatchObject({ owner: "alice", dataset: "cars" });
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    const result = await datasetUploadFolder(client, {
      dataset: "ul://alice/cars",
      folderPath: dir,
    });
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "GET /api/datasets/alice/cars",
      "POST /api/upload/signed-url",
      "POST /api/upload/complete",
      "POST /api/datasets/alice/cars/ingest",
      "GET /api/datasets/alice/cars",
    ]);
    expect(result.data).toMatchObject({ owner: "alice" });
  });

  test("rejects a bare id without any network call", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client, calls } = clientForFolderUpload();
    await expect(
      datasetUploadFolder(client, {
        dataset: "a".repeat(24),
        folderPath: dir,
      }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
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
        dataset: "alice/cars",
        folderPath: dir,
        targetSplit: "train",
      }),
    ).rejects.toThrow(/Folder has split directories/);
  });

  test("validates folder path before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFolder(client, {
        dataset: "alice/cars",
        folderPath: "",
      }),
    ).rejects.toThrow(/`folderPath` is required/);
    await expect(
      datasetUploadFolder(client, {
        dataset: "alice/cars",
        folderPath: join(tmpdir(), "missing-folder-xyz"),
      }),
    ).rejects.toThrow(/does not exist/);
  });

  test("surfaces the API message for an unrecognized targetSplit or conflictPolicy rather than rejecting locally", async () => {
    // No local targetSplit/conflictPolicy allowlist: the server rejects
    // unrecognized values itself (verified live: both return 400
    // `"Invalid input"` on `/datasets/{owner}/{dataset}/ingest`), and that
    // message surfaces verbatim.
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client: badSplitClient } = clientForFolderUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadFolder(badSplitClient, {
        dataset: "alice/cars",
        folderPath: dir,
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Invalid input/);

    const { client: badPolicyClient } = clientForFolderUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadFolder(badPolicyClient, {
        dataset: "alice/cars",
        folderPath: dir,
        conflictPolicy: "bogus",
      }),
    ).rejects.toThrow(/Invalid input/);
  });

  test("surfaces the API message for a missing dataset", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const missingClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/datasets/alice/missing") {
          return jsonResponse({ error: "Dataset not found" }, 404);
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetUploadFolder(missingClient, {
        dataset: "alice/missing",
        folderPath: dir,
      }),
    ).rejects.toThrow(/Dataset not found/);
  });

  test("errors when the dataset record has no id for the signed-url step", async () => {
    const dir = await writeImageFolder({ "bird.jpg": "jpg" });
    const { client } = clientForFolderUpload({
      datasetResponse: { dataset: { owner: "alice", dataset: "cars" } },
    });
    await expect(
      datasetUploadFolder(client, {
        dataset: "alice/cars",
        folderPath: dir,
      }),
    ).rejects.toThrow(/did not include an id/);
  });
});

describe("datasetUploadVideo", () => {
  const liveJobId = "c".repeat(24);
  const liveDatasetId = "a".repeat(24);
  const liveSignedHeaders = { "x-goog-if-generation-match": "0" };
  const liveSignedResponse = {
    sessionId: "session_123",
    uploadUrl: "https://signed.example/upload",
    expiresAt: "2026-09-12T04:00:00.000Z",
    headers: liveSignedHeaders,
  };
  const liveCompleteResponse = {
    success: true,
    file: { size: 1234, contentType: "application/zip" },
  };
  const liveIngestResponse = { jobId: liveJobId, status: "queued" };
  const liveDatasetWithStatus = {
    dataset: {
      id: liveDatasetId,
      owner: "alice",
      dataset: "cars",
      name: "Cars",
      visibility: "private",
      task: "detect",
      imageCount: 0,
      status: "processing",
      lastIngestJobId: null,
      lastIngestSummary: null,
      processingError: null,
      errorCount: 0,
    },
  };

  async function writeVideoFile(name = "birds.mp4"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, name);
    await writeFile(videoPath, "video");
    return videoPath;
  }

  function writeThreeFrames() {
    return async ({
      outputDir,
      ffmpegPath,
      rate,
      maxFrames,
    }: {
      outputDir: string;
      ffmpegPath: string;
      rate: number;
      maxFrames: number;
    }) => {
      expect(ffmpegPath).toBe("/usr/bin/ffmpeg");
      expect(rate).toBe(0.5);
      expect(maxFrames).toBe(100);
      await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
      await writeFile(join(outputDir, "frame_000002.jpg"), "jpg");
      await writeFile(join(outputDir, "frame_000003.jpg"), "jpg");
    };
  }

  function writeSingleFrame() {
    return async ({ outputDir }: { outputDir: string }) => {
      await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
    };
  }

  function clientForVideoUpload(
    options: {
      datasetResponse?: unknown;
      signedResponse?: unknown;
      completeResponse?: unknown;
      completeStatus?: number;
      ingestResponse?: unknown;
      ingestStatus?: number;
      accountOwner?: string;
      uploadImpl?: typeof fetch;
      failStatusLookup?: boolean;
      signedResponses?: unknown[];
    } = {},
  ) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const uploadCalls: Array<{
      url: string;
      method: string;
      contentType: string | null;
      contentLength: string | null;
      generationMatch: string | null;
      auth: string | null;
    }> = [];
    const signedResponse = options.signedResponse ?? liveSignedResponse;
    let datasetGets = 0;
    let signedCount = 0;
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
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (parsed.pathname === "/api/datasets/alice/cars") {
        datasetGets += 1;
        if (options.failStatusLookup && datasetGets > 1) {
          return jsonResponse({ error: "Server error" }, 500);
        }
        if (datasetGets === 1) {
          const first = options.datasetResponse ?? {
            dataset: { id: liveDatasetId, owner: "alice", dataset: "cars" },
          };
          return jsonResponse(first);
        }
        return jsonResponse(options.datasetResponse ?? liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        if (options.signedResponses !== undefined) {
          const next =
            options.signedResponses[
              Math.min(signedCount++, options.signedResponses.length - 1)
            ];
          return jsonResponse(next);
        }
        return jsonResponse(signedResponse);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse(
          options.completeResponse ?? liveCompleteResponse,
          options.completeStatus ?? 200,
        );
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(
          options.ingestResponse ?? liveIngestResponse,
          options.ingestStatus ?? 201,
        );
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch =
      options.uploadImpl ??
      ((async (url: string | URL, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        uploadCalls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          contentType: headers.get("Content-Type"),
          contentLength: headers.get("Content-Length"),
          generationMatch: headers.get("x-goog-if-generation-match"),
          auth: headers.get("Authorization"),
        });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch);
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });
    return { client: uploadClient, calls, uploadCalls };
  }

  function findIngestCall(calls: { url: string; body: unknown }[]) {
    return calls.find((call) =>
      call.url.endsWith("/datasets/alice/cars/ingest"),
    );
  }

  test("uploads extracted frames through the owner-scoped flow with both storage headers and reports ingest status", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls, uploadCalls } = clientForVideoUpload();
    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      targetSplit: "train",
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeThreeFrames(),
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
    const signedCall = calls[1];
    expect(signedCall.method).toBe("POST");
    expect(signedCall.body).toMatchObject({
      assetType: "datasets",
      assetId: liveDatasetId,
      filename: "birds.zip",
      contentType: "application/zip",
    });
    expect(typeof (signedCall.body as Record<string, unknown>).totalBytes).toBe(
      "number",
    );
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      url: "https://signed.example/upload",
      method: "PUT",
      contentType: "application/zip",
      generationMatch: "0",
      auth: null,
    });
    expect(calls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(calls[3]).toEqual({
      url: `${BASE}/datasets/alice/cars/ingest`,
      method: "POST",
      body: {
        sessionId: "session_123",
        conflictPolicy: "skip",
        targetSplit: "train",
      },
    });
    expect(result.summary).toContain("Extracted 3 frame(s)");
    expect(result.summary).toContain(liveJobId);
    expect(result.summary).toContain("datasets_get");
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      status: "queued",
      conflictPolicy: "skip",
      targetSplit: "train",
      owner: "alice",
      dataset: "cars",
      datasetStatus: "processing",
      frameCount: 3,
      fps: 1,
      maxFrames: 100,
      filename: "birds.zip",
      sessionId: "session_123",
    });
    expect(typeof (result.data as Record<string, unknown>).bytes).toBe(
      "number",
    );
  });

  test("falls back when probe fails", async () => {
    const videoPath = await writeVideoFile();
    const { client } = clientForVideoUpload();

    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
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
    expect(result.summary).toContain("datasets_get");
    expect(result.data).toMatchObject({
      owner: "alice",
      dataset: "cars",
      frameCount: 1,
      jobId: liveJobId,
    });
  });

  test("sends an explicit replace policy and omits targetSplit when absent", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      conflictPolicy: "replace",
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toEqual({
      sessionId: "session_123",
      conflictPolicy: "replace",
    });
    expect(result.data).toMatchObject({
      conflictPolicy: "replace",
      targetSplit: null,
    });
  });

  test("sends the keep_both policy the live API accepts", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      conflictPolicy: "keep_both",
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toMatchObject({ conflictPolicy: "keep_both" });
    expect(result.data).toMatchObject({ conflictPolicy: "keep_both" });
  });

  test("never sends class mapping, image metadata, or a dataset id to ingest", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    const ingestCall = findIngestCall(calls);
    // Without targetSplit the ingest payload carries only the session and policy.
    expect(ingestCall?.body).toEqual({
      sessionId: "session_123",
      conflictPolicy: "skip",
    });
  });

  test("starts a fresh signed-url session when the first upload fails", async () => {
    const videoPath = await writeVideoFile();
    const seenUrls: string[] = [];
    let putCount = 0;
    const failFirstUpload = (async (url: string | URL) => {
      seenUrls.push(String(url));
      putCount += 1;
      if (putCount === 1) {
        return new Response("precondition failed", { status: 412 });
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const { client, calls } = clientForVideoUpload({
      signedResponses: [
        {
          sessionId: "session_old",
          uploadUrl: "https://signed.example/old",
          expiresAt: "2026-09-12T04:00:00.000Z",
          headers: liveSignedHeaders,
        },
        {
          sessionId: "session_new",
          uploadUrl: "https://signed.example/new",
          expiresAt: "2026-09-12T04:01:00.000Z",
          headers: liveSignedHeaders,
        },
      ],
      uploadImpl: failFirstUpload,
    });

    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });

    expect(seenUrls).toEqual([
      "https://signed.example/old",
      "https://signed.example/new",
    ]);
    const completeCall = calls.find((call) =>
      call.url.endsWith("/upload/complete"),
    );
    expect(completeCall?.body).toEqual({ sessionId: "session_new" });
    const ingestCall = findIngestCall(calls);
    expect(ingestCall?.body).toMatchObject({ sessionId: "session_new" });
    expect(result.data).toMatchObject({ sessionId: "session_new" });
  });

  test("completes the upload session before starting ingest, in order", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
  });

  test("never starts ingest when completion is rejected", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload({
      completeResponse: {
        error:
          "Upload session not ready (status: pending). Call /api/upload/complete first.",
      },
      completeStatus: 400,
    });
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath,
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/Upload session not ready/);
    expect(
      calls.some((call) => call.url.endsWith("/datasets/alice/cars/ingest")),
    ).toBe(false);
  });

  test("still returns the job id when the status lookup fails", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload({ failStatusLookup: true });
    const result = await datasetUploadVideo(client, {
      dataset: "alice/cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    expect(
      calls.filter((call) => call.url === `${BASE}/datasets/alice/cars`),
    ).toHaveLength(2);
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      datasetStatus: null,
      lastIngestJobId: null,
    });
    expect(result.summary).toContain("status lookup failed");
    expect(result.summary).toContain("datasets_get");
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload({ accountOwner: "alice" });
    const result = await datasetUploadVideo(client, {
      dataset: "cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    expect(calls[0].url).toBe(`${BASE}/account/summary`);
    expect(calls[1].url).toBe(`${BASE}/datasets/alice/cars`);
    expect(result.data).toMatchObject({ owner: "alice", dataset: "cars" });
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    const result = await datasetUploadVideo(client, {
      dataset: "ul://alice/cars",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: writeSingleFrame(),
    });
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "GET /api/datasets/alice/cars",
      "POST /api/upload/signed-url",
      "POST /api/upload/complete",
      "POST /api/datasets/alice/cars/ingest",
      "GET /api/datasets/alice/cars",
    ]);
    expect(result.data).toMatchObject({ owner: "alice" });
  });

  test("rejects a bare id without any network call", async () => {
    const videoPath = await writeVideoFile();
    const { client, calls } = clientForVideoUpload();
    await expect(
      datasetUploadVideo(client, {
        dataset: "a".repeat(24),
        videoPath,
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
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
      datasetUploadVideo(client, { dataset: "alice/cars", videoPath: "" }),
    ).rejects.toThrow(/videoPath/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath: join(dir, "missing.mp4"),
      }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath: badPath,
      }),
    ).rejects.toThrow(/Unsupported video file type/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath,
        fps: 0,
      }),
    ).rejects.toThrow(/fps/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath,
        maxFrames: 0,
      }),
    ).rejects.toThrow(/maxFrames/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath,
        _findTool: () => null,
      }),
    ).rejects.toThrow(/ffmpeg\/ffprobe not found on PATH/);
  });

  test("surfaces the API message for an unrecognized targetSplit or conflictPolicy rather than rejecting locally", async () => {
    // No local targetSplit/conflictPolicy allowlist: the server rejects
    // unrecognized values itself (verified live: both return 400
    // `"Invalid input"` on `/datasets/{owner}/{dataset}/ingest`), and that
    // message surfaces verbatim.
    const videoPath = await writeVideoFile();
    const { client: badSplitClient } = clientForVideoUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadVideo(badSplitClient, {
        dataset: "alice/cars",
        videoPath,
        targetSplit: "bad",
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/Invalid input/);

    const { client: badPolicyClient } = clientForVideoUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadVideo(badPolicyClient, {
        dataset: "alice/cars",
        videoPath,
        conflictPolicy: "bogus",
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/Invalid input/);
  });

  test("surfaces the API message for a missing dataset", async () => {
    const videoPath = await writeVideoFile();
    const missingClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/datasets/alice/missing") {
          return jsonResponse({ error: "Dataset not found" }, 404);
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetUploadVideo(missingClient, {
        dataset: "alice/missing",
        videoPath,
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/Dataset not found/);
  });

  test("errors when the dataset record has no id for the signed-url step", async () => {
    const videoPath = await writeVideoFile();
    const { client } = clientForVideoUpload({
      datasetResponse: { dataset: { owner: "alice", dataset: "cars" } },
    });
    await expect(
      datasetUploadVideo(client, {
        dataset: "alice/cars",
        videoPath,
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: writeSingleFrame(),
      }),
    ).rejects.toThrow(/did not include an id/);
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

  // Observed live: the delete path answers `Dataset not found` even for an
  // unknown owner. The tool surfaces the API message verbatim either way.
  test.each([
    "alice/missing",
    "ghost/cars",
  ])("surfaces the API message for %s", async (ref) => {
    const { client } = routeClient((path) => {
      if (path === `/api/datasets/${ref}`) {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(datasetsDelete(client, ref)).rejects.toThrow(
      /Dataset not found/,
    );
  });
});

describe("datasetsIngest", () => {
  const liveJobId = "c".repeat(24);
  const liveIngestResponse = { jobId: liveJobId, status: "queued" };
  const liveDatasetReady = {
    dataset: {
      id: "a".repeat(24),
      owner: "alice",
      dataset: "cars",
      name: "Cars",
      visibility: "private",
      task: "detect",
      imageCount: 8,
      classCount: 12,
      status: "ready",
      lastIngestJobId: liveJobId,
      lastIngestSummary: { added: 8, errors: 0, skippedCounts: {} },
      processingError: null,
      errorCount: 0,
    },
  };

  function clientForIngest(
    options: {
      ingestResponse?: unknown;
      ingestStatus?: number;
      datasetResponse?: unknown;
      accountOwner?: string;
    } = {},
  ) {
    const ingestResponse = options.ingestResponse ?? liveIngestResponse;
    const datasetResponse = options.datasetResponse ?? liveDatasetReady;
    return captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(ingestResponse, options.ingestStatus ?? 201);
      }
      if (parsed.pathname === "/api/datasets/alice/cars") {
        return jsonResponse(datasetResponse);
      }
      return jsonResponse({}, 404);
    });
  }

  test("posts through the owner-scoped path with default skip and surfaces ingest status", async () => {
    const { client, calls } = clientForIngest();
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
      targetSplit: "train",
    });
    expect(calls).toEqual([
      {
        url: `${BASE}/datasets/alice/cars/ingest`,
        method: "POST",
        body: {
          sourceUrl: "https://example.com/dataset.zip",
          conflictPolicy: "skip",
          targetSplit: "train",
        },
      },
      {
        url: `${BASE}/datasets/alice/cars`,
        method: "GET",
        body: undefined,
      },
    ]);
    expect(result.summary).toBe(
      `Started dataset ingest job ${liveJobId} for dataset 'cars' for owner 'alice' ` +
        `(dataset status: ready). Use datasets_get to follow up; ` +
        `ingest completes when lastIngestJobId matches ${liveJobId}.`,
    );
    expect(result.data).toEqual({
      jobId: liveJobId,
      status: "queued",
      conflictPolicy: "skip",
      targetSplit: "train",
      owner: "alice",
      dataset: "cars",
      datasetStatus: "ready",
      lastIngestJobId: liveJobId,
      lastIngestSummary: { added: 8, errors: 0, skippedCounts: {} },
      processingError: null,
      errorCount: 0,
    });
  });

  test("sends an explicit replace policy and omits targetSplit when absent", async () => {
    const { client, calls } = clientForIngest();
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
      conflictPolicy: "replace",
    });
    expect(calls[0].body).toEqual({
      sourceUrl: "https://example.com/dataset.zip",
      conflictPolicy: "replace",
    });
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      conflictPolicy: "replace",
      targetSplit: null,
    });
  });

  test("sends the keep_both policy the live API accepts", async () => {
    const { client, calls } = clientForIngest();
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
      conflictPolicy: "keep_both",
    });
    expect(calls[0].body).toEqual({
      sourceUrl: "https://example.com/dataset.zip",
      conflictPolicy: "keep_both",
    });
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      conflictPolicy: "keep_both",
    });
  });

  test("never sends class mapping or image metadata", async () => {
    const { client, calls } = clientForIngest();
    await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
    });
    expect(
      Object.keys(calls[0].body as Record<string, unknown>).sort(),
    ).toEqual(["conflictPolicy", "sourceUrl"]);
  });

  test("tells a running ingest from a finished one via the dataset fields", async () => {
    const runningJobId = "d".repeat(24);
    const { client } = clientForIngest({
      ingestResponse: { jobId: runningJobId, status: "queued" },
      datasetResponse: {
        dataset: {
          status: "processing",
          lastIngestJobId: liveJobId,
          lastIngestSummary: null,
          processingError: null,
          errorCount: 0,
        },
      },
    });
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
    });
    expect(result.data).toMatchObject({
      jobId: runningJobId,
      datasetStatus: "processing",
      lastIngestJobId: liveJobId,
    });
    expect(result.summary).toContain(
      `ingest completes when lastIngestJobId matches ${runningJobId}`,
    );
    expect(result.summary).not.toMatch(/completed/i);
  });

  test("surfaces a failed ingest outcome instead of hiding it", async () => {
    const failedJobId = "e".repeat(24);
    const { client } = clientForIngest({
      ingestResponse: { jobId: failedJobId, status: "queued" },
      datasetResponse: {
        dataset: {
          status: "ready",
          lastIngestJobId: failedJobId,
          lastIngestSummary: null,
          processingError: {
            message: "HTTP 404",
            timestamp: "2026-09-12T03:51:31.425Z",
          },
          errorCount: 0,
        },
      },
    });
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/missing.zip",
    });
    expect(result.data).toMatchObject({
      jobId: failedJobId,
      datasetStatus: "ready",
      lastIngestJobId: failedJobId,
      processingError: {
        message: "HTTP 404",
        timestamp: "2026-09-12T03:51:31.425Z",
      },
    });
    expect(result.summary).toContain(failedJobId);
    expect(result.summary).toContain("datasets_get");
  });

  test("still returns the job id when the status lookup fails", async () => {
    const queuedJobId = "f".repeat(24);
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse({ jobId: queuedJobId, status: "queued" }, 201);
      }
      if (parsed.pathname === "/api/datasets/alice/cars") {
        return jsonResponse({ error: "Server error" }, 500);
      }
      return jsonResponse({}, 404);
    });
    const result = await datasetsIngest(client, {
      dataset: "alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
    });
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    expect(result.data).toEqual({
      jobId: queuedJobId,
      status: "queued",
      conflictPolicy: "skip",
      targetSplit: null,
      owner: "alice",
      dataset: "cars",
      datasetStatus: null,
      lastIngestJobId: null,
      lastIngestSummary: null,
      processingError: null,
      errorCount: null,
    });
    expect(result.summary).toContain(queuedJobId);
    expect(result.summary).toContain("status lookup failed");
    expect(result.summary).toContain("datasets_get");
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForIngest({ accountOwner: "alice" });
    const result = await datasetsIngest(client, {
      dataset: "cars",
      sourceUrl: "https://example.com/dataset.zip",
    });
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "GET /api/account/summary",
      "POST /api/datasets/alice/cars/ingest",
      "GET /api/datasets/alice/cars",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const { client, calls } = clientForIngest();
    const result = await datasetsIngest(client, {
      dataset: "ul://alice/cars",
      sourceUrl: "https://example.com/dataset.zip",
    });
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "POST /api/datasets/alice/cars/ingest",
      "GET /api/datasets/alice/cars",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForIngest();
    await expect(
      datasetsIngest(client, {
        dataset: "a".repeat(24),
        sourceUrl: "https://example.com/dataset.zip",
      }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("validates sourceUrl before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetsIngest(client, {
        dataset: "alice/cars",
        sourceUrl: "",
      }),
    ).rejects.toThrow(/`sourceUrl` is required/);
  });

  test("surfaces the API message for an unrecognized targetSplit or conflictPolicy rather than rejecting locally", async () => {
    // No local targetSplit/conflictPolicy allowlist: the server rejects
    // unrecognized values itself (verified live: both return 400
    // `"Invalid input"` on `/datasets/{owner}/{dataset}/ingest`), and that
    // message surfaces verbatim.
    const { client: badSplitClient } = clientForIngest({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetsIngest(badSplitClient, {
        dataset: "alice/cars",
        sourceUrl: "https://example.com/dataset.zip",
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Invalid input/);

    const { client: badPolicyClient } = clientForIngest({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetsIngest(badPolicyClient, {
        dataset: "alice/cars",
        sourceUrl: "https://example.com/dataset.zip",
        conflictPolicy: "bogus",
      }),
    ).rejects.toThrow(/Invalid input/);
  });

  test.each([
    "alice/missing",
    "ghost/cars",
  ])("surfaces the API message for %s", async (ref) => {
    const [owner, slug] = ref.split("/");
    const { client } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === `/api/datasets/${owner}/${slug}/ingest`) {
        return jsonResponse({ error: "Dataset not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(
      datasetsIngest(client, {
        dataset: ref,
        sourceUrl: "https://example.com/dataset.zip",
      }),
    ).rejects.toThrow(/Dataset not found/);
  });
});

describe("datasetUploadFile", () => {
  const liveJobId = "c".repeat(24);
  const liveDatasetId = "a".repeat(24);
  const liveSignedHeaders = { "x-goog-if-generation-match": "0" };
  const liveSignedResponse = {
    sessionId: "session_123",
    uploadUrl: "https://signed.example/upload",
    expiresAt: "2026-09-12T04:00:00.000Z",
    headers: liveSignedHeaders,
  };
  const liveCompleteResponse = {
    success: true,
    file: { size: 7, contentType: "application/zip" },
  };
  const liveIngestResponse = { jobId: liveJobId, status: "queued" };
  const liveDatasetWithStatus = {
    dataset: {
      id: liveDatasetId,
      owner: "alice",
      dataset: "cars",
      name: "Cars",
      visibility: "private",
      task: "detect",
      imageCount: 0,
      status: "processing",
      lastIngestJobId: null,
      lastIngestSummary: null,
      processingError: null,
      errorCount: 0,
    },
  };

  async function writeArchive(name = "dataset.zip", body = "archive") {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, name);
    await writeFile(filePath, body);
    return filePath;
  }

  const OVERSIZE_BYTES = 10 * 1024 * 1024 * 1024 + 1;

  /** A sparse archive with oversize logical bytes but no disk cost.
   *
   * `readFile` rejects such files outright, so this only works because the
   * tool streams the file instead of buffering it.
   */
  async function writeSparseArchive(name = "dataset.zip") {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, name);
    const fd = openSync(filePath, "w");
    try {
      ftruncateSync(fd, OVERSIZE_BYTES);
    } finally {
      closeSync(fd);
    }
    return { filePath, bytes: OVERSIZE_BYTES };
  }

  function clientForUpload(
    options: {
      datasetResponse?: unknown;
      signedResponse?: unknown;
      completeResponse?: unknown;
      completeStatus?: number;
      ingestResponse?: unknown;
      ingestStatus?: number;
      accountOwner?: string;
      uploadImpl?: typeof fetch;
      onUpload?: (headers: Headers, url: string) => void;
      failStatusLookup?: boolean;
    } = {},
  ) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const uploadCalls: Array<{
      url: string;
      method: string;
      body: string;
      contentType: string | null;
      contentLength: string | null;
      generationMatch: string | null;
      auth: string | null;
    }> = [];
    const signedResponse = options.signedResponse ?? liveSignedResponse;
    let datasetGets = 0;
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
      if (parsed.pathname === "/api/account/summary") {
        if (options.accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: options.accountOwner });
      }
      if (parsed.pathname === "/api/datasets/alice/cars") {
        datasetGets += 1;
        if (options.failStatusLookup && datasetGets > 1) {
          return jsonResponse({ error: "Server error" }, 500);
        }
        if (datasetGets === 1) {
          const first = options.datasetResponse ?? {
            dataset: { id: liveDatasetId, owner: "alice", dataset: "cars" },
          };
          return jsonResponse(first);
        }
        return jsonResponse(options.datasetResponse ?? liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse(signedResponse);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse(
          options.completeResponse ?? liveCompleteResponse,
          options.completeStatus ?? 200,
        );
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(
          options.ingestResponse ?? liveIngestResponse,
          options.ingestStatus ?? 201,
        );
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch =
      options.uploadImpl ??
      ((async (url: string | URL, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        options.onUpload?.(headers, String(url));
        uploadCalls.push({
          url: String(url),
          method: (init.method ?? "GET").toUpperCase(),
          body: await new Response(init.body).text(),
          contentType: headers.get("Content-Type"),
          contentLength: headers.get("Content-Length"),
          generationMatch: headers.get("x-goog-if-generation-match"),
          auth: headers.get("Authorization"),
        });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch);
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });
    return { client: uploadClient, calls, uploadCalls };
  }

  test("uploads through the owner-scoped flow with both storage headers and reports ingest status", async () => {
    const filePath = await writeArchive();
    const { client, calls, uploadCalls } = clientForUpload();
    const result = await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
      targetSplit: "train",
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
    expect(calls[1]).toEqual({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: liveDatasetId,
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
        contentLength: "7",
        generationMatch: "0",
        auth: null,
      },
    ]);
    expect(calls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(calls[3]).toEqual({
      url: `${BASE}/datasets/alice/cars/ingest`,
      method: "POST",
      body: {
        sessionId: "session_123",
        conflictPolicy: "skip",
        targetSplit: "train",
      },
    });
    expect(result.summary).toContain("dataset.zip");
    expect(result.summary).toContain(liveJobId);
    expect(result.summary).toContain("datasets_get");
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      status: "queued",
      conflictPolicy: "skip",
      targetSplit: "train",
      owner: "alice",
      dataset: "cars",
      datasetStatus: "processing",
      filename: "dataset.zip",
      bytes: 7,
      sessionId: "session_123",
      sizeWarning: null,
    });
  });

  test("never sends class mapping, image metadata, or a dataset id to ingest", async () => {
    const filePath = await writeArchive("coco8.zip", "archive");
    const { client, calls } = clientForUpload();
    await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
    });
    const ingestCall = calls.find((call) =>
      call.url.endsWith("/datasets/alice/cars/ingest"),
    );
    expect(
      Object.keys(ingestCall?.body as Record<string, unknown>).sort(),
    ).toEqual(["conflictPolicy", "sessionId"]);
  });

  test("sends an explicit replace policy and omits targetSplit when absent", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload();
    const result = await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
      conflictPolicy: "replace",
    });
    const ingestCall = calls.find((call) =>
      call.url.endsWith("/datasets/alice/cars/ingest"),
    );
    expect(ingestCall?.body).toEqual({
      sessionId: "session_123",
      conflictPolicy: "replace",
    });
    expect(result.data).toMatchObject({
      conflictPolicy: "replace",
      targetSplit: null,
    });
  });

  test("starts a fresh signed-url session when the first upload fails", async () => {
    const filePath = await writeArchive();
    const signedResponses = [
      {
        sessionId: "session_old",
        uploadUrl: "https://signed.example/old",
        expiresAt: "2026-09-12T04:00:00.000Z",
        headers: liveSignedHeaders,
      },
      {
        sessionId: "session_new",
        uploadUrl: "https://signed.example/new",
        expiresAt: "2026-09-12T04:01:00.000Z",
        headers: liveSignedHeaders,
      },
    ];
    let signedCount = 0;
    const putUrls: string[] = [];
    const calls: { url: string; method: string; body: unknown }[] = [];
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
      if (parsed.pathname === "/api/datasets/alice/cars") {
        return jsonResponse(liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse(signedResponses[Math.min(signedCount++, 1)]);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse(liveCompleteResponse);
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(liveIngestResponse, 201);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch = (async (url: string | URL, init: RequestInit = {}) => {
      putUrls.push(String(url));
      // Release the file stream without reading it.
      await (init.body as ReadableStream | undefined)?.cancel?.();
      if (putUrls.length === 1) {
        return new Response("precondition failed", { status: 412 });
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });

    const result = await datasetUploadFile(uploadClient, {
      dataset: "alice/cars",
      filePath,
    });

    expect(putUrls).toEqual([
      "https://signed.example/old",
      "https://signed.example/new",
    ]);
    const completeCall = calls.find((call) =>
      call.url.endsWith("/upload/complete"),
    );
    expect(completeCall?.body).toEqual({ sessionId: "session_new" });
    const ingestCall = calls.find((call) =>
      call.url.endsWith("/datasets/alice/cars/ingest"),
    );
    expect(ingestCall?.body).toMatchObject({ sessionId: "session_new" });
    expect(result.data).toMatchObject({ sessionId: "session_new" });
  });

  test("streams an oversize archive without buffering and warns", async () => {
    const { filePath, bytes } = await writeSparseArchive();
    const putHeaders: Array<{
      contentType: string | null;
      contentLength: string | null;
      generationMatch: string | null;
      auth: string | null;
    }> = [];
    let putCount = 0;
    const calls: { url: string; method: string; body: unknown }[] = [];
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
      if (parsed.pathname === "/api/datasets/alice/cars") {
        const getCount = calls.filter(
          (call) => call.url === `${BASE}/datasets/alice/cars`,
        ).length;
        if (getCount === 1) {
          return jsonResponse({
            dataset: { id: liveDatasetId, owner: "alice", dataset: "cars" },
          });
        }
        return jsonResponse(liveDatasetWithStatus);
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse(liveSignedResponse);
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse({
          success: true,
          file: { size: bytes, contentType: "application/zip" },
        });
      }
      if (parsed.pathname === "/api/datasets/alice/cars/ingest") {
        return jsonResponse(liveIngestResponse, 201);
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch = (async (url: string | URL, init: RequestInit = {}) => {
      putCount += 1;
      const headers = new Headers(init.headers);
      putHeaders.push({
        contentType: headers.get("Content-Type"),
        contentLength: headers.get("Content-Length"),
        generationMatch: headers.get("x-goog-if-generation-match"),
        auth: headers.get("Authorization"),
      });
      // Never read the stream: the archive is larger than memory.
      await (init.body as ReadableStream | undefined)?.cancel?.();
      expect(String(url)).toBe("https://signed.example/upload");
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });

    const result = await datasetUploadFile(uploadClient, {
      dataset: "alice/cars",
      filePath,
    });

    expect(putCount).toBe(1);
    expect(putHeaders).toEqual([
      {
        contentType: "application/zip",
        contentLength: String(bytes),
        generationMatch: "0",
        auth: null,
      },
    ]);
    const warning = (result.data as Record<string, unknown>).sizeWarning;
    expect(typeof warning).toBe("string");
    expect(warning as string).toMatch(/10 GB/);
    expect(warning as string).toMatch(/20 GB/);
    expect(warning as string).toMatch(/50 GB/);
    expect(warning as string).toMatch(/dataset_ingest/);
    expect(warning as string).toMatch(/cloud/i);
    expect(result.summary).toContain("Warning:");
    expect(result.summary).toContain(liveJobId);
  });

  test("keeps the size guidance when an oversize upload fails", async () => {
    const { filePath } = await writeSparseArchive();
    let signedCount = 0;
    const calls: { url: string; method: string; body: unknown }[] = [];
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
      if (parsed.pathname === "/api/datasets/alice/cars") {
        return jsonResponse({
          dataset: { id: liveDatasetId, owner: "alice", dataset: "cars" },
        });
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        signedCount += 1;
        return jsonResponse({
          ...liveSignedResponse,
          sessionId: `session_${signedCount}`,
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const uploadFetch = (async (_url: string | URL, init: RequestInit = {}) => {
      await (init.body as ReadableStream | undefined)?.cancel?.();
      return new Response("storage unreachable", { status: 500 });
    }) as unknown as typeof fetch;
    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });

    const error = await datasetUploadFile(uploadClient, {
      dataset: "alice/cars",
      filePath,
    }).catch((e) => e as Error);
    expect(signedCount).toBe(2);
    expect(calls.some((call) => call.url.endsWith("/upload/complete"))).toBe(
      false,
    );
    expect(error.message).toMatch(/10 GB/);
    expect(error.message).toMatch(/20 GB/);
    expect(error.message).toMatch(/50 GB/);
    expect(error.message).toMatch(/dataset_ingest/);
  });

  test("completes the upload session before starting ingest, in order", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload();
    await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets/alice/cars`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/alice/cars/ingest`,
      `${BASE}/datasets/alice/cars`,
    ]);
  });

  test("never starts ingest when completion is rejected", async () => {
    const filePath = await writeArchive();
    // Live capture: ingest on an uncompleted session is rejected with 400
    // "Upload session not ready (status: pending). Call
    // /api/upload/complete first." Completion is therefore a hard gate: when
    // it fails, the tool surfaces the error instead of ingesting.
    const { client, calls } = clientForUpload({
      completeResponse: {
        error:
          "Upload session not ready (status: pending). Call /api/upload/complete first.",
      },
      completeStatus: 400,
    });
    await expect(
      datasetUploadFile(client, {
        dataset: "alice/cars",
        filePath,
      }),
    ).rejects.toThrow(/Upload session not ready/);
    expect(
      calls.some((call) => call.url.endsWith("/datasets/alice/cars/ingest")),
    ).toBe(false);
  });

  test("warns rather than blocks when the archive exceeds the free-tier limit", async () => {
    const { archiveSizeWarning } = await import("../../src/tools/datasets.js");
    const limitBytes = 10 * 1024 * 1024 * 1024;
    expect(archiveSizeWarning("dataset.zip", 7)).toBeNull();
    expect(archiveSizeWarning("dataset.zip", limitBytes)).toBeNull();
    const bigBytes = limitBytes + 1;
    const warning = archiveSizeWarning("dataset.zip", bigBytes);
    expect(typeof warning).toBe("string");
    expect(warning).toContain("dataset.zip");
    expect(warning).toContain(String(bigBytes));
    expect(warning).toMatch(/10 GB/);
    expect(warning).toMatch(/20 GB/);
    expect(warning).toMatch(/50 GB/);
    expect(warning).toMatch(/dataset_ingest/);
    expect(warning).toMatch(/cloud/i);

    const filePath = await writeArchive();
    const { client } = clientForUpload();
    const result = await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
    });
    expect(result.data).toMatchObject({ sizeWarning: null });
    expect(result.summary).not.toMatch(/Warning:/);
  });

  test("still returns the job id when the status lookup fails", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload({ failStatusLookup: true });
    const result = await datasetUploadFile(client, {
      dataset: "alice/cars",
      filePath,
    });
    expect(
      calls.filter((call) => call.url === `${BASE}/datasets/alice/cars`),
    ).toHaveLength(2);
    expect(result.data).toMatchObject({
      jobId: liveJobId,
      datasetStatus: null,
      lastIngestJobId: null,
    });
    expect(result.summary).toContain("status lookup failed");
    expect(result.summary).toContain("datasets_get");
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload({ accountOwner: "alice" });
    const result = await datasetUploadFile(client, {
      dataset: "cars",
      filePath,
    });
    expect(calls[0].url).toBe(`${BASE}/account/summary`);
    expect(calls[1].url).toBe(`${BASE}/datasets/alice/cars`);
    expect(result.data).toMatchObject({ owner: "alice", dataset: "cars" });
  });

  test("accepts a ul:// dataset URI without an account lookup", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload();
    const result = await datasetUploadFile(client, {
      dataset: "ul://alice/cars",
      filePath,
    });
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "GET /api/datasets/alice/cars",
      "POST /api/upload/signed-url",
      "POST /api/upload/complete",
      "POST /api/datasets/alice/cars/ingest",
      "GET /api/datasets/alice/cars",
    ]);
    expect(result.data).toMatchObject({ owner: "alice" });
  });

  test("rejects a bare id without any network call", async () => {
    const filePath = await writeArchive();
    const { client, calls } = clientForUpload();
    await expect(
      datasetUploadFile(client, {
        dataset: "a".repeat(24),
        filePath,
      }),
    ).rejects.toThrow(/not addressable.*slug.*owner\/slug.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("validates file path before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFile(client, {
        dataset: "alice/cars",
        filePath: "",
      }),
    ).rejects.toThrow(/`filePath` is required/);
    await expect(
      datasetUploadFile(client, {
        dataset: "alice/cars",
        filePath: join(tmpdir(), "missing-dataset.zip"),
      }),
    ).rejects.toThrow(/does not exist/);

    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const badPath = join(tmp, "dataset.txt");
    await writeFile(badPath, "bad");
    await expect(
      datasetUploadFile(client, {
        dataset: "alice/cars",
        filePath: badPath,
      }),
    ).rejects.toThrow(/Unsupported dataset upload file type/);
  });

  test("surfaces the API message for an unrecognized targetSplit or conflictPolicy rather than rejecting locally", async () => {
    // No local targetSplit/conflictPolicy allowlist: the server rejects
    // unrecognized values itself (verified live: both return 400
    // `"Invalid input"` on `/datasets/{owner}/{dataset}/ingest`), and that
    // message surfaces verbatim.
    const goodPath = await writeArchive();
    const { client: badSplitClient } = clientForUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadFile(badSplitClient, {
        dataset: "alice/cars",
        filePath: goodPath,
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Invalid input/);

    const { client: badPolicyClient } = clientForUpload({
      ingestResponse: { error: "Invalid input" },
      ingestStatus: 400,
    });
    await expect(
      datasetUploadFile(badPolicyClient, {
        dataset: "alice/cars",
        filePath: goodPath,
        conflictPolicy: "bogus",
      }),
    ).rejects.toThrow(/Invalid input/);
  });

  test("surfaces the API message for a missing dataset", async () => {
    const filePath = await writeArchive();
    // Live capture: GET /api/datasets/{owner}/{bad-slug} answers 404
    // {"error":"Dataset not found"}; the client surfaces the API message.
    const missingClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/datasets/alice/missing") {
          return jsonResponse({ error: "Dataset not found" }, 404);
        }
        return jsonResponse({}, 404);
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetUploadFile(missingClient, {
        dataset: "alice/missing",
        filePath,
      }),
    ).rejects.toThrow(/Dataset not found/);
  });
});
