/** Tool registration for the MCP server.
 *
 * Logic functions live in the sibling modules and are re-exported for tests and
 * the parity fixture runner. `registerReadTools` wires them onto an `McpServer`
 * with Zod input schemas. User-facing tool names stay snake_case for parity with
 * the Python package.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UltralyticsClient } from "../client.js";
import { toMcpTextResult } from "../tool-result.js";
import { datasetsGet, datasetsList } from "./datasets.js";
import { modelDownload } from "./downloads.js";
import { gpuAvailability } from "./gpu.js";
import { modelsGet, modelsList } from "./models.js";
import { modelPredict } from "./predict.js";
import { projectsGet, projectsList } from "./projects.js";
import { trainingMonitor } from "./training.js";

export { datasetsGet, datasetsList } from "./datasets.js";
export { modelDownload } from "./downloads.js";
export { gpuAvailability } from "./gpu.js";
export { modelsGet, modelsList } from "./models.js";
export { modelPredict } from "./predict.js";
export { projectsGet, projectsList } from "./projects.js";
export { trainingMonitor } from "./training.js";

/** Names of the read-only tools registered by `registerReadTools`. */
export const READ_TOOL_NAMES = [
  "projects_list",
  "projects_get",
  "datasets_list",
  "datasets_get",
  "models_list",
  "models_get",
  "gpu_availability",
] as const;

/** Register the read-only tools onto a server, using a lazy client provider. */
export function registerReadTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  server.registerTool(
    "projects_list",
    {
      description:
        "List computer-vision projects in your Ultralytics workspace.",
      inputSchema: { username: z.string().optional() },
    },
    async ({ username }) =>
      toMcpTextResult(await projectsList(getClient(), username)),
  );

  server.registerTool(
    "projects_get",
    {
      description:
        "Get details for one project by id, slug, username/slug, or project ul:// URI.",
      inputSchema: { project: z.string() },
    },
    async ({ project }) =>
      toMcpTextResult(await projectsGet(getClient(), project)),
  );

  server.registerTool(
    "datasets_list",
    {
      description: "List datasets in your Ultralytics workspace.",
      inputSchema: { username: z.string().optional() },
    },
    async ({ username }) =>
      toMcpTextResult(await datasetsList(getClient(), username)),
  );

  server.registerTool(
    "datasets_get",
    {
      description:
        "Get details for one dataset by id, slug, username/slug, or dataset ul:// URI.",
      inputSchema: { dataset: z.string() },
    },
    async ({ dataset }) =>
      toMcpTextResult(await datasetsGet(getClient(), dataset)),
  );

  server.registerTool(
    "models_list",
    {
      description:
        "List models in a project by project id, slug, username/slug, or project ul:// URI.",
      inputSchema: { project: z.string() },
    },
    async ({ project }) =>
      toMcpTextResult(await modelsList(getClient(), project)),
  );

  server.registerTool(
    "models_get",
    {
      description: "Get one model by id, or by slug plus project.",
      inputSchema: { model: z.string(), project: z.string().optional() },
    },
    async ({ model, project }) =>
      toMcpTextResult(await modelsGet(getClient(), model, project)),
  );

  server.registerTool(
    "gpu_availability",
    {
      description: "Get current cloud-GPU stock status by GPU type.",
      inputSchema: {},
    },
    async () => toMcpTextResult(await gpuAvailability(getClient())),
  );
}

/** Names of the monitor/predict/download tools. */
export const ACTION_TOOL_NAMES = [
  "training_monitor",
  "model_predict",
  "model_download",
] as const;

/** Register training monitor, predict, and download tools. */
export function registerActionTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  server.registerTool(
    "training_monitor",
    {
      description:
        "Report a model's training status and progress (works for private and public projects).",
      inputSchema: { model: z.string(), project: z.string().optional() },
    },
    async ({ model, project }) =>
      toMcpTextResult(await trainingMonitor(getClient(), model, project)),
  );

  server.registerTool(
    "model_predict",
    {
      description:
        "Run inference with a trained model on an image URL or base64 source (no local file paths).",
      inputSchema: {
        model: z.string(),
        source: z.string(),
        project: z.string().optional(),
        conf: z.number().optional(),
        iou: z.number().optional(),
        imgsz: z.number().optional(),
      },
    },
    async ({ model, source, project, conf, iou, imgsz }) =>
      toMcpTextResult(
        await modelPredict(getClient(), model, {
          source,
          project,
          conf,
          iou,
          imgsz,
        }),
      ),
  );

  server.registerTool(
    "model_download",
    {
      description:
        "Download one trained model weight file to an explicit local path.",
      inputSchema: {
        model: z.string(),
        output_path: z.string(),
        project: z.string().optional(),
        filename: z.string().optional(),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ model, output_path, project, filename, overwrite }) =>
      toMcpTextResult(
        await modelDownload(getClient(), model, {
          outputPath: output_path,
          project,
          filename,
          overwrite,
        }),
      ),
  );
}

/** All tool names registered so far. */
export const TOOL_NAMES = [...READ_TOOL_NAMES, ...ACTION_TOOL_NAMES] as const;

/** Register all available tools onto a server. */
export function registerTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerReadTools(server, getClient);
  registerActionTools(server, getClient);
}
