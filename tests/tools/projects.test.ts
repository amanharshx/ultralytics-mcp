import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  exploreProjects,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "../../src/tools/projects.js";
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

describe("projectsList", () => {
  test("fills the owner from the account summary and reads live field names", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/projects/alice") {
        return jsonResponse({
          projects: [
            {
              id: "a".repeat(24),
              owner: "alice",
              project: "road",
              name: "Road",
              visibility: "private",
              iconColor: "#fff",
              modelCount: 2,
              modelNames: ["exp"],
              totalBytes: 10,
              starCount: 0,
              isStarred: false,
              viewPreferences: {},
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              extra: "omitted",
            },
            {
              id: "b".repeat(24),
              owner: "alice",
              project: "bare",
              name: "Bare",
              visibility: "public",
            },
          ],
          total: 2,
          region: "us",
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await projectsList(client);
    expect(result.summary).toBe("2 project(s) for owner 'alice'.");
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        name: "Road",
        slug: "road",
        username: "alice",
        visibility: "private",
        modelCount: 2,
      },
      {
        id: "b".repeat(24),
        name: "Bare",
        slug: "bare",
        username: "alice",
        visibility: "public",
        modelCount: null,
      },
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/projects/alice",
    ]);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/projects/bob") {
        return jsonResponse({ projects: [], total: 0, region: "us" });
      }
      return jsonResponse({}, 404);
    });
    const result = await projectsList(client, "bob");
    expect(result.summary).toBe("0 project(s) for owner 'bob'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/projects/bob"]);
  });

  test("accepts the owner through the username alias", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/projects/bob") {
        return jsonResponse({ projects: [], total: 0, region: "us" });
      }
      return jsonResponse({}, 404);
    });
    const result = await projectsList(client, undefined, "bob");
    expect(result.summary).toBe("0 project(s) for owner 'bob'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/projects/bob"]);
  });

  test("prefers owner over the username alias when both are given", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/projects/alice") {
        return jsonResponse({ projects: [], total: 0, region: "us" });
      }
      return jsonResponse({}, 404);
    });
    const result = await projectsList(client, "alice", "bob");
    expect(result.summary).toBe("0 project(s) for owner 'alice'.");
    expect(calls.map((call) => call.path)).toEqual(["/api/projects/alice"]);
  });

  test("treats a blank owner as omitted", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: "alice" });
      }
      if (path === "/api/projects/alice") {
        return jsonResponse({ projects: [], total: 0, region: "us" });
      }
      return jsonResponse({}, 404);
    });
    const result = await projectsList(client, "   ");
    expect(result.summary).toBe("0 project(s) for owner 'alice'.");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/projects/alice",
    ]);
  });

  test("surfaces the API message for an owner that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/projects/ghost") {
        return jsonResponse({ error: "Owner not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(projectsList(client, "ghost")).rejects.toThrow(
      /Owner not found/,
    );
  });
});

describe("exploreProjects", () => {
  test("builds query and trims results", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/explore/search") {
        return jsonResponse({
          projects: [
            {
              _id: "p".repeat(24),
              name: "Road Safety",
              slug: "road-safety",
              username: "user",
              visibility: "public",
              modelCount: 12,
              starCount: 99,
              extra: "omit",
            },
          ],
          hasMore: false,
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await exploreProjects(client, {
      q: "road",
      sort: "name-asc",
      offset: 0,
    });

    expect(calls[0]).toEqual({
      url: `${BASE}/explore/search?type=projects&q=road&sort=name-asc&offset=0`,
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe("Search 'road': 1 project(s)");
    expect(result.data).toEqual({
      projects: [
        {
          id: "p".repeat(24),
          name: "Road Safety",
          slug: "road-safety",
          username: "user",
          visibility: "public",
          modelCount: 12,
          starCount: 99,
        },
      ],
      hasMore: false,
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

    await expect(exploreProjects(client, { q: "" })).rejects.toThrow(
      /q is required/,
    );
    await expect(
      exploreProjects(client, { q: "road", sort: "popular" }),
    ).rejects.toThrow(/Unsupported sort/);
    await expect(
      exploreProjects(client, { q: "road", offset: -1 }),
    ).rejects.toThrow(/offset/);
  });
});

describe("projectsGet", () => {
  test("returns the project record and a summary", async () => {
    const id = "a".repeat(24);
    const { client } = routeClient((path) => {
      if (path === `/api/projects/${id}`) {
        return jsonResponse({
          project: {
            _id: id,
            name: "Road",
            visibility: "public",
            modelCount: 3,
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await projectsGet(client, id);
    expect(result.summary).toBe("Project 'Road' (public), 3 model(s).");
    expect(result.data).toEqual({
      _id: id,
      name: "Road",
      visibility: "public",
      modelCount: 3,
    });
  });

  test("renders missing fields like Python (None / ?) for sparse payloads", async () => {
    const id = "a".repeat(24);
    const { client } = routeClient((path) =>
      path === `/api/projects/${id}`
        ? jsonResponse({ project: {} })
        : jsonResponse({}, 404),
    );
    const result = await projectsGet(client, id);
    expect(result.summary).toBe("Project 'None' (None), ? model(s).");
  });
});

describe("projectsCreate", () => {
  test("posts the project payload and summarizes created project", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({
        project: { _id: "p".repeat(24), slug: "road", name: "Road Safety" },
      }),
    );
    const result = await projectsCreate(client, {
      name: "Road Safety",
      slug: "road",
      description: "Detection experiments",
    });
    expect(calls[0]).toEqual({
      url: `${BASE}/projects`,
      method: "POST",
      body: {
        name: "Road Safety",
        slug: "road",
        description: "Detection experiments",
      },
    });
    expect(result.summary).toBe(`Created project ${"p".repeat(24)} slug=road.`);
  });
});

describe("projectsDelete", () => {
  test("resolves a reference and deletes the project", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/projects") {
        return jsonResponse({
          projects: [{ _id: "p".repeat(24), slug: "road", username: "user" }],
        });
      }
      return jsonResponse({ deleted: true });
    });
    const result = await projectsDelete(client, "user/road");
    expect(calls.at(-1)).toMatchObject({
      url: `${BASE}/projects/${"p".repeat(24)}`,
      method: "DELETE",
    });
    expect(result.summary).toBe(
      `Deleted project ${"p".repeat(24)} (soft delete).`,
    );
  });
});
