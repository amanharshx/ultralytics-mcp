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

const DATASET_TASKS = new Set([
  "detect",
  "segment",
  "semantic",
  "classify",
  "pose",
  "obb",
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

export function validateExploreTasks(task?: string[]): string | undefined {
  if (!task || task.length === 0) {
    return undefined;
  }
  for (const item of task) {
    if (!DATASET_TASKS.has(item)) {
      const allowed = Array.from(DATASET_TASKS).sort().join(", ");
      throw new Error(
        `Unsupported dataset task '${item}'. Expected one of: ${allowed}.`,
      );
    }
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
