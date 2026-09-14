import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  deploymentGet,
  deploymentHealth,
  deploymentLogs,
  deploymentMetrics,
  deploymentPredict,
  deploymentStop,
  deploymentsList,
} from "../../src/tools/deployments.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

describe("deploymentsList", () => {
  test("fills the owner from the account summary and projects the guaranteed fields", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice") {
        return jsonResponse({
          deployments: [
            {
              id: "a".repeat(24),
              owner: "alice",
              deployment: "road-detector",
              name: "Road detector",
              status: "ready",
              region: "eu",
              resources: {
                cpu: 1,
                memoryGi: 2,
                minInstances: 0,
                maxInstances: 1,
              },
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              project: "alice/road",
              model: "alice/road/exp",
              task: "detect",
              serviceUrl: "https://road-detector.example.com",
              deployedAt: "2026-01-02T00:00:00Z",
            },
            {
              id: "b".repeat(24),
              owner: "alice",
              deployment: "bare",
              name: "Bare",
              status: "deploying",
              region: "eu",
              resources: {
                cpu: 1,
                memoryGi: 2,
                minInstances: 0,
                maxInstances: 1,
              },
              createdAt: "2026-01-03T00:00:00Z",
              updatedAt: "2026-01-03T00:00:00Z",
              project: "alice/road",
              model: "alice/road/exp2",
              task: "detect",
            },
          ],
          total: 2,
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentsList(client);
    expect(result.summary).toBe("2 deployment(s) for owner 'alice'.");
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        owner: "alice",
        deployment: "road-detector",
        name: "Road detector",
        status: "ready",
        region: "eu",
        resources: { cpu: 1, memoryGi: 2, minInstances: 0, maxInstances: 1 },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        project: "alice/road",
        model: "alice/road/exp",
        task: "detect",
      },
      {
        id: "b".repeat(24),
        owner: "alice",
        deployment: "bare",
        name: "Bare",
        status: "deploying",
        region: "eu",
        resources: { cpu: 1, memoryGi: 2, minInstances: 0, maxInstances: 1 },
        createdAt: "2026-01-03T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
        project: "alice/road",
        model: "alice/road/exp2",
        task: "detect",
      },
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice",
    ]);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/bob") {
        return jsonResponse({ deployments: [], total: 0, region: "us" });
      }
      return jsonResponse({}, 404);
    });
    const result = await deploymentsList(client, "bob");
    expect(result.summary).toBe("0 deployment(s) for owner 'bob'.");
    expect(result.data).toEqual([]);
    expect(calls.map((call) => call.path)).toEqual(["/api/deployments/bob"]);
  });

  test("treats a blank owner as omitted", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice") {
        return jsonResponse({ deployments: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await deploymentsList(client, "   ");
    expect(result.summary).toBe("0 deployment(s) for owner 'alice'.");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice",
    ]);
  });

  test("empty workspace reads as a clean zero-count result", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice") {
        return jsonResponse({ deployments: [], total: 0, region: "eu" });
      }
      return jsonResponse({}, 404);
    });
    const result = await deploymentsList(client, "alice");
    expect(result.summary).toBe("0 deployment(s) for owner 'alice'.");
    expect(result.data).toEqual([]);
  });
});

describe("deploymentGet", () => {
  test("reads an owner/deployment ref at ready, surfacing serviceUrl", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          deployment: {
            id: "a".repeat(24),
            owner: "alice",
            project: "road",
            model: "exp",
            task: "detect",
            deployment: "road-detector",
            name: "Road detector",
            status: "ready",
            region: "europe-west1",
            serviceUrl: "https://predict-abc-uc.a.run.app",
            resources: {
              cpu: 1,
              memoryGi: 2,
              minInstances: 0,
              maxInstances: 1,
            },
            deployedAt: "2026-01-02T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
          },
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentGet(client, "alice/road-detector");
    expect(result.data).toEqual({
      id: "a".repeat(24),
      owner: "alice",
      project: "road",
      model: "exp",
      task: "detect",
      deployment: "road-detector",
      name: "Road detector",
      status: "ready",
      region: "europe-west1",
      serviceUrl: "https://predict-abc-uc.a.run.app",
      resources: { cpu: 1, memoryGi: 2, minInstances: 0, maxInstances: 1 },
      deployedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    expect(result.summary).toContain("https://predict-abc-uc.a.run.app");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/deployments/alice/road-detector",
    ]);
  });

  test("treats serviceUrl and deployedAt as absent-until-ready, not a crash", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          deployment: {
            id: "a".repeat(24),
            owner: "alice",
            project: "road",
            model: "exp",
            task: "detect",
            deployment: "road-detector",
            name: "Road detector",
            status: "deploying",
            region: "europe-west1",
            resources: {
              cpu: 1,
              memoryGi: 2,
              minInstances: 0,
              maxInstances: 1,
            },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:05Z",
          },
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentGet(client, "alice/road-detector");
    const data = result.data as Record<string, unknown>;
    expect(data.serviceUrl).toBeNull();
    expect(data.deployedAt).toBeNull();
    expect(result.summary).toContain("not yet available");
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          deployment: {
            id: "a".repeat(24),
            owner: "alice",
            project: "road",
            model: "exp",
            task: "detect",
            deployment: "road-detector",
            name: "Road detector",
            status: "stopped",
            region: "europe-west1",
            resources: {
              cpu: 1,
              memoryGi: 2,
              minInstances: 0,
              maxInstances: 1,
            },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:05Z",
          },
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentGet(client, "road-detector");
    expect((result.data as Record<string, unknown>).owner).toBe("alice");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector",
    ]);
  });

  test("never echoes apiKeyId even if the platform returns it", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          deployment: {
            id: "a".repeat(24),
            owner: "alice",
            project: "road",
            model: "exp",
            task: "detect",
            deployment: "road-detector",
            name: "Road detector",
            status: "ready",
            region: "europe-west1",
            resources: {
              cpu: 1,
              memoryGi: 2,
              minInstances: 0,
              maxInstances: 1,
            },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            apiKeyId: "secret-key-id",
          },
          region: "eu",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentGet(client, "alice/road-detector");
    expect(result.data).not.toHaveProperty("apiKeyId");
  });

  test("passes an owner-qualified 24-hex id straight through, not treated as addressable", async () => {
    const id = "c".repeat(24);
    const { client, calls } = routeClient((path) => {
      if (path === `/api/deployments/alice/${id}`) {
        return jsonResponse({}, 404);
      }
      return jsonResponse({}, 404);
    });

    await expect(deploymentGet(client, `alice/${id}`)).rejects.toThrow(
      /HTTP 404/,
    );
    expect(calls.map((call) => call.path)).toEqual([
      `/api/deployments/alice/${id}`,
    ]);
  });

  test("treats a bare 24-hex id as an opaque slug, defaulting the owner like any other bare slug", async () => {
    const id = "d".repeat(24);
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === `/api/deployments/alice/${id}`) {
        return jsonResponse({}, 404);
      }
      return jsonResponse({}, 404);
    });

    await expect(deploymentGet(client, id)).rejects.toThrow(/HTTP 404/);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      `/api/deployments/alice/${id}`,
    ]);
  });
});

describe("deploymentHealth", () => {
  test("surfaces healthy, status, and latencyMs verbatim", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/health") {
        return jsonResponse({ healthy: true, status: 200, latencyMs: 326 });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentHealth(client, "alice/road-detector");
    expect(result.data).toEqual({ healthy: true, status: 200, latencyMs: 326 });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/deployments/alice/road-detector/health",
    ]);
  });

  test("surfaces error when present, on an unhealthy probe", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/health") {
        return jsonResponse({
          healthy: false,
          status: 503,
          latencyMs: 5000,
          error: "service unavailable",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentHealth(client, "alice/road-detector");
    expect(result.data).toEqual({
      healthy: false,
      status: 503,
      latencyMs: 5000,
      error: "service unavailable",
    });
    expect(result.summary).toContain("unhealthy");
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector/health") {
        return jsonResponse({ healthy: true, status: 200, latencyMs: 100 });
      }
      return jsonResponse({}, 404);
    });

    await deploymentHealth(client, "road-detector");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector/health",
    ]);
  });
});

describe("deploymentLogs", () => {
  test("returns entries verbatim with the pagination token exposed", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/logs") {
        return jsonResponse({
          entries: [
            {
              timestamp: "2026-01-01T00:00:00Z",
              severity: "INFO",
              message: "Container started.",
            },
            {
              timestamp: "2026-01-01T00:00:01Z",
              severity: "NOTICE",
              message: "Listening on port 8080.",
            },
          ],
          nextPageToken: "page-2-token",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentLogs(client, "alice/road-detector");
    expect(result.data).toEqual({
      entries: [
        {
          timestamp: "2026-01-01T00:00:00Z",
          severity: "INFO",
          message: "Container started.",
        },
        {
          timestamp: "2026-01-01T00:00:01Z",
          severity: "NOTICE",
          message: "Listening on port 8080.",
        },
      ],
      nextPageToken: "page-2-token",
    });
    expect(result.summary).toContain("2 log entr");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/deployments/alice/road-detector/logs",
    ]);
  });

  test("passes severity, limit, and pageToken through as plain query params", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/logs") {
        return jsonResponse({ entries: [], nextPageToken: null });
      }
      return jsonResponse({}, 404);
    });

    await deploymentLogs(client, "alice/road-detector", {
      severity: "WARNING",
      limit: 10,
      pageToken: "abc",
    });
    expect(calls[0].params.get("severity")).toBe("WARNING");
    expect(calls[0].params.get("limit")).toBe("10");
    expect(calls[0].params.get("pageToken")).toBe("abc");
  });

  test("empty entries on a fresh deployment is a valid result, not an error", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/logs") {
        return jsonResponse({ entries: [], nextPageToken: null });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentLogs(client, "alice/road-detector");
    expect(result.data).toEqual({ entries: [], nextPageToken: null });
    expect(result.summary).toContain("0 log entr");
  });

  test("surfaces the server's rejection message on an invalid severity rather than validating locally", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/logs") {
        return jsonResponse(
          { message: "severity must be one of DEFAULT, DEBUG, ..." },
          400,
        );
      }
      return jsonResponse({}, 404);
    });

    await expect(
      deploymentLogs(client, "alice/road-detector", {
        severity: "NOT_A_REAL_SEVERITY",
      }),
    ).rejects.toThrow(/severity must be one of/);
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector/logs") {
        return jsonResponse({ entries: [], nextPageToken: null });
      }
      return jsonResponse({}, 404);
    });

    await deploymentLogs(client, "road-detector");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector/logs",
    ]);
  });
});

describe("deploymentMetrics", () => {
  const timeRange1h = {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-01T01:00:00Z",
  };

  test("surfaces the detailed branch verbatim, including the timeRange object", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/metrics") {
        return jsonResponse({
          deploymentId: "a".repeat(24),
          region: "europe-west1",
          timeRange: timeRange1h,
          summary: {
            totalRequests: 42,
            errorCount: 1,
            errorRate: 0.024,
            avgLatencyMs: 120,
            p50LatencyMs: 100,
            p95LatencyMs: 250,
            p99LatencyMs: 400,
          },
          timeSeries: {
            requests: [1, 2, 3],
            errors: [0, 0, 1],
            latencyP50: [90, 100, 110],
            latencyP95: [200, 250, 300],
            cpuUtilization: [0.1, 0.2, 0.1],
            memoryUtilization: [0.3, 0.3, 0.4],
            instanceCount: [1, 1, 1],
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentMetrics(client, "alice/road-detector");
    expect(result.data).toEqual({
      deploymentId: "a".repeat(24),
      region: "europe-west1",
      timeRange: timeRange1h,
      summary: {
        totalRequests: 42,
        errorCount: 1,
        errorRate: 0.024,
        avgLatencyMs: 120,
        p50LatencyMs: 100,
        p95LatencyMs: 250,
        p99LatencyMs: 400,
      },
      timeSeries: {
        requests: [1, 2, 3],
        errors: [0, 0, 1],
        latencyP50: [90, 100, 110],
        latencyP95: [200, 250, 300],
        cpuUtilization: [0.1, 0.2, 0.1],
        memoryUtilization: [0.3, 0.3, 0.4],
        instanceCount: [1, 1, 1],
      },
    });
    expect(result.summary).toContain("42");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/deployments/alice/road-detector/metrics",
    ]);
  });

  test("surfaces the sparkline branch verbatim, never merged with the detailed shape", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/metrics") {
        return jsonResponse({
          requests24h: [10, 20, 15],
          totalRequests: 500,
          errorRate: 0,
          avgLatencyMs: 88,
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentMetrics(client, "alice/road-detector", {
      sparkline: true,
    });
    expect(result.data).toEqual({
      requests24h: [10, 20, 15],
      totalRequests: 500,
      errorRate: 0,
      avgLatencyMs: 88,
    });
    expect(result.data).not.toHaveProperty("timeSeries");
    expect(result.data).not.toHaveProperty("summary");
    expect(calls[0].params.get("sparkline")).toBe("true");
  });

  test("near-zero values on a fresh deployment are a valid result", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/metrics") {
        return jsonResponse({
          requests24h: [],
          totalRequests: 0,
          errorRate: 0,
          avgLatencyMs: 0,
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentMetrics(client, "alice/road-detector", {
      sparkline: true,
    });
    expect(result.data).toEqual({
      requests24h: [],
      totalRequests: 0,
      errorRate: 0,
      avgLatencyMs: 0,
    });
  });

  test("passes range through unvalidated as a plain query param", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/metrics") {
        return jsonResponse({
          deploymentId: "a".repeat(24),
          region: "eu",
          timeRange: timeRange1h,
          summary: {},
          timeSeries: {},
        });
      }
      return jsonResponse({}, 404);
    });

    await deploymentMetrics(client, "alice/road-detector", {
      range: "not-a-real-range",
    });
    expect(calls[0].params.get("range")).toBe("not-a-real-range");
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector/metrics") {
        return jsonResponse({
          deploymentId: "a".repeat(24),
          region: "eu",
          timeRange: timeRange1h,
          summary: {},
          timeSeries: {},
        });
      }
      return jsonResponse({}, 404);
    });

    await deploymentMetrics(client, "road-detector");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector/metrics",
    ]);
  });
});

describe("deploymentPredict", () => {
  let tmpDir: string;
  let imagePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ul-mcp-predict-"));
    imagePath = join(tmpDir, "bus.jpg");
    await writeFile(imagePath, "fake-jpeg-bytes");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("posts the local image file and returns images and metadata verbatim", async () => {
    const calls: { path: string; method: string; form: FormData }[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      calls.push({
        path: parsed.pathname,
        method: (init.method ?? "GET").toUpperCase(),
        form: init.body as FormData,
      });
      if (parsed.pathname === "/api/deployments/alice/road-detector/predict") {
        return jsonResponse({
          images: [
            {
              shape: [1080, 810],
              speed: { preprocess: 34.1, inference: 461.4, postprocess: 142.2 },
              results: [
                {
                  name: "person",
                  class: 0,
                  confidence: 0.923,
                  box: { x1: 668.3, y1: 394.8, x2: 809.5, y2: 880.3 },
                },
              ],
            },
          ],
          metadata: {
            imageCount: 1,
            classNames: ["person", "bus"],
            task: "detect",
            version: "1.0.0",
            functionTimeAlive: 12345.6,
            functionTimeCall: 78.9,
          },
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
    });

    const result = await deploymentPredict(client, "alice/road-detector", {
      imagePath,
    });

    expect(result.data).toEqual({
      owner: "alice",
      deployment: "road-detector",
      images: [
        {
          shape: [1080, 810],
          speed: { preprocess: 34.1, inference: 461.4, postprocess: 142.2 },
          results: [
            {
              name: "person",
              class: 0,
              confidence: 0.923,
              box: { x1: 668.3, y1: 394.8, x2: 809.5, y2: 880.3 },
            },
          ],
        },
      ],
      metadata: {
        imageCount: 1,
        classNames: ["person", "bus"],
        task: "detect",
        version: "1.0.0",
        functionTimeAlive: 12345.6,
        functionTimeCall: 78.9,
      },
    });
    expect(result.summary).toContain("1 image(s)");
    expect(result.summary).toContain("1 detection(s)");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].form.get("file")).toBeInstanceOf(Blob);
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector/predict") {
        return jsonResponse({ images: [], metadata: {} });
      }
      return jsonResponse({}, 404);
    });

    const result = await deploymentPredict(client, "road-detector", {
      imagePath,
    });
    expect((result.data as Record<string, unknown>).owner).toBe("alice");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector/predict",
    ]);
  });

  test("sends conf, iou, and imgsz only when given", async () => {
    const forms: FormData[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      forms.push(init.body as FormData);
      if (parsed.pathname === "/api/deployments/alice/road-detector/predict") {
        return jsonResponse({ images: [], metadata: {} });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
    });

    await deploymentPredict(client, "alice/road-detector", { imagePath });
    expect(forms[0].get("conf")).toBeNull();
    expect(forms[0].get("iou")).toBeNull();
    expect(forms[0].get("imgsz")).toBeNull();

    await deploymentPredict(client, "alice/road-detector", {
      imagePath,
      conf: 0.4,
      iou: 0.5,
      imgsz: 1280,
    });
    expect(forms[1].get("conf")).toBe("0.4");
    expect(forms[1].get("iou")).toBe("0.5");
    expect(forms[1].get("imgsz")).toBe("1280");
  });

  test("rejects a missing imagePath before making any request", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 404));
    await expect(
      deploymentPredict(client, "alice/road-detector", { imagePath: "" }),
    ).rejects.toThrow(/imagePath.*required/);
    expect(calls).toHaveLength(0);
  });

  test("rejects an image path that does not exist", async () => {
    const { client } = routeClient(() => jsonResponse({}, 404));
    await expect(
      deploymentPredict(client, "alice/road-detector", {
        imagePath: join(tmpDir, "missing.jpg"),
      }),
    ).rejects.toThrow(/does not exist/);
  });

  test("rejects an unsupported image file type", async () => {
    const { client } = routeClient(() => jsonResponse({}, 404));
    const badPath = join(tmpDir, "notes.txt");
    await writeFile(badPath, "not an image");
    await expect(
      deploymentPredict(client, "alice/road-detector", { imagePath: badPath }),
    ).rejects.toThrow(/Unsupported image file type/);
  });

  test("surfaces a 413 with the server's message rather than swallowing it", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/predict") {
        return jsonResponse({ error: "Prediction input too large" }, 413);
      }
      return jsonResponse({}, 404);
    });
    await expect(
      deploymentPredict(client, "alice/road-detector", { imagePath }),
    ).rejects.toThrow(/Prediction input too large/);
  });

  test("surfaces a 503 with the server's message rather than swallowing it", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector/predict") {
        return jsonResponse({ error: "Deployment is not ready" }, 503);
      }
      return jsonResponse({}, 404);
    });
    await expect(
      deploymentPredict(client, "alice/road-detector", { imagePath }),
    ).rejects.toThrow(/Deployment is not ready/);
  });
});

describe("deploymentStop", () => {
  test("sends only {action: stop} and reports the resulting status", async () => {
    const calls: { path: string; method: string; body: string }[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const parsed = new URL(String(url));
      calls.push({
        path: parsed.pathname,
        method: (init.method ?? "GET").toUpperCase(),
        body: String(init.body ?? ""),
      });
      if (parsed.pathname === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          success: true,
          status: "stopped",
          message: "Deployment stopped",
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
    });

    const result = await deploymentStop(client, "alice/road-detector");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toBe(JSON.stringify({ action: "stop" }));
    expect(result.data).toEqual({
      success: true,
      status: "stopped",
      message: "Deployment stopped",
    });
    expect(result.summary).toContain("stopped");
  });

  test("surfaces the server's rejection when stopping an already-stopped deployment", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse(
          { error: "Cannot stop deployment with status: stopped" },
          400,
        );
      }
      return jsonResponse({}, 404);
    });

    await expect(deploymentStop(client, "alice/road-detector")).rejects.toThrow(
      /Cannot stop deployment with status: stopped/,
    );
  });

  test("defaults the owner from the account summary for a bare slug", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/deployments/alice/road-detector") {
        return jsonResponse({
          success: true,
          status: "stopped",
          message: "Deployment stopped",
        });
      }
      return jsonResponse({}, 404);
    });

    await deploymentStop(client, "road-detector");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/deployments/alice/road-detector",
    ]);
  });
});
