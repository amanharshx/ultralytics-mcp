/** Deployment tools: reads, plus the bounded-cost `predict` verb. */

import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { UltralyticsClient } from "../client.js";
import type { NormalizedToolResult } from "../tool-result.js";
import {
  asRecord,
  listField,
  type PredictParams,
  projectPredictResult,
} from "./shared.js";

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** Split a deployment ref into an optional owner and a bare deployment slug.
 *
 * Unlike project, dataset, and model refs, no resolver exists for
 * deployments: a bare 24-hex id is not rejected here, since nothing on the
 * platform rejects it either. `owner/deployment` splits on the last `/`;
 * anything without a `/` is a bare slug, and the caller fills the owner from
 * the account summary.
 */
function splitDeploymentRef(ref: string): {
  owner: string | null;
  deployment: string;
} {
  const trimmed = ref.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex === -1) {
    return { owner: null, deployment: trimmed };
  }
  return {
    owner: trimmed.slice(0, slashIndex),
    deployment: trimmed.slice(slashIndex + 1),
  };
}

/** Split a deployment ref and fill a missing owner from the account summary.
 *
 * Every single-deployment tool (`deployment_get`, `_health`, `_logs`,
 * `_metrics`) needs exactly this pair of steps before it can build a path,
 * so it lives once here rather than four times.
 */
async function resolveDeploymentRef(
  client: UltralyticsClient,
  ref: string,
): Promise<{ owner: string; slug: string }> {
  const { owner: refOwner, deployment: slug } = splitDeploymentRef(ref);
  const owner = refOwner ?? (await client.getAccountOwner());
  return { owner, slug };
}

/** List deployments in the workspace, optionally for an explicit owner.
 *
 * Reads the live owner-scoped endpoint. When no owner is given, the owner is
 * filled from the account summary and named in the summary output so the
 * caller can tell which workspace was read.
 *
 * Projects each deployment to the fields the spec guarantees present
 * (`Deployment.required` plus `project`/`model`/`task`, observed always
 * present). `serviceUrl` and `deployedAt` are absent until a deployment is
 * `ready`, and `metered`/`statusMessage`/`apiKeyId` were never observed at
 * all; none of the five are projected here so this list never guarantees
 * fields the platform does not.
 */
export async function deploymentsList(
  client: UltralyticsClient,
  owner?: string,
): Promise<NormalizedToolResult> {
  const explicitOwner = owner?.trim() || undefined;
  const resolvedOwner = explicitOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/deployments/${encodeURIComponent(resolvedOwner)}`,
  );
  const items = listField(data, "deployments").map((deployment) => ({
    id: deployment.id ?? null,
    owner: deployment.owner ?? null,
    deployment: deployment.deployment ?? null,
    name: deployment.name ?? null,
    status: deployment.status ?? null,
    region: deployment.region ?? null,
    resources: deployment.resources ?? null,
    createdAt: deployment.createdAt ?? null,
    updatedAt: deployment.updatedAt ?? null,
    project: deployment.project ?? null,
    model: deployment.model ?? null,
    task: deployment.task ?? null,
  }));
  return {
    summary: `${items.length} deployment(s) for owner '${resolvedOwner}'.`,
    data: items,
  };
}

/** Read one deployment by `owner/deployment` or a bare slug.
 *
 * `serviceUrl` and `deployedAt` are absent until the deployment reaches
 * `ready`; both are reported as `null` rather than omitted so a caller never
 * has to guess between "absent" and "not yet fetched". `apiKeyId` is never
 * echoed even if the platform ever returns it: the Deployment object carries
 * the key the endpoint authenticates with.
 */
export async function deploymentGet(
  client: UltralyticsClient,
  deployment: string,
): Promise<NormalizedToolResult> {
  const { owner: resolvedOwner, slug } = await resolveDeploymentRef(
    client,
    deployment,
  );
  const data = await client.get(
    `/deployments/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(slug)}`,
  );
  const record = asRecord(data);
  const fields = asRecord(record.deployment);
  const serviceUrl =
    typeof fields.serviceUrl === "string" ? fields.serviceUrl : null;
  const deployedAt =
    typeof fields.deployedAt === "string" ? fields.deployedAt : null;
  const status = fields.status ?? null;

  const result: Record<string, unknown> = {
    id: fields.id ?? null,
    owner: fields.owner ?? null,
    project: fields.project ?? null,
    model: fields.model ?? null,
    task: fields.task ?? null,
    deployment: fields.deployment ?? null,
    name: fields.name ?? null,
    status,
    region: fields.region ?? null,
    serviceUrl,
    resources: fields.resources ?? null,
    deployedAt,
    createdAt: fields.createdAt ?? null,
    updatedAt: fields.updatedAt ?? null,
  };
  if (typeof fields.metered === "boolean") {
    result.metered = fields.metered;
  }
  if (typeof fields.statusMessage === "string") {
    result.statusMessage = fields.statusMessage;
  }

  const urlNote = serviceUrl ?? "not yet available";
  return {
    summary: `Deployment '${slug}' for owner '${resolvedOwner}': status ${status ?? "unknown"}, serviceUrl ${urlNote}.`,
    data: result,
  };
}

/** Probe one deployment's health by `owner/deployment` or a bare slug.
 *
 * `status` is the upstream HTTP status the health probe observed at the
 * deployment's own service URL, not the status of this MCP call; the two
 * are never the same thing and are never conflated here.
 */
export async function deploymentHealth(
  client: UltralyticsClient,
  deployment: string,
): Promise<NormalizedToolResult> {
  const { owner: resolvedOwner, slug } = await resolveDeploymentRef(
    client,
    deployment,
  );
  const data = await client.get(
    `/deployments/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(slug)}/health`,
  );
  const fields = asRecord(data);
  const healthy = fields.healthy ?? null;
  const status = typeof fields.status === "number" ? fields.status : null;
  const latencyMs =
    typeof fields.latencyMs === "number" ? fields.latencyMs : null;

  const result: Record<string, unknown> = { healthy, status, latencyMs };
  if (typeof fields.error === "string") {
    result.error = fields.error;
  }

  return {
    summary: `Deployment '${slug}' for owner '${resolvedOwner}': ${healthy ? "healthy" : "unhealthy"} (probe status ${status ?? "unknown"}, ${latencyMs ?? "unknown"}ms).`,
    data: result,
  };
}

/** Read one deployment's logs by `owner/deployment` or a bare slug.
 *
 * `severity` is passed through as a plain, comma-separated string, never
 * validated client-side: it is an exact-match filter against the server's
 * eight-value set (`DEBUG`…`EMERGENCY`), not a minimum-severity threshold,
 * and a bad value's rejection is the server's message, not a local allowlist
 * firing. `entries` and `nextPageToken` are surfaced verbatim, including an
 * empty `entries` on a fresh deployment, which is a valid result, not an
 * error.
 */
export async function deploymentLogs(
  client: UltralyticsClient,
  deployment: string,
  options: { severity?: string; limit?: number; pageToken?: string } = {},
): Promise<NormalizedToolResult> {
  const { owner: resolvedOwner, slug } = await resolveDeploymentRef(
    client,
    deployment,
  );
  const data = await client.get(
    `/deployments/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(slug)}/logs`,
    {
      severity: options.severity,
      limit: options.limit,
      pageToken: options.pageToken,
    },
  );
  const fields = asRecord(data);
  const entries = listField(data, "entries");
  const nextPageToken =
    typeof fields.nextPageToken === "string" ? fields.nextPageToken : null;

  return {
    summary: `Deployment '${slug}' for owner '${resolvedOwner}': ${entries.length} log entr${entries.length === 1 ? "y" : "ies"}${nextPageToken ? " (more available)" : ""}.`,
    data: { entries, nextPageToken },
  };
}

/** Read one deployment's metrics by `owner/deployment` or a bare slug.
 *
 * The 200 response is an `anyOf` of two schemas selected by `sparkline`:
 * the default branch carries `timeRange` (an observed `{start, end}` object,
 * not the requested range string), `summary`, and `timeSeries`; the
 * `sparkline=true` branch carries `requests24h` (observed live as an array of
 * per-hour points, not a scalar), `totalRequests`, `errorRate`, and
 * `avgLatencyMs`. The two are never flattened, merged, or normalised into
 * one shape — which branch came back is information the caller asked for.
 * `timeSeries` only appears on the default branch, so its presence is the
 * discriminator. `range` and `sparkline` pass straight through as query
 * params with no client-side validation.
 */
export async function deploymentMetrics(
  client: UltralyticsClient,
  deployment: string,
  options: { range?: string; sparkline?: boolean } = {},
): Promise<NormalizedToolResult> {
  const { owner: resolvedOwner, slug } = await resolveDeploymentRef(
    client,
    deployment,
  );
  const rangeLabel = options.range ?? "24h";
  const data = await client.get(
    `/deployments/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(slug)}/metrics`,
    { range: options.range, sparkline: options.sparkline },
  );
  const fields = asRecord(data);

  if ("timeSeries" in fields) {
    const summary = asRecord(fields.summary);
    const result = {
      deploymentId:
        typeof fields.deploymentId === "string" ? fields.deploymentId : null,
      region: typeof fields.region === "string" ? fields.region : null,
      timeRange: fields.timeRange ?? null,
      summary: fields.summary ?? null,
      timeSeries: fields.timeSeries ?? null,
    };
    return {
      summary: `Deployment '${slug}' for owner '${resolvedOwner}': ${rangeLabel} metrics, ${summary.totalRequests ?? "unknown"} total requests.`,
      data: result,
    };
  }

  const result = {
    requests24h: Array.isArray(fields.requests24h) ? fields.requests24h : null,
    totalRequests:
      typeof fields.totalRequests === "number" ? fields.totalRequests : null,
    errorRate: typeof fields.errorRate === "number" ? fields.errorRate : null,
    avgLatencyMs:
      typeof fields.avgLatencyMs === "number" ? fields.avgLatencyMs : null,
  };
  return {
    summary: `Deployment '${slug}' for owner '${resolvedOwner}': sparkline metrics, ${result.totalRequests ?? "unknown"} total requests, ${result.errorRate ?? "unknown"} error rate.`,
    data: result,
  };
}

/** Run inference against one deployment by `owner/deployment` or a bare slug.
 *
 * Posts a local image file straight through as `multipart/form-data`; the
 * endpoint's `file` branch is the only one used here (a URL/base64 `source`
 * belongs to `model_predict`, which never accepts a local path). `images`
 * and `metadata` are returned verbatim, including metadata's undocumented
 * fields (`functionTimeAlive`, `functionTimeCall`, `task`, `version`) — none
 * of them are projected away. `conf`/`iou`/`imgsz` are optional and only
 * sent when given, letting the server apply its own defaults otherwise.
 *
 * No `402` is documented on this endpoint and a live inference left
 * `creditsCents` unchanged, so inference reads as included in the running
 * deployment's cost rather than billed per request — stated here as
 * observed, not promised. A `413` (input too large) or `503` (service
 * unavailable, e.g. a cold start on `minInstances: 0`) surfaces the
 * server's own message; this never retries silently.
 */
export async function deploymentPredict(
  client: UltralyticsClient,
  deployment: string,
  options: PredictParams & { imagePath: string },
): Promise<NormalizedToolResult> {
  const imagePath = options.imagePath?.trim();
  if (!imagePath) {
    throw new Error(
      "`imagePath` is required: a local image file to run inference on.",
    );
  }
  const info = await stat(imagePath).catch(() => null);
  if (info === null) {
    throw new Error(`Image file does not exist: ${imagePath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Image path is not a file: ${imagePath}`);
  }
  const filename = basename(imagePath);
  const contentType = IMAGE_CONTENT_TYPES[extname(filename).toLowerCase()];
  if (!contentType) {
    throw new Error(
      `Unsupported image file type for '${filename}'. Expected one of: ${Object.keys(
        IMAGE_CONTENT_TYPES,
      ).join(", ")}.`,
    );
  }
  const bytes = await readFile(imagePath);
  const blob = new Blob([bytes], { type: contentType });

  const { owner: resolvedOwner, slug } = await resolveDeploymentRef(
    client,
    deployment,
  );

  const data: Record<string, unknown> = {};
  if (options.conf !== undefined) data.conf = options.conf;
  if (options.iou !== undefined) data.iou = options.iou;
  if (options.imgsz !== undefined) data.imgsz = options.imgsz;

  const result = await client.postMultipart(
    `/deployments/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(slug)}/predict`,
    { data, files: { file: { blob, filename } } },
  );

  const { images, metadata, detectionCount } = projectPredictResult(result);

  return {
    summary: `Deployment '${slug}' for owner '${resolvedOwner}': ${images.length} image(s), ${detectionCount} detection(s).`,
    data: { owner: resolvedOwner, deployment: slug, images, metadata },
  };
}
