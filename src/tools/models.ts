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
 * which the tool surfaces. The raw `bestFitness` is omitted: it cannot be
 * checked against the training records here, and model quality belongs to
 * `model_metrics`, which validates it.
 *
 * `limit` is forwarded only when given, so the server applies its own
 * default. The response carries no total and the tool does not mirror the
 * server's default, so a non-empty list is never presented as complete
 * unless an explicit limit was not reached.
 */
export async function modelsList(
  client: UltralyticsClient,
  project: string,
  limit?: number,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, project: refSlug } = resolveProject(project);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/models/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
    { limit },
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
  }));
  let summary = `${items.length} model(s) for project '${refSlug}' for owner '${resolvedOwner}'.`;
  if (items.length > 0 && limit === undefined) {
    summary +=
      " The API may have truncated this list; pass limit to request more.";
  } else if (limit !== undefined && items.length >= limit) {
    summary += ` The requested limit of ${limit} was reached; more may exist.`;
  }
  return { summary, data: items };
}

/** Get one model by owner/project/model, ul:// URI, or slug with a project.
 *
 * Resolves the model reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the live owner-scoped endpoint. The API nests the model under `model`
 * with `isOwner` beside it; both are surfaced. The curated model carries
 * the database id training start needs, the training state callers depend
 * on, and the recorded compute cost when present. Evaluation plots are
 * deliberately omitted: the platform disclaims their shape as unstable. The
 * raw `bestEpoch` and `bestFitness` are omitted too: observed live, they can
 * contradict the training records (`pothole/exp-2` reports epoch 99 while
 * its fitness belongs to epoch 66) or have none to match, so model quality
 * belongs to `model_metrics`, which validates them.
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
      `epochs=${pyField(epochs)}, hasWeights=${pyField(hasWeights)}, ` +
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
      owner: resolvedOwner,
      project: resolved.project,
      model: resolved.model,
      ...record,
    },
  };
}
