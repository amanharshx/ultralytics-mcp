/** Tool registration for the MCP server.
 *
 * Logic functions live in the sibling modules and are re-exported for tests and
 * the parity fixture runner. Registration helpers wire tools onto an
 * `McpServer` with Zod input schemas. User-facing tool names stay snake_case for
 * parity with the Python package.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UltralyticsClient } from "../client.js";
import { toMcpTextResult } from "../tool-result.js";
import { autoAnnotateStatus } from "./auto-annotate.js";
import {
  datasetClassStats,
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
  datasetUploadFolder,
  datasetUploadVideo,
  datasetVersionCreate,
  exploreDatasets,
} from "./datasets.js";
import {
  deploymentGet,
  deploymentHealth,
  deploymentLogs,
  deploymentMetrics,
  deploymentPredict,
  deploymentStop,
  deploymentsList,
} from "./deployments.js";
import { modelDownload } from "./downloads.js";
import {
  exportCancel,
  exportCreate,
  exportStatus,
  exportsList,
} from "./exports.js";
import { gpuAvailability } from "./gpu.js";
import { modelMetrics } from "./model-metrics.js";
import { modelPlots } from "./model-plots.js";
import { modelsDelete, modelsGet, modelsList } from "./models.js";
import { modelPredict } from "./predict.js";
import {
  exploreProjects,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
import { trainingCancel, trainingMonitor, trainingStart } from "./training.js";

export { autoAnnotateStatus } from "./auto-annotate.js";
export {
  datasetClassStats,
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
  datasetUploadFolder,
  datasetUploadVideo,
  datasetVersionCreate,
  exploreDatasets,
} from "./datasets.js";
export {
  deploymentGet,
  deploymentHealth,
  deploymentLogs,
  deploymentMetrics,
  deploymentPredict,
  deploymentStop,
  deploymentsList,
} from "./deployments.js";
export { modelDownload } from "./downloads.js";
export {
  exportCancel,
  exportCreate,
  exportStatus,
  exportsList,
} from "./exports.js";
export { gpuAvailability } from "./gpu.js";
export { modelMetrics } from "./model-metrics.js";
export { modelPlots } from "./model-plots.js";
export { modelsDelete, modelsGet, modelsList } from "./models.js";
export { modelPredict } from "./predict.js";
export {
  exploreProjects,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
export { trainingCancel, trainingMonitor, trainingStart } from "./training.js";

type RegistrationGroup = "read" | "action" | "write";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ReturnType<typeof toMcpTextResult>>;

type ToolDefinition = {
  name: string;
  registrationGroup: RegistrationGroup;
  stateChanging: boolean;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  docNote?: string;
  examples?: Array<{
    title: string;
    input: Record<string, unknown>;
  }>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  createHandler: (getClient: () => UltralyticsClient) => ToolHandler;
};

function tool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  tool({
    name: "projects_list",
    registrationGroup: "read",
    stateChanging: false,
    description: "List computer-vision projects in your Ultralytics workspace.",
    inputSchema: {
      owner: z.string().optional(),
      username: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ owner, username }) =>
        toMcpTextResult(
          await projectsList(
            getClient(),
            owner as string | undefined,
            username as string | undefined,
          ),
        ),
  }),
  tool({
    name: "projects_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one project by slug, owner/slug, or project ul:// URI.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ project }) =>
        toMcpTextResult(await projectsGet(getClient(), project as string)),
  }),
  tool({
    name: "explore_projects",
    registrationGroup: "read",
    stateChanging: false,
    description: "Search public projects on Ultralytics Explore.",
    inputSchema: {
      q: z.string(),
      sort: z.string().optional(),
      offset: z.number().int().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ q, sort, offset }) =>
        toMcpTextResult(
          await exploreProjects(getClient(), {
            q: q as string,
            sort: sort as string | undefined,
            offset: offset as number | undefined,
          }),
        ),
  }),
  tool({
    name: "projects_create",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Create a project in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).",
    inputSchema: {
      name: z.string(),
      project: z
        .string()
        .describe(
          "URL slug for the new project (distinct from the display name given by name).",
        ),
      owner: z
        .string()
        .optional()
        .describe("Workspace owner; defaults to the account owner."),
      visibility: z
        .string()
        .optional()
        .describe('Visibility "private" (default) or "public".'),
      description: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ name, project, owner, visibility, description }) =>
        toMcpTextResult(
          await projectsCreate(getClient(), {
            name: name as string,
            project: project as string,
            owner: owner as string | undefined,
            visibility: visibility as string | undefined,
            description: description as string | undefined,
          }),
        ),
  }),
  tool({
    name: "projects_delete",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Soft-delete a project by slug, owner/slug, or project ul:// URI. Deleted projects land in trash and remain restorable for a bounded window.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ project }) =>
        toMcpTextResult(await projectsDelete(getClient(), project as string)),
  }),
  tool({
    name: "datasets_list",
    registrationGroup: "read",
    stateChanging: false,
    description: "List datasets in your Ultralytics workspace.",
    inputSchema: {
      owner: z.string().optional(),
      username: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ owner, username }) =>
        toMcpTextResult(
          await datasetsList(
            getClient(),
            owner as string | undefined,
            username as string | undefined,
          ),
        ),
  }),
  tool({
    name: "datasets_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one dataset by slug, owner/slug, or dataset ul:// URI.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ dataset }) =>
        toMcpTextResult(await datasetsGet(getClient(), dataset as string)),
  }),
  tool({
    name: "explore_datasets",
    registrationGroup: "read",
    stateChanging: false,
    description: "Search public datasets on Ultralytics Explore.",
    inputSchema: {
      q: z.string(),
      sort: z.string().optional(),
      offset: z.number().int().optional(),
      task: z.array(z.string()).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ q, sort, offset, task }) =>
        toMcpTextResult(
          await exploreDatasets(getClient(), {
            q: q as string,
            sort: sort as string | undefined,
            offset: offset as number | undefined,
            task: task as string[] | undefined,
          }),
        ),
  }),
  tool({
    name: "datasets_create",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Create a dataset in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).",
    inputSchema: {
      name: z.string(),
      dataset: z
        .string()
        .describe(
          "URL slug for the new dataset (distinct from the display name given by name).",
        ),
      task: z
        .string()
        .describe(
          "Dataset task such as detect, segment, semantic, pose, obb, or classify.",
        ),
      owner: z
        .string()
        .optional()
        .describe("Workspace owner; defaults to the account owner."),
      visibility: z
        .string()
        .optional()
        .describe('Visibility "private" (default) or "public".'),
      description: z.string().optional(),
      classNames: z.array(z.string()).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({
        name,
        dataset,
        task,
        owner,
        description,
        visibility,
        classNames,
      }) =>
        toMcpTextResult(
          await datasetsCreate(getClient(), {
            name: name as string,
            dataset: dataset as string,
            task: task as string,
            owner: owner as string | undefined,
            description: description as string | undefined,
            visibility: visibility as string | undefined,
            classNames: classNames as string[] | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_images_list",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "List images in a dataset by slug, owner/slug, or dataset ul:// URI with optional filtering.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      split: z.string().optional(),
      search: z.string().optional(),
      hasLabel: z.boolean().optional(),
      classIds: z.array(z.string()).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      includeImageUrls: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
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
            dataset: dataset as string,
            split: split as string | undefined,
            search: search as string | undefined,
            hasLabel: hasLabel as boolean | undefined,
            classIds: classIds as string[] | undefined,
            limit: limit as number | undefined,
            offset: offset as number | undefined,
            includeImageUrls: includeImageUrls as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_export",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get a time-limited export download link for a dataset by slug, owner/slug, or dataset ul:// URI, for the latest export or one frozen version.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      version: z.number().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ dataset, version }) =>
        toMcpTextResult(
          await datasetExport(getClient(), {
            dataset: dataset as string,
            version: version as number | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_class_stats",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get per-class annotation counts for a dataset by slug, owner/slug, or dataset ul:// URI. By default omits the bulky histogram and heatmap groups (image size, file size, format, points-per-annotation, bbox distributions, and location/dimension heatmaps), naming them in the summary; pass include_histograms: true to get the full payload unmodified.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      include_histograms: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ dataset, include_histograms }) =>
        toMcpTextResult(
          await datasetClassStats(getClient(), {
            dataset: dataset as string,
            includeHistograms: include_histograms as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "auto_annotate_status",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get an auto-annotation run's status for a dataset by slug, owner/slug, or dataset ul:// URI. Surfaces activeJob and lastRun unmodified: both null means the dataset has never run one; activeJob carries progress for a run in flight; lastRun carries failed/stopped booleans plus results, or an error when the run failed.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ dataset }) =>
        toMcpTextResult(
          await autoAnnotateStatus(getClient(), dataset as string),
        ),
  }),
  tool({
    name: "dataset_version_create",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Create a frozen dataset version snapshot by slug, owner/slug, or dataset ul:// URI. If the dataset is unchanged since the previous snapshot the existing version is returned instead of a new one.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      description: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ dataset, description }) =>
        toMcpTextResult(
          await datasetVersionCreate(getClient(), {
            dataset: dataset as string,
            description: description as string | undefined,
          }),
        ),
  }),
  tool({
    name: "datasets_delete",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Delete a dataset by slug, owner/slug, or dataset ul:// URI. Deleting a dataset moves its images and annotations to trash with it; models trained on it are not deleted. Trashed items remain restorable for a bounded window.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ dataset }) =>
        toMcpTextResult(await datasetsDelete(getClient(), dataset as string)),
  }),
  tool({
    name: "dataset_ingest",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Start a remote URL ingest job for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      sourceUrl: z.string(),
      targetSplit: z.string().optional(),
      conflictPolicy: z
        .string()
        .optional()
        .describe(
          'Conflict policy "skip" (default), "keep_both", or "replace".',
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ dataset, sourceUrl, targetSplit, conflictPolicy }) =>
        toMcpTextResult(
          await datasetsIngest(getClient(), {
            dataset: dataset as string,
            sourceUrl: sourceUrl as string,
            targetSplit: targetSplit as string | undefined,
            conflictPolicy: conflictPolicy as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_file",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Upload a local dataset archive through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      file_path: z.string().describe("Local path to dataset archive file."),
      targetSplit: z.string().optional(),
      conflictPolicy: z
        .string()
        .optional()
        .describe(
          'Conflict policy "skip" (default), "keep_both", or "replace".',
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local archive file path and starts ingest into an existing dataset. Named YOLO ZIP archives preserve labels and classes on later ingests; archives without class names may map labels by positional index.",
    examples: [
      {
        title: "Upload dataset archive",
        input: {
          dataset: "team/warehouse-items",
          file_path: "/data/warehouse-items.zip",
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ dataset, file_path, targetSplit, conflictPolicy }) =>
        toMcpTextResult(
          await datasetUploadFile(getClient(), {
            dataset: dataset as string,
            filePath: file_path as string,
            targetSplit: targetSplit as string | undefined,
            conflictPolicy: conflictPolicy as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_folder",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Upload a local image folder as a zip through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      folder_path: z.string().describe("Local path to image folder."),
      targetSplit: z.string().optional(),
      conflictPolicy: z
        .string()
        .optional()
        .describe(
          'Conflict policy "skip" (default), "keep_both", or "replace".',
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local image folder path, zips it client-side, and starts ingest into an existing dataset. Images-only uploads may be inferred as classify by the platform; include task-specific labels when task preservation matters.",
    examples: [
      {
        title: "Upload image folder",
        input: {
          dataset: "team/warehouse-items",
          folder_path: "/data/warehouse-items",
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ dataset, folder_path, targetSplit, conflictPolicy }) =>
        toMcpTextResult(
          await datasetUploadFolder(getClient(), {
            dataset: dataset as string,
            folderPath: folder_path as string,
            targetSplit: targetSplit as string | undefined,
            conflictPolicy: conflictPolicy as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_video",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Upload a local video as extracted frames through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by slug, owner/slug, or ul:// URI."),
      video_path: z.string().describe("Local path to source video file."),
      fps: z.number().optional(),
      max_frames: z.number().int().optional(),
      targetSplit: z.string().optional(),
      conflictPolicy: z
        .string()
        .optional()
        .describe(
          'Conflict policy "skip" (default), "keep_both", or "replace".',
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local video path, extracts JPEG frames with ffmpeg, and starts ingest into an existing dataset. Images-only uploads may be inferred as classify by the platform; include task-specific labels when task preservation matters.",
    examples: [
      {
        title: "Upload video for frame extraction",
        input: {
          dataset: "team/factory-lines",
          video_path: "/videos/factory-shift.mp4",
          fps: 2,
          max_frames: 500,
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({
        dataset,
        video_path,
        fps,
        max_frames,
        targetSplit,
        conflictPolicy,
      }) =>
        toMcpTextResult(
          await datasetUploadVideo(getClient(), {
            dataset: dataset as string,
            videoPath: video_path as string,
            fps: fps as number | undefined,
            maxFrames: max_frames as number | undefined,
            targetSplit: targetSplit as string | undefined,
            conflictPolicy: conflictPolicy as string | undefined,
          }),
        ),
  }),
  tool({
    name: "models_list",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "List models in a project by slug, owner/slug, or project ul:// URI.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by slug, owner/slug, or ul:// URI."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ project }) =>
        toMcpTextResult(await modelsList(getClient(), project as string)),
  }),
  tool({
    name: "models_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one model by owner/project/model, ul://owner/project/model, or slug with a project.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ model, project }) =>
        toMcpTextResult(
          await modelsGet(
            getClient(),
            model as string,
            project as string | undefined,
          ),
        ),
  }),
  tool({
    name: "models_delete",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Soft-delete a model by owner/project/model, ul://owner/project/model, or slug with a project. Deleted models go to trash and remain restorable; weights, training history, and exports are removed only on permanent deletion.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ model, project }) =>
        toMcpTextResult(
          await modelsDelete(
            getClient(),
            model as string,
            project as string | undefined,
          ),
        ),
  }),
  tool({
    name: "gpu_availability",
    registrationGroup: "read",
    stateChanging: false,
    description: "Get current cloud-GPU stock status by GPU type.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler: (getClient) => async () =>
      toMcpTextResult(await gpuAvailability(getClient())),
  }),
  tool({
    name: "deployments_list",
    registrationGroup: "read",
    stateChanging: false,
    description: "List model deployments in your Ultralytics workspace.",
    inputSchema: {
      owner: z
        .string()
        .optional()
        .describe("Workspace owner; defaults to the account owner."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ owner }) =>
        toMcpTextResult(
          await deploymentsList(getClient(), owner as string | undefined),
        ),
  }),
  tool({
    name: "deployment_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). serviceUrl and deployedAt are null until the deployment reaches status ready.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ deployment }) =>
        toMcpTextResult(await deploymentGet(getClient(), deployment as string)),
  }),
  tool({
    name: "deployment_health",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Probe one deployment's health by owner/deployment or a bare slug (owner defaults to the account owner). status is the upstream HTTP status the health probe observed at the deployment's own service URL, not the status of this tool call.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ deployment }) =>
        toMcpTextResult(
          await deploymentHealth(getClient(), deployment as string),
        ),
  }),
  tool({
    name: "deployment_logs",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Read log entries for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). severity is passed through to the server unvalidated (illustrative values: DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY); an invalid value returns the server's own rejection message. limit defaults to 50, max 200. nextPageToken pages through older entries.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
      severity: z
        .string()
        .optional()
        .describe(
          "Comma-separated log severity levels, passed through unvalidated (e.g. INFO or WARNING,ERROR). Exact match, not a minimum threshold.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max entries to return (default 50, max 200)."),
      pageToken: z
        .string()
        .optional()
        .describe("Pagination token from a previous call's nextPageToken."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ deployment, severity, limit, pageToken }) =>
        toMcpTextResult(
          await deploymentLogs(getClient(), deployment as string, {
            severity: severity as string | undefined,
            limit: limit as number | undefined,
            pageToken: pageToken as string | undefined,
          }),
        ),
  }),
  tool({
    name: "deployment_metrics",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Read metrics for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). The response is one of two shapes selected by sparkline: the default shape carries timeRange (a {start, end} object)/summary/timeSeries, sparkline=true carries requests24h (an array of per-hour points, not a total)/totalRequests/errorRate/avgLatencyMs. The two are never merged; which shape came back is returned as-is. range is one of 1h, 6h, 24h, 7d, 30d (default 24h), passed through to the server unvalidated.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
      range: z
        .string()
        .optional()
        .describe(
          "Time range, passed through unvalidated (one of 1h, 6h, 24h, 7d, 30d; default 24h).",
        ),
      sparkline: z
        .boolean()
        .optional()
        .describe(
          "When true, selects the compact sparkline shape (requests24h, totalRequests, errorRate, avgLatencyMs) instead of the detailed shape.",
        ),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ deployment, range, sparkline }) =>
        toMcpTextResult(
          await deploymentMetrics(getClient(), deployment as string, {
            range: range as string | undefined,
            sparkline: sparkline as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "deployment_predict",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Run inference through a deployment's own serving endpoint on a local image file, by owner/deployment or a bare slug (owner defaults to the account owner). Returns images/metadata verbatim, including undocumented metadata fields. No per-request cost is documented for this endpoint; costs follow the deployment's own resource configuration. A cold start on a scaled-to-zero deployment may respond slowly or with a 503 — check deployment_health rather than retrying blindly.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
      imagePath: z
        .string()
        .describe(
          "Local path to an image file (.jpg, .jpeg, .png, .webp, .bmp, .tif, .tiff).",
        ),
      conf: z
        .number()
        .optional()
        .describe(
          "Confidence threshold (0.01-1, server default applies if omitted).",
        ),
      iou: z
        .number()
        .optional()
        .describe("IoU threshold (0-0.95, server default applies if omitted)."),
      imgsz: z
        .number()
        .optional()
        .describe(
          "Inference image size (32-1280, server default applies if omitted).",
        ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ deployment, imagePath, conf, iou, imgsz }) =>
        toMcpTextResult(
          await deploymentPredict(getClient(), deployment as string, {
            imagePath: imagePath as string,
            conf: conf as number | undefined,
            iou: iou as number | undefined,
            imgsz: imgsz as number | undefined,
          }),
        ),
  }),
  tool({
    name: "deployment_stop",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Stop a deployment by owner/deployment or a bare slug (owner defaults to the account owner). Sends only {action: stop}; the endpoint's start/resize/replace actions are unreachable from this tool. Stopping preserves the deployment's URL and configuration and still counts toward deployment quota; it is a money-off switch and ships ungated, consistent with training_cancel and export_cancel. Stopping an already-stopped deployment is rejected by the server (400) rather than treated as a success. Reversing this (start) is not available in this tool set.",
    inputSchema: {
      deployment: z
        .string()
        .describe("Deployment ref by owner/deployment or a bare slug."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ deployment }) =>
        toMcpTextResult(
          await deploymentStop(getClient(), deployment as string),
        ),
  }),
  tool({
    name: "training_monitor",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Report a model's training status and progress (works for private and public projects). timing.elapsedMs is wall-clock since model creation, evaluated at request time: it tracks elapsed run time while training is active, but for a finished model it reflects the model's age, not training duration. Billed training time is computeCost.durationMs.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
      include_history: z.boolean().optional(),
      history_last_n: z.number().int().positive().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ model, project, include_history, history_last_n }) =>
        toMcpTextResult(
          await trainingMonitor(
            getClient(),
            model as string,
            project as string | undefined,
            {
              includeHistory: include_history as boolean | undefined,
              historyLastN: history_last_n as number | undefined,
            },
          ),
        ),
  }),
  tool({
    name: "model_metrics",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Report a model's best-epoch and final-epoch evaluation metrics, labelled so one cannot be mistaken for the other (works for private and public projects). bestEpochMetrics is pulled explicitly from trainResults by matching its epoch field against bestEpoch, retrievable regardless of any include_history window; finalEpochMetrics is the model's top-level metrics field, observed live to always equal the last recorded epoch, never the best one. On a model with incoherent or missing training data (for example bestEpoch pointing past the recorded epochs), bestEpoch, bestFitness, and bestEpochMetrics are all reported as null rather than echoing the platform's unreliable raw values, and bestEpochNote explains why. include_train_args adds the full trainArgs object (111 keys observed live), omitted by default. include_history adds a metricsHistory-style curve and always states the window it covers, including when the full curve is returned.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
      include_history: z.boolean().optional(),
      history_last_n: z.number().int().positive().optional(),
      include_train_args: z.boolean().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({
        model,
        project,
        include_history,
        history_last_n,
        include_train_args,
      }) =>
        toMcpTextResult(
          await modelMetrics(
            getClient(),
            model as string,
            project as string | undefined,
            {
              includeHistory: include_history as boolean | undefined,
              historyLastN: history_last_n as number | undefined,
              includeTrainArgs: include_train_args as boolean | undefined,
            },
          ),
        ),
  }),
  tool({
    name: "model_plots",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Report a model's evaluation plots (per-class pr_curve, f1_curve, precision_curve, recall_curve, confusion_matrix), which model_metrics and training_monitor do not surface. By default lists each plot's type and the shape of its fields (array lengths only, never the values) since one pr_curve alone can carry thousands of numbers on a multi-class model; pass type to get that one plot's data back exactly as the platform returned it, unmodified. Field shapes vary by type: pr_curve/f1_curve/precision_curve/recall_curve carry x/y (and pr_curve additionally ap); confusion_matrix carries a matrix field instead, not x/y/ap. Plot presence does not track training history: a model can have plots with no trainResults, or (rarely) plots: [] on an otherwise completed model.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
      type: z
        .string()
        .optional()
        .describe(
          "Return this one plot's full data unmodified (e.g. pr_curve, confusion_matrix). Omit to list what's available.",
        ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ model, project, type }) =>
        toMcpTextResult(
          await modelPlots(
            getClient(),
            model as string,
            project as string | undefined,
            { type: type as string | undefined },
          ),
        ),
  }),
  tool({
    name: "model_predict",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Run inference with a trained model on an image URL or base64 source (no local file paths).",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      source: z
        .string()
        .describe(
          "Image URL, raw base64-encoded image, or base64 data: URI (data:<mime>;base64,<payload>). Local file paths are not supported.",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
      conf: z.number().optional(),
      iou: z.number().optional(),
      imgsz: z.number().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    examples: [
      {
        title: "Predict from image URL",
        input: {
          model: "team/project/my-model",
          source: "https://images.example.com/example.jpg",
          conf: 0.25,
        },
      },
      {
        title: "Predict from base64 input",
        input: {
          model: "team/project/my-model",
          source: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ model, source, project, conf, iou, imgsz }) =>
        toMcpTextResult(
          await modelPredict(getClient(), model as string, {
            source: source as string,
            project: project as string | undefined,
            conf: conf as number | undefined,
            iou: iou as number | undefined,
            imgsz: imgsz as number | undefined,
          }),
        ),
  }),
  tool({
    name: "model_download",
    registrationGroup: "action",
    stateChanging: true,
    description:
      "Download a trained model's weight file to an explicit local path by owner/project/model, ul://owner/project/model, or slug with a project.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      output_path: z
        .string()
        .describe("Local destination path for downloaded model weights."),
      project: z.string().optional(),
      filename: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote: "Writes model weights to a local filesystem path.",
    examples: [
      {
        title: "Download model weights",
        input: {
          model: "team/project/my-model",
          output_path: "/tmp/model.pt",
          overwrite: true,
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ model, output_path, project, filename, overwrite }) =>
        toMcpTextResult(
          await modelDownload(getClient(), model as string, {
            outputPath: output_path as string,
            project: project as string | undefined,
            filename: filename as string | undefined,
            overwrite: overwrite as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "exports_list",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "List export jobs for a model by owner/project/model, ul://owner/project/model, or slug with a project.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ model, project }) =>
        toMcpTextResult(
          await exportsList(
            getClient(),
            model as string,
            project as string | undefined,
          ),
        ),
  }),
  tool({
    name: "export_status",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get one export job's status for a model by owner/project/model, ul://owner/project/model, or slug with a project, plus the export id.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      export_id: z.string().describe("Export job id."),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ model, export_id, project }) =>
        toMcpTextResult(
          await exportStatus(
            getClient(),
            model as string,
            export_id as string,
            project as string | undefined,
          ),
        ),
  }),
  tool({
    name: "export_create",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Create a model export job by owner/project/model, ul://owner/project/model, or slug with a project (state-changing, may cost credits). The format is validated immediately by the server; task and architecture compatibility is only known when the job runs, so a queued export can still fail. Use export_status and exports_list for the real outcome. Requires confirm_cost=true.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      format: z
        .string()
        .describe("Requested export format (validated by the server)."),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
      gpu_type: z
        .string()
        .optional()
        .describe("GPU type required for TensorRT engine exports."),
      imgsz: z.number().optional(),
      half: z.boolean().optional(),
      dynamic: z.boolean().optional(),
      confirm_cost: z
        .boolean()
        .optional()
        .describe("Must be true to allow a credit-costing export job."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    docNote:
      "State-changing export job that may cost credits. Set `confirm_cost` to `true` explicitly.",
    examples: [
      {
        title: "Create export job",
        input: {
          model: "team/project/my-model",
          format: "onnx",
          confirm_cost: true,
        },
      },
    ],
    createHandler:
      (getClient) =>
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
          await exportCreate(getClient(), model as string, format as string, {
            project: project as string | undefined,
            gpuType: gpu_type as string | undefined,
            imgsz: imgsz as number | undefined,
            half: half as boolean | undefined,
            dynamic: dynamic as boolean | undefined,
            confirmCost: confirm_cost as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "export_cancel",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Cancel an active export job for a model by owner/project/model, ul://owner/project/model, or slug with a project, plus the export id. Checks the export's status first and sends the cancellation only while it is still active, refusing on any terminal status; the same API verb deletes a finished export's artifact irreversibly instead of cancelling it. The status check cannot be atomic: an export that finishes between the check and the request will have its artifact deleted rather than cancelled, and that deletion cannot be undone.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      export_id: z.string().describe("Export job id."),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ model, export_id, project }) =>
        toMcpTextResult(
          await exportCancel(
            getClient(),
            model as string,
            export_id as string,
            project as string | undefined,
          ),
        ),
  }),
  tool({
    name: "training_start",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Start a cloud training job from an existing model or official YOLO base checkpoint (state-changing, may cost credits). The dataset is validated immediately, so an unusable dataset is rejected before any compute starts; checkpoint mode also checks the checkpoint's task against every dataset's task up front. Starting is billable immediately: the platform has no cost preview before that, so the projected cost and remaining balance are only reported after the job starts. Training an existing model that already has a recorded run (any status past pending/untrained) replaces that model's status, epoch count, and per-epoch metric history the instant the new job starts, and that history cannot be recovered afterward; the previously uploaded weights survive. That path requires confirm_history_loss=true in addition to confirm_cost=true. Checkpoint mode always creates a new model and destroys nothing, so it never needs confirm_history_loss. An untrained or never-trained model needs no extra confirmation either. Use training_cancel to stop a job that is already running. Requires confirm_cost=true.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Existing model ref, or official YOLO base checkpoint such as yolo11n.pt or yolo11n-seg.pt. Checkpoint mode auto-creates a project model.",
        ),
      project: z
        .string()
        .describe("Project ref that owns the training job and resolved model."),
      dataset: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "Dataset ref by slug, owner/slug, or ul:// URI, or a list of refs to fine-tune on sequentially.",
        ),
      gpu_type: z.string().describe("Cloud GPU type to allocate for training."),
      train_args: z.record(z.string(), z.unknown()).optional(),
      epochs: z.number().optional(),
      imgsz: z.number().optional(),
      batch: z.number().optional(),
      name: z.string().optional(),
      confirm_cost: z
        .boolean()
        .optional()
        .describe(
          "Must be true to allow a credit-costing training run. Starting is billable immediately; the platform has no cost preview before that, so the estimated cost and remaining balance are only reported after the job starts.",
        ),
      confirm_history_loss: z
        .boolean()
        .optional()
        .describe(
          "Must be true to restart training on an existing model that already has a recorded run. Doing so replaces that model's status, epoch count, and per-epoch metric history irrecoverably; the previously uploaded weights survive. Not required for an untrained model or for checkpoint mode, which creates a new model instead. Separate from confirm_cost.",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    docNote:
      "Checkpoint-pattern model values such as `yolo11n.pt` and `yolo11n-seg.pt` trigger checkpoint mode, auto-create a project model, and require dataset-task compatibility.",
    examples: [
      {
        title: "Train from existing model",
        input: {
          model: "team/project/my-model",
          project: "team/project",
          dataset: "team/warehouse-items",
          gpu_type: "rtx-4090",
          confirm_cost: true,
        },
      },
      {
        title: "Retrain an existing model that already has a recorded run",
        input: {
          model: "team/project/my-model",
          project: "team/project",
          dataset: "team/warehouse-items",
          gpu_type: "rtx-4090",
          confirm_cost: true,
          confirm_history_loss: true,
        },
      },
      {
        title: "Train from official YOLO checkpoint",
        input: {
          model: "yolo11n-seg.pt",
          project: "team/project",
          dataset: "team/road-segments",
          gpu_type: "rtx-4090",
          confirm_cost: true,
        },
      },
      {
        title: "Fine-tune sequentially across multiple datasets",
        input: {
          model: "team/project/my-model",
          project: "team/project",
          dataset: ["team/road-segments", "team/warehouse-items"],
          gpu_type: "rtx-4090",
          confirm_cost: true,
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({
        model,
        project,
        dataset,
        gpu_type,
        train_args,
        epochs,
        imgsz,
        batch,
        name,
        confirm_cost,
        confirm_history_loss,
      }) =>
        toMcpTextResult(
          await trainingStart(getClient(), {
            model: model as string,
            project: project as string,
            dataset: dataset as string | string[],
            gpuType: gpu_type as string,
            trainArgs: train_args as Record<string, unknown> | undefined,
            epochs: epochs as number | undefined,
            imgsz: imgsz as number | undefined,
            batch: batch as number | undefined,
            name: name as string | undefined,
            confirmCost: confirm_cost as boolean | undefined,
            confirmHistoryLoss: confirm_history_loss as boolean | undefined,
          }),
        ),
  }),
  tool({
    name: "training_cancel",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Cancel a running training job by owner/project/model, ul://owner/project/model, or slug with a project. Cancelling releases the compute instance; elapsed GPU time is still charged and the most recently uploaded checkpoint is preserved rather than discarded. This stops the job and does not delete the model.",
    inputSchema: {
      model: z
        .string()
        .describe(
          "Model ref by owner/project/model, ul:// URI, or slug (requires project).",
        ),
      project: z
        .string()
        .optional()
        .describe("Project ref required when model is given by slug."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ model, project }) =>
        toMcpTextResult(
          await trainingCancel(
            getClient(),
            model as string,
            project as string | undefined,
          ),
        ),
  }),
];

function toolNames(predicate: (tool: ToolDefinition) => boolean): string[] {
  return TOOL_DEFINITIONS.filter(predicate).map((tool) => tool.name);
}

/** Names of tools that do not mutate remote or local state. */
export const READ_ONLY_TOOL_NAMES = toolNames((tool) => !tool.stateChanging);

/** Names of tools that mutate remote state or local filesystem state. */
export const STATE_CHANGING_TOOL_NAMES = toolNames(
  (tool) => tool.stateChanging,
);

/** Names of the tools grouped by operational semantics. */
export const TOOL_SETS = {
  readOnly: READ_ONLY_TOOL_NAMES,
  stateChanging: STATE_CHANGING_TOOL_NAMES,
} as const;

function registerToolDefinitions(
  server: McpServer,
  getClient: () => UltralyticsClient,
  registrationGroup: RegistrationGroup,
): void {
  for (const definition of TOOL_DEFINITIONS) {
    if (definition.registrationGroup !== registrationGroup) {
      continue;
    }

    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      definition.createHandler(getClient),
    );
  }
}

/** Register the read-only tools onto a server, using a lazy client provider. */
export function registerReadTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerToolDefinitions(server, getClient, "read");
}

/** Register local action tools. */
export function registerActionTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerToolDefinitions(server, getClient, "action");
}

/** Register remote mutation tools. The cost-incurring ones are guarded. */
export function registerWriteTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerToolDefinitions(server, getClient, "write");
}

/** All tool names registered so far. */
export const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

/** Register all available tools onto a server. */
export function registerTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerReadTools(server, getClient);
  registerActionTools(server, getClient);
  registerWriteTools(server, getClient);
}
