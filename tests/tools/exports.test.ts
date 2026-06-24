import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  exportCreate,
  exportStatus,
  exportsList,
} from "../../src/tools/exports.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

const ID = "a".repeat(24);
const EXPORT_ID = "e".repeat(24);

/** Client that records request method/body and replies via `responder`. */
function captureClient(responder: (url: string) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
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

function throwingClient() {
  return new UltralyticsClient({
    apiKey: KEY,
    baseUrl: BASE,
    fetchImpl: (async () => {
      throw new Error("network must not be called");
    }) as unknown as typeof fetch,
  });
}

describe("exportsList", () => {
  test("summarizes export jobs", async () => {
    const { client } = routeClient((path, params) => {
      if (path === "/api/exports" && params.get("modelId") === ID) {
        return jsonResponse({
          exports: [{ _id: EXPORT_ID, format: "onnx", status: "completed" }],
        });
      }
      return jsonResponse({}, 404);
    });
    const result = await exportsList(client, ID);
    expect(result.summary).toBe("1 export(s) for model.");
    expect(result.data).toEqual([
      { id: EXPORT_ID, format: "onnx", status: "completed" },
    ]);
  });
});

describe("exportStatus", () => {
  test("rejects a non-24-hex id before any network call", async () => {
    await expect(exportStatus(throwingClient(), "not-an-id")).rejects.toThrow(
      /must be a 24-character export id/,
    );
  });

  test("returns status for a valid id", async () => {
    const { client } = routeClient((path) =>
      path === `/api/exports/${EXPORT_ID}`
        ? jsonResponse({
            export: { _id: EXPORT_ID, status: "running", format: "onnx" },
          })
        : jsonResponse({}, 404),
    );
    const result = await exportStatus(client, EXPORT_ID);
    expect(result.summary).toBe(
      `Export ${EXPORT_ID} status=running format=onnx.`,
    );
  });
});

describe("exportCreate", () => {
  test("rejects when confirm_cost is false before any network call", async () => {
    await expect(exportCreate(throwingClient(), ID, "onnx")).rejects.toThrow(
      /Set confirm_cost=true/,
    );
  });

  test("rejects an unsupported format before any network call", async () => {
    await expect(
      exportCreate(throwingClient(), ID, "bogus", { confirmCost: true }),
    ).rejects.toThrow(/Unsupported export format/);
  });

  test("requires gpu_type for engine exports before any network call", async () => {
    await expect(
      exportCreate(throwingClient(), ID, "engine", { confirmCost: true }),
    ).rejects.toThrow(/gpu_type` is required for TensorRT/);
  });

  test("posts the export payload and summarizes the job", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({
        export: { _id: EXPORT_ID, status: "queued", format: "onnx" },
      }),
    );
    const result = await exportCreate(client, ID, "ONNX", {
      confirmCost: true,
    });
    expect(result.summary).toBe(
      `Created export ${EXPORT_ID} status=queued format=onnx.`,
    );
    expect(calls[0]).toMatchObject({
      url: `${BASE}/exports`,
      method: "POST",
      body: { modelId: ID, format: "onnx" },
    });
  });
});
