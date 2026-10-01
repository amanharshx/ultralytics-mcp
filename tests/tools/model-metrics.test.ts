import { describe, expect, test } from "vitest";

import { modelMetrics } from "../../src/tools/model-metrics.js";
import { jsonResponse, routeClient } from "../helpers.js";

const OWNER = "alice";
const PROJECT = "fish";
const MODEL = "exp-2";
const MODEL_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}`;

/** Build 25 sequential `trainResults` entries (epoch 0-24), matching the
 * live-observed shape: raw per-epoch keys (`metrics/mAP50(B)`, etc.), never
 * the cleaned names the top-level `metrics` field uses. Epoch 2 is the peak
 * (`bestEpoch`); metrics drift downward afterward, mirroring the live
 * `fish/exp-2` fixture where the best epoch sits far outside the default
 * 20-epoch history window. */
function buildTrainResults(): Record<string, unknown>[] {
  return Array.from({ length: 25 }, (_, epoch) => ({
    epoch,
    metrics: {
      "train/box_loss": 1 - epoch * 0.01,
      "metrics/precision(B)": epoch === 2 ? 0.967 : 0.5 + epoch * 0.005,
      "metrics/recall(B)": epoch === 2 ? 0.875 : 0.6 + epoch * 0.003,
      "metrics/mAP50(B)": epoch === 2 ? 0.976 : 0.7 + epoch * 0.004,
      "metrics/mAP50-95(B)": epoch === 2 ? 0.855 : 0.5 + epoch * 0.004,
    },
    fitness: epoch === 2 ? 0.855 : 0.5 + epoch * 0.004,
  }));
}

/** Top-level `metrics` uses cleaned key names and, on the live models
 * checked, equals the *last* record's values (which on Platform-trained runs
 * is the post-training evaluation, not a training epoch). */
function finalMetricsFromLast(
  trainResults: Record<string, unknown>[],
): Record<string, unknown> {
  const last = trainResults[trainResults.length - 1].metrics as Record<
    string,
    unknown
  >;
  return {
    mAP50: last["metrics/mAP50(B)"],
    "mAP50-95": last["metrics/mAP50-95(B)"],
    precision: last["metrics/precision(B)"],
    recall: last["metrics/recall(B)"],
  };
}

function baseModelFields(): Record<string, unknown> {
  const trainResults = buildTrainResults();
  return {
    id: "c".repeat(24),
    owner: OWNER,
    project: PROJECT,
    model: MODEL,
    name: MODEL,
    task: "detect",
    status: "completed",
    epochs: 200,
    bestEpoch: 2,
    bestFitness: 0.855,
    trainResults,
    metrics: finalMetricsFromLast(trainResults),
    trainArgs: { model: "yolo26x.pt", epochs: 200, batch: 16, lr0: 0.01 },
  };
}

describe("modelMetrics", () => {
  test("default call returns the validated best epoch and the reported metrics labelled distinctly, best-epoch correct outside the default history window, trainArgs and history omitted", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields() });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as Record<string, unknown>;

    expect(data.bestEpoch).toBe(2);
    expect(data.bestFitness).toBe(0.855);
    expect(data.bestEpochMetrics).toEqual({
      "train/box_loss": 0.98,
      "metrics/precision(B)": 0.967,
      "metrics/recall(B)": 0.875,
      "metrics/mAP50(B)": 0.976,
      "metrics/mAP50-95(B)": 0.855,
    });
    expect(data.bestEpochNote).toBeNull();
    expect(data.reportedMetrics).toEqual(
      finalMetricsFromLast(buildTrainResults()),
    );
    expect(data.reportedMetricsNote).toContain("does not say which evaluation");
    expect(data.resultRecordCount).toBe(25);
    // The reported metrics are never paired with an epoch, and nothing
    // counts records as epochs.
    expect(data).not.toHaveProperty("finalEpoch");
    expect(data).not.toHaveProperty("finalEpochMetrics");
    expect(data).not.toHaveProperty("epochsDone");
    expect(data).not.toHaveProperty("trainArgs");
    expect(data).not.toHaveProperty("history");
    expect(result.summary).toBe(
      "Model 'exp-2' for owner 'alice' project 'fish': best epoch 2 " +
        "(fitness 0.855); reported metrics available; 25 result record(s).",
    );
    expect(calls.map((call) => call.path)).toEqual([MODEL_PATH]);
  });

  test("include_train_args returns the full object; default omits it", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields() });
      }
      return jsonResponse({}, 404);
    });

    const withArgs = await modelMetrics(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
      undefined,
      { includeTrainArgs: true },
    );
    expect((withArgs.data as Record<string, unknown>).trainArgs).toEqual({
      model: "yolo26x.pt",
      epochs: 200,
      batch: 16,
      lr0: 0.01,
    });

    const withoutArgs = await modelMetrics(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
    );
    expect(withoutArgs.data).not.toHaveProperty("trainArgs");
  });

  test("include_history reports the curve and always states its window, including when the full curve is returned", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields() });
      }
      return jsonResponse({}, 404);
    });

    const truncated = await modelMetrics(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
      undefined,
      { includeHistory: true, historyLastN: 5 },
    );
    const truncatedHistory = (truncated.data as Record<string, unknown>)
      .history as { window: string; entries: unknown[] };
    expect(truncatedHistory.entries).toHaveLength(5);
    expect(truncatedHistory.window).toBe(
      "last 5 of 25 record(s) in API order; reported epochs 20-24, " +
        "0 duplicate and 0 missing epoch number(s) in that range",
    );

    const full = await modelMetrics(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
      undefined,
      { includeHistory: true, historyLastN: 1000 },
    );
    const fullHistory = (full.data as Record<string, unknown>).history as {
      window: string;
      entries: unknown[];
    };
    // The full curve is still labelled with its window -- the label is not
    // skipped just because the requested window covers every recorded epoch.
    expect(fullHistory.entries).toHaveLength(25);
    expect(fullHistory.window).toBe(
      "all 25 record(s) in API order; reported epochs 0-24, " +
        "0 duplicate and 0 missing epoch number(s) in that range",
    );
  });

  // Shape observed live on `road-safety-101/exp` (out-of-order callbacks,
  // missing epochs) and on pre-v8.4.52 runs (a post-training record
  // duplicating the last epoch number).
  test("include_history labels the window from reported epoch values, not array positions, counting duplicates and gaps only inside that range", async () => {
    const trainResults = [
      { epoch: 5, metrics: {}, fitness: 0.1 },
      { epoch: 9, metrics: {}, fitness: 0.1 },
      { epoch: 6, metrics: {}, fitness: 0.1 },
      { epoch: 9, metrics: {}, fitness: 0.1 },
      { epoch: 7, metrics: {}, fitness: 0.1 },
    ];
    const { client } = routeClient((path) =>
      path === MODEL_PATH
        ? jsonResponse({
            model: { ...baseModelFields(), bestEpoch: null, trainResults },
          })
        : jsonResponse({}, 404),
    );

    const result = await modelMetrics(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
      undefined,
      { includeHistory: true, historyLastN: 4 },
    );
    const history = (result.data as Record<string, unknown>).history as Record<
      string,
      unknown
    >;
    // Last 4 in API order are 9, 6, 9, 7: first/last positions would claim
    // "9-7"; the numeric range is 6-9, with 9 duplicated and 8 missing.
    // Epoch 5 is outside the window, so it is neither counted nor a gap.
    expect(history).toMatchObject({
      window:
        "last 4 of 5 record(s) in API order; reported epochs 6-9, " +
        "1 duplicate and 1 missing epoch number(s) in that range",
      returnedRecords: 4,
      totalRecords: 5,
      minEpoch: 6,
      maxEpoch: 9,
      duplicateEpochs: 1,
      missingEpochs: 1,
      entries: [
        { epoch: 9, metrics: {} },
        { epoch: 6, metrics: {} },
        { epoch: 9, metrics: {} },
        { epoch: 7, metrics: {} },
      ],
    });
    expect(history.note).toContain("post-training evaluation");
  });

  test("rejects a non-positive history_last_n before making any request", async () => {
    const { client, calls } = routeClient(() => jsonResponse({}, 404));
    await expect(
      modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`, undefined, {
        includeHistory: true,
        historyLastN: 0,
      }),
    ).rejects.toThrow(/history_last_n/);
    expect(calls).toHaveLength(0);
  });

  test("defaults the owner from the account summary for a bare slug with project", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: OWNER });
      }
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields() });
      }
      return jsonResponse({}, 404);
    });

    await modelMetrics(client, MODEL, PROJECT);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      MODEL_PATH,
    ]);
  });

  // `pothole/yolo26s`, observed live: `bestEpoch: null`, `epochs: -1`, 70
  // `trainResults`, but top-level `metrics` still present.
  test("survives bestEpoch: null without throwing, reporting bestEpochMetrics unavailable while reportedMetrics still comes through", async () => {
    const trainResults = [
      { epoch: 1, metrics: { "metrics/mAP50(B)": 0.4462 } },
      { epoch: 70, metrics: { "metrics/mAP50(B)": 0.64598 } },
    ];
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: {
            id: "d".repeat(24),
            owner: OWNER,
            project: PROJECT,
            model: MODEL,
            status: "completed",
            epochs: -1,
            bestEpoch: null,
            bestFitness: null,
            trainResults,
            metrics: {
              mAP50: 0.64598,
              "mAP50-95": 0.47769,
              precision: 0.69674,
              recall: 0.5811,
            },
            trainArgs: { model: "yolo26s.pt" },
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as Record<string, unknown>;
    expect(data.bestEpoch).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toBe(
      "bestEpoch is not recorded for this model.",
    );
    expect(data.epochs).toBeNull();
    expect(data.resultRecordCount).toBe(2);
    expect(data.reportedMetrics).toEqual({
      mAP50: 0.64598,
      "mAP50-95": 0.47769,
      precision: 0.69674,
      recall: 0.5811,
    });
    expect(result.summary).toContain("best epoch unavailable");
  });

  // `eggs-and-bowls/exp`, observed live: `bestEpoch: 99` beside zero
  // `trainResults` and an absent top-level `metrics` (`epochs: 1`), which
  // makes "best epoch 99" incoherent -- both a naive `trainResults[99]`
  // index and the `metrics` fallback fail here, and the tool must say so
  // rather than reporting 99 as fact.
  test("survives bestEpoch pointing past zero recorded epochs without throwing, treating it as incoherent rather than fact", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: {
            id: "e".repeat(24),
            owner: OWNER,
            project: PROJECT,
            model: MODEL,
            status: "cancelled",
            epochs: 1,
            bestEpoch: 99,
            bestFitness: 0.98007,
            trainArgs: { model: "yolo26n.pt" },
            // `metrics` and `trainResults` are entirely absent on this
            // fixture, not present-and-null -- observed live.
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as Record<string, unknown>;
    // The platform's raw bestEpoch: 99 / bestFitness: 0.98007 are never
    // echoed back in these fields -- only inside bestEpochNote -- so a
    // caller reading bestEpoch/bestFitness alone can't mistake 99 for fact.
    expect(data.bestEpoch).toBeNull();
    expect(data.bestFitness).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toBe(
      "the model reports bestEpoch 99 (bestFitness 0.98007), but none of " +
        "the 0 result record(s) reports epoch 99; not treated as fact.",
    );
    expect(data.reportedMetrics).toBeNull();
    expect(data.resultRecordCount).toBe(0);
    expect(result.summary).toContain("best epoch unavailable");
    expect(result.summary).toContain("reported metrics unavailable");
  });

  /** Serve the base model with the given best-epoch fields and records. */
  function bestEpochClient(overrides: Record<string, unknown>) {
    return routeClient((path) =>
      path === MODEL_PATH
        ? jsonResponse({ model: { ...baseModelFields(), ...overrides } })
        : jsonResponse({}, 404),
    ).client;
  }

  // `eggs-and-bowls/exp-2` and `pothole/exp-2`, observed live: a pre-v8.4.52
  // post-training record duplicates the last epoch number, so two records
  // match bestEpoch -- on eggs-and-bowls/exp-2 both even carry bestFitness.
  test("rejects a bestEpoch matched by several records even when every match carries the reported fitness", async () => {
    const client = bestEpochClient({
      bestEpoch: 99,
      bestFitness: 0.995,
      trainResults: [
        { epoch: 98, metrics: { "metrics/mAP50-95(B)": 0.99 }, fitness: 0.99 },
        {
          epoch: 99,
          metrics: { "metrics/mAP50-95(B)": 0.995 },
          fitness: 0.995,
        },
        {
          epoch: 99,
          metrics: { "metrics/mAP50-95(B)": 0.996 },
          fitness: 0.995,
        },
      ],
    });

    const result = await modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as Record<string, unknown>;
    expect(data.bestEpoch).toBeNull();
    expect(data.bestFitness).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toBe(
      "the model reports bestEpoch 99 (bestFitness 0.995), but 2 result " +
        "records report epoch 99, so which one it refers to is ambiguous; " +
        "not treated as fact.",
    );
  });

  // Ultralytics before v8.4.48 reported the last epoch as bestEpoch; if that
  // run's duplicate post-training record never arrived, exactly one record
  // matches, and only the fitness check catches it.
  test("rejects a uniquely matched bestEpoch whose record fitness differs from bestFitness, keeping both reported values in the note", async () => {
    const client = bestEpochClient({
      bestEpoch: 99,
      bestFitness: 0.35435,
      trainResults: [
        { epoch: 66, metrics: {}, fitness: 0.35435 },
        { epoch: 99, metrics: {}, fitness: 0.34833 },
      ],
    });

    const result = await modelMetrics(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as Record<string, unknown>;
    expect(data.bestEpoch).toBeNull();
    expect(data.bestFitness).toBeNull();
    expect(data.bestEpochMetrics).toBeNull();
    expect(data.bestEpochNote).toBe(
      "the model reports bestEpoch 99 (bestFitness 0.35435), but the result " +
        "record for epoch 99 reports fitness 0.34833; not treated as fact.",
    );
    expect(result.summary).toContain("best epoch unavailable");
  });

  test("requires exact fitness equality: no tolerance, and a missing bestFitness never matches", async () => {
    const nearMiss = await modelMetrics(
      bestEpochClient({
        bestEpoch: 1,
        bestFitness: 0.5,
        trainResults: [{ epoch: 1, metrics: {}, fitness: 0.500001 }],
      }),
      `${OWNER}/${PROJECT}/${MODEL}`,
    );
    expect((nearMiss.data as Record<string, unknown>).bestEpoch).toBeNull();

    const noFitness = await modelMetrics(
      bestEpochClient({
        bestEpoch: 1,
        bestFitness: null,
        trainResults: [{ epoch: 1, metrics: {} }],
      }),
      `${OWNER}/${PROJECT}/${MODEL}`,
    );
    expect((noFitness.data as Record<string, unknown>).bestEpoch).toBeNull();
  });
});
