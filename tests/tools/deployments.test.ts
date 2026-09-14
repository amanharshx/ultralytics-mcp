import { describe, expect, test } from "vitest";

import { deploymentGet, deploymentsList } from "../../src/tools/deployments.js";
import { jsonResponse, routeClient } from "../helpers.js";

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
