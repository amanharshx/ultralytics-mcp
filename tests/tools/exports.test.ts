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
  const OWNER = "alice";
  const PROJECT = "road";
  const MODEL = "exp";
  const REF = `${OWNER}/${PROJECT}/${MODEL}`;
  const EXPORTS_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}/exports`;

  const completedExport = {
    id: "c".repeat(24),
    status: "completed",
    format: "onnx",
    args: {
      format: "onnx",
      imgsz: 640,
      half: true,
      dynamic: false,
      simplify: true,
      nms: false,
      batch: 1,
    },
    file: {
      size: 111752607,
      downloadUrl: "https://storage.example/alice/road/exp.onnx",
      downloadFilename: "exp.onnx",
    },
    startedAt: "2026-05-17T14:38:32.696Z",
    completedAt: "2026-05-17T14:38:38.956Z",
    createdAt: "2026-05-17T14:38:31.741Z",
    updatedAt: "2026-05-17T14:38:38.956Z",
  };

  const curatedCompleted = {
    id: "c".repeat(24),
    format: "onnx",
    status: "completed",
    createdAt: "2026-05-17T14:38:31.741Z",
    startedAt: "2026-05-17T14:38:32.696Z",
    completedAt: "2026-05-17T14:38:38.956Z",
    updatedAt: "2026-05-17T14:38:38.956Z",
    fileSize: 111752607,
    downloadFilename: "exp.onnx",
    args: {
      format: "onnx",
      imgsz: 640,
      half: true,
      dynamic: false,
      simplify: true,
      nms: false,
      batch: 1,
    },
  };

  function exportsClient(
    options: {
      exportsBody?: unknown;
      exportsStatus?: number;
      accountOwner?: string;
    } = {},
  ) {
    const {
      exportsBody = { exports: [completedExport], region: "eu" },
      exportsStatus = 200,
      accountOwner,
    } = options;
    return routeClient((path) => {
      if (path === "/api/account/summary") {
        if (accountOwner === undefined) {
          return jsonResponse({ error: "unexpected account lookup" }, 500);
        }
        return jsonResponse({ username: accountOwner });
      }
      if (path === EXPORTS_PATH) {
        return jsonResponse(exportsBody, exportsStatus);
      }
      return jsonResponse({}, 404);
    });
  }

  test("reads live field names through the owner-scoped path for a full reference", async () => {
    const { client, calls } = exportsClient();

    const result = await exportsList(client, REF);

    expect(calls.map((call) => call.path)).toEqual([EXPORTS_PATH]);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 export(s).",
    );
    expect(result.data).toEqual([curatedCompleted]);
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = exportsClient();

    const result = await exportsList(client, "ul://alice/road/exp");

    expect(calls.map((call) => call.path)).toEqual([EXPORTS_PATH]);
    expect(result.data).toEqual([curatedCompleted]);
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = exportsClient({ accountOwner: OWNER });

    const result = await exportsList(client, MODEL, PROJECT);

    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      EXPORTS_PATH,
    ]);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 1 export(s).",
    );
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = exportsClient();
    await expect(exportsList(client, "b".repeat(24))).rejects.toThrow(
      /not addressable.*owner\/project\/model.*ul:\/\//s,
    );
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = exportsClient();
    await expect(exportsList(client, MODEL)).rejects.toThrow(
      /project is required/,
    );
    expect(calls).toHaveLength(0);
  });

  test("handles a model with no exports", async () => {
    const { client, calls } = exportsClient({
      exportsBody: { exports: [], region: "eu" },
    });

    const result = await exportsList(client, REF);

    expect(calls.map((call) => call.path)).toEqual([EXPORTS_PATH]);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 0 export(s).",
    );
    expect(result.data).toEqual([]);
  });

  test("tells a running export from a completed one without a second call", async () => {
    const runningExport = {
      id: "d".repeat(24),
      status: "running",
      format: "onnx",
      args: { format: "onnx", imgsz: 640 },
      file: null,
      startedAt: "2026-05-17T14:40:00.000Z",
      completedAt: null,
      createdAt: "2026-05-17T14:39:58.000Z",
      updatedAt: "2026-05-17T14:40:01.000Z",
    };
    const { client, calls } = exportsClient({
      exportsBody: { exports: [completedExport, runningExport], region: "eu" },
    });

    const result = await exportsList(client, REF);

    expect(calls.map((call) => call.path)).toEqual([EXPORTS_PATH]);
    expect(result.summary).toBe(
      "Model 'exp' for owner 'alice' project 'road': 2 export(s).",
    );
    const items = result.data as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      status: "completed",
      fileSize: 111752607,
      downloadFilename: "exp.onnx",
    });
    expect(items[0]?.completedAt).not.toBeNull();
    expect(items[1]).toMatchObject({
      status: "running",
      fileSize: null,
      downloadFilename: null,
      completedAt: null,
    });
  });

  test("surfaces the API message for a model that does not exist", async () => {
    const { client } = exportsClient({
      exportsBody: { error: "Model not found" },
      exportsStatus: 404,
    });
    await expect(exportsList(client, REF)).rejects.toThrow(/Model not found/);
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
