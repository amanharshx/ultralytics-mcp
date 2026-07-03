# Ultralytics Platform MCP

[![npm version](https://img.shields.io/npm/v/ultralytics-mcp.svg)](https://www.npmjs.com/package/ultralytics-mcp)
[![CI](https://github.com/amanharshx/ultralytics-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amanharshx/ultralytics-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

MCP server for [Ultralytics Platform](https://platform.ultralytics.com)
workflows: projects, datasets, models, training, prediction, exports, and
dataset uploads.

> [!IMPORTANT]
> Independent community project. Not affiliated with or endorsed by Ultralytics.

---

## Table of Contents

- [Requirements](#requirements)
- [Get API Key](#get-api-key)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
- [Verify Setup](#verify-setup)
- [What You Can Do](#what-you-can-do)
- [Tools](#tools-27)
- [Safety](#safety)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Requirements

- Node.js `>=20`
- Ultralytics Platform API key
- `ffmpeg` and `ffprobe` on `PATH` to upload a dataset from a local video file
- Claude Code, Codex, or another MCP client that can launch stdio servers

## Get API Key

1. Sign in at [Ultralytics Platform](https://platform.ultralytics.com).
2. Open `Settings -> API Keys`.
3. Create or copy an API key.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ULTRALYTICS_API_KEY` | ✅ | Ultralytics API key. Expected format: `ul_` followed by 40 hex characters |
| `ULTRALYTICS_API_BASE` | ❌ | Advanced: override API base URL. Default: `https://platform.ultralytics.com/api` |

## Installation

### Standard Config

Works in many MCP clients that accept JSON stdio server definitions.

```json
{
  "mcpServers": {
    "ultralytics": {
      "command": "npx",
      "args": ["-y", "ultralytics-mcp"],
      "env": {
        "ULTRALYTICS_API_KEY": "ul_your_api_key_here"
      }
    }
  }
}
```

### Claude Code

Add server with Claude Code CLI:

```bash
claude mcp add ultralytics --env ULTRALYTICS_API_KEY=ul_your_api_key_here -- npx -y ultralytics-mcp
```

Or add a project-scoped server in repo-root `.mcp.json`:

```json
{
  "mcpServers": {
    "ultralytics": {
      "command": "npx",
      "args": ["-y", "ultralytics-mcp"],
      "env": {
        "ULTRALYTICS_API_KEY": "ul_your_api_key_here"
      }
    }
  }
}
```

### Codex

Add server with Codex CLI:

```bash
codex mcp add ultralytics --env ULTRALYTICS_API_KEY=ul_your_api_key_here -- npx -y ultralytics-mcp
```

Or add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.ultralytics]
command = "npx"
args = ["-y", "ultralytics-mcp"]

[mcp_servers.ultralytics.env]
ULTRALYTICS_API_KEY = "ul_your_api_key_here"
```

## Verify Setup

### Claude Code

```bash
claude mcp list
```

You should see `ultralytics` in configured MCP servers.

### Codex

```bash
codex mcp list
```

You should see `ultralytics` in configured MCP servers.

## What You Can Do

- Browse projects, datasets, models, exports, GPU availability
- Resolve project and dataset refs by id, slug, `username/slug`, or `ul://`
- Search public projects and datasets on Ultralytics Explore
- Start dataset ingest jobs and upload archive files, folders, or videos
- Monitor training progress and inspect latest metrics or recent metric history
- Run model prediction from image URL or base64 input
- Download model weights to local path
- Create exports and training jobs with explicit cost confirmation
- Pass advanced YOLO training settings through `training_start.train_args`

## Tools (27)

### Projects (5 tools)

| Tool | Description |
| --- | --- |
| `projects_list` | List projects in your Ultralytics workspace |
| `projects_get` | Get one project by id, slug, `username/slug`, or `ul://` |
| `projects_create` | Create a new project |
| `projects_delete` | Soft-delete a project |
| `explore_projects` | Search public projects on Ultralytics Explore |

### Datasets (12 tools)

| Tool | Description |
| --- | --- |
| `datasets_list` | List datasets in your Ultralytics workspace |
| `datasets_get` | Get one dataset by id, slug, `username/slug`, or `ul://` |
| `datasets_create` | Create a new dataset |
| `datasets_delete` | Soft-delete a dataset |
| `dataset_images_list` | List images in a dataset with optional filters |
| `dataset_ingest` | Start a remote ingest job from a source URL |
| `dataset_upload_file` | Upload a local archive file for dataset ingest |
| `dataset_upload_folder` | Upload a local image folder for dataset ingest |
| `dataset_upload_video` | Upload a local video by extracting frames for dataset ingest |
| `dataset_export` | Get an export link for latest or frozen dataset version |
| `dataset_version_create` | Create a frozen dataset version snapshot |
| `explore_datasets` | Search public datasets on Ultralytics Explore |

### Models (4 tools)

| Tool | Description |
| --- | --- |
| `models_list` | List trained models and summary metrics |
| `models_get` | Get one model and its details |
| `model_predict` | Run inference from an image URL or base64 input |
| `model_download` | Download a model weight file to a local path |

### Training (2 tools)

| Tool | Description |
| --- | --- |
| `training_monitor` | Inspect status, progress, latest metrics, and optional history |
| `training_start` | Start a cloud training job with explicit cost confirmation and optional `train_args` passthrough |

### Exports (3 tools)

| Tool | Description |
| --- | --- |
| `exports_list` | List export jobs |
| `export_status` | Check export job status |
| `export_create` | Create an export job with explicit cost confirmation |

### Infrastructure (1 tool)

| Tool | Description |
| --- | --- |
| `gpu_availability` | Check cloud GPU availability |

## Safety

- `export_create` requires `confirm_cost: true`
- `training_start` requires `confirm_cost: true`
- Ambiguous project or dataset refs fail instead of guessing
- Signed upload and download URLs do not forward `Authorization`

## Troubleshooting

### Invalid API key

`ULTRALYTICS_API_KEY` must start with `ul_` and contain exactly 40 hex
characters after prefix.

### Server not loading in Claude Code

- run `claude mcp list`
- verify `npx` and Node.js are installed
- verify `ULTRALYTICS_API_KEY` was passed with `--env` when adding server
- if needed, inspect server config with `claude mcp get ultralytics`

### Server not loading in Codex

- run `codex mcp list`
- verify `npx` and Node.js are installed
- verify `ULTRALYTICS_API_KEY` value in `~/.codex/config.toml` or `codex mcp add` command

### Manual server smoke test

```bash
ULTRALYTICS_API_KEY=ul_your_api_key_here npx -y ultralytics-mcp
```

If command exits immediately with config error, fix environment first.

## Development

```bash
npm install
npm run check
npm test
npm run build
```
