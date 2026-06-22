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
