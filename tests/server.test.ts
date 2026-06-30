import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test } from "vitest";

import { createServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
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

  const projectsCreate = tools.find((tool) => tool.name === "projects_create");
  expect(projectsCreate?.inputSchema?.required).toEqual(["name"]);

  const projectsDelete = tools.find((tool) => tool.name === "projects_delete");
  expect(projectsDelete?.inputSchema?.required).toEqual(["project"]);

  const datasetsCreate = tools.find((tool) => tool.name === "datasets_create");
  expect(datasetsCreate?.inputSchema?.required).toEqual([
    "name",
    "task",
    "slug",
  ]);

  const datasetsDelete = tools.find((tool) => tool.name === "datasets_delete");
  expect(datasetsDelete?.inputSchema?.required).toEqual(["dataset"]);
});
