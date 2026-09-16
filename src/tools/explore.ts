import type { UltralyticsClient } from "../client.js";
import { asRecord } from "./shared.js";

const EXPLORE_SORTS = new Set([
  "newest",
  "stars",
  "oldest",
  "name-asc",
  "name-desc",
  "count-desc",
  "count-asc",
]);

export function validateExploreQuery(
  q: string,
  sort = "newest",
  offset = 0,
): void {
  if (!q.trim()) {
    throw new Error("q is required: a search query");
  }
  if (!EXPLORE_SORTS.has(sort)) {
    const allowed = Array.from(EXPLORE_SORTS).sort().join(", ");
    throw new Error(`Unsupported sort '${sort}'. Expected one of: ${allowed}.`);
  }
  if (offset < 0) {
    throw new Error("`offset` must be greater than or equal to 0.");
  }
}

/** Join dataset task filters for the `task` query param. The server rejects
 * an unrecognized task itself (verified live: `?task=notarealtask` on
 * `/explore/search` returns 400 `"Invalid task filter"`), so this does no
 * local validation — a fixed allowlist here previously excluded `depth`,
 * which the server accepts. */
export function joinExploreTasks(task?: string[]): string | undefined {
  if (!task || task.length === 0) {
    return undefined;
  }
  return task.join(",");
}

export async function exploreSearch(
  client: UltralyticsClient,
  type: "datasets" | "projects",
  q: string,
  options: {
    sort?: string;
    offset?: number;
    task?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const sort = options.sort ?? "newest";
  const offset = options.offset ?? 0;
  validateExploreQuery(q, sort, offset);

  const params: Record<string, unknown> = {
    type,
    q: q.trim(),
    sort,
    offset,
  };
  if (options.task !== undefined) {
    params.task = options.task;
  }
  return asRecord(await client.get("/explore/search", params));
}
