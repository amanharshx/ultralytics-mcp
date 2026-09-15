import { describe, expect, test } from "vitest";

import { modelPlots } from "../../src/tools/model-plots.js";
import { jsonResponse, routeClient } from "../helpers.js";

const OWNER = "alice";
const PROJECT = "carparts";
const MODEL = "exp-2";
const MODEL_PATH = `/api/models/${OWNER}/${PROJECT}/${MODEL}`;

/** Mirrors the live-observed shape on a 23-class model (`carparts/exp-2`):
 * `pr_curve`'s `y` (22 per-class curves) undercounts `ap` (23 per-class AP
 * rows) by one -- some class has an AP entry but no plotted curve -- and
 * `confusion_matrix` carries a `matrix` field, not `x`/`y`/`ap` at all. */
function multiClassPlots(): Record<string, unknown>[] {
  return [
    {
      type: "pr_curve",
      x: Array.from({ length: 101 }, (_, i) => i / 100),
      y: Array.from({ length: 22 }, () => Array(101).fill(0.5)),
      ap: Array.from({ length: 23 }, () => Array(10).fill(0.4)),
    },
    {
      type: "f1_curve",
      x: Array.from({ length: 101 }, (_, i) => i / 100),
      y: Array.from({ length: 23 }, () => Array(101).fill(0.6)),
    },
    {
      type: "precision_curve",
      x: Array.from({ length: 101 }, (_, i) => i / 100),
      y: Array.from({ length: 23 }, () => Array(101).fill(0.7)),
    },
    {
      type: "recall_curve",
      x: Array.from({ length: 101 }, (_, i) => i / 100),
      y: Array.from({ length: 23 }, () => Array(101).fill(0.8)),
    },
    {
      type: "confusion_matrix",
      matrix: Array.from({ length: 24 }, () => Array(24).fill(0)),
    },
  ];
}

function baseModelFields(
  plots: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    id: "a".repeat(24),
    owner: OWNER,
    project: PROJECT,
    model: MODEL,
    name: MODEL,
    status: "completed",
    plots,
  };
}

describe("modelPlots", () => {
  test("default call lists each plot's type and shape without returning the arrays", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields(multiClassPlots()) });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelPlots(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as { plots: Record<string, unknown>[] };

    expect(data.plots).toHaveLength(5);
    const prCurve = data.plots.find((p) => p.type === "pr_curve") as Record<
      string,
      unknown
    >;
    // The x/y/ap counts are reported as observed, never collapsed into one
    // "classCount" -- y (22) and ap (23) genuinely disagree on this fixture.
    expect(prCurve.x).toEqual({ length: 101 });
    expect(prCurve.y).toEqual({ length: 22, innerLength: 101 });
    expect(prCurve.ap).toEqual({ length: 23, innerLength: 10 });

    const confusionMatrix = data.plots.find(
      (p) => p.type === "confusion_matrix",
    ) as Record<string, unknown>;
    expect(confusionMatrix.matrix).toEqual({ length: 24, innerLength: 24 });
    // No leftover x/y/ap keys invented for a plot that never had them.
    expect(confusionMatrix).not.toHaveProperty("x");
    expect(confusionMatrix).not.toHaveProperty("y");
    expect(confusionMatrix).not.toHaveProperty("ap");

    // No raw arrays anywhere in the default listing.
    expect(JSON.stringify(data)).not.toContain("0.5,0.5");
    expect(calls.map((call) => call.path)).toEqual([MODEL_PATH]);
  });

  test("a named plot returns its data unmodified", async () => {
    const plots = multiClassPlots();
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields(plots) });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelPlots(
      client,
      `${OWNER}/${PROJECT}/${MODEL}`,
      undefined,
      { type: "pr_curve" },
    );
    expect(result.data).toEqual(plots[0]);
  });

  test("rejects an unknown plot type, naming the ones that exist", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: baseModelFields(multiClassPlots()),
        });
      }
      return jsonResponse({}, 404);
    });

    await expect(
      modelPlots(client, `${OWNER}/${PROJECT}/${MODEL}`, undefined, {
        type: "roc_curve",
      }),
    ).rejects.toThrow(/pr_curve/);
  });

  test("reports a legible empty result when plots is [] (pothole/yolo26s shape), including for a named-type request", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields([]) });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelPlots(client, `${OWNER}/${PROJECT}/${MODEL}`);
    expect(result.data).toEqual({ plots: [] });
    expect(result.summary).toContain("no plots available");

    await expect(
      modelPlots(client, `${OWNER}/${PROJECT}/${MODEL}`, undefined, {
        type: "pr_curve",
      }),
    ).rejects.toThrow(/no plots available/);
  });

  test("plots present with no trainResults (eggs-and-bowls/exp shape) still list normally", async () => {
    const { client } = routeClient((path) => {
      if (path === MODEL_PATH) {
        return jsonResponse({
          model: {
            ...baseModelFields(multiClassPlots()),
            bestEpoch: 99,
            // trainResults and metrics are absent entirely on this fixture.
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await modelPlots(client, `${OWNER}/${PROJECT}/${MODEL}`);
    const data = result.data as { plots: Record<string, unknown>[] };
    expect(data.plots).toHaveLength(5);
  });

  test("defaults the owner from the account summary for a bare slug with project", async () => {
    const { client, calls } = routeClient((path) => {
      if (path === "/api/account/summary") {
        return jsonResponse({ username: OWNER });
      }
      if (path === MODEL_PATH) {
        return jsonResponse({ model: baseModelFields([]) });
      }
      return jsonResponse({}, 404);
    });

    await modelPlots(client, MODEL, PROJECT);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/account/summary",
      MODEL_PATH,
    ]);
  });
});
