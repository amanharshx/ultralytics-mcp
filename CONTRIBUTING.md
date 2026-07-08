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
