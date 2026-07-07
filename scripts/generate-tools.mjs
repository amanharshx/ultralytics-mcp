import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const toolsModule = await import(new URL("../dist/tools/index.js", import.meta.url));
const { TOOL_DEFINITIONS } = toolsModule;

const GROUP_ORDER = [
  "Projects",
  "Datasets",
  "Models",
  "Training",
  "Exports",
  "Infrastructure",
];

function inferGroup(name) {
  if (name === "explore_projects" || name.startsWith("projects_")) return "Projects";
  if (
    name === "explore_datasets" ||
    name.startsWith("datasets_") ||
    name.startsWith("dataset_")
  ) {
    return "Datasets";
  }
  if (name.startsWith("models_") || name.startsWith("model_")) return "Models";
  if (name.startsWith("training_")) return "Training";
  if (name.startsWith("exports_") || name.startsWith("export_")) return "Exports";
  return "Infrastructure";
}

function unwrap(schema) {
  let current = schema;
  while (current?.def?.type === "optional" || current?.def?.type === "nullable") {
    current = current.def.innerType;
  }
  return current;
}

function typeLabel(schema) {
  const unwrapped = unwrap(schema);
  const def = unwrapped?.def ?? {};
  switch (def.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `array<${typeLabel(def.element)}>`;
    case "record":
      return "record<string, unknown>";
    case "object":
      return "object";
    default:
      return String(def.type ?? "unknown");
  }
}

function isRequired(schema) {
  return !schema.isOptional?.();
}

function paramRows(inputSchema) {
  return Object.entries(inputSchema)
    .map(([name, schema]) => {
      const description = schema.description ?? "";
      return `| \`${name}\` | ${typeLabel(schema)} | ${isRequired(schema) ? "Yes" : "No"} | ${description} |`;
    })
    .join("\n");
}

function annotationLabels(tool) {
  const labels = [];
  labels.push(tool.annotations.readOnlyHint ? "read-only" : "state-changing");
  if (tool.annotations.destructiveHint) labels.push("destructive");
  if (tool.annotations.idempotentHint === false) labels.push("non-idempotent");
  if (tool.annotations.openWorldHint) labels.push("external/live");
  return labels.join(", ");
}

function renderExamples(examples) {
  if (!examples?.length) return "";
  return examples
    .map(
      (example) =>
        `#### ${example.title}\n\n\`\`\`json\n${JSON.stringify(example.input, null, 2)}\n\`\`\``,
    )
    .join("\n\n");
}

function renderTool(tool) {
  const parts = [
    `### ${tool.name}`,
    "",
    tool.description,
    "",
    `Metadata: ${annotationLabels(tool)}`,
    "",
    "| Parameter | Type | Required | Description |",
    "| --- | --- | --- | --- |",
    paramRows(tool.inputSchema),
  ];

  if (tool.docNote) {
    parts.push("", `Notes: ${tool.docNote}`);
  }

  if (tool.examples?.length) {
    parts.push("", renderExamples(tool.examples));
  }

  return parts.join("\n");
}

function renderGroup(groupName, tools) {
  const groupCount = tools.length;
  const parts = [`## ${groupName}`, "", `${groupCount} tools.`, ""];
  for (const tool of tools) {
    parts.push(renderTool(tool), "");
  }
  return parts.join("\n").trimEnd();
}

function renderSharedSections() {
  return [
    "## Conventions",
    "",
    "- Many project, dataset, and model lookup tools accept ids, slugs, `username/slug`, or `ul://` refs.",
    "- Local-path tools operate on files or folders available to the MCP client host.",
    "- Exact accepted ref variants are documented in tool descriptions and notes when behavior differs.",
    "",
    "## Local Path Tools",
    "",
    "- `dataset_upload_file` uploads a local archive file.",
    "- `dataset_upload_folder` uploads a local image folder.",
    "- `dataset_upload_video` extracts frames from a local video file with `ffmpeg`.",
    "- `model_download` writes model weights to a local destination path.",
    "- Review local upload paths before approving tool calls; upload tools read from the MCP client host.",
    "- Review `model_download.output_path` and `overwrite` before approving downloads.",
    "",
    "## Cost and Safety",
    "",
    "- `training_start` requires `confirm_cost=true` and may create a model when checkpoint mode is used.",
    "- `export_create` requires `confirm_cost=true` and starts a credit-costing export job.",
    "- `projects_delete` and `datasets_delete` are soft-delete operations.",
    "",
    "## Platform Behaviors",
    "",
    "- Re-uploading images with label files can create new dataset image records instead of attaching labels to existing images. To label existing images, edit them on the platform; re-uploading labeled copies may duplicate image records.",
    "- Images-only dataset uploads may be inferred as `classify` by the platform even when the dataset was created for detection. Include labels in a task-specific archive when task preservation matters.",
    "",
  ].join("\n");
}

function renderMarkdown() {
  const groups = new Map(GROUP_ORDER.map((group) => [group, []]));
  for (const tool of TOOL_DEFINITIONS) {
    groups.get(inferGroup(tool.name))?.push(tool);
  }

  const sections = [
    "# Tools Reference",
    "",
    "Auto-generated reference for Ultralytics Platform MCP tools.",
    "",
    "> Auto-generated. Do not edit by hand. Run `npm run generate:tools`. Edit tool definitions in `src/tools/index.ts`.",
    "",
    renderSharedSections(),
  ];

  for (const group of GROUP_ORDER) {
    sections.push(renderGroup(group, groups.get(group) ?? []), "");
  }

  return sections.join("\n").trimEnd() + "\n";
}

const markdown = renderMarkdown();

if (process.argv.includes("--stdout")) {
  process.stdout.write(markdown);
} else {
  writeFileSync(new URL("../TOOLS.md", import.meta.url), markdown, "utf8");
  process.stdout.write(`Wrote ${repoRoot}TOOLS.md\n`);
}
