/** Model weight download tool. Writes to an explicit local path; the signed-URL
 * fetch never forwards API credentials (handled by client.downloadBytes).
 */

import { stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord } from "./shared.js";

function fileName(info: Record<string, unknown>): string | null {
  const value = info.name ?? info.filename ?? info.fileName;
  return value ? String(value) : null;
}

function fileUrl(info: Record<string, unknown>): string | null {
  const value =
    info.url ?? info.downloadUrl ?? info.download_url ?? info.signedUrl;
  return value ? String(value) : null;
}

function modelFiles(data: unknown): Record<string, unknown>[] {
  const record = asRecord(data);
  const files = record.files ?? record.modelFiles ?? record.models;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter((item) => item && typeof item === "object") as Record<
    string,
    unknown
  >[];
}

function selectModelFile(
  files: Record<string, unknown>[],
  filename?: string,
): Record<string, unknown> {
  if (files.length === 0) {
    throw new Error("No downloadable model files returned by the API.");
  }
  if (filename) {
    for (const file of files) {
      if (fileName(file) === filename) {
        return file;
      }
    }
    throw new Error(
      `No model file named '${filename}' was returned by the API.`,
    );
  }
  for (const file of files) {
    if (fileName(file) === "best.pt") {
      return file;
    }
  }
  return files[0];
}

function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

async function statSafe(
  target: string,
): Promise<{ exists: boolean; isDir: boolean }> {
  try {
    const info = await stat(target);
    return { exists: true, isDir: info.isDirectory() };
  } catch {
    return { exists: false, isDir: false };
  }
}

async function downloadTarget(
  outputPath: string,
  overwrite: boolean,
): Promise<string> {
  if (!outputPath?.trim()) {
    throw new Error("`output_path` is required.");
  }
  const target = resolve(expandHome(outputPath));
  const parent = dirname(target);

  const parentInfo = await statSafe(parent);
  if (!parentInfo.exists) {
    throw new Error(`Output directory does not exist: ${parent}`);
  }
  if (!parentInfo.isDir) {
    throw new Error(`Output parent is not a directory: ${parent}`);
  }

  const targetInfo = await statSafe(target);
  if (targetInfo.exists && targetInfo.isDir) {
    throw new Error(`Output path is a directory: ${target}`);
  }
  if (targetInfo.exists && !overwrite) {
    throw new Error(
      `Output path exists: ${target}. Pass overwrite=true to replace it.`,
    );
  }
  return target;
}

/** Download one model weight file to an explicit local path. */
export async function modelDownload(
  client: UltralyticsClient,
  model: string,
  options: {
    outputPath: string;
    project?: string;
    filename?: string;
    overwrite?: boolean;
  },
): Promise<NormalizedToolResult> {
  const { outputPath, project, filename, overwrite = false } = options;
  const target = await downloadTarget(outputPath, overwrite);
  const modelId = await resolveModel(client, model, project);
  const data = await client.get(`/models/${modelId}/files`);
  const fileInfo = selectModelFile(modelFiles(data), filename);
  const selectedName = fileName(fileInfo) ?? filename ?? "model file";
  const signedUrl = fileUrl(fileInfo);
  if (signedUrl === null) {
    throw new Error(
      `Model file '${selectedName}' did not include a download URL.`,
    );
  }

  const content = await client.downloadBytes(signedUrl);
  await writeFile(target, content);
  return {
    summary: `Downloaded ${selectedName} to ${target} (${content.length} bytes).`,
    data: {
      modelId,
      filename: selectedName,
      path: target,
      bytes: content.length,
    },
  };
}
