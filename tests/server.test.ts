import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test } from "vitest";

import { createServer, SERVER_VERSION } from "../src/server.js";
import { TOOL_NAMES, TOOL_SETS } from "../src/tools/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

test("server version stays in sync with package.json", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  };

  expect(SERVER_VERSION).toBe(packageJson.version);
});

test("tool taxonomy keeps write tools out of read-only set", () => {
  expect(TOOL_SETS.readOnly).toContain("projects_list");
  expect(TOOL_SETS.readOnly).not.toContain("projects_create");
  expect(TOOL_SETS.readOnly).not.toContain("dataset_upload_file");
  expect(TOOL_SETS.stateChanging).toContain("projects_create");
  expect(TOOL_SETS.stateChanging).toContain("training_start");
  expect([...TOOL_NAMES]).toContain("training_start");
  const overlap = TOOL_SETS.readOnly.filter((name) =>
    TOOL_SETS.stateChanging.includes(name),
  );
  expect(overlap).toEqual([]);
});

test("server registers all available tools over the protocol", async () => {
  // A throwing client factory proves listing never constructs a client.
  const server = createServer(() => {
    throw new Error("client must not be created during tool listing");
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  cleanups.push(async () => {
    await client.close();
    await server.close();
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  expect(names).toEqual([...TOOL_NAMES].sort());

  const projectsGet = tools.find((tool) => tool.name === "projects_get");
  expect(projectsGet?.inputSchema?.type).toBe("object");
  expect(projectsGet?.inputSchema?.required).toEqual(["project"]);

  const exploreProjects = tools.find(
    (tool) => tool.name === "explore_projects",
  );
  expect(exploreProjects?.inputSchema?.required).toEqual(["q"]);

  const projectsCreate = tools.find((tool) => tool.name === "projects_create");
  expect(projectsCreate?.inputSchema?.required).toEqual(["name"]);

  const projectsDelete = tools.find((tool) => tool.name === "projects_delete");
  expect(projectsDelete?.inputSchema?.required).toEqual(["project"]);
  expect(projectsDelete?.annotations).toMatchObject({
    readOnlyHint: false,
    destructiveHint: true,
  });

  const datasetsCreate = tools.find((tool) => tool.name === "datasets_create");
  expect(datasetsCreate?.inputSchema?.required).toEqual([
    "name",
    "task",
    "slug",
  ]);
  expect(datasetsCreate?.inputSchema?.properties?.task).toMatchObject({
    description: expect.any(String),
  });

  const datasetsDelete = tools.find((tool) => tool.name === "datasets_delete");
  expect(datasetsDelete?.inputSchema?.required).toEqual(["dataset"]);

  const datasetImagesList = tools.find(
    (tool) => tool.name === "dataset_images_list",
  );
  expect(datasetImagesList?.inputSchema?.required).toEqual(["dataset"]);

  const exploreDatasets = tools.find(
    (tool) => tool.name === "explore_datasets",
  );
  expect(exploreDatasets?.inputSchema?.required).toEqual(["q"]);

  const datasetExport = tools.find((tool) => tool.name === "dataset_export");
  expect(datasetExport?.inputSchema?.required).toEqual(["dataset"]);

  const datasetVersionCreate = tools.find(
    (tool) => tool.name === "dataset_version_create",
  );
  expect(datasetVersionCreate?.inputSchema?.required).toEqual(["dataset"]);

  const datasetIngest = tools.find((tool) => tool.name === "dataset_ingest");
  expect(datasetIngest?.inputSchema?.required).toEqual([
    "dataset",
    "sourceUrl",
  ]);

  const datasetUploadFile = tools.find(
    (tool) => tool.name === "dataset_upload_file",
  );
  expect(datasetUploadFile?.inputSchema?.required).toEqual([
    "dataset",
    "file_path",
  ]);

  const datasetUploadFolder = tools.find(
    (tool) => tool.name === "dataset_upload_folder",
  );
  expect(datasetUploadFolder?.inputSchema?.required).toEqual([
    "dataset",
    "folder_path",
  ]);

  const datasetUploadVideo = tools.find(
    (tool) => tool.name === "dataset_upload_video",
  );
  expect(datasetUploadVideo?.inputSchema?.required).toEqual([
    "dataset",
    "video_path",
  ]);

  const trainingMonitor = tools.find(
    (tool) => tool.name === "training_monitor",
  );
  expect(trainingMonitor?.inputSchema?.required).toEqual(["model"]);
  expect(trainingMonitor?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
  });
  expect(trainingMonitor?.inputSchema?.properties).toMatchObject({
    include_metrics: expect.any(Object),
    include_history: expect.any(Object),
    history_last_n: expect.any(Object),
  });

  const trainingStart = tools.find((tool) => tool.name === "training_start");
  expect(trainingStart?.inputSchema?.required).toEqual([
    "model",
    "project",
    "dataset",
    "gpu_type",
  ]);
  expect(trainingStart?.annotations).toMatchObject({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  expect(trainingStart?.inputSchema?.properties).toMatchObject({
    train_args: expect.any(Object),
    confirm_cost: expect.any(Object),
    model: {
      description: expect.any(String),
    },
    dataset: {
      description: expect.any(String),
    },
  });
});
