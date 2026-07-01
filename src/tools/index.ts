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
import {
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
} from "./datasets.js";
import { modelDownload } from "./downloads.js";
import { exportCreate, exportStatus, exportsList } from "./exports.js";
import { gpuAvailability } from "./gpu.js";
import { modelsGet, modelsList } from "./models.js";
import { modelPredict } from "./predict.js";
import {
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
import { trainingMonitor, trainingStart } from "./training.js";

export {
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
} from "./datasets.js";
export { modelDownload } from "./downloads.js";
export { exportCreate, exportStatus, exportsList } from "./exports.js";
export { gpuAvailability } from "./gpu.js";
export { modelsGet, modelsList } from "./models.js";
export { modelPredict } from "./predict.js";
export {
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
export { trainingMonitor, trainingStart } from "./training.js";

/** Names of the read-only tools registered by `registerReadTools`. */
export const READ_TOOL_NAMES = [
  "projects_list",
  "projects_get",
  "projects_create",
  "projects_delete",
  "datasets_list",
  "datasets_get",
  "datasets_create",
  "dataset_images_list",
  "datasets_delete",
  "dataset_ingest",
  "dataset_upload_file",
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
    "projects_create",
    {
      description: "Create a project in your Ultralytics workspace.",
      inputSchema: {
        name: z.string(),
        slug: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async ({ name, slug, description }) =>
      toMcpTextResult(
        await projectsCreate(getClient(), { name, slug, description }),
      ),
  );

  server.registerTool(
    "projects_delete",
    {
      description:
        "Soft-delete a project by id, slug, username/slug, or project ul:// URI.",
      inputSchema: { project: z.string() },
    },
    async ({ project }) =>
      toMcpTextResult(await projectsDelete(getClient(), project)),
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
    "datasets_create",
    {
      description: "Create a dataset in your Ultralytics workspace.",
      inputSchema: {
        name: z.string(),
        task: z.string(),
        slug: z.string(),
        description: z.string().optional(),
        visibility: z.string().optional(),
        classNames: z.array(z.string()).optional(),
      },
    },
    async ({ name, task, slug, description, visibility, classNames }) =>
      toMcpTextResult(
        await datasetsCreate(getClient(), {
          name,
          task,
          slug,
          description,
          visibility,
          classNames,
        }),
      ),
  );

  server.registerTool(
    "dataset_images_list",
    {
      description: "List images in a dataset with optional filtering.",
      inputSchema: {
        dataset: z.string(),
        split: z.string().optional(),
        search: z.string().optional(),
        hasLabel: z.boolean().optional(),
        classIds: z.array(z.string()).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        includeImageUrls: z.boolean().optional(),
      },
    },
    async ({
      dataset,
      split,
      search,
      hasLabel,
      classIds,
      limit,
      offset,
      includeImageUrls,
    }) =>
      toMcpTextResult(
        await datasetImagesList(getClient(), {
          dataset,
          split,
          search,
          hasLabel,
          classIds,
          limit,
          offset,
          includeImageUrls,
        }),
      ),
  );

  server.registerTool(
    "datasets_delete",
    {
      description:
        "Soft-delete a dataset by id, slug, username/slug, or dataset ul:// URI.",
      inputSchema: { dataset: z.string() },
    },
    async ({ dataset }) =>
      toMcpTextResult(await datasetsDelete(getClient(), dataset)),
  );

  server.registerTool(
    "dataset_ingest",
    {
      description: "Start a remote URL ingest job for an existing dataset.",
      inputSchema: {
        dataset: z.string(),
        sourceUrl: z.string(),
        targetSplit: z.string().optional(),
      },
    },
    async ({ dataset, sourceUrl, targetSplit }) =>
      toMcpTextResult(
        await datasetsIngest(getClient(), { dataset, sourceUrl, targetSplit }),
      ),
  );

  server.registerTool(
    "dataset_upload_file",
    {
      description:
        "Upload a local dataset archive file and start ingest for an existing dataset.",
      inputSchema: {
        dataset: z.string(),
        file_path: z.string(),
        targetSplit: z.string().optional(),
      },
    },
    async ({ dataset, file_path, targetSplit }) =>
      toMcpTextResult(
        await datasetUploadFile(getClient(), {
          dataset,
          filePath: file_path,
          targetSplit,
        }),
      ),
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

/** Names of the guarded write tools (exports + training start). */
export const WRITE_TOOL_NAMES = [
  "exports_list",
  "export_status",
  "export_create",
  "training_start",
] as const;

/** Register export and training-start tools. The cost-incurring ones are guarded. */
export function registerWriteTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  server.registerTool(
    "exports_list",
    {
      description: "List export jobs for a model.",
      inputSchema: { model: z.string(), project: z.string().optional() },
    },
    async ({ model, project }) =>
      toMcpTextResult(await exportsList(getClient(), model, project)),
  );

  server.registerTool(
    "export_status",
    {
      description: "Get status for one export job by 24-character export id.",
      inputSchema: { export_id: z.string() },
    },
    async ({ export_id }) =>
      toMcpTextResult(await exportStatus(getClient(), export_id)),
  );

  server.registerTool(
    "export_create",
    {
      description:
        "Create a model export job (state-changing, may cost credits). Requires confirm_cost=true.",
      inputSchema: {
        model: z.string(),
        format: z.string(),
        project: z.string().optional(),
        gpu_type: z.string().optional(),
        imgsz: z.number().optional(),
        half: z.boolean().optional(),
        dynamic: z.boolean().optional(),
        confirm_cost: z.boolean().optional(),
      },
    },
    async ({
      model,
      format,
      project,
      gpu_type,
      imgsz,
      half,
      dynamic,
      confirm_cost,
    }) =>
      toMcpTextResult(
        await exportCreate(getClient(), model, format, {
          project,
          gpuType: gpu_type,
          imgsz,
          half,
          dynamic,
          confirmCost: confirm_cost,
        }),
      ),
  );

  server.registerTool(
    "training_start",
    {
      description:
        "Start a cloud training job (state-changing, may cost credits). Requires confirm_cost=true.",
      inputSchema: {
        model: z.string(),
        project: z.string(),
        dataset: z.string(),
        gpu_type: z.string(),
        epochs: z.number().optional(),
        imgsz: z.number().optional(),
        batch: z.number().optional(),
        name: z.string().optional(),
        confirm_cost: z.boolean().optional(),
      },
    },
    async ({
      model,
      project,
      dataset,
      gpu_type,
      epochs,
      imgsz,
      batch,
      name,
      confirm_cost,
    }) =>
      toMcpTextResult(
        await trainingStart(getClient(), {
          model,
          project,
          dataset,
          gpuType: gpu_type,
          epochs,
          imgsz,
          batch,
          name,
          confirmCost: confirm_cost,
        }),
      ),
  );
}

/** All tool names registered so far. */
export const TOOL_NAMES = [
  ...READ_TOOL_NAMES,
  ...ACTION_TOOL_NAMES,
  ...WRITE_TOOL_NAMES,
] as const;

/** Register all available tools onto a server. */
export function registerTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerReadTools(server, getClient);
  registerActionTools(server, getClient);
  registerWriteTools(server, getClient);
}
