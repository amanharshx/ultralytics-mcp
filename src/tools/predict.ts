/** Inference tool. Accepts an image URL, a base64 image, or a local file. */

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import type { MultipartFile, UltralyticsClient } from "../client.js";
import { resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { type PredictParams, projectPredictResult } from "./shared.js";

/** Standard or URL-safe base64 alphabet, padding only at the end. */
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Decode standard or URL-safe base64, or return null when it is malformed.
 *
 * ASCII whitespace is ignored, so line-wrapped payloads decode as written.
 * `Buffer.from` never rejects input — it skips unknown characters and drops a
 * dangling one — so the bytes are re-encoded and compared against the input
 * to reject anything that does not round-trip exactly.
 */
function decodeBase64(text: string): Buffer | null {
  const compact = text.replace(/[\t\n\v\f\r ]/g, "");
  if (!BASE64_PATTERN.test(compact)) return null;
  if (compact.includes("=") && compact.length % 4 !== 0) return null;
  const bytes = Buffer.from(compact, "base64");
  const canonical = compact
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return bytes.toString("base64url") === canonical ? bytes : null;
}

/** Run inference from an image URL, a base64 image, or a local file.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and posts
 * through the live owner-scoped endpoint. The API returns `{images[],
 * metadata}`; each image carries `shape`, `speed`, and `results[]`, and the
 * metadata names the `task` and `classNames`. The response carries no model
 * identity of its own, so the resolved owner/project/model the prediction
 * was sent to is reported as the model used.
 *
 * A `source` containing `://` is posted as the `source` field and the server
 * decides whether it can fetch it. Anything else must be base64 (raw or a
 * base64 `data:` URI) and is decoded and uploaded as the multipart `file`
 * part, because the endpoint caps `source` at 4,096 characters (~3 KB of
 * image). The part is always named `image.jpg`: the server rejects a file
 * part without a recognized extension (`blob`, `image`, `image.bin`) but
 * reads the bytes themselves, so PNG/WebP/BMP/TIFF content uploads fine
 * under that name (verified live). Malformed base64 and non-base64 `data:`
 * URIs are rejected before any request.
 *
 * A `filePath` is uploaded as the `file` part under its own basename, typed
 * `application/octet-stream`. Only existence and being a regular file are
 * checked locally: which image and video formats are supported, and how
 * large a file may be, are the server's rules and its errors are surfaced
 * verbatim (verified live: an `.mp4` returns one image entry per frame; the
 * spec documents `413` for oversized input). Exactly one of `source` and
 * `filePath` must be given.
 *
 * A model without weights fails with `400 {"error":"Model has no trained
 * weights"}` while an input the endpoint rejects (unreadable image,
 * unreachable URL) fails with its own `400`, so the surfaced message tells a
 * model problem from an input problem. Zero detections are a normal `200`
 * with empty `results`. `conf`/`iou`/`imgsz` are optional and only sent when
 * given, letting the server apply its own default otherwise (verified live:
 * identical detections with and without the fields set to 0.25/0.7/640).
 */
export async function modelPredict(
  client: UltralyticsClient,
  model: string,
  options: PredictParams & {
    source?: string;
    filePath?: string;
    project?: string;
  },
): Promise<NormalizedToolResult> {
  const { project, conf, iou, imgsz } = options;
  const source = options.source?.trim() ?? "";
  const filePath = options.filePath?.trim() ?? "";
  if (Boolean(source) === Boolean(filePath)) {
    throw new Error(
      "Provide exactly one of `source` (an image URL or base64-encoded " +
        "image) or `file_path` (a local image or video file).",
    );
  }
  let file: MultipartFile | undefined;
  if (filePath) {
    const info = await stat(filePath).catch(() => null);
    if (info === null) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    if (!info.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }
    file = {
      blob: new Blob([await readFile(filePath)]),
      filename: basename(filePath),
    };
  } else if (!source.includes("://")) {
    let payload = source;
    if (/^data:/i.test(source)) {
      payload = /^data:[^,]*;base64,(.*)$/is.exec(source)?.[1]?.trim() ?? "";
      if (!payload) {
        throw new Error(
          "`source` data: URIs must be base64 with a non-empty payload " +
            "(`data:<mime>;base64,<payload>`); image URLs and raw base64 are also accepted.",
        );
      }
    }
    const bytes = decodeBase64(payload);
    if (!bytes) {
      throw new Error(
        "`source` is neither an image URL nor valid base64 (standard or " +
          "URL-safe, optional padding, ASCII whitespace ignored). Pass a " +
          "local file as `file_path` instead.",
      );
    }
    file = { blob: new Blob([new Uint8Array(bytes)]), filename: "image.jpg" };
  }

  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data: Record<string, unknown> = {};
  if (!file) data.source = source;
  if (conf !== undefined) data.conf = conf;
  if (iou !== undefined) data.iou = iou;
  if (imgsz !== undefined) data.imgsz = imgsz;
  const result = await client.postMultipart(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}/predict`,
    { data, files: file ? { file } : undefined },
  );

  const { images, metadata, detectionCount } = projectPredictResult(result);
  return {
    summary:
      `Model '${resolved.model}' for owner '${resolvedOwner}' ` +
      `project '${resolved.project}': ${images.length} image(s), ` +
      `${detectionCount} detection(s).`,
    data: {
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      images,
      metadata,
    },
  };
}
