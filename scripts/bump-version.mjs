#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , version, targetDir = "."] = process.argv;

if (!version) {
  console.error("Usage: node scripts/bump-version.mjs <version> [dir]");
  process.exit(1);
}

execFileSync(
  "npm",
  ["version", version, "--no-git-tag-version", "--allow-same-version"],
  {
    cwd: resolve(targetDir),
    stdio: "inherit",
  },
);

const serverJsonPath = resolve(targetDir, "server.json");

if (existsSync(serverJsonPath)) {
  const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf8"));
  serverJson.version = version;

  if (Array.isArray(serverJson.packages)) {
    for (const packageEntry of serverJson.packages) {
      packageEntry.version = version;
    }
  }

  writeFileSync(serverJsonPath, `${JSON.stringify(serverJson, null, 2)}\n`);
}
