/** Live smoke test for the model_metrics tool.
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
 * Every read here is against models the deploy-eval epic's tracker already
 * verified live in the `support-doe` workspace (see the epic overview and
 * this tool's own ticket): `fish/exp-2` (a normally trained model whose
 * `bestEpoch` sits far outside the default 20-epoch history window),
 * `road-safety-101/exp-3` (a `cancelled` run), `pothole/yolo26s` and
 * `eggs-and-bowls/exp` (the two degenerate shapes the tool must survive
 * without throwing), and `pothole/exp-2` and `eggs-and-bowls/exp-2`
 * (pre-v8.4.48 runs whose reported bestEpoch is the last epoch, matched by
 * two records). This suite creates nothing and deletes nothing: every
 * call is a plain read against pre-existing fixtures, so it needs no
 * disposable-resource cleanup, unlike the project/dataset/model/deployment
 * live suites. It is skipped entirely if any of these models are absent
 * from the workspace the key belongs to.
 */

import { describe, expect, test } from "vitest";
import { modelMetrics } from "../../src/tools/model-metrics.js";
import {
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const EXPECTED_STATUS = { accountSummary: 200, get: 200 } as const;

describe.skipIf(!apiKey)("model_metrics live smoke", () => {
  test("labels the validated best epoch and the reported metrics distinctly, with best-epoch correct far outside the default history window", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

    const result = await modelMetrics(client, `${owner}/fish/exp-2`);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
    const data = result.data as Record<string, unknown>;

    expect(data.bestEpoch).toBe(17);
    expect(typeof data.bestFitness).toBe("number");
    // The default 20-epoch history window would cover only the last 20 of
    // 119 recorded epochs (99-118); epoch 17 sits well outside it, so a
    // correct bestEpochMetrics here proves the lookup scans the full
    // trainResults array, not a windowed slice.
    expect(data.resultRecordCount as number).toBeGreaterThan(40);
    expect(data.bestEpochMetrics).toBeTruthy();
    expect(data.bestEpochNote).toBeNull();
    const bestEpochMetrics = data.bestEpochMetrics as Record<string, number>;
    expect(bestEpochMetrics["metrics/mAP50(B)"]).toBeGreaterThan(0);

    // The model's top-level `metrics` comes through verbatim, paired with
    // no epoch: no record identifies which evaluation produced it.
    expect(data.reportedMetrics).toBeTruthy();
    expect(typeof data.reportedMetricsNote).toBe("string");
    expect(data).not.toHaveProperty("finalEpoch");
    expect(data).not.toHaveProperty("finalEpochMetrics");

    expect(data).not.toHaveProperty("trainArgs");
    expect(data).not.toHaveProperty("history");
  }, 30_000);

  test("include_train_args returns all keys; include_history states its window even at the full curve", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();

    const withArgs = await modelMetrics(
      client,
      `${owner}/fish/exp-2`,
      undefined,
      { includeTrainArgs: true },
    );
    const trainArgs = (withArgs.data as Record<string, unknown>)
      .trainArgs as Record<string, unknown>;
    expect(Object.keys(trainArgs).length).toBe(111);

    const withoutArgs = await modelMetrics(client, `${owner}/fish/exp-2`);
    expect(withoutArgs.data).not.toHaveProperty("trainArgs");

    const fullHistory = await modelMetrics(
      client,
      `${owner}/fish/exp-2`,
      undefined,
      { includeHistory: true, historyLastN: 1000 },
    );
    const history = (fullHistory.data as Record<string, unknown>).history as {
      window: string;
      entries: unknown[];
    };
    expect(history.entries.length).toBe(
      (fullHistory.data as Record<string, unknown>).resultRecordCount,
    );
    expect(history.window).toMatch(
      /^all \d+ record\(s\) in API order; reported epochs \d+-\d+, \d+ duplicate and \d+ missing epoch number\(s\) in that range$/,
    );
  }, 30_000);

  test("reads a cancelled model without throwing", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelMetrics(client, `${owner}/road-safety-101/exp-3`);
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe("cancelled");
    expect(typeof data.bestEpoch).toBe("number");
  }, 30_000);

  test("survives bestEpoch: null (pothole/yolo26s) without throwing", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelMetrics(client, `${owner}/pothole/yolo26s`);
    const data = result.data as Record<string, unknown>;
    expect(data.bestEpoch).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(typeof data.bestEpochNote).toBe("string");
    // Top-level `metrics` is still present on this fixture even with
    // `bestEpoch: null` -- observed live -- so reportedMetrics survives.
    expect(data.reportedMetrics).toBeTruthy();
  }, 30_000);

  test("survives bestEpoch pointing past zero recorded epochs (eggs-and-bowls/exp) without throwing", async () => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelMetrics(client, `${owner}/eggs-and-bowls/exp`);
    const data = result.data as Record<string, unknown>;
    // The platform reports bestEpoch: 99 with zero trainResults; that raw
    // value is never echoed in bestEpoch/bestFitness, only inside the note.
    expect(data.bestEpoch).toBeNull();
    expect(data.bestFitness).toBeNull();
    expect(data.resultRecordCount).toBe(0);
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toContain("99");
    expect(data.bestEpochNote).toContain("not treated as fact");
    expect(data.reportedMetrics).toBeNull();
  }, 30_000);

  test.each([
    "pothole/exp-2",
    "eggs-and-bowls/exp-2",
  ])("rejects the legacy last-epoch bestEpoch on %s instead of stating it as fact", async (ref) => {
    const client = recordingClient(apiKey as string, []);
    const owner = await client.getAccountOwner();

    const result = await modelMetrics(client, `${owner}/${ref}`);
    const data = result.data as Record<string, unknown>;
    expect(data.bestEpoch).toBeNull();
    expect(data.bestFitness).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toContain("2 result records report epoch 99");
  }, 30_000);
});
