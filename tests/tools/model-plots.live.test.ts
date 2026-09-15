/** Live smoke test for the model_plots tool.
 *
 * Fails when the platform changes its contract underneath us (paths,
 * statuses, or response field names). Skipped silently without a key so
 * contributors without credentials are unaffected, and excluded from
 * `npm test` so ordinary development stays offline and fast.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npm run test:live
 * ```
 *
 * `carparts/exp-2` (23 classes) exercises the per-class shape the ticket
 * requires; `pothole/yolo26s` (`plots: []` despite `status: "completed"`) and
 * `eggs-and-bowls/exp` (`plots: 5`, `trainResults: 0`) are the two degenerate
 * shapes the tool must survive legibly. This suite creates nothing and
 * deletes nothing: every call is a plain read against pre-existing fixtures
 * in the `support-doe` workspace, so it needs no disposable-resource cleanup.
 */

import { describe, expect, test } from "vitest";
import { modelPlots } from "../../src/tools/model-plots.js";
import {
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const EXPECTED_STATUS = { accountSummary: 200, get: 200 } as const;

describe.skipIf(!apiKey)("model_plots live smoke", () => {
  test("lists five plot types with per-class shape on a 23-class model, then returns one named plot unmodified", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

    const listing = await modelPlots(client, `${owner}/carparts/exp-2`);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
    const listingData = listing.data as { plots: Record<string, unknown>[] };
    expect(listingData.plots.map((p) => p.type)).toEqual([
      "pr_curve",
      "f1_curve",
      "precision_curve",
      "recall_curve",
      "confusion_matrix",
    ]);
    // No raw arrays anywhere in the default listing -- shapes only.
    expect(JSON.stringify(listingData)).not.toMatch(/\[\s*0\.\d+,/);

    const prCurve = listingData.plots.find(
      (p) => p.type === "pr_curve",
    ) as Record<string, unknown>;
    expect((prCurve.x as { length: number }).length).toBe(101);
    expect((prCurve.ap as { length: number }).length).toBe(23);

    const confusionMatrix = listingData.plots.find(
      (p) => p.type === "confusion_matrix",
    ) as Record<string, unknown>;
    expect(confusionMatrix).not.toHaveProperty("x");
    expect(confusionMatrix).not.toHaveProperty("ap");
    expect((confusionMatrix.matrix as { length: number }).length).toBe(24);

    const named = await modelPlots(
      client,
      `${owner}/carparts/exp-2`,
      undefined,
      { type: "pr_curve" },
    );
    const namedData = named.data as Record<string, unknown>;
    expect(namedData.type).toBe("pr_curve");
    expect(Array.isArray(namedData.x)).toBe(true);
    expect((namedData.x as unknown[]).length).toBe(101);
    expect((namedData.ap as unknown[]).length).toBe(23);
  }, 30_000);

  test("survives plots: [] on a completed model (pothole/yolo26s) without throwing", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelPlots(client, `${owner}/pothole/yolo26s`);
    const data = result.data as { plots: unknown[] };
    expect(data.plots).toEqual([]);
    expect(result.summary).toContain("no plots available");

    await expect(
      modelPlots(client, `${owner}/pothole/yolo26s`, undefined, {
        type: "pr_curve",
      }),
    ).rejects.toThrow(/no plots available/);
  }, 30_000);

  test("lists plots on a model with no training history (eggs-and-bowls/exp)", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelPlots(client, `${owner}/eggs-and-bowls/exp`);
    const data = result.data as { plots: Record<string, unknown>[] };
    expect(data.plots).toHaveLength(5);
    expect(data).not.toHaveProperty("bestEpoch");
    expect(data).not.toHaveProperty("trainResults");
  }, 30_000);
});
