/** Resolve Platform references to owner-scoped paths.
 *
 * Project, dataset, and model references resolve by pure string parsing with
 * no network calls: project and dataset refs parse into `{owner, <kind>}`
 * pairs, and model refs parse into `{owner, project, model}` triples. Ids
 * are not addressable on any endpoint, so a bare 24-character hex id is
 * rejected with an actionable error.
 *
 * Every tool in the server is migrated onto these pure resolvers; the legacy
 * list-then-filter id lookups this module used to export for unmigrated
 * consumers are gone.
 */

const ID_RE = /^[0-9a-fA-F]{24}$/;
const UL_PREFIX = "ul://";

/** Raised when a reference cannot resolve to exactly one resource. */
export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

/** Owner-scoped project reference. `owner` is null for a bare slug; the
 * caller fills it from the account summary (see `getAccountOwner`). */
export interface ResolvedProjectRef {
  owner: string | null;
  project: string;
}

const PROJECT_REF_HELP =
  "Use 'slug', 'owner/slug', or a 'ul://owner/project' URI.";
const IDS_NOT_ADDRESSABLE = "Project ids are not addressable.";

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
      `Cannot parse project reference ''. ${PROJECT_REF_HELP} ${IDS_NOT_ADDRESSABLE}`,
    );
  }
  if (looksLikeId(trimmed)) {
    throw new ResolutionError(
      `${IDS_NOT_ADDRESSABLE} ${PROJECT_REF_HELP} '${trimmed}' is a bare id, ` +
        "which is no longer accepted.",
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
  if (parts.length === 0 || parts.length > 2) {
    throw new ResolutionError(
      `Cannot parse project reference '${trimmed}'. ${PROJECT_REF_HELP} ` +
        IDS_NOT_ADDRESSABLE,
    );
  }
  return {
    owner: parts.length === 2 ? parts[0] : null,
    project: parts[parts.length - 1],
  };
}

/** Owner-scoped dataset reference. `owner` is null for a bare slug; the
 * caller fills it from the account summary (see `getAccountOwner`). */
export interface ResolvedDatasetRef {
  owner: string | null;
  dataset: string;
}

const DATASET_REF_HELP =
  "Use 'slug', 'owner/slug', or a 'ul://owner/dataset' URI.";
const DATASET_IDS_NOT_ADDRESSABLE = "Dataset ids are not addressable.";

/** Parse a dataset ref into an `{owner, dataset}` pair with no network call.
 *
 * Accepts `owner/slug`, `ul://owner/dataset`, and a bare `slug`. Rejects
 * bare 24-character hex ids (not addressable), model `ul://` URIs, and the
 * legacy `ul://owner/datasets/slug` URI form with errors that point at the
 * correct form. A 2-part `ul://` project URI is structurally identical to a
 * dataset URI, so it resolves as a dataset ref; the tool context decides the
 * kind, exactly as the `owner/slug` path form does.
 */
export function resolveDataset(ref: string): ResolvedDatasetRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new ResolutionError(
      `Cannot parse dataset reference ''. ${DATASET_REF_HELP} ${DATASET_IDS_NOT_ADDRESSABLE}`,
    );
  }
  if (looksLikeId(trimmed)) {
    throw new ResolutionError(
      `${DATASET_IDS_NOT_ADDRESSABLE} ${DATASET_REF_HELP} '${trimmed}' is a bare id, ` +
        "which is no longer accepted.",
    );
  }

  const { isUlUri, parts } = parseRef(trimmed);
  if (isUlUri) {
    if (parts.length === 3 && parts[1] === "datasets") {
      throw new ResolutionError(
        `'${trimmed}' is a legacy dataset URI. ${DATASET_REF_HELP}`,
      );
    }
    if (parts.length === 3) {
      throw new ResolutionError(
        `'${trimmed}' is a model URI, not a dataset. ${DATASET_REF_HELP}`,
      );
    }
    if (parts.length !== 2) {
      throw new ResolutionError(
        `Unsupported dataset ul:// URI '${trimmed}'. Expected 'ul://owner/dataset'.`,
      );
    }
    return { owner: parts[0], dataset: parts[1] };
  }
  if (parts.length === 0 || parts.length > 2) {
    throw new ResolutionError(
      `Cannot parse dataset reference '${trimmed}'. ${DATASET_REF_HELP} ` +
        DATASET_IDS_NOT_ADDRESSABLE,
    );
  }
  return {
    owner: parts.length === 2 ? parts[0] : null,
    dataset: parts[parts.length - 1],
  };
}

/** Owner-scoped model reference. `owner` is null when neither the model ref
 * nor the project ref names one; the caller fills it from the account
 * summary (see `getAccountOwner`). */
export interface ResolvedModelRef {
  owner: string | null;
  project: string;
  model: string;
}

const MODEL_REF_HELP =
  "Use 'owner/project/model', 'ul://owner/project/model', or 'model' with a project.";
const MODEL_IDS_NOT_ADDRESSABLE = "Model ids are not addressable.";

/** Parse a model ref into an `{owner, project, model}` triple with no network call.
 *
 * Accepts `owner/project/model`, `ul://owner/project/model`, and a bare
 * `model` slug when a project ref is also given (the project ref itself
 * accepts `slug`, `owner/slug`, or `ul://owner/project` and is parsed via
 * {@link resolveProject}, so its disambiguation errors are preserved).
 * Rejects bare 24-character hex ids (not addressable), dataset `ul://` URIs,
 * and project `ul://` URIs with errors that point at the correct form.
 *
 * This is the shared model resolver for the models epic: it lands here so
 * later tickets wire their tools to it without touching it again. It has no
 * `src/` caller yet by design (`modelsList` takes a project ref via
 * {@link resolveProject}); coverage lives in `tests/resolve.test.ts` and the
 * `models_list` parity fixture asserts the live field contract.
 */
export function resolveModel(
  ref: string,
  projectRef?: string,
): ResolvedModelRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new ResolutionError(
      `Cannot parse model reference ''. ${MODEL_REF_HELP} ${MODEL_IDS_NOT_ADDRESSABLE}`,
    );
  }
  if (looksLikeId(trimmed)) {
    throw new ResolutionError(
      `${MODEL_IDS_NOT_ADDRESSABLE} ${MODEL_REF_HELP} '${trimmed}' is a bare id, ` +
        "which is no longer accepted.",
    );
  }

  const { isUlUri, parts } = parseRef(trimmed);
  if (isUlUri) {
    if (parts.length === 3 && parts[1] === "datasets") {
      throw new ResolutionError(
        `'${trimmed}' is a dataset URI, not a model. ${MODEL_REF_HELP}`,
      );
    }
    if (parts.length === 3) {
      return { owner: parts[0], project: parts[1], model: parts[2] };
    }
    if (parts.length === 2) {
      throw new ResolutionError(
        `'${trimmed}' is a project URI, not a model. ${MODEL_REF_HELP}`,
      );
    }
    throw new ResolutionError(
      `Unsupported model ul:// URI '${trimmed}'. Expected 'ul://owner/project/model'.`,
    );
  }
  if (parts.length === 3) {
    return { owner: parts[0], project: parts[1], model: parts[2] };
  }
  if (parts.length === 1) {
    if (projectRef === undefined) {
      throw new ResolutionError(
        `Model reference '${trimmed}' is a slug; a project is required to resolve it. ${MODEL_REF_HELP}`,
      );
    }
    const { owner, project } = resolveProject(projectRef);
    return { owner, project, model: parts[0] };
  }
  throw new ResolutionError(
    `Cannot parse model reference '${trimmed}'. ${MODEL_REF_HELP} ` +
      MODEL_IDS_NOT_ADDRESSABLE,
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
