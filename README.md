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
- [Verify Setup](#verify-setup)
- [What You Can Do](#what-you-can-do)
- [Tools](#tools)
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
      "args": ["-y", "ultralytics-mcp@latest"],
      "env": {
        "ULTRALYTICS_API_KEY": "ul_your_api_key_here"
      }
    }
  }
}
```

<details>
<summary>Antigravity</summary>

Add via the Antigravity settings or by updating your configuration file:

```json
{
  "mcpServers": {
    "ultralytics": {
      "command": "npx",
      "args": ["-y", "ultralytics-mcp@latest"],
      "env": {
        "ULTRALYTICS_API_KEY": "ul_your_api_key_here"
      }
    }
  }
}
```

</details>

<details>
<summary>Claude Code</summary>

Add server with Claude Code CLI:

```bash
claude mcp add ultralytics --env ULTRALYTICS_API_KEY=ul_your_api_key_here -- npx -y ultralytics-mcp@latest
```

Or add a project-scoped server in repo-root `.mcp.json`:

```json
{
  "mcpServers": {
    "ultralytics": {
      "command": "npx",
      "args": ["-y", "ultralytics-mcp@latest"],
      "env": {
        "ULTRALYTICS_API_KEY": "ul_your_api_key_here"
      }
    }
  }
}
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the MCP install [guide](https://modelcontextprotocol.io/quickstart/user), use the standard config above.

</details>

<details>
<summary>Codex</summary>

Add server with Codex CLI:

```bash
codex mcp add ultralytics --env ULTRALYTICS_API_KEY=ul_your_api_key_here -- npx -y ultralytics-mcp@latest
```

Or add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.ultralytics]
command = "npx"
args = ["-y", "ultralytics-mcp@latest"]

[mcp_servers.ultralytics.env]
ULTRALYTICS_API_KEY = "ul_your_api_key_here"
```

</details>

<details>
<summary>Cursor</summary>

#### Click the button to install:

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor">](https://cursor.com/en/install-mcp?name=ultralytics&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInVsdHJhbHl0aWNzLW1jcEBsYXRlc3QiXSwiZW52Ijp7IlVMVFJBTFlUSUNTX0FQSV9LRVkiOiJ1bF95b3VyX2FwaV9rZXlfaGVyZSJ9fQ%3D%3D)

> **Important**
> The install button writes a placeholder key. After installing, open your Cursor MCP config and replace `ul_your_api_key_here` with your Ultralytics API key, then restart Cursor.

#### Or install manually:

Go to `Cursor Settings` -> `MCP` -> `Add new MCP Server` (or edit `~/.cursor/mcp.json` directly) and use the standard config above: `command` set to `npx`, `args` set to `["-y", "ultralytics-mcp@latest"]`, and `ULTRALYTICS_API_KEY` in `env`.

</details>

<details>
<summary>Gemini CLI</summary>

Follow the MCP install [guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md#configure-the-mcp-server-in-settingsjson), use the standard config above.

</details>

<details>
<summary>VS Code / Copilot</summary>

#### Click the button to install:

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522ultralytics%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522ultralytics-mcp%2540latest%2522%255D%252C%2522env%2522%253A%257B%2522ULTRALYTICS_API_KEY%2522%253A%2522ul_your_api_key_here%2522%257D%257D)

> **Important**
> The install button writes a placeholder key. After installing, open your VS Code MCP config and replace `ul_your_api_key_here` with your Ultralytics API key, then restart VS Code.

#### Or install manually:

Follow the MCP install [guide](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server), use the standard config above. You can also install the server using the VS Code CLI:

```bash
# For VS Code
code --add-mcp '{"name":"ultralytics","command":"npx","args":["-y","ultralytics-mcp@latest"],"env":{"ULTRALYTICS_API_KEY":"ul_your_api_key_here"}}'
```

After installation, the Ultralytics MCP server will be available for use with your GitHub Copilot agent in VS Code.

</details>

These examples track latest published npm release. Restart MCP client or session after upgrading so new server process picks up latest package.

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
- Start training from existing project models or official YOLO base checkpoints

## Tools

See [TOOLS.md](./TOOLS.md) for full parameter reference, safety notes, local-path behavior, and examples for tricky tools.

- Projects: 5 tools
- Datasets: 12 tools
- Models: 5 tools
- Training: 2 tools
- Exports: 3 tools
- Infrastructure: 1 tool

## Safety

- `export_create` requires `confirm_cost: true`
- `training_start` requires `confirm_cost: true`
- Ambiguous project or dataset refs fail instead of guessing
- Signed upload and download URLs do not forward `Authorization`
- Local upload tools read files from the MCP client host; approve calls only for paths you expect to share with Ultralytics
- `model_download` writes to the requested local path; review `output_path` and `overwrite` before approving

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
ULTRALYTICS_API_KEY=ul_your_api_key_here npx -y ultralytics-mcp@latest
```

If command exits immediately with config error, fix environment first.

## Development

```bash
npm install
npm run check
npm test
npm run build
npm run generate:tools
```
