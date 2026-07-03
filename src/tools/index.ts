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
import { modelDownload } from "./downloads.js";
import { exportCreate, exportStatus, exportsList } from "./exports.js";
import { gpuAvailability } from "./gpu.js";
import { modelsGet, modelsList } from "./models.js";
import { modelPredict } from "./predict.js";
import {
  exploreProjects,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
import { trainingMonitor, trainingStart } from "./training.js";

export {
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
export { modelDownload } from "./downloads.js";
export { exportCreate, exportStatus, exportsList } from "./exports.js";
export { gpuAvailability } from "./gpu.js";
export { modelsGet, modelsList } from "./models.js";
export { modelPredict } from "./predict.js";
export {
  exploreProjects,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "./projects.js";
export { trainingMonitor, trainingStart } from "./training.js";

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
    inputSchema: { username: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ username }) =>
        toMcpTextResult(
          await projectsList(getClient(), username as string | undefined),
        ),
  }),
  tool({
    name: "projects_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one project by id, slug, username/slug, or project ul:// URI.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by id, slug, username/slug, or ul:// URI."),
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
    registrationGroup: "read",
    stateChanging: true,
    description: "Create a project in your Ultralytics workspace.",
    inputSchema: {
      name: z.string(),
      slug: z.string().optional(),
      description: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ name, slug, description }) =>
        toMcpTextResult(
          await projectsCreate(getClient(), {
            name: name as string,
            slug: slug as string | undefined,
            description: description as string | undefined,
          }),
        ),
  }),
  tool({
    name: "projects_delete",
    registrationGroup: "read",
    stateChanging: true,
    description:
      "Soft-delete a project by id, slug, username/slug, or project ul:// URI.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by id, slug, username/slug, or ul:// URI."),
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
    inputSchema: { username: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ username }) =>
        toMcpTextResult(
          await datasetsList(getClient(), username as string | undefined),
        ),
  }),
  tool({
    name: "datasets_get",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "Get details for one dataset by id, slug, username/slug, or dataset ul:// URI.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
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
    registrationGroup: "read",
    stateChanging: true,
    description: "Create a dataset in your Ultralytics workspace.",
    inputSchema: {
      name: z.string(),
      task: z
        .string()
        .describe(
          "Dataset task such as detect, segment, semantic, pose, obb, or classify.",
        ),
      slug: z.string(),
      description: z.string().optional(),
      visibility: z.string().optional(),
      classNames: z.array(z.string()).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    createHandler:
      (getClient) =>
      async ({ name, task, slug, description, visibility, classNames }) =>
        toMcpTextResult(
          await datasetsCreate(getClient(), {
            name: name as string,
            task: task as string,
            slug: slug as string,
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
    description: "List images in a dataset with optional filtering.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
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
    description: "Get export link for latest or one frozen dataset version.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
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
    name: "dataset_version_create",
    registrationGroup: "read",
    stateChanging: true,
    description: "Create a frozen dataset version snapshot.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
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
    registrationGroup: "read",
    stateChanging: true,
    description:
      "Soft-delete a dataset by id, slug, username/slug, or dataset ul:// URI.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
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
    registrationGroup: "read",
    stateChanging: true,
    description: "Start a remote URL ingest job for an existing dataset.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
      sourceUrl: z.string(),
      targetSplit: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    createHandler:
      (getClient) =>
      async ({ dataset, sourceUrl, targetSplit }) =>
        toMcpTextResult(
          await datasetsIngest(getClient(), {
            dataset: dataset as string,
            sourceUrl: sourceUrl as string,
            targetSplit: targetSplit as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_file",
    registrationGroup: "read",
    stateChanging: true,
    description:
      "Upload a local dataset archive file and start ingest for an existing dataset.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
      file_path: z.string().describe("Local path to dataset archive file."),
      targetSplit: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local archive file path and starts ingest into an existing dataset.",
    examples: [
      {
        title: "Upload dataset archive",
        input: {
          dataset: "team/datasets/warehouse-items",
          file_path: "/data/warehouse-items.zip",
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ dataset, file_path, targetSplit }) =>
        toMcpTextResult(
          await datasetUploadFile(getClient(), {
            dataset: dataset as string,
            filePath: file_path as string,
            targetSplit: targetSplit as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_folder",
    registrationGroup: "read",
    stateChanging: true,
    description:
      "Upload a local image folder as a zip and start ingest for an existing dataset.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
      folder_path: z.string().describe("Local path to image folder."),
      targetSplit: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local image folder path, zips it client-side, and starts ingest into an existing dataset.",
    examples: [
      {
        title: "Upload image folder",
        input: {
          dataset: "team/datasets/warehouse-items",
          folder_path: "/data/warehouse-items",
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ dataset, folder_path, targetSplit }) =>
        toMcpTextResult(
          await datasetUploadFolder(getClient(), {
            dataset: dataset as string,
            folderPath: folder_path as string,
            targetSplit: targetSplit as string | undefined,
          }),
        ),
  }),
  tool({
    name: "dataset_upload_video",
    registrationGroup: "read",
    stateChanging: true,
    description:
      "Upload a local video by extracting JPEG frames with ffmpeg, then start dataset ingest for an existing dataset.",
    inputSchema: {
      dataset: z
        .string()
        .describe("Dataset ref by id, slug, username/slug, or ul:// URI."),
      video_path: z.string().describe("Local path to source video file."),
      fps: z.number().optional(),
      max_frames: z.number().int().optional(),
      targetSplit: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    docNote:
      "Uses a local video path, extracts JPEG frames with ffmpeg, and starts ingest into an existing dataset.",
    examples: [
      {
        title: "Upload video for frame extraction",
        input: {
          dataset: "team/datasets/factory-lines",
          video_path: "/videos/factory-shift.mp4",
          fps: 2,
          max_frames: 500,
          targetSplit: "train",
        },
      },
    ],
    createHandler:
      (getClient) =>
      async ({ dataset, video_path, fps, max_frames, targetSplit }) =>
        toMcpTextResult(
          await datasetUploadVideo(getClient(), {
            dataset: dataset as string,
            videoPath: video_path as string,
            fps: fps as number | undefined,
            maxFrames: max_frames as number | undefined,
            targetSplit: targetSplit as string | undefined,
          }),
        ),
  }),
  tool({
    name: "models_list",
    registrationGroup: "read",
    stateChanging: false,
    description:
      "List models in a project by project id, slug, username/slug, or project ul:// URI.",
    inputSchema: {
      project: z
        .string()
        .describe("Project ref by id, slug, username/slug, or ul:// URI."),
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
    description: "Get one model by id, or by slug plus project.",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
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
    name: "training_monitor",
    registrationGroup: "action",
    stateChanging: false,
    description:
      "Report a model's training status and progress (works for private and public projects).",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
      project: z.string().optional(),
      include_metrics: z.boolean().optional(),
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
      async ({
        model,
        project,
        include_metrics,
        include_history,
        history_last_n,
      }) =>
        toMcpTextResult(
          await trainingMonitor(
            getClient(),
            model as string,
            project as string | undefined,
            {
              includeMetrics: include_metrics as boolean | undefined,
              includeHistory: include_history as boolean | undefined,
              historyLastN: history_last_n as number | undefined,
            },
          ),
        ),
  }),
  tool({
    name: "model_predict",
    registrationGroup: "action",
    stateChanging: false,
    description:
      "Run inference with a trained model on an image URL or base64 source (no local file paths).",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
      source: z
        .string()
        .describe(
          "Image URL or base64 input string. Local file paths are not supported.",
        ),
      project: z.string().optional(),
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
      "Download one trained model weight file to an explicit local path.",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
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
    registrationGroup: "write",
    stateChanging: false,
    description: "List export jobs for a model.",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
      project: z.string().optional(),
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
    registrationGroup: "write",
    stateChanging: false,
    description: "Get status for one export job by 24-character export id.",
    inputSchema: {
      export_id: z.string().describe("24-character export job id."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    createHandler:
      (getClient) =>
      async ({ export_id }) =>
        toMcpTextResult(await exportStatus(getClient(), export_id as string)),
  }),
  tool({
    name: "export_create",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Create a model export job (state-changing, may cost credits). Requires confirm_cost=true.",
    inputSchema: {
      model: z
        .string()
        .describe("Model id, or slug when project is also provided."),
      format: z.string().describe("Requested export format."),
      project: z.string().optional(),
      gpu_type: z.string().optional(),
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
    name: "training_start",
    registrationGroup: "write",
    stateChanging: true,
    description:
      "Start a cloud training job from an existing model or official YOLO base checkpoint (state-changing, may cost credits). Requires confirm_cost=true.",
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
        .string()
        .describe("Dataset ref used as training data for the job."),
      gpu_type: z.string().describe("Cloud GPU type to allocate for training."),
      train_args: z.record(z.string(), z.unknown()).optional(),
      epochs: z.number().optional(),
      imgsz: z.number().optional(),
      batch: z.number().optional(),
      name: z.string().optional(),
      confirm_cost: z
        .boolean()
        .optional()
        .describe("Must be true to allow a credit-costing training run."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
          dataset: "team/datasets/warehouse-items",
          gpu_type: "rtx-4090",
          confirm_cost: true,
        },
      },
      {
        title: "Train from official YOLO checkpoint",
        input: {
          model: "yolo11n-seg.pt",
          project: "team/project",
          dataset: "team/datasets/road-segments",
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
      }) =>
        toMcpTextResult(
          await trainingStart(getClient(), {
            model: model as string,
            project: project as string,
            dataset: dataset as string,
            gpuType: gpu_type as string,
            trainArgs: train_args as Record<string, unknown> | undefined,
            epochs: epochs as number | undefined,
            imgsz: imgsz as number | undefined,
            batch: batch as number | undefined,
            name: name as string | undefined,
            confirmCost: confirm_cost as boolean | undefined,
          }),
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

/** Register training monitor, predict, and download tools. */
export function registerActionTools(
  server: McpServer,
  getClient: () => UltralyticsClient,
): void {
  registerToolDefinitions(server, getClient, "action");
}

/** Register export and training-start tools. The cost-incurring ones are guarded. */
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
