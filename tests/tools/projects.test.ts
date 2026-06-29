import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
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
  test("normalizes items and drops unknown fields", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/projects") {
        return jsonResponse({
          projects: [
            {
              _id: "a".repeat(24),
              name: "Road",
              slug: "road",
              username: "u",
              visibility: "private",
              modelCount: 2,
              extra: "omitted",
            },
            { _id: "b".repeat(24), name: "Bare", slug: "bare", username: "u" },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await projectsList(client);
    expect(result.summary).toBe("2 project(s).");
    expect(result.data).toEqual([
      {
        id: "a".repeat(24),
        name: "Road",
        slug: "road",
        username: "u",
        visibility: "private",
        modelCount: 2,
      },
      {
        id: "b".repeat(24),
        name: "Bare",
        slug: "bare",
        username: "u",
        visibility: null,
        modelCount: null,
      },
    ]);
    expect(calls[0].params.has("username")).toBe(false);
  });

  test("passes a username filter when provided", async () => {
    const { client, calls } = routeClient(() => jsonResponse({ projects: [] }));
    const result = await projectsList(client, "alice");
    expect(result.summary).toBe("0 project(s).");
    expect(calls[0].params.get("username")).toBe("alice");
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
