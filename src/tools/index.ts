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
import { gpuAvailability } from "./gpu.js";
import { modelsGet, modelsList } from "./models.js";
import { projectsGet, projectsList } from "./projects.js";

export { datasetsGet, datasetsList } from "./datasets.js";
export { gpuAvailability } from "./gpu.js";
export { modelsGet, modelsList } from "./models.js";
export { projectsGet, projectsList } from "./projects.js";

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
