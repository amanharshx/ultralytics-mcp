import { describe, expect, test } from "vitest";

import { projectsGet, projectsList } from "../../src/tools/projects.js";
import { jsonResponse, routeClient } from "../helpers.js";

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
