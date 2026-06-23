import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import { modelPredict } from "../../src/tools/predict.js";
import { BASE, KEY } from "../helpers.js";

const ID = "a".repeat(24);

describe("modelPredict", () => {
  test("rejects a blank source before any request", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("should not be called");
      }) as unknown as typeof fetch,
    });
    await expect(modelPredict(client, ID, { source: "  " })).rejects.toThrow(
      /`source` is required/,
    );
  });

  test("sends the source and options as multipart form data", async () => {
    const calls: { url: string; body: FormData }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: init.body as FormData });
      return new Response(
        JSON.stringify({ images: [{ results: [{ class: 0 }, { class: 1 }] }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    const result = await modelPredict(client, ID, {
      source: "https://x/y.jpg",
      conf: 0.5,
    });
    expect(result.summary).toBe("1 image(s), 2 detection(s).");

    const body = calls[0].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("source")).toBe("https://x/y.jpg");
    expect(body.get("conf")).toBe("0.5");
    expect(body.get("iou")).toBe("0.7");
    expect(body.get("imgsz")).toBe("640");
    expect(calls[0].url).toBe(`${BASE}/models/${ID}/predict`);
  });
});
