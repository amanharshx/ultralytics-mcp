import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { modelPredict } from "../../src/tools/predict.js";
import { BASE, jsonResponse, KEY } from "../helpers.js";

const LIVE_IMAGES = [
  {
    shape: [1080, 810],
    speed: { preprocess: 7.78, inference: 149.9, postprocess: 58.27 },
    results: [
      {
        name: "trunk",
        class: 21,
        confidence: 0.69399,
        box: { x1: 317.77, y1: 310.95, x2: 784.59, y2: 678.07 },
      },
      {
        name: "wheel",
        class: 22,
        confidence: 0.812,
        box: { x1: 100.0, y1: 500.0, x2: 200.0, y2: 600.0 },
      },
    ],
  },
];

const LIVE_METADATA = {
  imageCount: 1,
  classNames: ["trunk", "wheel"],
  task: "segment",
};

interface PredictClientOptions {
  /** Body served on the owner-scoped predict path. */
  predictBody?: unknown;
  /** Status served on the owner-scoped predict path. */
  predictStatus?: number;
  /** Owner served by the account summary; unset makes the lookup fail. */
  accountOwner?: string;
}

/** Client serving the owner-scoped predict path with live field names. */
function predictClient(options: PredictClientOptions = {}) {
  const {
    predictBody = { images: LIVE_IMAGES, metadata: LIVE_METADATA },
    predictStatus = 200,
    accountOwner,
  } = options;
  const calls: { path: string; method: string; body?: FormData }[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const method = (init.method ?? "GET").toUpperCase();
    if (parsed.pathname === "/api/account/summary") {
      calls.push({ path: parsed.pathname, method });
      if (accountOwner === undefined) {
        return jsonResponse({ error: "unexpected account lookup" }, 500);
      }
      return jsonResponse({ username: accountOwner });
    }
    if (
      parsed.pathname === "/api/models/alice/road/exp/predict" &&
      method === "POST"
    ) {
      calls.push({
        path: parsed.pathname,
        method,
        body: init.body as FormData,
      });
      return jsonResponse(predictBody, predictStatus);
    }
    calls.push({ path: parsed.pathname, method });
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
  const client = new UltralyticsClient({
    apiKey: KEY,
    baseUrl: BASE,
    fetchImpl,
  });
  return { client, calls };
}

describe("modelPredict", () => {
  test("rejects a blank source before any request", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "alice/road/exp", { source: "  " }),
    ).rejects.toThrow(/`source` is required/);
    expect(calls).toHaveLength(0);
  });

  // Live capture: the endpoint rejects the `data:` URI form with 400, so a
  // base64 data URI is normalized to its raw payload before posting.
  test("strips a base64 data: URI prefix before posting", async () => {
    const { client, calls } = predictClient();
    const payload = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAKgCAIAAAD8nD72AAA";

    const result = await modelPredict(client, "alice/road/exp", {
      source: `data:image/jpeg;base64,${payload}`,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body?.get("source")).toBe(payload);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 2 detection(s).",
    );
  });

  test("rejects a non-base64 data: URI before any request", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "alice/road/exp", {
        source: "data:image/svg+xml,<svg></svg>",
      }),
    ).rejects.toThrow(/must be base64 with a non-empty payload/);
    expect(calls).toHaveLength(0);
  });

  test("rejects an empty data: URI payload before any request", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "alice/road/exp", {
        source: "data:image/png;base64,   ",
      }),
    ).rejects.toThrow(/must be base64 with a non-empty payload/);
    expect(calls).toHaveLength(0);
  });

  test("posts multipart source and options to the owner-scoped predict path", async () => {
    const { client, calls } = predictClient();

    const result = await modelPredict(client, "alice/road/exp", {
      source: "https://x/y.jpg",
      conf: 0.5,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/models/alice/road/exp/predict");
    expect(calls[0].method).toBe("POST");
    const body = calls[0].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body?.get("source")).toBe("https://x/y.jpg");
    expect(body?.get("conf")).toBe("0.5");
    expect(body?.get("iou")).toBeNull();
    expect(body?.get("imgsz")).toBeNull();
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 2 detection(s).",
    );
    expect(result.data).toEqual({
      owner: "alice",
      project: "road",
      model: "exp",
      images: LIVE_IMAGES,
      metadata: LIVE_METADATA,
    });
  });

  // Live capture: identical detections with and without conf/iou/imgsz set
  // to 0.25/0.7/640, so the fields are only sent when given and the server
  // applies its own default otherwise.
  test("sends conf, iou, and imgsz only when given", async () => {
    const { client, calls } = predictClient();

    await modelPredict(client, "alice/road/exp", { source: "https://x/y.jpg" });
    const firstBody = calls[0].body;
    expect(firstBody?.get("conf")).toBeNull();
    expect(firstBody?.get("iou")).toBeNull();
    expect(firstBody?.get("imgsz")).toBeNull();

    await modelPredict(client, "alice/road/exp", {
      source: "https://x/y.jpg",
      conf: 0.4,
      iou: 0.5,
      imgsz: 1280,
    });
    const secondBody = calls[1].body;
    expect(secondBody?.get("conf")).toBe("0.4");
    expect(secondBody?.get("iou")).toBe("0.5");
    expect(secondBody?.get("imgsz")).toBe("1280");
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = predictClient();

    const result = await modelPredict(client, "ul://alice/road/exp", {
      source: "https://x/y.jpg",
    });

    expect(calls).toEqual([
      {
        path: "/api/models/alice/road/exp/predict",
        method: "POST",
        body: expect.any(FormData),
      },
    ]);
    expect(result.data).toMatchObject({
      owner: "alice",
      project: "road",
      model: "exp",
    });
  });

  // Live capture: POST with a raw base64 source -> 200 `{images[],
  // metadata}`; a base64 `data:` URI is normalized to this form first.
  test("sends a base64 source through unchanged", async () => {
    const { client, calls } = predictClient();
    const source = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAKgCAIAAAD8nD72AAA";

    const result = await modelPredict(client, "alice/road/exp", { source });

    expect(calls).toHaveLength(1);
    expect(calls[0].body?.get("source")).toBe(source);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 2 detection(s).",
    );
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = predictClient({ accountOwner: "alice" });

    const result = await modelPredict(client, "exp", {
      source: "https://x/y.jpg",
      project: "road",
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/models/alice/road/exp/predict",
    ]);
    expect(result.data).toMatchObject({
      owner: "alice",
      project: "road",
      model: "exp",
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "a".repeat(24), { source: "https://x/y.jpg" }),
    ).rejects.toThrow(/not addressable.*owner\/project\/model.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "exp", { source: "https://x/y.jpg" }),
    ).rejects.toThrow(/project is required/);
    expect(calls).toHaveLength(0);
  });

  // Live capture: nothing matching the request (seen with conf=1.0 and with
  // an image whose classes the model does not know) is a normal 200 with
  // empty `results`, distinct from the 400/404 model and input failures.
  test("reports zero detections when nothing matches the request", async () => {
    const { client } = predictClient({
      predictBody: {
        images: [{ shape: [1080, 810], results: [] }],
        metadata: LIVE_METADATA,
      },
    });

    const result = await modelPredict(client, "alice/road/exp", {
      source: "https://x/y.jpg",
    });

    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 0 detection(s).",
    );
    expect(result.data).toMatchObject({
      owner: "alice",
      project: "road",
      model: "exp",
      metadata: { task: "segment", classNames: ["trunk", "wheel"] },
    });
  });

  // Live capture: POST /api/models/{owner}/{project}/{model}/predict on a
  // model without weights -> 400 {"error":"Model has no trained weights"}
  test("surfaces the API message for a model without weights", async () => {
    const { client } = predictClient({
      predictBody: { error: "Model has no trained weights" },
      predictStatus: 400,
    });

    await expect(
      modelPredict(client, "alice/road/exp", { source: "https://x/y.jpg" }),
    ).rejects.toThrow(/Model has no trained weights/);
  });

  // Live capture: POST /api/models/{owner}/{project}/{bad-model}/predict
  // -> 404 {"error":"Model not found"}
  test("surfaces the API message for a missing model", async () => {
    const { client } = predictClient({
      predictBody: { error: "Model not found" },
      predictStatus: 404,
    });

    const err = await modelPredict(client, "alice/road/exp", {
      source: "https://x/y.jpg",
    }).catch((e) => e as Error);
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Model not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
  });

  // Live capture: oversized source -> 400 {"error":"Too big: expected string
  // to have <=4096 characters"}
  test("surfaces the API message for an oversized source", async () => {
    const { client } = predictClient({
      predictBody: {
        error: "Too big: expected string to have <=4096 characters",
      },
      predictStatus: 400,
    });

    await expect(
      modelPredict(client, "alice/road/exp", { source: "https://x/y.jpg" }),
    ).rejects.toThrow(/Too big/);
  });
});
