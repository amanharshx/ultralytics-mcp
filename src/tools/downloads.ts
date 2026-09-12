/** Model weight download tool. Writes to an explicit local path; the signed-URL
 * fetch never forwards API credentials (handled by client.downloadBytes).
 */

import { lstat, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { UltralyticsClient } from "../client.js";
import { type ResolvedModelRef, resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { listField } from "./shared.js";

function fileName(info: Record<string, unknown>): string | null {
  const value = info.name;
  return value ? String(value) : null;
}

function fileUrl(info: Record<string, unknown>): string | null {
  const value = info.downloadUrl;
  return value ? String(value) : null;
}

function urlPathBasename(info: Record<string, unknown>): string | null {
  const url = fileUrl(info);
  if (url === null) {
    return null;
  }
  try {
    return basename(new URL(url).pathname);
  } catch {
    return null;
  }
}

function fileMatchesName(
  file: Record<string, unknown>,
  filename: string,
): boolean {
  const name = fileName(file);
  const requested = basename(filename);
  if (name !== null && (name === filename || basename(name) === requested)) {
    return true;
  }
  return urlPathBasename(file) === requested;
}

function availableFileNames(files: Record<string, unknown>[]): string {
  return files
    .map((file) => {
      const name = fileName(file) ?? "unknown";
      const urlName = urlPathBasename(file);
      return urlName && urlName !== basename(name)
        ? `${name} (url: ${urlName})`
        : name;
    })
    .join(", ");
}

function modelFiles(data: unknown): Record<string, unknown>[] {
  return listField(data, "files");
}

function selectModelFile(
  files: Record<string, unknown>[],
  ref: ResolvedModelRef,
  resolvedOwner: string,
  filename?: string,
): Record<string, unknown> {
  if (files.length === 0) {
    throw new Error(
      `Model '${ref.model}' for owner '${resolvedOwner}' project '${ref.project}' ` +
        `has no downloadable weight files yet; it may not be trained.`,
    );
  }
  if (filename) {
    for (const file of files) {
      if (fileMatchesName(file, filename)) {
        return file;
      }
    }
    throw new Error(
      `No model file matching '${filename}'. Available: ${availableFileNames(files)}.`,
    );
  }
  for (const file of files) {
    if (urlPathBasename(file) === "best.pt") {
      return file;
    }
  }
  for (const file of files) {
    if (basename(fileName(file) ?? "") === "best.pt") {
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

async function lstatSafe(
  target: string,
): Promise<{ exists: boolean; isDir: boolean; isSymlink: boolean }> {
  try {
    const info = await lstat(target);
    return {
      exists: true,
      isDir: info.isDirectory(),
      isSymlink: info.isSymbolicLink(),
    };
  } catch {
    return { exists: false, isDir: false, isSymlink: false };
  }
}

async function writeFileAtomic(
  target: string,
  content: Uint8Array,
): Promise<void> {
  const parent = dirname(target);
  const temporary = join(
    parent,
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
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

  const targetInfo = await lstatSafe(target);
  if (targetInfo.exists && targetInfo.isDir) {
    throw new Error(`Output path is a directory: ${target}`);
  }
  if (targetInfo.exists && targetInfo.isSymlink) {
    throw new Error(`Output path is a symbolic link: ${target}`);
  }
  if (targetInfo.exists && !overwrite) {
    throw new Error(
      `Output path exists: ${target}. Pass overwrite=true to replace it.`,
    );
  }
  return target;
}

/** Download one model weight file to an explicit local path.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and lists
 * the model's files through the live owner-scoped endpoint. The API returns
 * `{files[]}` with each entry naming the file via `name`, `size`, and
 * `downloadUrl`. An empty list means the model has no weights yet, which is
 * reported distinctly from a failed download. The signed-URL fetch never
 * forwards API credentials (handled by client.downloadBytes).
 */
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
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/files`,
  );
  const fileInfo = selectModelFile(
    modelFiles(data),
    resolved,
    resolvedOwner,
    filename,
  );
  const selectedName = fileName(fileInfo) ?? filename ?? "model file";
  const signedUrl = fileUrl(fileInfo);
  if (signedUrl === null) {
    throw new Error(
      `Model file '${selectedName}' did not include a download URL.`,
    );
  }

  const content = await client.downloadBytes(signedUrl);
  await writeFileAtomic(target, content);
  return {
    summary: `Downloaded ${selectedName} to ${target} (${content.length} bytes).`,
    data: {
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      filename: selectedName,
      path: target,
      bytes: content.length,
    },
  };
}
