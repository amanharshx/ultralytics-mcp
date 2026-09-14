/** Read-only deployment tools. */

import type { UltralyticsClient } from "../client.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField } from "./shared.js";

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
  const { owner: refOwner, deployment: slug } = splitDeploymentRef(deployment);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
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
  const { owner: refOwner, deployment: slug } = splitDeploymentRef(deployment);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
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
  const { owner: refOwner, deployment: slug } = splitDeploymentRef(deployment);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
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
