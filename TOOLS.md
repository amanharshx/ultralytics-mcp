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
- `deployment_predict` reads a local image file to run inference.
- Review local upload paths before approving tool calls; upload tools and `deployment_predict` read from the MCP client host.
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
| `owner` | string | No | Workspace owner; defaults to the account owner. Takes precedence over username when both are given. |
| `username` | string | No | Compatibility alias for owner. |

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
| `q` | string | Yes | Search term. |
| `sort` | string | No | Sort order for results. Server-validated; for example stars or newest. |
| `offset` | number | No | Results to skip. |

### projects_create

Create a project in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Display name. |
| `project` | string | Yes | URL slug for the new project (distinct from the display name given by name). |
| `owner` | string | No | Workspace owner; defaults to the account owner. |
| `visibility` | string | No | Visibility "private" (default) or "public". |
| `description` | string | No | Project description. |

### projects_delete

Soft-delete a project by slug, owner/slug, or project ul:// URI. Deleted projects land in trash and remain restorable for a bounded window.

Metadata: state-changing, destructive, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | string | Yes | Project ref by slug, owner/slug, or ul:// URI. |

## Datasets

14 tools.

### datasets_list

List datasets in your Ultralytics workspace.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `owner` | string | No | Workspace owner; defaults to the account owner. Takes precedence over username when both are given. |
| `username` | string | No | Compatibility alias for owner. |

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
| `q` | string | Yes | Search term. |
| `sort` | string | No | Sort order for results. Server-validated; for example stars or newest. |
| `offset` | number | No | Results to skip. |
| `task` | array<string> | No | Dataset task filters. Server-validated; for example detect or segment. |

### datasets_create

Create a dataset in your Ultralytics workspace. Defaults to private visibility (the platform defaults to public when visibility is omitted).

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Display name. |
| `dataset` | string | Yes | URL slug for the new dataset (distinct from the display name given by name). |
| `task` | string | Yes | Dataset task such as detect, segment, semantic, pose, obb, or classify. |
| `owner` | string | No | Workspace owner; defaults to the account owner. |
| `visibility` | string | No | Visibility "private" (default) or "public". |
| `description` | string | No | Dataset description. |
| `classNames` | array<string> | No | Initial class names for the dataset. |

### dataset_images_list

List images in a dataset by slug, owner/slug, or dataset ul:// URI with optional filtering.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `split` | string | No | Dataset split to filter by, for example train, val, or test. |
| `search` | string | No | Image name or metadata search. |
| `hasLabel` | boolean | No | Filter by annotation state. |
| `classIds` | array<string> | No | Class IDs to filter by. An empty array is treated as no filter (all images match), not as a filter that excludes everything. |
| `limit` | number | No | Maximum images to return. |
| `offset` | number | No | Images to skip. |
| `includeImageUrls` | boolean | No | Include signed full-size image URLs. |

### dataset_export

Get a time-limited export download link for a dataset by slug, owner/slug, or dataset ul:// URI, for the latest export or one frozen version.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `version` | number | No | Saved version number. |

### dataset_class_stats

Get per-class annotation counts for a dataset by slug, owner/slug, or dataset ul:// URI. By default omits the bulky histogram and heatmap groups (image size, file size, format, points-per-annotation, bbox distributions, and location/dimension heatmaps), naming them in the summary; pass include_histograms: true to get the full payload unmodified.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `include_histograms` | boolean | No | Include the histogram and heatmap groups omitted by default (image size, file size, format, points-per-annotation, bbox distributions, and location/dimension heatmaps). Off by default because the payload is large; the summary names the groups it omits. |

### dataset_version_create

Create a frozen dataset version snapshot by slug, owner/slug, or dataset ul:// URI. If the dataset is unchanged since the previous snapshot the existing version is returned instead of a new one.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `description` | string | No | Optional note describing this snapshot. |

### dataset_version_restore

Restore a dataset to a previously saved version by slug, owner/slug, or dataset ul:// URI, and an integer version number. Versions are listed via datasets_get (the versions array, already returned unprojected). This REPLACES the dataset's current images, labels, and splits with that snapshot outright: anything done since that version, including un-versioned manual annotation work, is discarded. Ships ungated anyway, since it is the undo tool — an auto-annotate run snapshots a version before labelling, so restoring that version undoes the run exactly, and a mistaken restore is itself recoverable by restoring a later version. Restore also reassigns image IDs: a pre-restore image ID still resolves afterward but returns an empty label array rather than a 404, so callers must re-list images (for example with dataset_images_list) after a restore instead of reusing held IDs.

Metadata: state-changing, destructive, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `version` | number | Yes | Version number to restore, as listed in datasets_get's versions array. |

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
| `sourceUrl` | string | Yes | Remote dataset archive or NDJSON URL. |
| `targetSplit` | string | No | Target split for new images (overrides archive structure). |
| `conflictPolicy` | string | No | Conflict policy "skip" (default), "keep_both", or "replace". |

### dataset_upload_file

Upload a local dataset archive through the signed-upload flow for a dataset by slug, owner/slug, or dataset ul:// URI. Defaults conflictPolicy to skip (the platform default is undocumented). Reports the queued job id with the dataset's current ingest status; use datasets_get to follow up.

Metadata: state-changing, non-idempotent

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `file_path` | string | Yes | Local path to dataset archive file. |
| `targetSplit` | string | No | Target split for new images (overrides archive structure). |
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
| `targetSplit` | string | No | Target split for new images (overrides archive structure). |
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
| `fps` | number | No | Frame extraction rate in frames per second. |
| `max_frames` | number | No | Maximum number of frames to extract. |
| `targetSplit` | string | No | Target split for new images (overrides archive structure). |
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

7 tools.

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

### model_metrics

Report a model's best-epoch and final-epoch evaluation metrics, labelled so one cannot be mistaken for the other (works for private and public projects). bestEpochMetrics is pulled explicitly from trainResults by matching its epoch field against bestEpoch, retrievable regardless of any include_history window; finalEpochMetrics is the model's top-level metrics field, observed live to always equal the last recorded epoch, never the best one. On a model with incoherent or missing training data (for example bestEpoch pointing past the recorded epochs), bestEpoch, bestFitness, and bestEpochMetrics are all reported as null rather than echoing the platform's unreliable raw values, and bestEpochNote explains why. include_train_args adds the full trainArgs object (111 keys observed live), omitted by default. include_history adds a metricsHistory-style curve and always states the window it covers, including when the full curve is returned.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |
| `include_history` | boolean | No | Include the epoch metrics history curve; omitted by default. |
| `history_last_n` | number | No | Limit the history curve to the most recent N epochs (default 20). Truncates a long run to its tail; the response always reports the epoch window it covers, so a flat tail is not mistaken for a converged run. |
| `include_train_args` | boolean | No | Include the full trainArgs object; off by default because the platform returns roughly a hundred keys. |

### model_plots

Report a model's evaluation plots (per-class pr_curve, f1_curve, precision_curve, recall_curve, confusion_matrix), which model_metrics and training_monitor do not surface. By default lists each plot's type and the shape of its fields (array lengths only, never the values) since one pr_curve alone can carry thousands of numbers on a multi-class model; pass type to get that one plot's data back exactly as the platform returned it, unmodified. Field shapes vary by type: pr_curve/f1_curve/precision_curve/recall_curve carry x/y (and pr_curve additionally ap); confusion_matrix carries a matrix field instead, not x/y/ap. Plot presence does not track training history: a model can have plots with no trainResults, or (rarely) plots: [] on an otherwise completed model.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |
| `type` | string | No | Return this one plot's full data unmodified (e.g. pr_curve, confusion_matrix). Omit to list what's available. |

### model_predict

Run inference with a trained model on an image URL or base64 source (no local file paths).

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `source` | string | Yes | Image URL, raw base64-encoded image, or base64 data: URI (data:<mime>;base64,<payload>). Local file paths are not supported. |
| `project` | string | No | Project ref required when model is given by slug. |
| `conf` | number | No | Confidence threshold (0.01-1); defaults to 0.25 when omitted. |
| `iou` | number | No | IoU threshold (0-0.95); defaults to 0.7 when omitted. |
| `imgsz` | number | No | Inference image size (32-1280); defaults to 640 when omitted. |

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
| `project` | string | No | Project ref required when model is given by slug. |
| `filename` | string | No | Select which of the model's remote weight files to download by name; does not set the local output filename (use output_path for that). Omit to prefer best.pt, then the first available file. |
| `overwrite` | boolean | No | Overwrite an existing file at output_path. |

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

Report a model's training status and progress (works for private and public projects). timing.elapsedMs is wall-clock since model creation, evaluated at request time: it tracks elapsed run time while training is active, but for a finished model it reflects the model's age, not training duration. Billed training time is computeCost.durationMs.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |
| `include_history` | boolean | No | Include the epoch metrics history curve; omitted by default. |
| `history_last_n` | number | No | Limit the history curve to the most recent N epochs (default 20). Truncates a long run to its tail; the response always reports the epoch window it covers, so a flat tail is not mistaken for a converged run. |

### training_start

Start a cloud training job from an existing model or official YOLO base checkpoint (state-changing, may cost credits). The dataset is validated immediately, so an unusable dataset is rejected before any compute starts; checkpoint mode also checks the checkpoint's task against every dataset's task up front. Starting is billable immediately: the platform has no cost preview before that, so the projected cost and remaining balance are only reported after the job starts. Training an existing model that already has a recorded run (any status past pending/untrained) replaces that model's status, epoch count, and per-epoch metric history the instant the new job starts, and that history cannot be recovered afterward; the previously uploaded weights survive. That path requires confirm_history_loss=true in addition to confirm_cost=true. Checkpoint mode always creates a new model and destroys nothing, so it never needs confirm_history_loss. An untrained or never-trained model needs no extra confirmation either. Use training_cancel to stop a job that is already running. Requires confirm_cost=true.

Metadata: state-changing, destructive, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Existing model ref, or official YOLO base checkpoint such as yolo11n.pt or yolo11n-seg.pt. Checkpoint mode auto-creates a project model. |
| `project` | string | Yes | Project ref that owns the training job and resolved model. |
| `dataset` | union | Yes | Dataset ref by slug, owner/slug, or ul:// URI, or a list of refs to fine-tune on sequentially. |
| `gpu_type` | string | Yes | Cloud GPU type to allocate for training. |
| `train_args` | record<string, unknown> | No | Additional YOLO training arguments passed through to the platform. epochs, imgsz, batch, and name here are silently overridden by the matching top-level input when both are set; data and model are rejected outright if present here. |
| `epochs` | number | No | Maximum full passes over the training set. |
| `imgsz` | number | No | Target input size: square batches normally, or the long-side size with rect=true. |
| `batch` | number | No | Images per batch: -1 targets about 60% GPU memory, a value between 0 and 1 sets a memory fraction, and a positive integer fixes the image count. |
| `name` | string | No | Run name for callbacks. |
| `confirm_cost` | boolean | No | Must be true to allow a credit-costing training run. Starting is billable immediately; the platform has no cost preview before that, so the estimated cost and remaining balance are only reported after the job starts. |
| `confirm_history_loss` | boolean | No | Must be true to restart training on an existing model that already has a recorded run. Doing so replaces that model's status, epoch count, and per-epoch metric history irrecoverably; the previously uploaded weights survive. Not required for an untrained model or for checkpoint mode, which creates a new model instead. Separate from confirm_cost. |

Notes: Checkpoint-pattern model values such as `yolo11n.pt` and `yolo11n-seg.pt` trigger checkpoint mode, auto-create a project model, and require dataset-task compatibility.

#### Train from existing model

```json
{
  "model": "team/project/my-model",
  "project": "team/project",
  "dataset": "team/warehouse-items",
  "gpu_type": "rtx-4090",
  "confirm_cost": true
}
```

#### Retrain an existing model that already has a recorded run

```json
{
  "model": "team/project/my-model",
  "project": "team/project",
  "dataset": "team/warehouse-items",
  "gpu_type": "rtx-4090",
  "confirm_cost": true,
  "confirm_history_loss": true
}
```

#### Train from official YOLO checkpoint

```json
{
  "model": "yolo11n-seg.pt",
  "project": "team/project",
  "dataset": "team/road-segments",
  "gpu_type": "rtx-4090",
  "confirm_cost": true
}
```

#### Fine-tune sequentially across multiple datasets

```json
{
  "model": "team/project/my-model",
  "project": "team/project",
  "dataset": [
    "team/road-segments",
    "team/warehouse-items"
  ],
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

4 tools.

### exports_list

List export jobs for a model by owner/project/model, ul://owner/project/model, or slug with a project.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |

### export_status

Get one export job's status for a model by owner/project/model, ul://owner/project/model, or slug with a project, plus the export id.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `export_id` | string | Yes | Export job id. |
| `project` | string | No | Project ref required when model is given by slug. |

### export_create

Create a model export job by owner/project/model, ul://owner/project/model, or slug with a project (state-changing, may cost credits). The format is validated immediately by the server; task and architecture compatibility is only known when the job runs, so a queued export can still fail. Use export_status and exports_list for the real outcome. Requires confirm_cost=true.

Metadata: state-changing, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `format` | string | Yes | Requested export format (validated by the server). |
| `project` | string | No | Project ref required when model is given by slug. |
| `gpu_type` | string | No | GPU type required for TensorRT engine exports. |
| `imgsz` | number | No | Image size for export. |
| `half` | boolean | No | Legacy FP16 export precision flag. |
| `dynamic` | boolean | No | Dynamic input shapes. |
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

### export_cancel

Cancel an active export job for a model by owner/project/model, ul://owner/project/model, or slug with a project, plus the export id. Checks the export's status first and sends the cancellation only while it is still active, refusing on any terminal status; the same API verb deletes a finished export's artifact irreversibly instead of cancelling it. The status check cannot be atomic: an export that finishes between the check and the request will have its artifact deleted rather than cancelled, and that deletion cannot be undone.

Metadata: state-changing, destructive, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `export_id` | string | Yes | Export job id. |
| `project` | string | No | Project ref required when model is given by slug. |

## Deployments

7 tools.

### deployments_list

List model deployments in your Ultralytics workspace.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `owner` | string | No | Workspace owner; defaults to the account owner. |

### deployment_get

Get details for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). serviceUrl and deployedAt are null until the deployment reaches status ready.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |

### deployment_health

Probe one deployment's health by owner/deployment or a bare slug (owner defaults to the account owner). status is the upstream HTTP status the health probe observed at the deployment's own service URL, not the status of this tool call.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |

### deployment_logs

Read log entries for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). severity is passed through to the server unvalidated (illustrative values: DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY); an invalid value returns the server's own rejection message. limit defaults to 50, max 200. nextPageToken pages through older entries.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |
| `severity` | string | No | Comma-separated log severity levels, passed through unvalidated (e.g. INFO or WARNING,ERROR). Exact match, not a minimum threshold. |
| `limit` | number | No | Max entries to return (default 50, max 200). |
| `pageToken` | string | No | Pagination token from a previous call's nextPageToken. |

### deployment_metrics

Read metrics for one deployment by owner/deployment or a bare slug (owner defaults to the account owner). The response is one of two shapes selected by sparkline: the default shape carries timeRange (a {start, end} object)/summary/timeSeries, sparkline=true carries requests24h (an array of per-hour points, not a total)/totalRequests/errorRate/avgLatencyMs. The two are never merged; which shape came back is returned as-is. range is one of 1h, 6h, 24h, 7d, 30d (default 24h), passed through to the server unvalidated.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |
| `range` | string | No | Time range, passed through unvalidated (one of 1h, 6h, 24h, 7d, 30d; default 24h). |
| `sparkline` | boolean | No | When true, selects the compact sparkline shape (requests24h, totalRequests, errorRate, avgLatencyMs) instead of the detailed shape. |

### deployment_predict

Run inference through a deployment's own serving endpoint on a local image file, by owner/deployment or a bare slug (owner defaults to the account owner). Returns images/metadata verbatim, including undocumented metadata fields. No per-request cost is documented for this endpoint; costs follow the deployment's own resource configuration. A cold start on a scaled-to-zero deployment may respond slowly or with a 503 — check deployment_health rather than retrying blindly.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |
| `imagePath` | string | Yes | Local path to an image file (.jpg, .jpeg, .png, .webp, .bmp, .tif, .tiff). |
| `conf` | number | No | Confidence threshold (0.01-1, server default applies if omitted). |
| `iou` | number | No | IoU threshold (0-0.95, server default applies if omitted). |
| `imgsz` | number | No | Inference image size (32-1280, server default applies if omitted). |

### deployment_stop

Stop a deployment by owner/deployment or a bare slug (owner defaults to the account owner). Sends only {action: stop}; the endpoint's start/resize/replace actions are unreachable from this tool. Stopping preserves the deployment's URL and configuration and still counts toward deployment quota; it is a money-off switch and ships ungated, consistent with training_cancel and export_cancel. Stopping an already-stopped deployment is rejected by the server (400) rather than treated as a success. Reversing this (start) is not available in this tool set.

Metadata: state-changing, destructive, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deployment` | string | Yes | Deployment ref by owner/deployment or a bare slug. |

## Auto-annotate

3 tools.

### auto_annotate_status

Get an auto-annotation run's status for a dataset by slug, owner/slug, or dataset ul:// URI. Surfaces activeJob and lastRun unmodified: both null means the dataset has never run one; activeJob carries progress for a run in flight; lastRun carries failed/stopped booleans plus results, or an error when the run failed.

Metadata: read-only

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |

### auto_annotate_start

Start an auto-annotation run on a dataset by slug, owner/slug, or dataset ul:// URI, labelling it with a model given by owner/project/model, ul://owner/project/model, or slug with a project (state-changing, billable, may cost credits). Requires confirm_cost=true: there is no cost preview, no published rate, and a 402 signals insufficient credits; gauge magnitude with datasets_get (the unlabeled image count by default, the total count when include_annotated is true). Sends only modelId plus any of confidence, iou, class_mapping, and include_annotated the caller sets explicitly, omitting the rest so the server's own defaults (confidence 0.25, iou 0.7, include_annotated false, illustrative only) apply undisturbed. There is no imgsz parameter. class_mapping bridges a model/dataset class-taxonomy mismatch (for example a 1-class model against an 80-class dataset, which otherwise fails outright); it passes through with no length check. Labels are additive, never overwritten, so no overwrite confirmation is needed. Every start snapshots a dataset version before labelling, listed via datasets_get and undoable exactly with dataset_version_restore. Billing settles at run time, not at dismissal, so auto_annotate_stop does not refund a charge already incurred. Use auto_annotate_status to poll and auto_annotate_stop to cancel.

Metadata: state-changing, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |
| `model` | string | Yes | Model ref by owner/project/model, ul:// URI, or slug (requires project). |
| `project` | string | No | Project ref required when model is given by slug. |
| `confidence` | number | No | Confidence threshold for generated labels. Omit to use the server default (currently 0.25). |
| `iou` | number | No | IoU threshold for generated labels. Omit to use the server default (currently 0.7). |
| `class_mapping` | array<union> | No | Model class index -> dataset class index mapping, positioned by model class index. Required to bridge a class-taxonomy mismatch between the model and the dataset; passed through with no length check. |
| `include_annotated` | boolean | No | Re-label images that already carry annotations. Omit to use the server default (currently false). |
| `confirm_cost` | boolean | No | Must be true to allow a credit-costing auto-annotation run. |

Notes: State-changing auto-annotation run that is billable immediately. Set `confirm_cost` to `true` explicitly.

#### Start an auto-annotation run

```json
{
  "dataset": "team/cars",
  "model": "team/project/my-model",
  "confirm_cost": true
}
```

### auto_annotate_stop

Stop or dismiss a dataset's auto-annotation run by slug, owner/slug, or dataset ul:// URI. Reads status first and refuses without calling the endpoint when no run is active, since there is nothing to stop. When a run is active it sends the request and surfaces the server's own action verbatim rather than inferring it: cancelled for an active run stopped mid-flight, dismissed for a terminal run's summary being cleared, or none if nothing acted on. Ships ungated, consistent with training_cancel and export_cancel: an off-switch is never gated. An undismissed terminal run does not block the next start, so this never strands anything; dismissal moves no money.

Metadata: state-changing, destructive, non-idempotent, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset` | string | Yes | Dataset ref by slug, owner/slug, or ul:// URI. |

## Infrastructure

1 tools.

### gpu_availability

Get current cloud-GPU stock status by GPU type.

Metadata: read-only, external/live

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
