/** Resolve Platform references to owner-scoped paths.
 *
 * Project references resolve by pure string parsing with no network calls:
 * `owner/slug`, `ul://owner/project`, and bare `slug` all parse directly
 * into an `{owner, project}` pair. Ids are not addressable on any endpoint,
 * so a bare 24-character hex id is rejected with an actionable error.
 *
 * Dataset and model lookups below are unmigrated legacy: they still resolve
 * to ids for endpoints whose live contract has not been captured yet. They
 * keep their previous behavior until their own migration; do not extend them.
 */

import type { UltralyticsClient } from "./client.js";

const ID_RE = /^[0-9a-fA-F]{24}$/;
const UL_PREFIX = "ul://";

/** Raised when a reference cannot resolve to exactly one resource. */
export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

interface Resource {
  _id?: string;
  slug?: string;
  username?: string;
}

export interface ResolvedDatasetDetails {
  id: string;
  task: string | null;
  name: string | null;
  slug: string | null;
}

/** Owner-scoped project reference. `owner` is null for a bare slug; the
 * caller fills it from the account summary (see `getAccountOwner`). */
export interface ResolvedProjectRef {
  owner: string | null;
  project: string;
}

/** Parse a project ref into an `{owner, project}` pair with no network call.
 *
 * Accepts `owner/slug`, `ul://owner/project`, and a bare `slug`. Rejects
 * bare 24-character hex ids (not addressable) and non-project `ul://` URIs
 * with errors that point at the correct form.
 */
export function resolveProject(ref: string): ResolvedProjectRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new ResolutionError(
      "Cannot parse project reference ''. Use 'slug', 'owner/slug', or a " +
        "'ul://owner/project' URI. Project ids are not addressable.",
    );
  }
  if (looksLikeId(trimmed)) {
    throw new ResolutionError(
      "Project ids are not addressable. Use 'slug', 'owner/slug', or a " +
        `'ul://owner/project' URI instead of '${trimmed}'. ` +
        "Bare ids are no longer accepted.",
    );
  }

  const { isUlUri, parts } = parseRef(trimmed);
  if (isUlUri) {
    if (parts.length === 3 && parts[1] === "datasets") {
      throw new ResolutionError(
        `'${trimmed}' is a dataset URI, not a project. Use 'owner/slug' or ` +
          "'ul://owner/project' for the project.",
      );
    }
    if (parts.length === 3) {
      throw new ResolutionError(
        `'${trimmed}' is a model URI; use 'ul://${parts[0]}/${parts[1]}' for the project.`,
      );
    }
    if (parts.length !== 2) {
      throw new ResolutionError(
        `Unsupported project ul:// URI '${trimmed}'. Expected 'ul://owner/project'.`,
      );
    }
    return { owner: parts[0], project: parts[1] };
  }
  if (parts.length === 1) {
    return { owner: null, project: parts[0] };
  }
  if (parts.length === 2) {
    return { owner: parts[0], project: parts[1] };
  }
  throw new ResolutionError(
    `Cannot parse project reference '${trimmed}'. Use 'slug', 'owner/slug', ` +
      "or a 'ul://owner/project' URI. Project ids are not addressable.",
  );
}

/** Return true when `ref` is a 24-hex Platform object id. */
export function looksLikeId(ref: string): boolean {
  return ID_RE.test(ref.trim());
}

/** Split a reference into `{ isUlUri, parts }`. */
export function parseRef(ref: string): { isUlUri: boolean; parts: string[] } {
  const cleaned = ref.trim();
  const isUlUri = cleaned.startsWith(UL_PREFIX);
  const body = isUlUri ? cleaned.slice(UL_PREFIX.length) : cleaned;
  return { isUlUri, parts: body.split("/").filter((part) => part.length > 0) };
}

function simpleUsernameSlug(
  parts: string[],
  kind: string,
  ref: string,
): [string | null, string] {
  if (parts.length === 1) {
    return [null, parts[0]];
  }
  if (parts.length === 2) {
    return [parts[0], parts[1]];
  }
  throw new ResolutionError(
    `Cannot parse ${kind} reference '${ref}'. Use 'slug', 'username/slug', ` +
      "a ul:// URI, or a 24-character id.",
  );
}

function listField(data: unknown, field: string): Resource[] {
  if (data && typeof data === "object") {
    const value = (data as Record<string, unknown>)[field];
    if (Array.isArray(value)) {
      return value as Resource[];
    }
  }
  return [];
}

function recordField(data: unknown, field: string): Record<string, unknown> {
  if (data && typeof data === "object") {
    const value = (data as Record<string, unknown>)[field];
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function select(matches: Resource[], kind: string, ref: string): Resource {
  if (matches.length === 0) {
    throw new ResolutionError(
      `No ${kind} found matching '${ref}'. Check the slug/username, or pass the ` +
        `24-character ${kind} id directly.`,
    );
  }
  if (matches.length > 1) {
    const options = matches
      .slice(0, 8)
      .map(
        (item) =>
          `${item.username ?? "?"}/${item.slug ?? "?"} (id=${item._id})`,
      )
      .join(", ");
    throw new ResolutionError(
      `Ambiguous ${kind} reference '${ref}' matched ${matches.length} resources: ` +
        `${options}. Pass the explicit id or a fully qualified reference.`,
    );
  }
  return matches[0];
}

/** Legacy project-id lookup for unmigrated tools only.
 *
 * Preserves the previous list-then-filter behavior (including id
 * passthrough) for consumers whose live contract has not been captured yet
 * (models, training, project get/delete). Migrated tools use the pure
 * {@link resolveProject} instead. Do not use for new code; this is deleted
 * once the model tools migrate off id-addressed paths.
 */
export async function resolveProjectId(
  client: UltralyticsClient,
  ref: string,
): Promise<string> {
  if (looksLikeId(ref)) {
    return ref;
  }

  const { isUlUri, parts } = parseRef(ref);
  let username: string | null;
  let slug: string;
  if (isUlUri) {
    if (parts.length === 3 && parts[1] === "datasets") {
      throw new ResolutionError(`'${ref}' is a dataset URI, not a project.`);
    }
    if (parts.length === 3) {
      throw new ResolutionError(
        `'${ref}' is a model URI; use 'ul://${parts[0]}/${parts[1]}' for the project.`,
      );
    }
    if (parts.length !== 2) {
      throw new ResolutionError(
        `Unsupported project ul:// URI '${ref}'. Expected ul://username/project.`,
      );
    }
    [username, slug] = [parts[0], parts[1]];
  } else {
    [username, slug] = simpleUsernameSlug(parts, "project", ref);
  }

  const data = await client.get(
    "/projects",
    username ? { username } : undefined,
  );
  const matches = listField(data, "projects").filter(
    (project) =>
      project.slug === slug &&
      (username === null || project.username === username),
  );
  return select(matches, "project", ref)._id as string;
}

/** Resolve a dataset id, slug, username/slug, or dataset ul:// URI. */
export async function resolveDataset(
  client: UltralyticsClient,
  ref: string,
): Promise<string> {
  if (looksLikeId(ref)) {
    return ref;
  }

  const { isUlUri, parts } = parseRef(ref);
  let username: string | null;
  let slug: string;
  if (isUlUri) {
    if (!(parts.length === 3 && parts[1] === "datasets")) {
      throw new ResolutionError(
        `Unsupported dataset ul:// URI '${ref}'. Expected ul://username/datasets/slug.`,
      );
    }
    [username, slug] = [parts[0], parts[2]];
  } else {
    [username, slug] = simpleUsernameSlug(parts, "dataset", ref);
  }

  const data = await client.get(
    "/datasets",
    username ? { username } : undefined,
  );
  const matches = listField(data, "datasets").filter(
    (dataset) =>
      dataset.slug === slug &&
      (username === null || dataset.username === username),
  );
  return select(matches, "dataset", ref)._id as string;
}

/** Resolve a dataset ref and return its id plus task metadata. */
export async function resolveDatasetDetails(
  client: UltralyticsClient,
  ref: string,
): Promise<ResolvedDatasetDetails> {
  const id = await resolveDataset(client, ref);
  const data = await client.get(`/datasets/${id}`);
  const dataset =
    data &&
    typeof data === "object" &&
    "dataset" in (data as Record<string, unknown>)
      ? recordField(data, "dataset")
      : ((data as Record<string, unknown> | null) ?? {});
  return {
    id,
    task: typeof dataset.task === "string" ? dataset.task : null,
    name: typeof dataset.name === "string" ? dataset.name : null,
    slug: typeof dataset.slug === "string" ? dataset.slug : null,
  };
}

/** Resolve a model id, slug plus project, or model ul:// URI. */
export async function resolveModel(
  client: UltralyticsClient,
  ref: string,
  projectRef?: string,
): Promise<string> {
  if (looksLikeId(ref)) {
    return ref;
  }

  const { isUlUri, parts } = parseRef(ref);
  let slug: string;
  let resolvedProjectRef = projectRef;
  if (isUlUri) {
    if (!(parts.length === 3 && parts[1] !== "datasets")) {
      throw new ResolutionError(
        `Unsupported model ul:// URI '${ref}'. Expected ul://username/project/model.`,
      );
    }
    const [username, projectSlug, modelSlug] = parts;
    slug = modelSlug;
    resolvedProjectRef = `${username}/${projectSlug}`;
  } else {
    if (resolvedProjectRef === undefined) {
      throw new ResolutionError(
        `Model reference '${ref}' is a slug; a project id/slug is required to resolve it.`,
      );
    }
    [, slug] = simpleUsernameSlug(parts, "model", ref);
  }

  const projectId = await resolveProjectId(client, resolvedProjectRef);
  const data = await client.get("/models", { projectId });
  const matches = listField(data, "models").filter(
    (model) => model.slug === slug,
  );
  return select(matches, "model", ref)._id as string;
}
