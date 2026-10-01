/** Live smoke test pinning `model_predict`'s file-part routes.
 *
 * The predict endpoint caps its `source` field at 4,096 characters (~3 KB of
 * image), so `model_predict` decodes base64 itself and uploads the bytes as
 * the multipart `file` part named `image.jpg`. That name is load-bearing and
 * undocumented: the server rejects a file part named `blob`, `image`, or
 * `image.bin` with a generic 400, yet reads the bytes by content once the
 * extension is recognized. A unit test can only prove the tool sends
 * `image.jpg`; this suite proves the server still accepts it.
 *
 * A real image whose base64 is well over the cap is predicted once from its
 * URL and once from its base64, and the two must agree on `shape` and
 * `results` (`speed` varies run to run). The same image is then predicted
 * from a local `file_path`, uploaded under its own basename, and must agree
 * the same way.
 *
 * Needs a trained model with real weights, opted into with
 * `ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model`, and skips without it.
 * Prediction is read-only and unbilled, so this spends and creates nothing.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * export ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model
 * npm run test:live
 * ```
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { modelPredict } from "../../src/tools/predict.js";
import { recordingClient } from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();
const modelRef = process.env.ULTRALYTICS_SMOKE_MODEL_REF?.trim();

const SAMPLE_IMAGE_URL = "https://ultralytics.com/images/bus.jpg";

interface PredictResponse {
  images: Array<{ shape: unknown; results: unknown[] }>;
}

describe.skipIf(!apiKey)("model_predict base64 live smoke", () => {
  test("base64 over the source cap predicts the same as the image's URL", async (ctx) => {
    if (!modelRef) {
      ctx.skip(
        "needs ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model pointing " +
          "at a trained model with real weights.",
      );
    }

    const client = recordingClient(apiKey as string, []);
    const image = await fetch(SAMPLE_IMAGE_URL);
    expect(image.ok).toBe(true);
    const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    expect(base64.length).toBeGreaterThan(4096);

    const fromUrl = (
      await modelPredict(client, modelRef as string, {
        source: SAMPLE_IMAGE_URL,
      })
    ).data as PredictResponse;
    const fromBase64 = (
      await modelPredict(client, modelRef as string, { source: base64 })
    ).data as PredictResponse;

    expect(fromBase64.images).toHaveLength(1);
    expect(fromBase64.images.map((entry) => entry.shape)).toEqual(
      fromUrl.images.map((entry) => entry.shape),
    );
    expect(fromBase64.images.map((entry) => entry.results)).toEqual(
      fromUrl.images.map((entry) => entry.results),
    );
  }, 30_000);

  test("a local file_path predicts the same as the image's URL", async (ctx) => {
    if (!modelRef) {
      ctx.skip(
        "needs ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model pointing " +
          "at a trained model with real weights.",
      );
    }

    const client = recordingClient(apiKey as string, []);
    const image = await fetch(SAMPLE_IMAGE_URL);
    expect(image.ok).toBe(true);
    const tmpDir = await mkdtemp(join(tmpdir(), "ul-mcp-model-predict-live-"));
    try {
      const filePath = join(tmpDir, "bus.jpg");
      await writeFile(filePath, Buffer.from(await image.arrayBuffer()));

      const fromUrl = (
        await modelPredict(client, modelRef as string, {
          source: SAMPLE_IMAGE_URL,
        })
      ).data as PredictResponse;
      const fromFile = (
        await modelPredict(client, modelRef as string, { filePath })
      ).data as PredictResponse;

      expect(fromFile.images).toHaveLength(1);
      expect(fromFile.images.map((entry) => entry.shape)).toEqual(
        fromUrl.images.map((entry) => entry.shape),
      );
      expect(fromFile.images.map((entry) => entry.results)).toEqual(
        fromUrl.images.map((entry) => entry.results),
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
