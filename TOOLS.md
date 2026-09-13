# Tools Reference

Auto-generated reference for Ultralytics Platform MCP tools.

> Auto-generated. Do not edit by hand. Run `npm run generate:tools`. Edit tool definitions in `src/tools/index.ts`.

## Conventions

- Many project, dataset, and model lookup tools accept ids, slugs, `username/slug`, or `ul://` refs.
- Local-path tools operate on files or folders available to the MCP client host.
- Exact accepted ref variants are documented in tool descriptions and notes when behavior differs.

## Local Path Tools

- `dataset_upload_file` uploads a local archive file.
- `dataset_upload_folder` uploads a local image folder.
- `dataset_upload_video` extracts frames from a local video file with `ffmpeg`.
- `model_download` writes model weights to a local destination path.
- Review local upload paths before approving tool calls; upload tools read from the MCP client host.
- Review `model_download.output_path` and `overwrite` before approving downloads.

## Cost and Safety

- `training_start` requires `confirm_cost=true` and may create a model when checkpoint mode is used.
- `export_create` requires `confirm_cost=true` and starts a credit-costing export job.
- `projects_delete` and `datasets_delete` are soft-delete operations.

## Platform Behaviors

- Re-uploading images with label files can create new dataset image records instead of attaching labels to existing images. To label existing images, edit them on the platform; re-uploading labeled copies may duplicate image records.
- Images-only dataset uploads may be inferred as `classify` by the platform even when the dataset was created for detection. Include labels in a task-specific archive when task preservation matters.

## Projects

5 tools.

### projects_list

List computer-vision projects in your Ultralytics workspace.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `owner` | string | No |  |
| `username` | string | No |  |

### projects_get

Get details for one project by slug, owner/slug, or project ul:// URI.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | string | Yes | Project ref by slug, owner/slug, or ul:// URI. |

### explore_projects

Search public projects on Ultralytics Explore.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | Yes |  |
| `sort` | string | No |  |
| `offset` | number | No |  |

### projects_create

Create a project in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `project` | string | Yes | URL slug for the new project (distinct from the display name given by name). |
| `owner` | string | No | Workspace owner; defaults to the account owner. |
| `visibility` | string | No | Visibility "private" (default) or "public". |
| `description` | string | No |  |

### projects_delete

Soft-delete a project by slug, owner/slug, or project ul:// URI. Deleted projects land in trash and remain restorable for a bounded window.

Metadata: state-changing, destructive, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | string | Yes | Project ref by slug, owner/slug, or ul:// URI. |

## Datasets

12 tools.

### datasets_list

List datasets in your Ultralytics workspace.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `owner` | string | No |  |
| `username` | string | No |  |

### datasets_get

Get details for one dataset by slug, owner/slug, or dataset ul:// URI.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |

### explore_datasets

Search public datasets on Ultralytics Explore.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | Yes |  |
| `sort` | string | No |  |
| `offset` | number | No |  |
| `task` | array<string> | No |  |

### datasets_create

Create a dataset in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `dataset` | string | Yes | URL slug for the new dataset (distinct from the display name given by name). |
| `task` | string | Yes | Dataset task such as detect, segment, semantic, pose, obb, or classify. |
| `owner` | string | No | Workspace owner; defaults to the account owner. |
| `visibility` | string | No | Visibility "private" (default) or "public". |
| `description` | string | No |  |
| `classNames` | array<string> | No |  |

### dataset_images_list

List images in a dataset by slug, owner/slug, or dataset ul:// URI with optional filtering.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `split` | string | No |  |
| `search` | string | No |  |
| `hasLabel` | boolean | No |  |
| `classIds` | array<string> | No |  |
| `limit` | number | No |  |
| `offset` | number | No |  |
| `includeImageUrls` | boolean | No |  |

### dataset_export

Get a time-limited export download link for a dataset by slug, owner/slug, or dataset ul:// URI, for the latest export or one frozen version.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `version` | number | No |  |

### dataset_version_create

Create a frozen dataset version snapshot by slug, owner/slug, or dataset ul:// URI. If the dataset is unchanged since the previous snapshot the existing version is returned instead of a new one.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `description` | string | No |  |

### datasets_delete

Delete a dataset by slug, owner/slug, or dataset ul:// URI. Deleting a dataset moves its images and annotations to trash with it; models trained on it are not deleted. Trashed items remain restorable for a bounded window.

Metadata: state-changing, destructive, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |

### dataset_ingest

Start a remote URL ingest job for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.

Metadata: state-changing, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `sourceUrl` | string | Yes |  |
| `targetSplit` | string | No |  |
| `conflictPolicy` | string | No | Conflict policy "skip" (default), "keep_both", or "replace". |

### dataset_upload_file

Upload a local dataset archive through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `file_path` | string | Yes | Local path to dataset archive file. |
| `targetSplit` | string | No |  |
| `conflictPolicy` | string | No | Conflict policy "skip" (default), "keep_both", or "replace". |

Notes: Uses a local archive file path and starts ingest into an existing dataset. Named YOLO ZIP archives preserve labels and classes on later ingests; archives without class names may map labels by positional index.

#### Upload dataset archive

```json
{
  "dataset": "team/warehouse-items",
  "file_path": "/data/warehouse-items.zip",
  "targetSplit": "train"
}
```

### dataset_upload_folder

Upload a local image folder as a zip through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `folder_path` | string | Yes | Local path to image folder. |
| `targetSplit` | string | No |  |
| `conflictPolicy` | string | No | Conflict policy "skip" (default), "keep_both", or "replace". |

Notes: Uses a local image folder path, zips it client-side, and starts ingest into an existing dataset. Images-only uploads may be inferred as classify by the platform; include task-specific labels when task preservation matters.

#### Upload image folder

```json
{
  "dataset": "team/warehouse-items",
  "folder_path": "/data/warehouse-items",
  "targetSplit": "train"
}
```

### dataset_upload_video

Upload a local video as extracted frames through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `video_path` | string | Yes | Local path to source video file. |
| `fps` | number | No |  |
| `max_frames` | number | No |  |
| `targetSplit` | string | No |  |
| `conflictPolicy` | string | No | Conflict policy "skip" (default), "keep_both", or "replace". |

Notes: Uses a local video path, extracts JPEG frames with ffmpeg, and starts ingest into an existing dataset. Images-only uploads may be inferred as classify by the platform; include task-specific labels when task preservation matters.

#### Upload video for frame extraction

```json
{
  "dataset": "team/factory-lines",
  "video_path": "/videos/factory-shift.mp4",
  "fps": 2,
  "max_frames": 500,
  "targetSplit": "train"
}
```

## Models

5 tools.

### models_list

List models in a project by slug, owner/slug, or project ul:// URI.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | string | Yes | Project ref by slug, owner/slug, or ul:// URI. |

### models_get

Get details for one model by owner/project/model, ul://owner/project/model, or slug with a project.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |

### models_delete

Soft-delete a model by owner/project/model, ul://owner/project/model, or slug with a project. Deleted models go to trash and remain restorable; weights, training history, and exports are removed only on permanent deletion.

Metadata: state-changing, destructive, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |

### model_predict

Run inference with a trained model on an image URL or base64 source (no local file paths).

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `source` | string | Yes | Image URL, raw base64-encoded image, or base64 data: URI (data:<mime>;base64,<payload>). Local file paths are not supported. |
| `project` | string | No | Project ref required when model is given by slug. |
| `conf` | number | No |  |
| `iou` | number | No |  |
| `imgsz` | number | No |  |

#### Predict from image URL

```json
{
  "model": "team/project/my-model",
  "source": "https://images.example.com/example.jpg",
  "conf": 0.25
}
```

#### Predict from base64 input

```json
{
  "model": "team/project/my-model",
  "source": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

### model_download

Download a trained model's weight file to an explicit local path by owner/project/model, ul://owner/project/model, or slug with a project.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `output_path` | string | Yes | Local destination path for downloaded model weights. |
| `project` | string | No |  |
| `filename` | string | No |  |
| `overwrite` | boolean | No |  |

Notes: Writes model weights to a local filesystem path.

#### Download model weights

```json
{
  "model": "team/project/my-model",
  "output_path": "/tmp/model.pt",
  "overwrite": true
}
```

## Training

3 tools.

### training_monitor

Report a model's training status and progress (works for private and public projects).

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |
| `include_metrics` | boolean | No |  |
| `include_history` | boolean | No |  |
| `history_last_n` | number | No |  |

### training_start

Start a cloud training job from an existing model or official YOLO base checkpoint (state-changing, may cost credits). Requires confirm_cost=true.

Metadata: state-changing, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Existing model ref, or official YOLO base checkpoint such as yolo11n.pt or yolo11n-seg.pt. Checkpoint mode auto-creates a project model. |
| `project` | string | Yes | Project ref that owns the training job and resolved model. |
| `dataset` | string | Yes | Dataset ref used as training data for the job. |
| `gpu_type` | string | Yes | Cloud GPU type to allocate for training. |
| `train_args` | record<string, unknown> | No |  |
| `epochs` | number | No |  |
| `imgsz` | number | No |  |
| `batch` | number | No |  |
| `name` | string | No |  |
| `confirm_cost` | boolean | No | Must be true to allow a credit-costing training run. |

Notes: Checkpoint-pattern model values such as `yolo11n.pt` and `yolo11n-seg.pt` trigger checkpoint mode, auto-create a project model, and require dataset-task compatibility.

#### Train from existing model

```json
{
  "model": "team/project/my-model",
  "project": "team/project",
  "dataset": "team/datasets/warehouse-items",
  "gpu_type": "rtx-4090",
  "confirm_cost": true
}
```

#### Train from official YOLO checkpoint

```json
{
  "model": "yolo11n-seg.pt",
  "project": "team/project",
  "dataset": "team/datasets/road-segments",
  "gpu_type": "rtx-4090",
  "confirm_cost": true
}
```

### training_cancel

Cancel a running training job by owner/project/model, ul://owner/project/model, or slug with a project. Cancelling releases the compute instance; elapsed GPU time is still charged and the most recently uploaded checkpoint is preserved rather than discarded. This stops the job and does not delete the model.

Metadata: state-changing, destructive, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |

## Exports

3 tools.

### exports_list

List export jobs for a model by owner/project/model, ul://owner/project/model, or slug with a project.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |

### export_status

Get status for one export job by 24-character export id.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `export_id` | string | Yes | 24-character export job id. |

### export_create

Create a model export job (state-changing, may cost credits). Requires confirm_cost=true.

Metadata: state-changing, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model id, or slug when project is also provided. |
| `format` | string | Yes | Requested export format. |
| `project` | string | No |  |
| `gpu_type` | string | No |  |
| `imgsz` | number | No |  |
| `half` | boolean | No |  |
| `dynamic` | boolean | No |  |
| `confirm_cost` | boolean | No | Must be true to allow a credit-costing export job. |

Notes: State-changing export job that may cost credits. Set `confirm_cost` to `true` explicitly.

#### Create export job

```json
{
  "model": "team/project/my-model",
  "format": "onnx",
  "confirm_cost": true
}
```

## Infrastructure

1 tools.

### gpu_availability

Get current cloud-GPU stock status by GPU type.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
