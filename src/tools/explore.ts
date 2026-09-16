import type { UltralyticsClient } from "../client.js";
import { asRecord } from "./shared.js";

/** The server rejects an unrecognized `sort` itself (verified live:
 * `?sort=notarealsort` on `/explore/search` returns 400 `Invalid option:
 * expected one of "stars"|"newest"|"oldest"|"name-asc"|"name-desc"|
 * "count-desc"|"count-asc"`), so this does no local validation of it. */
export function validateExploreQuery(q: string, offset = 0): void {
  if (!q.trim()) {
    throw new Error("q is required: a search query");
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
  validateExploreQuery(q, offset);

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
