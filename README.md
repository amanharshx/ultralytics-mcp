# Ultralytics Platform MCP

[![npm version](https://img.shields.io/npm/v/ultralytics-mcp.svg)](https://www.npmjs.com/package/ultralytics-mcp)
[![CI](https://github.com/amanharshx/ultralytics-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amanharshx/ultralytics-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

MCP server for [Ultralytics Platform](https://platform.ultralytics.com)
workflows: projects, datasets, models, training, prediction, exports, and
dataset uploads.

> [!IMPORTANT]
> Independent community project. Not affiliated with or endorsed by Ultralytics.

[Install](#installation) · [Tools](./TOOLS.md) · [Safety](#safety) · [Troubleshooting](#troubleshooting)

## Try Asking

- "Show me my Ultralytics projects and which datasets are ready to train on."
- "Create a private project called `traffic-cams` and upload `./clips/junction.mp4` as a dataset."
- "Fine-tune `yolo11n` on `traffic-cams` for 50 epochs."
- "Fine-tune `traffic-cams/detector` across `day-shots`, then `night-shots`, in one run."
- "How is that training going? Show me the last 10 epochs of metrics."
- "Run the trained model on `https://example.com/frame.jpg`, then download the weights to `./weights`."
- "Move my `scratch` project to trash." (restorable for 30 days)

https://github.com/user-attachments/assets/c686717a-b499-44c8-817e-b0ea6e78c3b3

## Installation

You need:

- Node.js `>=20`
- An Ultralytics Platform API key
- `ffmpeg` and `ffprobe` on `PATH`, to upload a dataset from a local video file
- Claude Code, Codex, or another MCP client that can launch stdio servers

### Get an API key

Sign in at [Ultralytics Platform](https://platform.ultralytics.com), open
`Settings -> API Keys`, and create or copy a key. The official
[API key docs](https://docs.ultralytics.com/platform/account/api-keys) cover
creation, usage, and revocation.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ULTRALYTICS_API_KEY` | ✅ | Ultralytics API key. Expected format: `ul_` followed by 40 hex characters |
| `ULTRALYTICS_API_BASE` | ❌ | Advanced: override API base URL. Default: `https://platform.ultralytics.com/api` |

Treat `ULTRALYTICS_API_KEY` as a bearer token. Pass it through your MCP client's
environment configuration only. Never paste real keys into prompts, scripts, or
committed config files. Project-scoped `.mcp.json` files are ignored by this repo
to reduce accidental key commits; if a key is exposed, revoke it in Ultralytics
Platform and create a replacement.

### Standard config

Works in MCP clients that accept JSON stdio server definitions.

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

These examples track the latest published npm release. Restart your MCP client
or session after upgrading, so the new server process picks up the latest
package.

<details>
<summary>Antigravity</summary>

Add the standard config above through Antigravity settings, or by editing your
configuration file directly.

</details>

<details>
<summary>Claude Code</summary>

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

Follow the MCP install [guide](https://modelcontextprotocol.io/quickstart/user)
with the standard config above.

</details>

<details>
<summary>Codex</summary>

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

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor">](https://cursor.com/en/install-mcp?name=ultralytics&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInVsdHJhbHl0aWNzLW1jcEBsYXRlc3QiXSwiZW52Ijp7IlVMVFJBTFlUSUNTX0FQSV9LRVkiOiJ1bF95b3VyX2FwaV9rZXlfaGVyZSJ9fQ%3D%3D)

> **Important**
> The install button writes a placeholder key. After installing, open your Cursor MCP config and replace `ul_your_api_key_here` with your Ultralytics API key, then restart Cursor.

To install manually, go to `Cursor Settings` -> `MCP` -> `Add new MCP Server`
(or edit `~/.cursor/mcp.json`) and use the standard config above.

</details>

<details>
<summary>Gemini CLI</summary>

Follow the MCP install [guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md#configure-the-mcp-server-in-settingsjson)
with the standard config above.

</details>

<details>
<summary>VS Code / Copilot</summary>

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522ultralytics%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522ultralytics-mcp%2540latest%2522%255D%252C%2522env%2522%253A%257B%2522ULTRALYTICS_API_KEY%2522%253A%2522ul_your_api_key_here%2522%257D%257D)

> **Important**
> The install button writes a placeholder key. After installing, open your VS Code MCP config and replace `ul_your_api_key_here` with your Ultralytics API key, then restart VS Code.

To install manually, follow the MCP install
[guide](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server),
or use the VS Code CLI:

```bash
code --add-mcp '{"name":"ultralytics","command":"npx","args":["-y","ultralytics-mcp@latest"],"env":{"ULTRALYTICS_API_KEY":"ul_your_api_key_here"}}'
```

</details>

## Verify

Run `claude mcp list` or `codex mcp list`. You should see `ultralytics` among
the configured MCP servers.

## Tools

See [TOOLS.md](./TOOLS.md) for the full parameter reference, safety notes,
local-path behavior, and examples for the tricky tools.

## Safety

- Projects and datasets are created private by default, even though the platform itself defaults to public
- `export_create` requires `confirm_cost: true`
- `training_start` requires `confirm_cost: true`, plus `confirm_history_loss: true` when restarting training on an existing model that already has a recorded run. That path replaces its status, epoch count, and per-epoch metric history irrecoverably
- Starting a training job or an export is billable immediately, so the estimated cost and remaining balance are reported after the job starts, not before
- `training_start` in checkpoint mode (a base checkpoint like `yolo11n.pt`, not an existing model ref) with a single dataset creates the project model before the platform checks the checkpoint's task against the dataset's
- If that check fails, the model it already created is not deleted automatically. The error names the model; review it and delete it with `models_delete` if it is unwanted
- Cancelling a running training job preserves the latest checkpoint and keeps the model
- `export_cancel` proceeds only when it observes an export as `queued` or `running`, and refuses every other status, including unrecognized ones. Because the status check and the cancel request are not atomic, an export that finishes between them may have its artifact irreversibly deleted
- Deleting a project or dataset is a soft delete to trash, restorable for 30 days. Deleting a project reports the cascade count; deleting a dataset moves its images and annotations with it and leaves models trained on it unaffected
- Ambiguous project or dataset refs fail instead of guessing
- Signed upload and download URLs do not forward `Authorization`
- Local upload tools and `deployment_predict` read files from the MCP client host; approve calls only for paths you expect to share with Ultralytics
- `model_download` writes to the requested local path; review `output_path` and `overwrite` before approving
- Adding a named YOLO ZIP (with `data.yaml` class names) to an existing dataset imports its labels and merges classes
- Re-ingest does not re-label images already in the dataset (use the annotation editor); re-uploading the same image under a different split can create a duplicate

## Troubleshooting

### Invalid API key

`ULTRALYTICS_API_KEY` must start with `ul_` and contain exactly 40 hex
characters after the prefix.

### Server not loading

Run `claude mcp list` or `codex mcp list`, then verify that `npx` and Node.js
are installed and that `ULTRALYTICS_API_KEY` reached the client — passed with
`--env` when adding the server, or set in `~/.codex/config.toml`. In Claude
Code, `claude mcp get ultralytics` shows the resolved config.

To smoke-test the server on its own:

```bash
ULTRALYTICS_API_KEY=ul_your_api_key_here npx -y ultralytics-mcp@latest
```

If the command exits immediately with a config error, fix the environment
first.

### Platform API errors

For authentication, rate-limit, or endpoint behavior, compare against the
official [Ultralytics Platform REST API docs](https://docs.ultralytics.com/platform/api).
When asking for help, include the tool name, request summary, response status,
redacted response body, and a minimal reproduction. Do not include real API
keys, signed URLs, private dataset contents, or private model artifacts.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the check suite, and the
live smoke test.
