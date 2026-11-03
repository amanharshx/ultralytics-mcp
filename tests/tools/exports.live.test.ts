/** Live smoke test for `exports_list` against a public model with more
 * exports than the server's default page.
 *
 * The endpoint returns `{exports, region}` only: no total, and it ignores
 * every paging parameter but `limit`. So the tool can never state a total;
 * it can only refuse to present a page as complete. `ultralytics/yolo26/
 * yolo26n` had 22 exports when this was written, so the default page of 20
 * is short of it while `limit: 100` returns every one.
 *
 * Pure reads of a public model: creates nothing and spends nothing. Skipped
 * silently without `ULTRALYTICS_API_KEY` and excluded from `npm test`.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npx vitest run tests/tools/exports.live.test.ts --no-file-parallelism
 * ```
 */

import { describe, expect, test } from "vitest";
import { exportsList } from "../../src/tools/exports.js";
import {
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const MODEL = "ultralytics/yolo26/yolo26n";
const PREFIX = "Model 'yolo26n' for owner 'ultralytics' project 'yolo26'";

describe.skipIf(!apiKey)("exports_list limit live smoke", () => {
  test("never calls a default page complete, and limit 100 returns every export", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);

    const all = await exportsList(client, MODEL, undefined, 100);
    expect(lastStatus(records)).toBe(200);
    const allItems = all.data as unknown[];
    // The page under test only truncates while the model has more exports
    // than the default page; fail loudly if that precondition ever lapses.
    expect(allItems.length).toBeGreaterThan(20);
    expect(allItems.length).toBeLessThan(100);
    expect(all.summary).toBe(`${PREFIX}: ${allItems.length} export(s).`);

    const page = await exportsList(client, MODEL);
    expect(lastStatus(records)).toBe(200);
    const pageItems = page.data as unknown[];
    expect(pageItems.length).toBeLessThan(allItems.length);
    expect(page.summary).toBe(
      `${PREFIX}: ${pageItems.length} export(s). ` +
        "The API may have truncated this list; pass limit to request more.",
    );

    const capped = await exportsList(client, MODEL, undefined, 21);
    expect(capped.summary).toBe(
      `${PREFIX}: 21 export(s). The requested limit of 21 was reached; more may exist.`,
    );
  }, 60_000);

  test("surfaces the server's own rejection of an over-max limit", async () => {
    const client = recordingClient(apiKey as string, []);
    await expect(exportsList(client, MODEL, undefined, 101)).rejects.toThrow(
      "limit: Too big: expected number to be <=100",
    );
  }, 60_000);
});
