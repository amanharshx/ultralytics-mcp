/** Read-only project tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveProject } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { exploreSearch } from "./explore.js";
import { asRecord, listField, pyCount, pyField } from "./shared.js";

/** List projects in the workspace, optionally filtered by username.
 *
 * Reads the live owner-scoped endpoint. When no owner is given, the owner is
 * filled from the account summary and named in the summary output so the
 * caller can tell which workspace was read. An explicit `owner` always wins;
 * `username` remains as a compatibility alias for it.
 */
export async function projectsList(
  client: UltralyticsClient,
  owner?: string,
  username?: string,
): Promise<NormalizedToolResult> {
  const explicit = owner?.trim() || username?.trim() || undefined;
  const resolvedOwner = explicit ?? (await client.getAccountOwner());
  const data = await client.get(
    `/projects/${encodeURIComponent(resolvedOwner)}`,
  );
  const items = listField(data, "projects").map((project) => ({
    id: project.id ?? null,
    name: project.name ?? null,
    slug: project.project ?? null,
    username: project.owner ?? null,
    visibility: project.visibility ?? null,
    modelCount: project.modelCount ?? null,
  }));
  return {
    summary: `${items.length} project(s) for owner '${resolvedOwner}'.`,
    data: items,
  };
}

export interface ExploreProjectsOptions {
  q: string;
  sort?: string;
  offset?: number;
}

/** Search public projects on Explore. */
export async function exploreProjects(
  client: UltralyticsClient,
  options: ExploreProjectsOptions,
): Promise<NormalizedToolResult> {
  const data = await exploreSearch(client, "projects", options.q, {
    sort: options.sort,
    offset: options.offset,
  });
  const items = listField(data, "projects").map((project) => ({
    id: project._id ?? null,
    name: project.name ?? null,
    slug: project.slug ?? null,
    username: project.username ?? null,
    visibility: project.visibility ?? null,
    modelCount: project.modelCount ?? null,
    starCount: project.starCount ?? null,
  }));
  const hasMore = Boolean(data.hasMore);
  return {
    summary: `Search '${options.q.trim()}': ${items.length} project(s)${hasMore ? " (more available)" : ""}`,
    data: {
      projects: items,
      hasMore,
    },
  };
}

/** Get one project by slug, owner/slug, or project ul:// URI.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and reads the live
 * owner-scoped endpoint. The API nests the project under `project` with
 * `models` and `isOwner` beside it; all three are surfaced.
 */
export async function projectsGet(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, project: refSlug } = resolveProject(project);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/projects/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
  );
  const record = asRecord(data);
  const projectFields = asRecord(record.project);
  const models = Array.isArray(record.models)
    ? (record.models as unknown[])
    : [];
  const isOwner = typeof record.isOwner === "boolean" ? record.isOwner : null;
  return {
    summary:
      `Project '${pyField(projectFields.project)}' for owner '${resolvedOwner}': ` +
      `'${pyField(projectFields.name)}' (${pyField(projectFields.visibility)}), ` +
      `${pyCount(projectFields, "modelCount")} model(s).`,
    data: {
      project: projectFields,
      models,
      isOwner,
    },
  };
}

export interface ProjectsCreateOptions {
  name: string;
  project: string;
  owner?: string;
  visibility?: string;
  description?: string;
}

/** Create a project safely without publishing by accident.
 *
 * Sends the URL slug as `project` (the API rejects `slug`), defaults
 * visibility to private, accepts an optional owner defaulting to the
 * account owner, and reads the flat create response. The summary names
 * the id, owner, and slug so the caller can tell what was created where.
 */
export async function projectsCreate(
  client: UltralyticsClient,
  options: ProjectsCreateOptions,
): Promise<NormalizedToolResult> {
  const explicitOwner = options.owner?.trim() || undefined;
  const resolvedOwner = explicitOwner ?? (await client.getAccountOwner());
  const visibility = options.visibility ?? "private";
  const payload: Record<string, unknown> = {
    project: options.project,
    name: options.name,
    visibility,
    owner: resolvedOwner,
  };
  if (options.description !== undefined) {
    payload.description = options.description;
  }

  const data = await client.postJson("/projects", payload);
  const record = asRecord(data);
  return {
    summary:
      `Created project '${pyField(record.project ?? options.project)}' ` +
      `for owner '${pyField(record.owner ?? resolvedOwner)}' ` +
      `with id '${pyField(record.id)}' (${pyField(visibility)}).`,
    data: record,
  };
}

/** Delete a project by slug, owner/slug, or project ul:// URI.
 *
 * Resolves the reference by pure string parsing (ids are not addressable),
 * fills a missing owner from the account summary, and deletes through the
 * live owner-scoped endpoint. The API soft-deletes into trash (restorable
 * for a bounded window) and reports how many models cascaded; both are
 * surfaced so the caller can tell what was removed and where it went.
 */
export async function projectsDelete(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const { owner: refOwner, project: refSlug } = resolveProject(project);
  const resolvedOwner = refOwner ?? (await client.getAccountOwner());
  const data = await client.delete(
    `/projects/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(refSlug)}`,
  );
  const record = asRecord(data);
  return {
    summary:
      `Deleted project '${refSlug}' for owner '${resolvedOwner}' ` +
      `(soft delete; ${pyCount(record, "cascadedModels")} model(s) removed; ` +
      `restorable from trash).`,
    data: {
      owner: resolvedOwner,
      project: refSlug,
      ...record,
    },
  };
}
