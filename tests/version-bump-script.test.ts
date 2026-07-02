import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("version bump script repairs nested lockfile version on same-version rerun", () => {
  const dir = mkdtempSync(join(tmpdir(), "ultralytics-version-bump-"));
  tempDirs.push(dir);

  const packageJsonPath = join(dir, "package.json");
  const packageLockPath = join(dir, "package-lock.json");

  writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name: "fixture-package",
        version: "0.1.4",
      },
      null,
      2,
    ),
  );

  execFileSync("npm", ["install", "--package-lock-only"], {
    cwd: dir,
    stdio: "pipe",
  });

  const lockfile = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
    version: string;
    packages: { "": { version: string } };
  };
  lockfile.version = "0.1.4";
  lockfile.packages[""].version = "0.1.3";
  writeFileSync(packageLockPath, JSON.stringify(lockfile, null, 2));

  execFileSync(
    "node",
    [join(process.cwd(), "scripts", "bump-version.mjs"), "0.1.4", dir],
    {
      stdio: "pipe",
    },
  );

  const updatedPackageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as {
    version: string;
  };
  const updatedLockfile = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
    version: string;
    packages: { "": { version: string } };
  };

  expect(updatedPackageJson.version).toBe("0.1.4");
  expect(updatedLockfile.version).toBe("0.1.4");
  expect(updatedLockfile.packages[""].version).toBe("0.1.4");
});
