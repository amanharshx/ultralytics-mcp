import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const serverJsonPath = resolve(repoRoot, "server.json");

type PackageJson = {
  mcpName?: string;
  name: string;
  version: string;
};

type ServerJson = {
  name: string;
  packages: Array<{
    identifier: string;
    registryType: string;
    transport: { type: string };
    version: string;
  }>;
  version: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("MCP registry manifest", () => {
  test("uses matching package and server identity", () => {
    expect(existsSync(serverJsonPath)).toBe(true);

    const packageJson = readJson<PackageJson>(packageJsonPath);
    const serverJson = readJson<ServerJson>(serverJsonPath);

    expect(packageJson.mcpName).toBe("io.github.amanharshx/ultralytics-mcp");
    expect(serverJson.name).toBe(packageJson.mcpName);
    expect(serverJson.packages).toHaveLength(1);
    expect(serverJson.packages[0]?.identifier).toBe(packageJson.name);
    expect(serverJson.packages[0]?.registryType).toBe("npm");
    expect(serverJson.packages[0]?.transport.type).toBe("stdio");
  });

  test("keeps registry manifest versions aligned with package version", () => {
    expect(existsSync(serverJsonPath)).toBe(true);

    const packageJson = readJson<PackageJson>(packageJsonPath);
    const serverJson = readJson<ServerJson>(serverJsonPath);

    expect(serverJson.version).toBe(packageJson.version);
    expect(serverJson.packages[0]?.version).toBe(packageJson.version);
  });
});
