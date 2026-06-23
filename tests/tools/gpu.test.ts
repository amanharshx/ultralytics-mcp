import { describe, expect, test } from "vitest";

import { gpuAvailability } from "../../src/tools/gpu.js";
import { jsonResponse, routeClient } from "../helpers.js";

describe("gpuAvailability", () => {
  test("counts High/Medium stock and returns the raw payload", async () => {
    const payload = {
      "a100-80gb-sxm": "High",
      "rtx-4090": "Medium",
      "h100-sxm": "Low",
    };
    const { client, calls } = routeClient((path) => {
      if (path === "/api/training/gpu-availability") {
        return jsonResponse(payload);
      }
      return jsonResponse({}, 404);
    });

    const result = await gpuAvailability(client);
    expect(result.summary).toBe("2 GPU type(s) with High/Medium stock.");
    expect(result.data).toEqual(payload);
    expect(calls[0].path).toBe("/api/training/gpu-availability");
  });
});
