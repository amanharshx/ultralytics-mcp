# Ultralytics Platform MCP

MCP server for the [Ultralytics Platform](https://platform.ultralytics.com).

> Independent community project. Not affiliated with or endorsed by Ultralytics.

Current milestone: read, monitor, predict, export, and initial project and
dataset lifecycle tools are available. Additional resource-management tools
land incrementally from here.

## Tools (18)

| Tool | Description |
| --- | --- |
| `projects_list` / `projects_get` | Browse projects |
| `projects_create` / `projects_delete` | Create / soft-delete projects |
| `datasets_list` / `datasets_get` / `datasets_create` / `datasets_delete` | Browse / create / soft-delete datasets |
| `models_list` / `models_get` | Browse trained models and metrics |
| `training_monitor` | Status, progress, and latest metrics |
| `model_predict` | Run inference on an image URL or base64 source |
| `model_download` | Download a model weight file to a local path |
| `gpu_availability` | Cloud GPU stock status |
| `exports_list` / `export_status` | List / check export jobs |
| `export_create` | Create an export job — **requires `confirm_cost: true`** |
| `training_start` | Start cloud training — **requires `confirm_cost: true`** |

## Development

```bash
npm install
npm run check
npm test
npm run build
```
