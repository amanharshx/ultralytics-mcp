/** Cloud GPU availability tool. */

import type { UltralyticsClient } from "../client.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord } from "./shared.js";

/** Get current cloud GPU stock status by GPU type. */
export async function gpuAvailability(
  client: UltralyticsClient,
): Promise<NormalizedToolResult> {
  const data = await client.get("/training/gpu-availability");
  const available = Object.entries(asRecord(data))
    .filter(([, stock]) => stock === "High" || stock === "Medium")
    .map(([name]) => name);
  return {
    summary: `${available.length} GPU type(s) with High/Medium stock.`,
    data,
  };
}
