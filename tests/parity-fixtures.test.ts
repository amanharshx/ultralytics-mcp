import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { z } from "zod";

const responseSchema = z.object({
  status: z.number().int(),
  json: z.unknown().optional(),
  content: z.string().optional(),
});

const apiStepSchema = z.object({
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.string()).optional(),
  response: responseSchema,
});

const downloadSchema = z.object({
  url: z.string().url(),
  body_text: z.string(),
});

const fixtureSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  api: z.array(apiStepSchema),
  download: downloadSchema.optional(),
  expected: z.object({
    summary: z.string(),
    data: z.unknown(),
  }),
});

describe("parity fixtures", () => {
  // Resolve relative to this test file, not the process cwd, so the suite is
  // robust to where the runner is invoked from.
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtureDir = join(here, "..", "fixtures", "parity");
  const fixtureFiles = readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  test("fixture set is present", () => {
    expect([...fixtureFiles].sort()).toEqual(
      [
        "model_download_signed_url.json",
        "models_get.json",
        "projects_list.json",
        "training_monitor_private.json",
      ].sort(),
    );
  });

  for (const fixtureFile of fixtureFiles) {
    test(`fixture schema: ${fixtureFile}`, () => {
      const raw = readFileSync(join(fixtureDir, fixtureFile), "utf8");
      const fixture = fixtureSchema.parse(JSON.parse(raw));
      expect(fixture.expected.summary.length).toBeGreaterThan(0);
      expect(fixture.api.length).toBeGreaterThan(0);
    });
  }
});
