import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../src/client.js";
import { UltralyticsApiError } from "../src/errors.js";

const KEY = `ul_${"0".repeat(40)}`;
const BASE = "https://platform.ultralytics.com/api";

/** Build an injectable fetch that records calls and returns queued responses. */
function makeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return responses[Math.min(index++, responses.length - 1)];
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function client(fetchImpl: typeof fetch, downloadFetchImpl?: typeof fetch) {
  return new UltralyticsClient({
    apiKey: KEY,
    baseUrl: BASE,
    fetchImpl,
    downloadFetchImpl,
  });
}

describe("UltralyticsClient.get", () => {
  test("sends Bearer auth and Accept headers and builds query params", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    ]);
    const result = await client(impl).get("/projects", { username: "u" });
    expect(result).toEqual({ projects: [] });
    expect(calls[0].url).toBe(`${BASE}/projects?username=u`);
    const headers = headersOf(calls[0].init);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers.Accept).toBe("application/json");
  });

  test("normalizes a 401 into UltralyticsApiError with an auth hint", async () => {
    const { impl } = makeFetch([
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    ]);
    const err = await client(impl)
      .get("/projects")
      .catch((e) => e as UltralyticsApiError);
    expect(err).toBeInstanceOf(UltralyticsApiError);
    expect(err.statusCode).toBe(401);
    expect(String(err)).toMatch(/authentication failed/);
  });

  test("surfaces a 404 verbatim with a static hint naming all candidate causes", async () => {
    // Live capture: GET /api/projects/{bad-owner} -> 404 {"error":"Owner not found"}
    const { impl } = makeFetch([
      new Response(JSON.stringify({ error: "Owner not found" }), {
        status: 404,
      }),
    ]);
    const err = await client(impl)
      .get("/projects/ghost")
      .catch((e) => e as UltralyticsApiError);
    expect(err).toBeInstanceOf(UltralyticsApiError);
    expect(err.statusCode).toBe(404);
    expect(err.apiMessage).toBe("Owner not found");
    expect(String(err)).toMatch(/HTTP 404/);
    expect(String(err)).toMatch(/Owner not found/);
    expect(String(err)).toMatch(/owner may not exist/);
    expect(String(err)).toMatch(/resource may not exist/);
    expect(String(err)).toMatch(/API key may lack access/);
  });

  test("uses the same static 404 hint for a missing project", async () => {
    // Live capture: GET /api/projects/{owner}/{bad-slug} -> 404 {"error":"Project not found"}
    const ownerFetch = makeFetch([
      new Response(JSON.stringify({ error: "Owner not found" }), {
        status: 404,
      }),
    ]);
    const projectFetch = makeFetch([
      new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
      }),
    ]);
    const ownerErr = await client(ownerFetch.impl)
      .get("/projects/ghost")
      .catch((e) => e as UltralyticsApiError);
    const projectErr = await client(projectFetch.impl)
      .get("/projects/alice/missing")
      .catch((e) => e as UltralyticsApiError);
    expect(projectErr.apiMessage).toBe("Project not found");
    expect(String(projectErr)).toMatch(/HTTP 404/);
    expect(String(projectErr)).toMatch(/Project not found/);
    // Same static hint regardless of which route matched: never branch on message text.
    const hintOf = (err: UltralyticsApiError): string => {
      const match = /HTTP 404 \((.*)\):/.exec(String(err));
      return match?.[1] ?? "";
    };
    expect(hintOf(projectErr)).toBe(hintOf(ownerErr));
    expect(hintOf(projectErr)).toMatch(/owner may not exist/);
  });

  test("keeps a rejected key distinct from a missing resource", async () => {
    // Live captures: bad key -> 401 {"error":"Invalid API key"},
    // unknown owner -> 404 {"error":"Owner not found"}
    const unauthorized = makeFetch([
      new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
      }),
    ]);
    const notFound = makeFetch([
      new Response(JSON.stringify({ error: "Owner not found" }), {
        status: 404,
      }),
    ]);
    const authErr = await client(unauthorized.impl)
      .get("/projects/alice")
      .catch((e) => e as UltralyticsApiError);
    const missingErr = await client(notFound.impl)
      .get("/projects/ghost")
      .catch((e) => e as UltralyticsApiError);
    expect(authErr.statusCode).toBe(401);
    expect(authErr.apiMessage).toBe("Invalid API key");
    expect(String(authErr)).toMatch(/HTTP 401/);
    expect(String(authErr)).toMatch(/Invalid API key/);
    expect(String(authErr)).toMatch(/authentication failed/);
    expect(String(missingErr)).not.toMatch(/authentication failed/);
    expect(String(authErr)).not.toMatch(/owner may not exist/);
  });

  test("preserves status and message for a 405 with an empty body", async () => {
    // Live capture: GET /api/projects -> 405 with empty body
    const { impl } = makeFetch([
      new Response("", { status: 405, statusText: "Method Not Allowed" }),
    ]);
    const err = await client(impl)
      .get("/projects")
      .catch((e) => e as UltralyticsApiError);
    expect(err).toBeInstanceOf(UltralyticsApiError);
    expect(err.statusCode).toBe(405);
    expect(String(err)).toMatch(/HTTP 405/);
    expect(String(err)).toMatch(/HTTP 405 \(.*method not allowed.*\):/i);
    expect(String(err)).toMatch(/method not allowed/i);
  });

  test("extracts the nested message when an edge-layer error wraps {code, message} instead of a plain string", async () => {
    // Live capture: POST .../deployments/{owner}/{deployment}/predict with an
    // oversized file -> 413 {"error":{"code":"413","message":"Request Entity Too Large"}}.
    // This 413 is generated in front of the app (a body-size gate), so it
    // does not follow the app's own ErrorResponse.error: string contract.
    const { impl } = makeFetch([
      new Response(
        JSON.stringify({
          error: { code: "413", message: "Request Entity Too Large" },
        }),
        { status: 413 },
      ),
    ]);
    const err = await client(impl)
      .get("/deployments/alice/road-detector/predict")
      .catch((e) => e as UltralyticsApiError);
    expect(err).toBeInstanceOf(UltralyticsApiError);
    expect(err.statusCode).toBe(413);
    expect(err.apiMessage).toBe("Request Entity Too Large");
    expect(String(err)).toMatch(/Request Entity Too Large/);
  });

  test("retries a 429 once then succeeds", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ error: "rate" }), {
        status: 429,
        headers: { "Retry-After": "0" },
      }),
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    ]);
    const result = await client(impl).get("/projects");
    expect(result).toEqual({ projects: [] });
    expect(calls).toHaveLength(2);
  });
});

describe("UltralyticsClient POST", () => {
  test("postJson does not retry a 429 (no duplicate state-changing calls)", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ error: "rate" }), {
        status: 429,
        headers: { "Retry-After": "0" },
      }),
    ]);
    await expect(
      client(impl).postJson("/training/start", { modelId: "x" }),
    ).rejects.toThrowError(UltralyticsApiError);
    expect(calls).toHaveLength(1);
  });

  test("postJson sends a JSON content-type and body", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    await client(impl).postJson("/exports", { modelId: "x", format: "onnx" });
    expect(headersOf(calls[0].init)["Content-Type"]).toBe("application/json");
    expect(calls[0].init.body).toBe(
      JSON.stringify({ modelId: "x", format: "onnx" }),
    );
  });

  test("postMultipart sends form data fields", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ images: [] }), { status: 200 }),
    ]);
    await client(impl).postMultipart("/models/abc/predict", {
      data: { source: "https://x/y.jpg", conf: "0.5" },
    });
    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("source")).toBe("https://x/y.jpg");
    expect(body.get("conf")).toBe("0.5");
  });
});

describe("UltralyticsClient.getAccountOwner", () => {
  test("reads the owner from the account summary", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ username: "alice" }), { status: 200 }),
    ]);
    const owner = await client(impl).getAccountOwner();
    expect(owner).toBe("alice");
    expect(calls[0].url).toBe(`${BASE}/account/summary`);
  });

  test("caches the owner for the lifetime of the client", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ username: "alice" }), { status: 200 }),
    ]);
    const owned = client(impl);
    await expect(owned.getAccountOwner()).resolves.toBe("alice");
    await expect(owned.getAccountOwner()).resolves.toBe("alice");
    expect(calls).toHaveLength(1);
  });

  test("fails loudly when the summary has no username", async () => {
    const { impl } = makeFetch([
      new Response(JSON.stringify({ plan: "pro" }), { status: 200 }),
    ]);
    await expect(client(impl).getAccountOwner()).rejects.toThrow(/username/);
  });
});

describe("UltralyticsClient signed upload", () => {
  function uploadClient(uploadImpl: typeof fetch) {
    const api = makeFetch([new Response("{}", { status: 200 })]);
    return {
      owned: new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: api.impl,
        uploadFetchImpl: uploadImpl,
      }),
    };
  }

  test("sends runtime headers with the declared content type and no auth", async () => {
    const upload = makeFetch([new Response("", { status: 200 })]);
    const { owned } = uploadClient(upload.impl);
    await owned.putSignedBytes(
      "https://signed.example/upload?REDACTED",
      new TextEncoder().encode("archive"),
      "application/zip",
      { "x-goog-if-generation-match": "0", "Content-Length": "7" },
    );
    expect(upload.calls[0].url).toBe("https://signed.example/upload?REDACTED");
    const headers = headersOf(upload.calls[0].init);
    expect(headers["Content-Type"]).toBe("application/zip");
    expect(headers["x-goog-if-generation-match"]).toBe("0");
    expect(headers["Content-Length"]).toBe("7");
    expect(headers.Authorization).toBeUndefined();
    expect("duplex" in upload.calls[0].init).toBe(false);
  });

  test("sets duplex half for stream bodies without buffering them", async () => {
    const upload = makeFetch([new Response("", { status: 200 })]);
    const { owned } = uploadClient(upload.impl);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("archive"));
        controller.close();
      },
    });
    await owned.putSignedBytes(
      "https://signed.example/upload?REDACTED",
      stream,
      "application/zip",
      { "Content-Length": "7" },
    );
    const init = upload.calls[0].init as RequestInit & { duplex?: string };
    expect(init.duplex).toBe("half");
    expect(headersOf(init)["Content-Length"]).toBe("7");
  });

  test("uploadBytes keeps sending bytes with no auth", async () => {
    const upload = makeFetch([new Response("", { status: 200 })]);
    const { owned } = uploadClient(upload.impl);
    await owned.uploadBytes(
      "https://signed.example/upload",
      new TextEncoder().encode("archive"),
      "application/zip",
      { "x-goog-if-generation-match": "0" },
    );
    const headers = headersOf(upload.calls[0].init);
    expect(headers["Content-Type"]).toBe("application/zip");
    expect(headers["x-goog-if-generation-match"]).toBe("0");
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("UltralyticsClient.downloadBytes", () => {
  test("fetches a signed URL without forwarding Authorization", async () => {
    const api = makeFetch([new Response("{}", { status: 200 })]);
    const download = makeFetch([new Response("weights", { status: 200 })]);
    const bytes = await client(api.impl, download.impl).downloadBytes(
      "https://signed.example/best.pt",
    );
    expect(new TextDecoder().decode(bytes)).toBe("weights");
    const headers = headersOf(download.calls[0].init);
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("*/*");
    expect(download.calls[0].url).toBe("https://signed.example/best.pt");
  });

  test("throws a normalized error on download failure", async () => {
    const api = makeFetch([new Response("{}", { status: 200 })]);
    const download = makeFetch([
      new Response(JSON.stringify({ error: "gone" }), { status: 404 }),
    ]);
    await expect(
      client(api.impl, download.impl).downloadBytes("https://signed.example/x"),
    ).rejects.toThrowError(UltralyticsApiError);
  });
});
