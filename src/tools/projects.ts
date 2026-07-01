/** Read-only project tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveProject } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { exploreSearch } from "./explore.js";
import { asRecord, listField, pyCount, pyField } from "./shared.js";

function resourceId(item: Record<string, unknown>, fallback?: string): string {
  const value = item._id ?? item.id ?? item.projectId ?? item.datasetId;
  return String(value ?? fallback ?? "None");
}

/** List projects in the workspace, optionally filtered by username. */
export async function projectsList(
  client: UltralyticsClient,
  username?: string,
): Promise<NormalizedToolResult> {
  const data = await client.get(
    "/projects",
    username ? { username } : undefined,
  );
  const items = listField(data, "projects").map((project) => ({
    id: project._id ?? null,
    name: project.name ?? null,
    slug: project.slug ?? null,
    username: project.username ?? null,
    visibility: project.visibility ?? null,
    modelCount: project.modelCount ?? null,
  }));
  return { summary: `${items.length} project(s).`, data: items };
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

/** Get one project by id, slug, username/slug, or project ul:// URI. */
export async function projectsGet(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const projectId = await resolveProject(client, project);
  const data = await client.get(`/projects/${projectId}`);
  const record = asRecord(data);
  const item = "project" in record ? record.project : data;
  const fields = asRecord(item);
  return {
    summary:
      `Project '${pyField(fields.name)}' (${pyField(fields.visibility)}), ` +
      `${pyCount(fields, "modelCount")} model(s).`,
    data: item,
  };
}

export interface ProjectsCreateOptions {
  name: string;
  slug?: string;
  description?: string;
}

/** Create a project. */
export async function projectsCreate(
  client: UltralyticsClient,
  options: ProjectsCreateOptions,
): Promise<NormalizedToolResult> {
  const payload: Record<string, unknown> = { name: options.name };
  if (options.slug !== undefined) {
    payload.slug = options.slug;
  }
  if (options.description !== undefined) {
    payload.description = options.description;
  }

  const data = await client.postJson("/projects", payload);
  const record = asRecord(data);
  const item = asRecord("project" in record ? record.project : data);
  const id = resourceId(item);
  const slug = item.slug ?? options.slug ?? "None";
  return {
    summary: `Created project ${id} slug=${String(slug)}.`,
    data: item,
  };
}

/** Soft-delete a project by id, slug, username/slug, or project ul:// URI. */
export async function projectsDelete(
  client: UltralyticsClient,
  project: string,
): Promise<NormalizedToolResult> {
  const projectId = await resolveProject(client, project);
  const data = await client.delete(`/projects/${projectId}`);
  return {
    summary: `Deleted project ${projectId} (soft delete).`,
    data: { id: projectId, response: data },
  };
}
