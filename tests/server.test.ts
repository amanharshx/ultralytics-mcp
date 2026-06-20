import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test } from "vitest";

import { createServer } from "../src/server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

test("server can list registered tools over the protocol", async () => {
  const server = createServer();
  server.registerTool(
    "probe_tool",
    {
      description: "Protocol listing probe.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "ok" }],
    }),
  );
  const client = new Client({
    name: "test-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  cleanups.push(async () => {
    await client.close();
    await server.close();
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  expect(tools.tools).toHaveLength(1);
  expect(tools.tools[0]?.name).toBe("probe_tool");
  expect(tools.tools[0]?.inputSchema?.type).toBe("object");
  expect(tools.tools[0]?.inputSchema?.properties).toEqual({});
});
