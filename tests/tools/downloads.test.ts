import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { modelDownload } from "../../src/tools/downloads.js";
import { BASE, jsonResponse, KEY } from "../helpers.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ul-mcp-dl-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

interface DownloadCall {
  url: string;
  auth: string | undefined;
}

interface TestClientOptions {
  /** Entries served as `{files}` on the owner-scoped files path. */
  files?: Array<Record<string, unknown>>;
  /** Raw body served on the files path instead of `{files}`. */
  filesBody?: unknown;
  /** Status served on the files path. */
  filesStatus?: number;
  /** Owner served by the account summary; unset makes the lookup fail. */
  accountOwner?: string;
  /** Bytes served by the signed-URL download. */
  body?: string;
}

/** Client serving the owner-scoped files path with live field names. */
function downloadClient(options: TestClientOptions = {}) {
  const {
    files = [
      { name: "exp.pt", size: 7, downloadUrl: "https://signed.example/exp.pt" },
    ],
    filesBody,
    filesStatus = 200,
    accountOwner,
    body = "weights",
  } = options;
  const calls: { path: string; method: string }[] = [];
  const downloadCalls: DownloadCall[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    calls.push({
      path: parsed.pathname,
      method: (init.method ?? "GET").toUpperCase(),
    });
    if (parsed.pathname === "/api/account/summary") {
      if (accountOwner === undefined) {
        return jsonResponse({ error: "unexpected account lookup" }, 500);
      }
      return jsonResponse({ username: accountOwner });
    }
    if (parsed.pathname === "/api/models/alice/road/exp/files") {
      return jsonResponse(filesBody ?? { files }, filesStatus);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
  const downloadFetchImpl = (async (
    url: string | URL,
    init: RequestInit = {},
  ) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    downloadCalls.push({ url: String(url), auth: headers.Authorization });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  const client = new UltralyticsClient({
    apiKey: KEY,
    baseUrl: BASE,
    fetchImpl,
    downloadFetchImpl,
  });
  return { client, calls, downloadCalls };
}

describe("modelDownload", () => {
  test("downloads through the owner-scoped files path using live field names", async () => {
    const { client, calls, downloadCalls } = downloadClient();
    const outputPath = join(tmp, "exp.pt");

    const result = await modelDownload(client, "alice/road/exp", {
      outputPath,
    });

    expect(calls).toEqual([
      { path: "/api/models/alice/road/exp/files", method: "GET" },
    ]);
    expect(result.summary).toBe(
      `Downloaded exp.pt to ${outputPath} (7 bytes).`,
    );
    expect(result.data).toEqual({
      owner: "alice",
      project: "road",
      model: "exp",
      filename: "exp.pt",
      path: outputPath,
      bytes: 7,
    });
    expect(downloadCalls[0].url).toBe("https://signed.example/exp.pt");
    expect(downloadCalls[0].auth).toBeUndefined();
    expect(await readFile(outputPath, "utf8")).toBe("weights");
  });

  test("accepts a ul:// model URI without an account lookup", async () => {
    const { client, calls } = downloadClient();
    const outputPath = join(tmp, "exp.pt");

    const result = await modelDownload(client, "ul://alice/road/exp", {
      outputPath,
    });

    expect(calls).toEqual([
      { path: "/api/models/alice/road/exp/files", method: "GET" },
    ]);
    expect(result.data).toMatchObject({
      owner: "alice",
      project: "road",
      model: "exp",
    });
  });

  test("fills a missing owner from the account summary for a bare slug", async () => {
    const { client, calls } = downloadClient({ accountOwner: "alice" });
    const outputPath = join(tmp, "exp.pt");

    const result = await modelDownload(client, "exp", {
      outputPath,
      project: "road",
    });

    expect(calls).toEqual([
      { path: "/api/account/summary", method: "GET" },
      { path: "/api/models/alice/road/exp/files", method: "GET" },
    ]);
    expect(result.data).toMatchObject({
      owner: "alice",
      project: "road",
      model: "exp",
    });
  });

  test("rejects a bare id without any network call", async () => {
    const { client, calls } = downloadClient();

    await expect(
      modelDownload(client, "a".repeat(24), {
        outputPath: join(tmp, "exp.pt"),
      }),
    ).rejects.toThrow(/not addressable.*owner\/project\/model.*ul:\/\//s);
    expect(calls).toHaveLength(0);
  });

  test("requires a project for a bare slug", async () => {
    const { client, calls } = downloadClient();

    await expect(
      modelDownload(client, "exp", { outputPath: join(tmp, "exp.pt") }),
    ).rejects.toThrow(/project is required/);
    expect(calls).toHaveLength(0);
  });

  test("names the model when it has no downloadable weight files", async () => {
    const { client } = downloadClient({ files: [] });
    const outputPath = join(tmp, "exp.pt");

    await expect(
      modelDownload(client, "alice/road/exp", { outputPath }),
    ).rejects.toThrow(
      /Model 'exp' for owner 'alice' project 'road' has no downloadable weight files.*may not be trained/s,
    );
  });

  // Live capture: GET /api/models/{owner}/{project}/{bad-model}/files -> 404 {"error":"Model not found"}
  test("surfaces the API message for a missing model", async () => {
    const { client } = downloadClient({
      filesBody: { error: "Model not found" },
      filesStatus: 404,
    });

    await expect(
      modelDownload(client, "alice/road/exp", {
        outputPath: join(tmp, "exp.pt"),
      }),
    ).rejects.toThrow(/Model not found/);
  });

  test("selects the requested filename and downloads without forwarding auth", async () => {
    const { client, downloadCalls } = downloadClient({
      files: [
        {
          name: "last.pt",
          size: 8,
          downloadUrl: "https://signed.example/last.pt",
        },
        {
          name: "best.pt",
          size: 7,
          downloadUrl: "https://signed.example/best.pt",
        },
      ],
    });
    const outputPath = join(tmp, "best.pt");

    const result = await modelDownload(client, "alice/road/exp", {
      outputPath,
      filename: "best.pt",
    });
    expect(result.summary).toBe(
      `Downloaded best.pt to ${outputPath} (7 bytes).`,
    );
    expect(result.data).toEqual({
      owner: "alice",
      project: "road",
      model: "exp",
      filename: "best.pt",
      path: outputPath,
      bytes: 7,
    });
    expect(downloadCalls[0].url).toBe("https://signed.example/best.pt");
    expect(downloadCalls[0].auth).toBeUndefined();
    expect(await readFile(outputPath, "utf8")).toBe("weights");
  });

  test("matches requested filename against the download link path basename", async () => {
    const { client, downloadCalls } = downloadClient({
      files: [
        {
          name: "exp-4.pt",
          size: 7,
          downloadUrl: "https://signed.example/models/abc/best.pt?x=1",
        },
      ],
    });
    const outputPath = join(tmp, "best.pt");

    const result = await modelDownload(client, "alice/road/exp", {
      outputPath,
      filename: "best.pt",
    });

    expect(result.summary).toBe(
      `Downloaded exp-4.pt to ${outputPath} (7 bytes).`,
    );
    expect(result.data).toEqual({
      owner: "alice",
      project: "road",
      model: "exp",
      filename: "exp-4.pt",
      path: outputPath,
      bytes: 7,
    });
    expect(downloadCalls[0].url).toBe(
      "https://signed.example/models/abc/best.pt?x=1",
    );
  });

  test("prefers best.pt from the download link path when no filename is requested", async () => {
    const { client, downloadCalls } = downloadClient({
      files: [
        {
          name: "last.pt",
          size: 8,
          downloadUrl: "https://signed.example/models/abc/last.pt",
        },
        {
          name: "exp-4.pt",
          size: 7,
          downloadUrl: "https://signed.example/models/abc/best.pt",
        },
      ],
    });
    const outputPath = join(tmp, "best.pt");

    await modelDownload(client, "alice/road/exp", { outputPath });

    expect(downloadCalls[0].url).toBe(
      "https://signed.example/models/abc/best.pt",
    );
  });

  test("lists file names and link basenames when requested filename is missing", async () => {
    const { client } = downloadClient({
      files: [
        {
          name: "exp-4.pt",
          size: 7,
          downloadUrl: "https://signed.example/models/abc/best.pt",
        },
        { name: "last.pt", size: 8, downloadUrl: "not a url" },
      ],
    });
    const outputPath = join(tmp, "missing.pt");

    await expect(
      modelDownload(client, "alice/road/exp", {
        outputPath,
        filename: "missing.pt",
      }),
    ).rejects.toThrow(
      /No model file matching 'missing.pt'. Available: exp-4.pt \(url: best.pt\), last.pt/,
    );
  });

  test("refuses to overwrite an existing file by default", async () => {
    const { client } = downloadClient();
    const outputPath = join(tmp, "exp.pt");
    await writeFile(outputPath, "existing");

    await expect(
      modelDownload(client, "alice/road/exp", { outputPath }),
    ).rejects.toThrow(/Output path exists/);
    // Untouched.
    expect(await readFile(outputPath, "utf8")).toBe("existing");
  });

  test("rejects symlink targets even when overwrite is enabled", async () => {
    const { client } = downloadClient();
    const linkedPath = join(tmp, "linked.pt");
    const outputPath = join(tmp, "exp.pt");
    await writeFile(linkedPath, "existing");
    await symlink(linkedPath, outputPath);

    await expect(
      modelDownload(client, "alice/road/exp", { outputPath, overwrite: true }),
    ).rejects.toThrow(/symbolic link/);
    expect(await readFile(linkedPath, "utf8")).toBe("existing");
  });

  test("requires an existing parent directory", async () => {
    const { client } = downloadClient();
    const outputPath = join(tmp, "missing-dir", "exp.pt");
    await expect(
      modelDownload(client, "alice/road/exp", { outputPath }),
    ).rejects.toThrow(/Output directory does not exist/);
  });
});
