import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../src/client.js";
import {
  looksLikeId,
  parseRef,
  resolveDataset,
  resolveLegacyProjectId,
  resolveModel,
  resolveProject,
} from "../src/resolve.js";

const KEY = `ul_${"0".repeat(40)}`;
const BASE = "https://platform.ultralytics.com/api";

/** Build a client whose fetch routes through `handler`, recording call URLs. */
function clientWith(
  handler: (path: string, params: URLSearchParams) => Response,
) {
  const calls: { path: string; params: URLSearchParams }[] = [];
  const impl = (async (url: string | URL) => {
    const parsed = new URL(String(url));
    const entry = { path: parsed.pathname, params: parsed.searchParams };
    calls.push(entry);
    return handler(parsed.pathname, parsed.searchParams);
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

describe("looksLikeId / parseRef", () => {
  test("looksLikeId", () => {
    expect(looksLikeId("6a15700a49a694644aeb62aa")).toBe(true);
    expect(looksLikeId("6A15700A49A694644AEB62AA")).toBe(true);
    expect(looksLikeId("road-safety-101")).toBe(false);
    expect(looksLikeId("user/project")).toBe(false);
  });

  test("parseRef", () => {
    expect(parseRef("project")).toEqual({ isUlUri: false, parts: ["project"] });
    expect(parseRef("user/project")).toEqual({
      isUlUri: false,
      parts: ["user", "project"],
    });
    expect(parseRef("ul://user/datasets/data")).toEqual({
      isUlUri: true,
      parts: ["user", "datasets", "data"],
    });
    expect(parseRef("ul://user/project/model")).toEqual({
      isUlUri: true,
      parts: ["user", "project", "model"],
    });
  });
});

describe("resolveProject", () => {
  test("parses owner/slug into a pair with no network call", () => {
    expect(resolveProject("u/p")).toEqual({ owner: "u", project: "p" });
  });

  test("parses a ul:// project URI into a pair with no network call", () => {
    expect(resolveProject("ul://u/p")).toEqual({ owner: "u", project: "p" });
  });

  test("parses a bare slug with a null owner and no network call", () => {
    expect(resolveProject("p")).toEqual({ owner: null, project: "p" });
  });

  test("trims surrounding whitespace", () => {
    expect(resolveProject("  u/p  ")).toEqual({ owner: "u", project: "p" });
  });

  test("rejects a bare 24-hex id and names the accepted ref forms", () => {
    expect(() => resolveProject("6a15700a49a694644aeb62aa")).toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
  });

  test("rejects an uppercase 24-hex id", () => {
    expect(() => resolveProject("6A15700A49A694644AEB62AA")).toThrow(
      /not addressable/,
    );
  });

  test("rejects a blank reference", () => {
    expect(() => resolveProject("   ")).toThrow(/Cannot parse project/);
  });

  test("rejects a slash-only reference", () => {
    expect(() => resolveProject("///")).toThrow(/Cannot parse project/);
  });

  test("rejects a three-segment reference", () => {
    expect(() => resolveProject("a/b/c")).toThrow(/Cannot parse project/);
  });

  test("a dataset URI is rejected and points at the project form", () => {
    expect(() => resolveProject("ul://u/datasets/data")).toThrow(
      /dataset URI, not a project.*ul:\/\/owner\/project/s,
    );
  });

  test("a model URI is rejected and points at the project form", () => {
    expect(() => resolveProject("ul://u/p/m")).toThrow(
      /model URI.*ul:\/\/u\/p/s,
    );
  });

  test("a malformed project ul:// URI names the expected form", () => {
    expect(() => resolveProject("ul://only-one-part")).toThrow(
      /Unsupported project ul:\/\/ URI.*ul:\/\/owner\/project/s,
    );
  });
});

describe("resolveLegacyProjectId (legacy id lookup for unmigrated tools)", () => {
  test("id passthrough makes no request", async () => {
    const id = "6a15700a49a694644aeb62aa";
    const { client, calls } = clientWith(
      () => new Response(null, { status: 500 }),
    );
    expect(await resolveLegacyProjectId(client, id)).toBe(id);
    expect(calls).toHaveLength(0);
  });

  test("resolves username/slug via the projects endpoint", async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(
          JSON.stringify({
            projects: [{ _id: "a".repeat(24), slug: "p", username: "u" }],
          }),
          {
            status: 200,
          },
        ),
    );
    expect(await resolveLegacyProjectId(client, "u/p")).toBe("a".repeat(24));
    expect(calls[0].path).toBe("/api/projects");
    expect(calls[0].params.get("username")).toBe("u");
  });

  test("ambiguous slug fails loudly", async () => {
    const { client } = clientWith(
      () =>
        new Response(
          JSON.stringify({
            projects: [
              { _id: "a".repeat(24), slug: "dup", username: "u1" },
              { _id: "b".repeat(24), slug: "dup", username: "u2" },
            ],
          }),
          { status: 200 },
        ),
    );
    await expect(resolveLegacyProjectId(client, "dup")).rejects.toThrow(
      /Ambiguous project/,
    );
  });

  test("missing slug fails loudly", async () => {
    const { client } = clientWith(
      () => new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );
    await expect(resolveLegacyProjectId(client, "missing")).rejects.toThrow(
      /No project found/,
    );
  });

  test("a dataset URI is rejected by the legacy project lookup", async () => {
    const { client } = clientWith(() => new Response(null, { status: 500 }));
    await expect(
      resolveLegacyProjectId(client, "ul://u/datasets/data"),
    ).rejects.toThrow(/dataset URI, not a project/);
  });
});

describe("resolveDataset", () => {
  test("resolves a dataset ul:// URI by querying username and filtering slug locally", async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(
          JSON.stringify({
            datasets: [
              { _id: "x".repeat(24), slug: "other", username: "u" },
              { _id: "d".repeat(24), slug: "data", username: "u" },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await resolveDataset(client, "ul://u/datasets/data")).toBe(
      "d".repeat(24),
    );
    expect(calls[0].path).toBe("/api/datasets");
    expect(calls[0].params.get("username")).toBe("u");
    expect(calls[0].params.has("slug")).toBe(false);
  });

  test("resolves username/slug by querying username and filtering slug locally", async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(
          JSON.stringify({
            datasets: [
              { _id: "x".repeat(24), slug: "other", username: "u" },
              { _id: "d".repeat(24), slug: "data", username: "u" },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await resolveDataset(client, "u/data")).toBe("d".repeat(24));
    expect(calls[0].path).toBe("/api/datasets");
    expect(calls[0].params.get("username")).toBe("u");
    expect(calls[0].params.has("slug")).toBe(false);
  });

  test("resolves a bare dataset slug without sending a slug query", async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(
          JSON.stringify({
            datasets: [{ _id: "d".repeat(24), slug: "data", username: "u" }],
          }),
          { status: 200 },
        ),
    );
    expect(await resolveDataset(client, "data")).toBe("d".repeat(24));
    expect(calls[0].path).toBe("/api/datasets");
    expect(calls[0].params.has("slug")).toBe(false);
    expect(calls[0].params.has("username")).toBe(false);
  });

  test("a malformed dataset ul:// URI is rejected", async () => {
    const { client } = clientWith(() => new Response(null, { status: 500 }));
    await expect(
      resolveDataset(client, "ul://u/project/model"),
    ).rejects.toThrow(/Unsupported dataset ul:\/\/ URI/);
  });
});

describe("resolveModel", () => {
  test("infers the project from a model ul:// URI", async () => {
    const { client, calls } = clientWith((path) => {
      if (path === "/api/projects") {
        return new Response(
          JSON.stringify({
            projects: [{ _id: "p".repeat(24), slug: "proj", username: "u" }],
          }),
          { status: 200 },
        );
      }
      if (path === "/api/models") {
        return new Response(
          JSON.stringify({ models: [{ _id: "m".repeat(24), slug: "mod" }] }),
          {
            status: 200,
          },
        );
      }
      return new Response(null, { status: 404 });
    });
    expect(await resolveModel(client, "ul://u/proj/mod")).toBe("m".repeat(24));
    expect(calls[1].params.get("projectId")).toBe("p".repeat(24));
  });

  test("a bare slug without a project fails loudly", async () => {
    const { client } = clientWith(() => new Response(null, { status: 500 }));
    await expect(resolveModel(client, "mod")).rejects.toThrow(
      /project id\/slug is required/,
    );
  });
});
