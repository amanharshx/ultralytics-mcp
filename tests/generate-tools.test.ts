import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("generate-tools script", () => {
  test("renders grouped markdown to stdout", () => {
    const repoRoot = resolve(import.meta.dirname, "..");
    execFileSync("npm", ["run", "build"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const output = execFileSync(
      "node",
      ["scripts/generate-tools.mjs", "--stdout"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(output).toContain("# Tools Reference");
    expect(output).toContain("Auto-generated. Do not edit by hand.");
    expect(output).toContain("## Conventions");
    expect(output).toContain("## Platform Behaviors");
    expect(output).toContain("new dataset image records");
    expect(output).toContain("classify");
    expect(output).toContain("## Projects");
    expect(output).toContain("## Datasets");
    expect(output).toContain("## Models");
    expect(output).toContain("## Training");
    expect(output).toContain("## Exports");
    expect(output).toContain("## Infrastructure");
    expect(output).toContain("### training_start");
    expect(output).toContain("Checkpoint-pattern model values");
    expect(output).toContain("| Parameter | Type | Required | Description |");
  });
});
