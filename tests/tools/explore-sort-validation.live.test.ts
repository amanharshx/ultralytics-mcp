/** Live smoke test asserting the platform still validates `sort` on
 * `/explore/search` server-side.
 *
 * The `sort` help text on `explore_datasets`/`explore_projects` said "sort
 * order for results, server-validated" while a local allowlist
 * (`EXPLORE_SORTS`) rejected an unrecognized value before the request ever
 * reached the network — the text and the code disagreed. This suite is the
 * live verification that resolved it: an unrecognized `sort` is rejected by
 * the server itself, so the client-side allowlist was redundant and has been
 * removed; the description was already accurate and needed no change.
 *
 * "Surfaces verbatim" is proved the same way `export-format.live.test.ts`
 * and `enum-cache-removal.live.test.ts` prove it: an independent, direct
 * call to the same endpoint captures the server's raw message, and the
 * tool's surfaced message is compared for exact equality against that raw
 * capture — not a substring or a regex, which would pass even if the tool
 * substituted or reformatted the message.
 *
 * An invalid sort is rejected before any search work happens, so this check
 * spends nothing and creates nothing. Skipped silently without
 * `ULTRALYTICS_API_KEY` and excluded from `npm test`, exactly like the other
 * live smoke suites.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npm run test:live
 * ```
 */

import { describe, expect, test } from "vitest";
import { UltralyticsApiError } from "../../src/errors.js";
import { exploreDatasets } from "../../src/tools/datasets.js";
import { exploreProjects } from "../../src/tools/projects.js";
import {
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

async function catchApiError(
  promise: Promise<unknown>,
): Promise<UltralyticsApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UltralyticsApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject with an UltralyticsApiError");
}

describe.skipIf(!apiKey)("explore sort validation live smoke", () => {
  test("explore datasets: rejects a bogus sort with the server's own message", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    // Independent raw call to the same endpoint: pins the server's own
    // message, uncoupled from exploreDatasets's own handling.
    const rawError = await catchApiError(
      client.get("/explore/search", {
        type: "datasets",
        q: "mcp-smoke-not-a-real-query",
        sort: "mcp-smoke-not-a-real-sort",
        offset: 0,
      }),
    );
    expect(rawError.statusCode).toBe(400);

    const error = await catchApiError(
      exploreDatasets(client, {
        q: "mcp-smoke-not-a-real-query",
        sort: "mcp-smoke-not-a-real-sort",
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(error.statusCode).toBe(400);
    // The tool surfaces the server's own message rather than substituting
    // its own: exact match against the independent raw call above.
    expect(error.apiMessage).toBe(rawError.apiMessage);
  }, 30_000);

  test("explore projects: rejects a bogus sort with the server's own message", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    const rawError = await catchApiError(
      client.get("/explore/search", {
        type: "projects",
        q: "mcp-smoke-not-a-real-query",
        sort: "mcp-smoke-not-a-real-sort",
        offset: 0,
      }),
    );
    expect(rawError.statusCode).toBe(400);

    const error = await catchApiError(
      exploreProjects(client, {
        q: "mcp-smoke-not-a-real-query",
        sort: "mcp-smoke-not-a-real-sort",
      }),
    );
    expect(lastStatus(records)).toBe(400);
    expect(error.statusCode).toBe(400);
    expect(error.apiMessage).toBe(rawError.apiMessage);
  }, 30_000);

  test("explore datasets: accepts a recognized sort and forwards it unchanged", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    const result = await exploreDatasets(client, {
      q: "mcp-smoke-not-a-real-query",
      sort: "stars",
    });
    expect(lastStatus(records)).toBe(200);
    expect(result.data).toMatchObject({ datasets: [] });
  }, 30_000);
});
