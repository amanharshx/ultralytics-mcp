import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { UltralyticsClient } from "../src/client.js";
import type { NormalizedToolResult } from "../src/tool-result.js";
import {
  datasetsCreate,
  modelDownload,
  modelsGet,
  projectsCreate,
  projectsDelete,
  projectsList,
  trainingMonitor,
} from "../src/tools/index.js";

const responseSchema = z.object({
  status: z.number().int(),
  json: z.unknown().optional(),
  content: z.string().optional(),
});

const apiStepSchema = z.object({
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.string()).optional(),
  json: z.unknown().optional(),
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

type Fixture = z.infer<typeof fixtureSchema>;

const BASE = "https://platform.ultralytics.com/api";
const KEY = `ul_${"0".repeat(40)}`;

/** Build a fetch that replays a fixture's recorded API steps.
 *
 * Steps are matched on method, path, and an EXACT query map, and are consumed in
 * order so repeated calls to the same endpoint map to successive responses.
 */
function replayFetch(steps: Fixture["api"]): typeof fetch {
  const remaining = steps.map((step) => ({ step, used: false }));
  return (async (url: string | URL, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const method = (init.method ?? "GET").toUpperCase();
    const requestQuery = Object.fromEntries(parsed.searchParams.entries());

    for (const entry of remaining) {
      if (entry.used) continue;
      const { step } = entry;
      if (step.method.toUpperCase() !== method) continue;
      if (step.path !== parsed.pathname) continue;

      const stepQuery = step.query ?? {};
      const keys = new Set([
        ...Object.keys(stepQuery),
        ...Object.keys(requestQuery),
      ]);
      let queryMatches = true;
      for (const key of keys) {
        if (stepQuery[key] !== requestQuery[key]) {
          queryMatches = false;
          break;
        }
      }
      if (!queryMatches) continue;
      if (step.json !== undefined) {
        expect(JSON.parse(String(init.body))).toEqual(step.json);
      }

      entry.used = true;
      const body =
        step.response.json !== undefined
          ? JSON.stringify(step.response.json)
          : (step.response.content ?? "");
      return new Response(body, { status: step.response.status });
    }
    return new Response(
      JSON.stringify({ error: `unexpected ${method} ${parsed.pathname}` }),
      {
        status: 404,
      },
    );
  }) as unknown as typeof fetch;
}

/** Tools that can run against fixtures in this PR. Grows as tools are ported. */
const TOOL_RUNNERS: Record<
  string,
  (
    client: UltralyticsClient,
    args: Record<string, unknown>,
  ) => Promise<NormalizedToolResult>
> = {
  projects_list: (client, args) =>
    projectsList(client, args.username as string | undefined),
  projects_create: (client, args) =>
    projectsCreate(client, {
      name: args.name as string,
      slug: args.slug as string | undefined,
      description: args.description as string | undefined,
    }),
  datasets_create: (client, args) =>
    datasetsCreate(client, {
      name: args.name as string,
      task: args.task as string,
      slug: args.slug as string,
      description: args.description as string | undefined,
      visibility: args.visibility as string | undefined,
      classNames: args.classNames as string[] | undefined,
    }),
  projects_delete: (client, args) =>
    projectsDelete(client, args.project as string),
  models_get: (client, args) =>
    modelsGet(client, args.model as string, args.project as string | undefined),
  training_monitor: (client, args) =>
    trainingMonitor(
      client,
      args.model as string,
      args.project as string | undefined,
    ),
};

/** Recursively replace the `__TMP__` placeholder with a real temp dir path. */
function replaceTmp<T>(value: T, tmp: string): T {
  if (typeof value === "string") {
    return value.replaceAll("__TMP__", tmp) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTmp(item, tmp)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTmp(item, tmp)]),
    ) as T;
  }
  return value;
}

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
        "datasets_create.json",
        "models_get.json",
        "projects_create.json",
        "projects_delete.json",
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

  for (const fixtureFile of fixtureFiles) {
    const raw = readFileSync(join(fixtureDir, fixtureFile), "utf8");
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const runner = TOOL_RUNNERS[fixture.tool];
    if (!runner) continue; // tool not ported yet; schema-validated above

    test(`parity output: ${fixtureFile}`, async () => {
      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: replayFetch(fixture.api),
      });
      const result = await runner(client, fixture.args);
      expect(result).toEqual(fixture.expected);
    });
  }

  test("parity output: model_download_signed_url.json", async () => {
    const raw = readFileSync(
      join(fixtureDir, "model_download_signed_url.json"),
      "utf8",
    );
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-"));
    try {
      const args = replaceTmp(fixture.args, tmp) as Record<string, unknown>;
      const expected = replaceTmp(fixture.expected, tmp);

      let downloadAuth: string | null | undefined = "unset";
      const downloadFetch = (async (
        url: string | URL,
        init: RequestInit = {},
      ) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        downloadAuth = headers.Authorization;
        expect(String(url)).toBe(fixture.download?.url);
        return new Response(fixture.download?.body_text ?? "", { status: 200 });
      }) as unknown as typeof fetch;

      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: replayFetch(fixture.api),
        downloadFetchImpl: downloadFetch,
      });

      const result = await modelDownload(client, args.model as string, {
        outputPath: args.output_path as string,
        project: args.project as string | undefined,
        filename: args.filename as string | undefined,
        overwrite: args.overwrite as boolean | undefined,
      });

      expect(result).toEqual(expected);
      // The signed-URL download must NOT forward the API key.
      expect(downloadAuth).toBeUndefined();
      const written = await readFile(join(tmp, "best.pt"), "utf8");
      expect(written).toBe(fixture.download?.body_text);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
