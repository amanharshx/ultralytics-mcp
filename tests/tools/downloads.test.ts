import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { modelDownload } from "../../src/tools/downloads.js";
import { BASE, KEY } from "../helpers.js";

const ID = "a".repeat(24);

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ul-mcp-dl-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Client with a files endpoint and a recorded signed-URL download fetch. */
function downloadClient(
  files: Array<{ name: string; url: string }>,
  body: string,
) {
  const downloadCalls: { url: string; auth: string | undefined }[] = [];
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith(`/models/${ID}/files`)) {
      return new Response(JSON.stringify({ files }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
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
  return { client, downloadCalls };
}

describe("modelDownload", () => {
  test("selects the requested filename and downloads without forwarding auth", async () => {
    const { client, downloadCalls } = downloadClient(
      [
        { name: "last.pt", url: "https://signed.example/last.pt" },
        { name: "best.pt", url: "https://signed.example/best.pt" },
      ],
      "weights",
    );
    const outputPath = join(tmp, "best.pt");

    const result = await modelDownload(client, ID, {
      outputPath,
      filename: "best.pt",
    });
    expect(result.summary).toBe(
      `Downloaded best.pt to ${outputPath} (7 bytes).`,
    );
    expect(result.data).toEqual({
      modelId: ID,
      filename: "best.pt",
      path: outputPath,
      bytes: 7,
    });
    expect(downloadCalls[0].url).toBe("https://signed.example/best.pt");
    expect(downloadCalls[0].auth).toBeUndefined();
    expect(await readFile(outputPath, "utf8")).toBe("weights");
  });

  test("refuses to overwrite an existing file by default", async () => {
    const { client } = downloadClient(
      [{ name: "best.pt", url: "https://x/best.pt" }],
      "weights",
    );
    const outputPath = join(tmp, "best.pt");
    await writeFile(outputPath, "existing");

    await expect(modelDownload(client, ID, { outputPath })).rejects.toThrow(
      /Output path exists/,
    );
    // Untouched.
    expect(await readFile(outputPath, "utf8")).toBe("existing");
  });

  test("requires an existing parent directory", async () => {
    const { client } = downloadClient(
      [{ name: "best.pt", url: "https://x/best.pt" }],
      "weights",
    );
    const outputPath = join(tmp, "missing-dir", "best.pt");
    await expect(modelDownload(client, ID, { outputPath })).rejects.toThrow(
      /Output directory does not exist/,
    );
  });
});
