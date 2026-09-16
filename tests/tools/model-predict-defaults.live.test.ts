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
 * This suite proves the fields are safe to omit: a prediction sent with the
 * three fields explicitly set to 0.25/0.7/640 is compared against the same
 * prediction with all three omitted, on the same image and model. The
 * comparison ignores `speed` (timing varies run to run) and compares
 * `results` and `shape` for exact equality — not just "no error was
 * thrown." A second call with a deliberately high `conf` confirms the field
 * is still genuinely respected when given, not silently dropped.
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

describe.skipIf(!apiKey)("model_predict defaults live smoke", () => {
  test("omitting conf/iou/imgsz matches sending the client's old fixed values, and conf is still respected when given", async (ctx) => {
    if (!modelRef) {
      ctx.skip(
        "needs ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model pointing " +
          "at a trained model with real weights.",
      );
    }

    const client = recordingClient(apiKey as string, []);

    const withDefaults = await modelPredict(client, modelRef as string, {
      source: SAMPLE_IMAGE_URL,
      conf: 0.25,
      iou: 0.7,
      imgsz: 640,
    });
    const withoutFields = await modelPredict(client, modelRef as string, {
      source: SAMPLE_IMAGE_URL,
    });

    type PredictData = { images: Array<{ shape: unknown; results: unknown }> };
    const defaultsImages = (withDefaults.data as PredictData).images;
    const omittedImages = (withoutFields.data as PredictData).images;

    expect(omittedImages.map((image) => image.shape)).toEqual(
      defaultsImages.map((image) => image.shape),
    );
    expect(omittedImages.map((image) => image.results)).toEqual(
      defaultsImages.map((image) => image.results),
    );

    // A high conf threshold must still narrow the results: proves the field
    // reaches the server rather than being silently dropped now that it is
    // only sent conditionally.
    const highConf = await modelPredict(client, modelRef as string, {
      source: SAMPLE_IMAGE_URL,
      conf: 0.95,
    });
    const highConfImages = (highConf.data as PredictData).images;
    const totalHighConfResults = highConfImages.reduce(
      (sum, image) => sum + (image.results as unknown[]).length,
      0,
    );
    const totalDefaultResults = defaultsImages.reduce(
      (sum, image) => sum + (image.results as unknown[]).length,
      0,
    );
    expect(totalHighConfResults).toBeLessThan(totalDefaultResults);
  }, 30_000);
});
