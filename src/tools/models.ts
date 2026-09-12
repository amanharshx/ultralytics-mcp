/** Model tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveLegacyModelId, resolveProject } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField, pyField } from "./shared.js";

/** List models in a project by slug, owner/slug, or project ul:// URI.
 *
 * Resolves the project reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the live owner-scoped endpoint. The API returns `{models[], region}`;
 * items name the resource via `id`, `model` (slug), `owner`, and `name`,
 * which the tool surfaces.
 */
export async function modelsList(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, project: refSlug } = resolveProject(project);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
  );
  const items = listField(data, "models").map((model) => ({
    id: model.id ?? null,
    name: model.name ?? null,
    slug: model.model ?? null,
    username: model.owner ?? null,
    visibility: model.visibility ?? null,
    status: model.status ?? null,
    task: model.task ?? null,
    epochs: model.epochs ?? null,
    bestFitness: model.bestFitness ?? null,
  }));
  return {
    summary: `${items.length} model(s) for project '${refSlug}' for owner '${resolvedOwner}'.`,
    data: items,
  };
}

/** Get one model by id, or by slug within a project. */
export async function modelsGet(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const modelId = await resolveLegacyModelId(client, model, project);
  const data = await client.get(`/models/${modelId}`);
  const record = asRecord(data);
  const item = "model" in record ? record.model : data;
  const fields = asRecord(item);
  const info = asRecord(fields.modelInfo);
  return {
    summary:
      `Model '${pyField(fields.name)}' [${pyField(fields.task)}] status=${pyField(fields.status)}, ` +
      `epochs=${pyField(fields.epochs)}, params=${pyField(info.parameters)}.`,
    data: item,
  };
}

/** Delete a model by id, or by slug within a project. */
export async function modelsDelete(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const modelId = await resolveLegacyModelId(client, model, project);
  const data = await client.delete(`/models/${modelId}`);
  return {
    summary: `Deleted model ${modelId}.`,
    data: { id: modelId, response: data },
  };
}
