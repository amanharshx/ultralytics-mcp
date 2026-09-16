# Contributing

Thanks for your interest in improving this project. This guide covers the setup,
workflow, and conventions used here.

## Prerequisites

- Node.js `>=20`
- `ffmpeg` and `ffprobe` on your `PATH` (only needed to work on the video upload
  tool)

## Setup

```bash
npm install
npm run build
npm test
```

## Development Workflow

Keep public wording product-facing. Describe what a change does for users rather
than framing it as a port, mirror, or rewrite.

If a change affects user-facing tools, arguments, safety behavior, or examples,
update `README.md` and regenerate the tool reference:

```bash
npm run generate:tools
```

Commit the regenerated `TOOLS.md`; CI fails if it is out of date.

## Verification

Run the full check suite before opening a pull request:

```bash
npm run check   # lint and format
npm test        # unit and integration tests
npm run build   # type-check and compile
```

## Live Smoke Test

```bash
export ULTRALYTICS_API_KEY=ul_...
npm run test:live
```

Runs against the real platform. It reads the same key as the server, is
excluded from `npm test`, and skips silently when the key is unset.

It creates and cleans up disposable projects, models, datasets, and deployments.
Their slugs use `mcp-smoke-*` or `zz-mcp-*`. Cleanup also runs when a test
fails, but an interrupted process may leave resources behind.

Deployment provisioning has taken 40-60 seconds in live checks and temporarily
consumes deployment quota. The deployment tests assert that the workspace credit
balance remains unchanged.

The suite also starts billable auto-annotation runs and may consume several
cents of platform credit. It prints the credit balance delta after those tests.
Training and export creation are excluded and verified separately.

Three fixtures are opt-in and skip without their variable:

- `ULTRALYTICS_SMOKE_DATASET_REF=owner/slug` — a ready dataset with ingested
  images, for version snapshot coverage
- `ULTRALYTICS_SMOKE_MODEL_REF=owner/project/model` — a trained model with real
  weights, for the `model_predict` default checks. These checks create no
  resources
- `ULTRALYTICS_SMOKE_EXPORT_REF=owner/project/model:exportId` — a trained model
  with downloadable weights and a terminal training status, plus an export that
  has also reached a terminal status. Covers weight download, inference, the
  training- and export-cancel refusals, and export field shapes

## Registry Metadata

The npm package and the MCP registry manifest must stay aligned. These five
values are expected to match on every release:

- `package.json` → `mcpName`
- `server.json` → `name`
- `package.json` → `version`
- `server.json` → top-level `version`
- `server.json` → `packages[].version`

Always update versions through the bump script so package and registry metadata
move together:

```bash
node scripts/bump-version.mjs <version>
```

A test guards this alignment and will fail if the values drift.

## Pull Requests

Use a short, [conventional](https://www.conventionalcommits.org) title:

```text
feat: add dataset upload video tool
```

Keep the description focused:

```markdown
## Summary

## Motivation

## Key Changes
```

## Code of Conduct

By participating in this project, you agree to abide by the
[Code of Conduct](./CODE_OF_CONDUCT.md).
