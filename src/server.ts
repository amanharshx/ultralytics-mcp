import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer() {
  return new McpServer({
    name: "ultralytics",
    version: "0.2.0",
  });
}
