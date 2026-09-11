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

  test("attaches the static not-found hint through the tool", async () => {
    // Live capture: GET /api/projects/{bad-owner} -> 404 {"error":"Owner not found"}
    const { client } = routeClient((path) => {
      if (path === "/api/projects/ghost") {
        return jsonResponse({ error: "Owner not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    const err = await projectsList(client, "ghost").catch((e) => e as Error);
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Owner not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
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
  const baseProject = {
    id: "a".repeat(24),
    owner: "alice",
    project: "road",
    name: "Road",
    visibility: "private",
    modelCount: 2,
  };

  function clientForProjectGet(
    response: unknown,
    options: { accountOwner?: string } = {},
  ) {
    return routeClient((path) => {
      if (options.accountOwner && path === "/api/account/summary") {
        return jsonResponse({ username: options.accountOwner });
      }
      return path === "/api/projects/alice/road"
        ? jsonResponse(response)
        : jsonResponse({}, 404);
    });
  }

  test("fetches through the owner-scoped path and reads the nested project", async () => {
    const { client, calls } = clientForProjectGet({
      project: { ...baseProject },
      models: [{ id: "b".repeat(24), model: "exp", name: "exp" }],
      isOwner: true,
    });

    const result = await projectsGet(client, "alice/road");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/projects/alice/road",
    ]);
    expect(result.summary).toBe(
      "Project 'road' for owner 'alice': 'Road' (private), 2 model(s).",
    );
    expect(result.data).toEqual({
      project: { ...baseProject },
      models: [{ id: "b".repeat(24), model: "exp", name: "exp" }],
      isOwner: true,
    });
  });

  test("renders missing fields like Python (None / ?) for sparse payloads", async () => {
    const { client } = clientForProjectGet({
      project: {},
      models: [],
      isOwner: true,
    });
    const result = await projectsGet(client, "alice/road");
    expect(result.summary).toBe(
      "Project 'None' for owner 'alice': 'None' (None), ? model(s).",
    );
    expect(result.data).toEqual({
      project: {},
      models: [],
      isOwner: true,
    });
  });

  test("succeeds for a ul:// project URI without an account lookup", async () => {
    const { client, calls } = clientForProjectGet({
      project: { ...baseProject, visibility: "public", modelCount: 0 },
      models: [],
      isOwner: false,
    });
    const result = await projectsGet(client, "ul://alice/road");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/projects/alice/road",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
    expect(result.data).toMatchObject({
      project: { project: "road" },
      isOwner: false,
    });
  });

  test("falls back to the account owner for a bare slug", async () => {
    const { client, calls } = clientForProjectGet(
      {
        project: { ...baseProject, modelCount: 1 },
        models: [],
        isOwner: true,
      },
      { accountOwner: "alice" },
    );
    const result = await projectsGet(client, "road");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      "/api/projects/alice/road",
    ]);
    expect(result.summary).toContain("for owner 'alice'");
    expect(result.data).toMatchObject({
      project: { project: "road", owner: "alice" },
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 500));
    await expect(projectsGet(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a project that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/projects/alice/missing") {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(projectsGet(client, "alice/missing")).rejects.toThrow(
      /Project not found/,
    );
  });
});

describe("projectsCreate", () => {
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
        parsed.pathname === "/api/projects" &&
        (init.method ?? "GET").toUpperCase() === "POST"
      ) {
        return jsonResponse(createResponse, options.status ?? 200);
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
    project: "road",
    region: "eu",
  };

  test("sends the slug as project, defaults to private, and fills the owner", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    const result = await projectsCreate(client, {
      name: "Road Safety",
      project: "road",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/account/summary",
      "POST /api/projects",
    ]);
    expect(calls[1].body).toEqual({
      project: "road",
      name: "Road Safety",
      visibility: "private",
      owner: "alice",
    });
    expect(result.summary).toBe(
      `Created project 'road' for owner 'alice' with id '${"a".repeat(24)}' (private).`,
    );
    expect(result.data).toEqual(flatCreate);
  });

  test("sends public visibility and description when requested", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    const result = await projectsCreate(client, {
      name: "Road Safety",
      project: "road",
      visibility: "public",
      description: "Detection experiments",
    });
    expect(calls[1].body).toEqual({
      project: "road",
      name: "Road Safety",
      visibility: "public",
      owner: "alice",
      description: "Detection experiments",
    });
    expect(result.summary).toContain("(public)");
    expect(result.data).toEqual(flatCreate);
  });

  test("prefers an explicit owner and skips the account summary", async () => {
    const { client, calls } = clientForCreate(flatCreate);
    const result = await projectsCreate(client, {
      name: "Road Safety",
      project: "road",
      owner: "bob",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/projects",
    ]);
    expect(calls[0].body).toMatchObject({ owner: "bob" });
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("treats a blank owner as omitted", async () => {
    const { client, calls } = clientForCreate(flatCreate, {
      accountOwner: "alice",
    });
    await projectsCreate(client, {
      name: "Road Safety",
      project: "road",
      owner: "   ",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/account/summary",
      "POST /api/projects",
    ]);
    expect(calls[1].body).toMatchObject({ owner: "alice" });
  });

  test("reports id, owner, and slug from the flat response", async () => {
    const { client } = clientForCreate(
      { id: "c".repeat(24), owner: "bob", project: "track", region: "us" },
      { accountOwner: "bob" },
    );
    const result = await projectsCreate(client, {
      name: "Track",
      project: "track",
    });
    expect(result.summary).toContain(`'track'`);
    expect(result.summary).toContain(`'bob'`);
    expect(result.summary).toContain("c".repeat(24));
    expect(result.data).toEqual({
      id: "c".repeat(24),
      owner: "bob",
      project: "track",
      region: "us",
    });
  });

  test("surfaces the API message for invalid visibility", async () => {
    const { client } = clientForCreate(
      { error: 'Invalid option: expected one of "public"|"private"' },
      { accountOwner: "alice", status: 400 },
    );
    await expect(
      projectsCreate(client, {
        name: "Road Safety",
        project: "road",
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
      projectsCreate(client, {
        name: "Road Safety",
        project: "road",
        owner: "ghost-owner",
      }),
    ).rejects.toThrow(/Access denied/);
  });

  test("surfaces the API message when the slug field is missing", async () => {
    const { client } = clientForCreate(
      { error: "Invalid input: expected string, received undefined" },
      { accountOwner: "alice", status: 400 },
    );
    await expect(
      projectsCreate(client, { name: "Road Safety", project: "" }),
    ).rejects.toThrow(/Invalid input/);
  });
});

describe("projectsDelete", () => {
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
        parsed.pathname === "/api/projects/alice/road" &&
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

  test("deletes through the owner-scoped path and reports the cascade count", async () => {
    const { client, calls } = clientForDelete({
      success: true,
      cascadedModels: 0,
    });
    const result = await projectsDelete(client, "alice/road");
    expect(calls).toEqual([
      { path: "/api/projects/alice/road", method: "DELETE" },
    ]);
    expect(result.summary).toBe(
      "Deleted project 'road' for owner 'alice' (soft delete; 0 model(s) removed; restorable from trash).",
    );
    expect(result.data).toEqual({
      owner: "alice",
      project: "road",
      success: true,
      cascadedModels: 0,
    });
  });

  test("reports a nonzero cascade count", async () => {
    const { client } = clientForDelete({
      success: true,
      cascadedModels: 2,
    });
    const result = await projectsDelete(client, "alice/road");
    expect(result.summary).toContain("2 model(s) removed");
    expect(result.data).toMatchObject({ cascadedModels: 2, success: true });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = clientForDelete(
      { success: true, cascadedModels: 0 },
      { accountOwner: "alice" },
    );
    const result = await projectsDelete(client, "road");
    expect(calls).toEqual([
      { path: "/api/account/summary", method: "GET" },
      { path: "/api/projects/alice/road", method: "DELETE" },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("accepts a ul:// project URI without an account lookup", async () => {
    const { client, calls } = clientForDelete({
      success: true,
      cascadedModels: 0,
    });
    const result = await projectsDelete(client, "ul://alice/road");
    expect(calls).toEqual([
      { path: "/api/projects/alice/road", method: "DELETE" },
    ]);
    expect(result.summary).toContain("for owner 'alice'");
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = clientForDelete({ success: true });
    await expect(projectsDelete(client, "a".repeat(24))).rejects.toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("surfaces the API message for a project that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/projects/alice/missing") {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(projectsDelete(client, "alice/missing")).rejects.toThrow(
      /Project not found/,
    );
  });

  // Observed live: unlike the list path (which answers `Owner not found`),
  // the delete path answers `Project not found` even for an unknown owner.
  // The tool surfaces the API message verbatim either way.
  test("surfaces the API message verbatim for an owner that does not exist", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/projects/ghost/road") {
        return jsonResponse({ error: "Project not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    await expect(projectsDelete(client, "ghost/road")).rejects.toThrow(
      /Project not found/,
    );
  });
});
