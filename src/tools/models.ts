/** Read-only model tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveModel, resolveProject } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, listField, pyField } from "./shared.js";

/** List models in a project. */
export async function modelsList(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const projectId = await resolveProject(client, project);
  const data = await client.get("/models", { projectId });
  const items = listField(data, "models").map((model) => ({
    id: model._id ?? null,
    name: model.name ?? null,
    slug: model.slug ?? null,
    status: model.status ?? null,
    task: model.task ?? null,
    epochs: model.epochs ?? null,
    bestFitness: model.bestFitness ?? null,
  }));
  return { summary: `${items.length} model(s) in project.`, data: items };
}

/** Get one model by id, or by slug within a project. */
export async function modelsGet(
  client: UltralyticsClient,
  model: string,
  project?: string,
): Promise<NormalizedToolResult> {
  const modelId = await resolveModel(client, model, project);
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
