import { describe, expect, test } from "vitest";
import { UltralyticsClient } from "../../src/client.js";
import { autoAnnotateStatus } from "../../src/tools/auto-annotate.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

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
