/** Read-only deployment tools. */

import type { UltralyticsClient } from "../client.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { listField } from "./shared.js";

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
