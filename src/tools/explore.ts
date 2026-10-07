import type { UltralyticsClient } from "../client.js";
import { asRecord } from "./shared.js";

/** The server rejects an unrecognized `sort` and a negative `offset`
 * itself (verified live on `/explore/search`: `?sort=notarealsort` returns
 * 400 `Invalid option: expected one of "stars"|"newest"|"oldest"|
 * "name-asc"|"name-desc"|"count-desc"|"count-asc"`, and `?offset=-1`
 * returns 400 `Too small: expected number to be >=0`), so this does no
 * local validation of either. */
export function validateExploreQuery(q: string): void {
  if (!q.trim()) {
    throw new Error("q is required: a search query");
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
  validateExploreQuery(q);
  // Unset `sort`/`offset` are omitted so the server applies its own defaults.
  return asRecord(
    await client.get("/explore/search", {
      type,
      q: q.trim(),
      sort: options.sort,
      offset: options.offset,
      task: options.task,
    }),
  );
}
