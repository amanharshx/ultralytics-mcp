import { describe, expect, test } from "vitest";
import { UltralyticsClient } from "../../src/client.js";
import {
  autoAnnotateStart,
  autoAnnotateStatus,
  autoAnnotateStop,
} from "../../src/tools/auto-annotate.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

/** Client that records request method/body and replies via `responder`. */
function captureClient(responder: (url: string) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
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

/** Client that replies to successive requests with queued responders, in
 * order, recording each call's method and path for assertions. */
function sequenceClient(responders: ((path: string) => Response)[]) {
  const calls: { method: string; path: string }[] = [];
  let index = 0;
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    calls.push({
      method: (init.method ?? "GET").toUpperCase(),
      path: parsed.pathname,
    });
    const responder = responders[index];
    index += 1;
    if (!responder) {
      return jsonResponse({ error: "unexpected extra call" }, 500);
    }
    return responder(parsed.pathname);
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

function throwingClient() {
  return new UltralyticsClient({
    apiKey: KEY,
    baseUrl: BASE,
    fetchImpl: (async () => {
      throw new Error("network must not be called");
    }) as unknown as typeof fetch,
  });
}

function clientForStatus(
  response: unknown,
  options: { accountOwner?: string; status?: number } = {},
) {
  return routeClient((path) => {
    if (options.accountOwner && path === "/api/account/summary") {
      return jsonResponse({ username: options.accountOwner });
    }
    return path === "/api/datasets/alice/cars/predict/batch"
      ? jsonResponse(response, options.status ?? 200)
      : jsonResponse({}, 404);
  });
}

describe("autoAnnotateStatus", () => {
  test("never-run dataset reports both fields null", async () => {
    const { client, calls } = clientForStatus({
      activeJob: null,
      lastRun: null,
    });

    const result = await autoAnnotateStatus(client, "alice/cars");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/datasets/alice/cars/predict/batch",
    ]);
    expect(result.data).toEqual({ activeJob: null, lastRun: null });
    expect(result.summary).toBe(
      "Dataset 'cars' for owner 'alice': no auto-annotation run recorded.",
    );
  });

  test("active run surfaces progress and startedAt verbatim", async () => {
    const { client } = clientForStatus({
      activeJob: {
        id: "job1",
        stopping: false,
        progress: { processed: 3, total: 8 },
        startedAt: "2026-09-16T02:53:02.188Z",
      },
      lastRun: null,
    });

    const result = await autoAnnotateStatus(client, "alice/cars");

    expect(result.data).toEqual({
      activeJob: {
        id: "job1",
        stopping: false,
        progress: { processed: 3, total: 8 },
        startedAt: "2026-09-16T02:53:02.188Z",
      },
      lastRun: null,
    });
    expect(result.summary).toBe(
      "Dataset 'cars' for owner 'alice': run 'job1' active, processed 3/8, started at 2026-09-16T02:53:02.188Z.",
    );
  });

  test("terminal success surfaces results verbatim", async () => {
    const { client } = clientForStatus({
      activeJob: null,
      lastRun: {
        failed: false,
        stopped: false,
        error: null,
        results: { processed: 8, annotations: 4, classes: 1 },
      },
    });

    const result = await autoAnnotateStatus(client, "alice/cars");

    expect(result.data).toEqual({
      activeJob: null,
      lastRun: {
        failed: false,
        stopped: false,
        error: null,
        results: { processed: 8, annotations: 4, classes: 1 },
      },
    });
    expect(result.summary).toBe(
      "Dataset 'cars' for owner 'alice': last run finished, failed=false stopped=false, " +
        "processed 8, annotations 4, classes 1.",
    );
  });

  test("terminal failure surfaces the error verbatim with no results", async () => {
    const { client } = clientForStatus({
      activeJob: null,
      lastRun: {
        failed: true,
        stopped: false,
        error: "This model's task or classes do not match the dataset.",
        results: null,
      },
    });

    const result = await autoAnnotateStatus(client, "alice/cars");

    expect(result.data).toEqual({
      activeJob: null,
      lastRun: {
        failed: true,
        stopped: false,
        error: "This model's task or classes do not match the dataset.",
        results: null,
      },
    });
    expect(result.summary).toBe(
      "Dataset 'cars' for owner 'alice': last run finished, failed=true stopped=false. " +
        "Error: This model's task or classes do not match the dataset.",
    );
  });

  test("resolves owner from the account summary when the ref has no owner", async () => {
    const { client, calls } = clientForStatus(
      { activeJob: null, lastRun: null },
      { accountOwner: "alice" },
    );

    const result = await autoAnnotateStatus(client, "cars");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/datasets/alice/cars/predict/batch",
    ]);
    expect(result.summary).toContain("owner 'alice'");
  });

  test("rejects a malformed response missing activeJob or lastRun", async () => {
    const { client } = clientForStatus({ activeJob: null });

    await expect(autoAnnotateStatus(client, "alice/cars")).rejects.toThrow(
      /malformed/i,
    );
  });

  test("propagates a not-found error for an unknown dataset", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () =>
        jsonResponse(
          { error: "Dataset not found" },
          404,
        )) as unknown as typeof fetch,
    });

    await expect(autoAnnotateStatus(client, "alice/ghost")).rejects.toThrow(
      "Dataset not found",
    );
  });
});

describe("autoAnnotateStart", () => {
  const OWNER = "alice";
  const DATASET = "cars";
  const MODEL_REF = "alice/roads/exp-2";
  const PATH = `/api/datasets/${OWNER}/${DATASET}/predict/batch`;

  test("rejects when confirm_cost is false before any network call", async () => {
    await expect(
      autoAnnotateStart(throwingClient(), `${OWNER}/${DATASET}`, MODEL_REF),
    ).rejects.toThrow(/confirm_cost=true/);
  });

  test("sends only modelId when every optional param is left unset", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({ jobId: "job1" }, 202),
    );

    const result = await autoAnnotateStart(
      client,
      `${OWNER}/${DATASET}`,
      MODEL_REF,
      { confirmCost: true },
    );

    expect(calls[0]).toMatchObject({
      url: `${BASE}/datasets/${OWNER}/${DATASET}/predict/batch`,
      method: "POST",
      body: { modelId: "ul://alice/roads/exp-2" },
    });
    expect(result.data).toEqual({ jobId: "job1" });
  });

  test("formats modelId as a ul:// URI from the resolved triple", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({ jobId: "job1" }, 202),
    );

    await autoAnnotateStart(client, `${OWNER}/${DATASET}`, "exp-2", {
      project: `${OWNER}/roads`,
      confirmCost: true,
    });

    expect(calls[0]?.body).toMatchObject({ modelId: "ul://alice/roads/exp-2" });
  });

  test("sends every documented param the caller provides", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({ jobId: "job1" }, 202),
    );

    await autoAnnotateStart(client, `${OWNER}/${DATASET}`, MODEL_REF, {
      confirmCost: true,
      confidence: 0.5,
      iou: 0.6,
      classMapping: [0, null, 2],
      includeAnnotated: true,
    });

    expect(calls[0]?.body).toEqual({
      modelId: "ul://alice/roads/exp-2",
      confidence: 0.5,
      iou: 0.6,
      classMapping: [0, null, 2],
      includeAnnotated: true,
    });
  });

  test("passes an over-length classMapping through with no client-side check", async () => {
    const longMapping = new Array(30).fill(0);
    const { client, calls } = captureClient(() =>
      jsonResponse({ jobId: "job1" }, 202),
    );

    await autoAnnotateStart(client, `${OWNER}/${DATASET}`, MODEL_REF, {
      confirmCost: true,
      classMapping: longMapping,
    });

    expect(calls[0]?.body).toMatchObject({ classMapping: longMapping });
  });

  test("fills a missing dataset and model owner from a single cached account lookup", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: OWNER });
      }
      if (path === PATH) {
        return jsonResponse({ jobId: "job1" }, 202);
      }
      return jsonResponse({}, 404);
    });

    const result = await autoAnnotateStart(client, DATASET, "exp-2", {
      project: "roads",
      confirmCost: true,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      PATH,
    ]);
    expect(result.data).toEqual({ jobId: "job1" });
  });

  test("surfaces the server's error verbatim when nothing is left to annotate", async () => {
    const { client } = captureClient(() =>
      jsonResponse({ error: "No images left to annotate" }, 409),
    );

    await expect(
      autoAnnotateStart(client, `${OWNER}/${DATASET}`, MODEL_REF, {
        confirmCost: true,
      }),
    ).rejects.toThrow("No images left to annotate");
  });

  test("surfaces the server's error verbatim for any other failure status", async () => {
    const { client } = captureClient(() =>
      jsonResponse({ error: "Dataset has no classes" }, 422),
    );

    await expect(
      autoAnnotateStart(client, `${OWNER}/${DATASET}`, MODEL_REF, {
        confirmCost: true,
      }),
    ).rejects.toThrow("Dataset has no classes");
  });
});

describe("autoAnnotateStop", () => {
  const OWNER = "alice";
  const DATASET = "cars";
  const PATH = `/api/datasets/${OWNER}/${DATASET}/predict/batch`;

  test("refuses when activeJob is null without calling DELETE", async () => {
    const { client, calls } = sequenceClient([
      () => jsonResponse({ activeJob: null, lastRun: null }),
    ]);

    await expect(
      autoAnnotateStop(client, `${OWNER}/${DATASET}`),
    ).rejects.toThrow(/no active auto-annotation run/);
    expect(calls).toEqual([{ method: "GET", path: PATH }]);
  });

  test("cancels an active run and surfaces the action verbatim", async () => {
    const { client, calls } = sequenceClient([
      () =>
        jsonResponse({
          activeJob: {
            id: "job1",
            stopping: false,
            progress: { processed: 1, total: 8 },
          },
          lastRun: null,
        }),
      () => jsonResponse({ action: "cancelled", jobId: "job1" }),
    ]);

    const result = await autoAnnotateStop(client, `${OWNER}/${DATASET}`);

    expect(calls).toEqual([
      { method: "GET", path: PATH },
      { method: "DELETE", path: PATH },
    ]);
    expect(result.summary).toBe(`Dataset 'cars' for owner 'alice': cancelled.`);
    expect(result.data).toEqual({
      owner: OWNER,
      dataset: DATASET,
      action: "cancelled",
      jobId: "job1",
    });
  });

  test("surfaces a dismissed action verbatim", async () => {
    const { client } = sequenceClient([
      () =>
        jsonResponse({
          activeJob: {
            id: "job1",
            stopping: false,
            progress: { processed: 8, total: 8 },
          },
          lastRun: null,
        }),
      () => jsonResponse({ action: "dismissed", jobId: "job1" }),
    ]);

    const result = await autoAnnotateStop(client, `${OWNER}/${DATASET}`);

    expect(result.data).toMatchObject({ action: "dismissed" });
  });

  test("fills a missing owner from the account summary", async () => {
    const { client, calls } = sequenceClient([
      () => jsonResponse({ username: OWNER }),
      () =>
        jsonResponse({
          activeJob: {
            id: "job1",
            stopping: false,
            progress: { processed: 1, total: 8 },
          },
          lastRun: null,
        }),
      () => jsonResponse({ action: "cancelled", jobId: "job1" }),
    ]);

    const result = await autoAnnotateStop(client, DATASET);

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      PATH,
      PATH,
    ]);
    expect(result.data).toMatchObject({ owner: OWNER, action: "cancelled" });
  });

  test("surfaces the API message for a dataset that does not exist", async () => {
    const { client } = sequenceClient([
      () => jsonResponse({ error: "Dataset not found" }, 404),
    ]);

    await expect(
      autoAnnotateStop(client, `${OWNER}/${DATASET}`),
    ).rejects.toThrow("Dataset not found");
  });
});
