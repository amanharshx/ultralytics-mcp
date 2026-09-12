/** Model tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveModel, resolveProject } from "../resolve.js";
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

/** Get one model by owner/project/model, ul:// URI, or slug with a project.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the live owner-scoped endpoint. The API nests the model under `model`
 * with `isOwner` beside it; both are surfaced. The curated model carries
 * the database id training start needs, the training state callers depend
 * on, and the recorded compute cost when present. Evaluation plots are
 * deliberately omitted: the platform disclaims their shape as unstable.
 */
export async function modelsGet(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`,
  );
  const record = asRecord(data);
  const fields = asRecord(record.model);
  const isOwner = typeof record.isOwner === "boolean" ? record.isOwner : null;
  const datasetRecord = asRecord(fields.dataset);
  const dataset =
    fields.dataset && typeof fields.dataset === "object"
      ? {
          owner: datasetRecord.owner ?? null,
          dataset: datasetRecord.dataset ?? null,
        }
      : null;
  const computeRecord = asRecord(fields.computeCost);
  const computeCost =
    fields.computeCost && typeof fields.computeCost === "object"
      ? computeRecord
      : null;
  const slug = fields.model ?? null;
  const name = fields.name ?? null;
  const task = fields.task ?? null;
  const status = fields.status ?? null;
  const epochs = fields.epochs ?? null;
  const bestEpoch = fields.bestEpoch ?? null;
  const bestFitness = fields.bestFitness ?? null;
  const hasWeights = fields.hasWeights ?? null;
  const datasetRef =
    dataset &&
    typeof dataset.owner === "string" &&
    typeof dataset.dataset === "string"
      ? `${dataset.owner}/${dataset.dataset}`
      : "None";
  const costNote =
    computeCost &&
    computeCost.totalCost !== undefined &&
    computeCost.totalCost !== null
      ? ` Compute cost ${String(computeCost.totalCost)} (${String(computeCost.gpuType ?? "unknown")}).`
      : "";
  return {
    summary:
      `Model '${pyField(slug)}' for owner '${resolvedOwner}' project '${resolved.project}': ` +
      `'${pyField(name)}' [${pyField(task)}] status=${pyField(status)}, ` +
      `epochs=${pyField(epochs)}, bestEpoch=${pyField(bestEpoch)}, ` +
      `bestFitness=${pyField(bestFitness)}, hasWeights=${pyField(hasWeights)}, ` +
      `dataset=${datasetRef}.${costNote}`,
    data: {
      model: {
        id: fields.id ?? null,
        name,
        slug,
        owner: fields.owner ?? null,
        project: fields.project ?? null,
        visibility: fields.visibility ?? null,
        task,
        status,
        epochs,
        bestEpoch,
        bestFitness,
        hasWeights,
        dataset,
        datasetId: fields.datasetId ?? null,
        datasetVersion: fields.datasetVersion ?? null,
        computeCost,
      },
      isOwner,
    },
  };
}

/** Delete a model by owner/project/model, ul:// URI, or slug with a project.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and deletes
 * through the live owner-scoped endpoint. The API reports only
 * `{success: true}` with no cascade summary; both the returned fields and
 * the ref are surfaced so the caller can tell what was removed. Deleting a
 * model moves it to trash where it remains restorable; weights, training
 * history, and exports are removed only on permanent deletion.
 */
export async function modelsDelete(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveModel(model, project);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.delete(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.project)}/${encodeURIComponent(resolved.model)}`,
  );
  const record = asRecord(data);
  return {
    summary:
      `Deleted model '${resolved.model}' for owner '${resolvedOwner}' ` +
      `project '${resolved.project}' (soft delete; restorable from trash; ` +
      `weights, training history, and exports removed only on permanent deletion).`,
    data: {
      // Ref echo last: it names what was removed even if a future API
      // field ever overlaps one of these keys.
      ...record,
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
    },
  };
}
