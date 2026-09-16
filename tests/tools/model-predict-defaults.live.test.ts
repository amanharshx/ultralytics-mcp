/** Live smoke test asserting the platform's own `conf`/`iou`/`imgsz`
 * defaults on `/models/{owner}/{project}/{model}/predict` match the values
 * `model_predict` used to fill in on its own (0.25/0.7/640).
 *
 * `model_predict` always sent `conf`, `iou`, and `imgsz`, even when the
 * caller left them unset, which meant the server could never apply its own
 * default for them — the same shape of bug `deployment_predict` already
 * avoids by sending each field only when given. The help text never claimed
 * otherwise, so nothing was factually wrong, but the values were still a
 * client-side cache of a server default, the exact thing this repo's
 * housekeeping tickets keep finding and removing elsewhere (`sort`, the
 * dataset-task/split/conflict-policy enums).
 *
 * "Surfaces the server's real default" is proved the same way the sort and
 * enum-cache live suites prove their equivalents: an independent, direct
 * `client.postMultipart` call — bypassing `modelPredict` entirely — pins the
 * server's own response with no fields sent, and that raw response is
 * compared against a raw call sending the old fixed values (0.25/0.7/640)
 * for exact equality. Only after that baseline is pinned does the suite
 * check that `modelPredict` itself, called with the fields omitted, matches
 * it — so a bug specific to how `modelPredict` builds the omitted-field
 * request can't hide behind two calls that both go through the same code
 * path. `results` and `shape` are compared; `speed` is excluded because
 * timing varies run to run.
 *
 * Each of `conf`, `iou`, and `imgsz` is then shown to still change the
 * result, individually, when given a non-default value — proving each
 * field still reaches the server now that it's only sent conditionally,
 * not silently dropped. The specific values and directions were found by
 * probing this model live beforehand, not guessed.
 *
 * Needs a trained model with real weights, opted into with
 * `ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model`, and skips without it —
 * this suite never selects an arbitrary model on its own. Prediction is a
 * read-only, unbilled call (confirmed elsewhere in this repo's live
 * suites), so this spends nothing and creates nothing.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * export ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model
 * npm run test:live
 * ```
 */

import { describe, expect, test } from "vitest";
import { modelPredict } from "../../src/tools/predict.js";
import { recordingClient } from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();
const modelRef = process.env.ULTRALYTICS_SMOKE_MODEL_REF?.trim();

const SAMPLE_IMAGE_URL = "https://ultralytics.com/images/bus.jpg";

interface PredictResponse {
  images: Array<{ shape: unknown; results: unknown[] }>;
}

function totalResults(response: PredictResponse): number {
  return response.images.reduce((sum, image) => sum + image.results.length, 0);
}

describe.skipIf(!apiKey)("model_predict defaults live smoke", () => {
  test("omitting conf/iou/imgsz matches the server's own default, verified against an independent raw call", async (ctx) => {
    if (!modelRef) {
      ctx.skip(
        "needs ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model pointing " +
          "at a trained model with real weights.",
      );
    }

    const client = recordingClient(apiKey as string, []);
    const [owner, project, model] = (modelRef as string).split("/");
    const path = `/models/${owner}/${project}/${model}/predict`;

    // Independent raw calls, bypassing modelPredict entirely: pins the
    // server's own default, uncoupled from modelPredict's own handling.
    const rawOmitted = (await client.postMultipart(path, {
      data: { source: SAMPLE_IMAGE_URL },
    })) as PredictResponse;
    const rawWithOldFixedValues = (await client.postMultipart(path, {
      data: { source: SAMPLE_IMAGE_URL, conf: 0.25, iou: 0.7, imgsz: 640 },
    })) as PredictResponse;

    expect(rawOmitted.images.map((image) => image.shape)).toEqual(
      rawWithOldFixedValues.images.map((image) => image.shape),
    );
    expect(rawOmitted.images.map((image) => image.results)).toEqual(
      rawWithOldFixedValues.images.map((image) => image.results),
    );

    // modelPredict itself, called with the fields omitted, must match that
    // independently-pinned raw baseline exactly.
    const toolOmitted = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
      })
    ).data as PredictResponse;
    expect(toolOmitted.images.map((image) => image.shape)).toEqual(
      rawOmitted.images.map((image) => image.shape),
    );
    expect(toolOmitted.images.map((image) => image.results)).toEqual(
      rawOmitted.images.map((image) => image.results),
    );
  }, 30_000);

  test("conf, iou, and imgsz each still reach the server and change the result when given", async (ctx) => {
    if (!modelRef) {
      ctx.skip(
        "needs ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model pointing " +
          "at a trained model with real weights.",
      );
    }

    const client = recordingClient(apiKey as string, []);

    const baseline = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
      })
    ).data as PredictResponse;
    const baselineCount = totalResults(baseline);

    // A high conf threshold narrows results: fewer detections clear the bar.
    const highConf = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
        conf: 0.95,
      })
    ).data as PredictResponse;
    expect(totalResults(highConf)).toBeLessThan(baselineCount);

    // A near-zero IoU threshold suppresses more overlapping boxes, so it
    // narrows results too, in the opposite direction from a high IoU.
    const lowIou = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
        iou: 0.01,
      })
    ).data as PredictResponse;
    expect(totalResults(lowIou)).toBeLessThan(baselineCount);

    // A much smaller inference size loses detail and narrows results too.
    const smallImgsz = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
        imgsz: 96,
      })
    ).data as PredictResponse;
    expect(totalResults(smallImgsz)).toBeLessThan(baselineCount);
  }, 30_000);
});
