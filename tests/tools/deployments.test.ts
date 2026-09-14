import { describe, expect, test } from "vitest";

import { deploymentsList } from "../../src/tools/deployments.js";
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
