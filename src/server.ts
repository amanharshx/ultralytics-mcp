import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { UltralyticsClient } from "./client.js";
import { registerTools } from "./tools/index.js";

type PackageJson = {
  version: string;
};

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
  return packageJson.version;
}

export const SERVER_VERSION = readPackageVersion();

/** Create the MCP server with all tools registered.
 *
 * The client is created lazily on first tool invocation (so it reads the API key
 * only when a tool actually runs, not at registration/listing time). A custom
 * `clientFactory` can be injected for tests.
 */
export function createServer(
  clientFactory: () => UltralyticsClient = () => new UltralyticsClient(),
): McpServer {
  const server = new McpServer({
    name: "ultralytics",
    version: SERVER_VERSION,
  });

  let client: UltralyticsClient | undefined;
  const getClient = (): UltralyticsClient => {
    if (!client) {
      client = clientFactory();
    }
    return client;
  };

  registerTools(server, getClient);
  return server;
}
