#!/usr/bin/env node

import { execFileSync } from "node:child_process";
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
