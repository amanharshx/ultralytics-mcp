import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

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

/** Arbitrary bytes whose standard base64 (`++++/9g=`) uses `+`, `/`, and
 * padding, so the URL-safe form differs in every way it can. Content is
 * irrelevant here: the server, not this tool, reads the image. */
const BYTES = Buffer.from([0xfb, 0xef, 0xbe, 0xff, 0xd8]);
const BASE64 = BYTES.toString("base64");

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
  test.each([
    ["neither input", {}],
    ["a blank source", { source: "  " }],
    ["both inputs", { source: "https://x/y.jpg", filePath: "/tmp/y.jpg" }],
  ])(
    "requires exactly one input, rejecting %s before any request",
    async (_label, input) => {
      const { client, calls } = predictClient();
      await expect(
        modelPredict(client, "alice/road/exp", input),
      ).rejects.toThrow(/exactly one of `source`.*or `file_path`/);
      expect(calls).toHaveLength(0);
    },
  );

  // Live capture: the endpoint caps `source` at 4,096 characters, so base64
  // is decoded and uploaded as the `file` part instead. A file part named
  // `blob` or `image.bin` is rejected while `image.jpg` is read by content.
  test("uploads a base64 data: URI's payload as a file named image.jpg", async () => {
    const { client, calls } = predictClient();

    const result = await modelPredict(client, "alice/road/exp", {
      source: `data:image/jpeg;base64,${BASE64}`,
      conf: 0.5,
    });

    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect(body?.get("source")).toBeNull();
    expect(body?.get("conf")).toBe("0.5");
    const file = body?.get("file") as File;
    expect(file.name).toBe("image.jpg");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(BYTES);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 2 detection(s).",
    );
  });

  test("decodes URL-safe, unpadded, and line-wrapped base64 to the same bytes", async () => {
    const { client, calls } = predictClient();
    const urlSafe = BYTES.toString("base64url");
    const wrapped = BASE64.replace(/.{1,3}/g, "$&\r\n");

    for (const source of [BASE64, urlSafe, wrapped]) {
      await modelPredict(client, "alice/road/exp", { source });
    }

    expect(urlSafe).toBe("----_9g");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const file = call.body?.get("file") as File;
      expect(Buffer.from(await file.arrayBuffer())).toEqual(BYTES);
    }
  });

  // `Buffer.from` would silently decode each of these into junk bytes.
  test.each([
    ["a lone character", "A"],
    ["a dangling character", "abcde"],
    ["padding on a full quantum", "abcd="],
    ["over-padding", "abcd=="],
    ["a local file path", "/Users/alice/bus.jpg"],
    ["a URL missing its scheme", "ultralytics.com/images/bus.jpg"],
  ])("rejects %s before any request", async (_label, source) => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "alice/road/exp", { source }),
    ).rejects.toThrow(/neither an image URL nor valid base64/);
    expect(calls).toHaveLength(0);
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
        source: "data:image/jpeg;base64,   ",
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

  test("reports depth maps, not detections, for a depth model", async () => {
    // Live capture: POST /api/models/{owner}/{project}/{model}/predict on a
    // yolo26n-depth model with bus.jpg -> 200 with empty `results` and a
    // per-image `depth` PNG.
    const captured = JSON.parse(
      await readFile(
        new URL(
          "../../fixtures/model_predict_depth_response.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const { client } = predictClient({ predictBody: captured });

    const result = await modelPredict(client, "alice/road/exp", {
      source: "https://x/y.jpg",
    });

    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 1 depth map(s).",
    );
    expect(result.data).toHaveProperty("images.0.results", []);
    expect(result.data).toHaveProperty("images", captured.images);
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

describe("modelPredict with a local file", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ul-mcp-model-predict-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Live capture: an `.mp4` file part returns one image entry per frame, so
  // the file goes up under its own name with no local format allowlist.
  test("uploads the file under its own basename with no source field", async () => {
    const { client, calls } = predictClient();
    const filePath = join(tmpDir, "clip.mp4");
    await writeFile(filePath, BYTES);

    const result = await modelPredict(client, "alice/road/exp", {
      filePath,
      imgsz: 320,
    });

    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect(body?.get("source")).toBeNull();
    expect(body?.get("imgsz")).toBe("320");
    const file = body?.get("file") as File;
    expect(file.name).toBe("clip.mp4");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(BYTES);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 image(s), 2 detection(s).",
    );
  });

  test("rejects a missing path before any request", async () => {
    const { client, calls } = predictClient();
    const filePath = join(tmpDir, "missing.jpg");
    await expect(
      modelPredict(client, "alice/road/exp", { filePath }),
    ).rejects.toThrow(`File does not exist: ${filePath}`);
    expect(calls).toHaveLength(0);
  });

  test("rejects a directory before any request", async () => {
    const { client, calls } = predictClient();
    await expect(
      modelPredict(client, "alice/road/exp", { filePath: tmpDir }),
    ).rejects.toThrow(`Path is not a file: ${tmpDir}`);
    expect(calls).toHaveLength(0);
  });
});
