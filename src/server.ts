import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { UltralyticsClient } from "./client.js";
import { registerReadTools } from "./tools/index.js";

/** Create the MCP server with all tools registered.
 *
 * The client is created lazily on first tool invocation (so it reads the API key
 * only when a tool actually runs, not at registration/listing time). A custom
 * `clientFactory` can be injected for tests.
 */
export function createServer(
  clientFactory: () => UltralyticsClient = () => new UltralyticsClient(),
): McpServer {
  const server = new McpServer({ name: "ultralytics", version: "0.2.0" });

  let client: UltralyticsClient | undefined;
  const getClient = (): UltralyticsClient => {
    if (!client) {
      client = clientFactory();
    }
    return client;
  };

  registerReadTools(server, getClient);
  return server;
}
