import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { UltralyticsClient } from "../src/client.js";
import { UltralyticsApiError } from "../src/errors.js";
import type { NormalizedToolResult } from "../src/tool-result.js";
import {
  datasetExport,
  datasetImagesList,
  datasetsCreate,
  datasetsDelete,
  datasetsGet,
  datasetsIngest,
  datasetsList,
  datasetUploadFile,
  datasetUploadFolder,
  datasetUploadVideo,
  datasetVersionCreate,
  exploreDatasets,
  exploreProjects,
  modelDownload,
  modelPredict,
  modelsDelete,
  modelsGet,
  modelsList,
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
  trainingCancel,
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

const uploadSchema = z.object({
  url: z.string().url(),
  content_type: z.string(),
  body_text: z.string().optional(),
  zip_files: z.record(z.string(), z.string()).optional(),
});

const expectedErrorSchema = z.object({
  status: z.number().int(),
  message: z.string(),
});

const fixtureSchema = z
  .object({
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    api: z.array(apiStepSchema),
    download: downloadSchema.optional(),
    upload: uploadSchema.optional(),
    folder_files: z.record(z.string(), z.string()).optional(),
    expected: z
      .object({
        summary: z.string(),
        data: z.unknown(),
      })
      .optional(),
    // Refusal case: the tool throws the API's error instead of returning a
    // result, so the fixture records the expected failure, not output.
    expectedError: expectedErrorSchema.optional(),
  })
  .refine((fixture) => fixture.expected !== undefined || fixture.expectedError !== undefined, {
    message: "fixture must declare either expected or expectedError",
  });

type Fixture = z.infer<typeof fixtureSchema>;

const BASE = "https://platform.ultralytics.com/api";
const KEY = `ul_${"0".repeat(40)}`;
const fixtureUploadVideoZipFiles = {
  "frame_000001.jpg": "jpg",
  "frame_000002.jpg": "jpg",
  "frame_000003.jpg": "jpg",
};

function expectMatch(actual: unknown, expected: unknown): void {
  if (expected === "__ANY_NUMBER__") {
    expect(actual).toEqual(expect.any(Number));
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((item, index) => {
      expectMatch((actual as unknown[])[index], item);
    });
    return;
  }
  if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object").toBe(true);
    for (const [key, value] of Object.entries(expected)) {
      expectMatch((actual as Record<string, unknown>)[key], value);
    }
    return;
  }
  expect(actual).toEqual(expected);
}

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
        expectMatch(JSON.parse(String(init.body)), step.json);
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
    projectsList(
      client,
      args.owner as string | undefined,
      args.username as string | undefined,
    ),
  projects_get: (client, args) => projectsGet(client, args.project as string),
  projects_create: (client, args) =>
    projectsCreate(client, {
      name: args.name as string,
      project: args.project as string,
      owner: args.owner as string | undefined,
      visibility: args.visibility as string | undefined,
      description: args.description as string | undefined,
    }),
  datasets_create: (client, args) =>
    datasetsCreate(client, {
      name: args.name as string,
      dataset: args.dataset as string,
      task: args.task as string,
      owner: args.owner as string | undefined,
      description: args.description as string | undefined,
      visibility: args.visibility as string | undefined,
      classNames: args.classNames as string[] | undefined,
    }),
  datasets_list: (client, args) =>
    datasetsList(
      client,
      args.owner as string | undefined,
      args.username as string | undefined,
    ),
  datasets_get: (client, args) => datasetsGet(client, args.dataset as string),
  dataset_images_list: (client, args) =>
    datasetImagesList(client, {
      dataset: args.dataset as string,
      split: args.split as string | undefined,
      search: args.search as string | undefined,
      hasLabel: args.hasLabel as boolean | undefined,
      classIds: args.classIds as string[] | undefined,
      limit: args.limit as number | undefined,
      offset: args.offset as number | undefined,
      includeImageUrls: args.includeImageUrls as boolean | undefined,
    }),
  dataset_export: (client, args) =>
    datasetExport(client, {
      dataset: args.dataset as string,
      version: args.version as number | undefined,
    }),
  dataset_version_create: (client, args) =>
    datasetVersionCreate(client, {
      dataset: args.dataset as string,
      description: args.description as string | undefined,
    }),
  explore_projects: (client, args) =>
    exploreProjects(client, {
      q: args.q as string,
      sort: args.sort as string | undefined,
      offset: args.offset as number | undefined,
    }),
  explore_datasets: (client, args) =>
    exploreDatasets(client, {
      q: args.q as string,
      sort: args.sort as string | undefined,
      offset: args.offset as number | undefined,
      task: args.task as string[] | undefined,
    }),
  dataset_upload_folder: (client, args) =>
    datasetUploadFolder(client, {
      dataset: args.dataset as string,
      folderPath: args.folder_path as string,
      targetSplit: args.targetSplit as string | undefined,
      conflictPolicy: args.conflictPolicy as string | undefined,
    }),
  dataset_upload_video: (client, args) =>
    datasetUploadVideo(client, {
      dataset: args.dataset as string,
      videoPath: args.video_path as string,
      fps: args.fps as number | undefined,
      maxFrames: args.max_frames as number | undefined,
      targetSplit: args.targetSplit as string | undefined,
      conflictPolicy: args.conflictPolicy as string | undefined,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: async ({ outputDir, ffmpegPath, rate, maxFrames }) => {
        expect(ffmpegPath).toBe("/usr/bin/ffmpeg");
        expect(rate).toBe(0.5);
        expect(maxFrames).toBe(100);
        await mkdir(outputDir, { recursive: true });
        for (const [path, content] of Object.entries(
          fixtureUploadVideoZipFiles,
        )) {
          const filePath = join(outputDir, path);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, content);
        }
      },
    }),
  datasets_delete: (client, args) =>
    datasetsDelete(client, args.dataset as string),
  dataset_ingest: (client, args) =>
    datasetsIngest(client, {
      dataset: args.dataset as string,
      sourceUrl: args.sourceUrl as string,
      targetSplit: args.targetSplit as string | undefined,
      conflictPolicy: args.conflictPolicy as string | undefined,
    }),
  dataset_upload_file: (client, args) =>
    datasetUploadFile(client, {
      dataset: args.dataset as string,
      filePath: args.file_path as string,
      targetSplit: args.targetSplit as string | undefined,
      conflictPolicy: args.conflictPolicy as string | undefined,
    }),
  projects_delete: (client, args) =>
    projectsDelete(client, args.project as string),
  models_list: (client, args) => modelsList(client, args.project as string),
  models_get: (client, args) =>
    modelsGet(client, args.model as string, args.project as string | undefined),
  models_delete: (client, args) =>
    modelsDelete(
      client,
      args.model as string,
      args.project as string | undefined,
    ),
  model_predict: (client, args) =>
    modelPredict(client, args.model as string, {
      source: args.source as string,
      project: args.project as string | undefined,
      conf: args.conf as number | undefined,
      iou: args.iou as number | undefined,
      imgsz: args.imgsz as number | undefined,
    }),
  training_monitor: (client, args) =>
    trainingMonitor(
      client,
      args.model as string,
      args.project as string | undefined,
      {
        includeMetrics: args.include_metrics as boolean | undefined,
        includeHistory: args.include_history as boolean | undefined,
        historyLastN: args.history_last_n as number | undefined,
      },
    ),
  training_cancel: (client, args) =>
    trainingCancel(
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
        "datasets_delete.json",
        "datasets_get.json",
        "datasets_list.json",
        "dataset_export.json",
        "dataset_images_list.json",
        "dataset_ingest.json",
        "explore_datasets.json",
        "explore_projects.json",
        "dataset_version_create.json",
        "dataset_upload_file.json",
        "dataset_upload_folder.json",
        "dataset_upload_video.json",
        "models_get.json",
        "model_predict_base64.json",
        "models_delete.json",
        "models_list.json",
        "projects_create.json",
        "projects_delete.json",
        "projects_get.json",
        "projects_list.json",
        "training_monitor_history.json",
        "training_monitor_metrics.json",
        "training_monitor_private.json",
        "training_monitor_cancelled.json",
        "training_monitor_untrained.json",
        "training_cancel.json",
        "training_cancel_refused.json",
      ].sort(),
    );
  });

  for (const fixtureFile of fixtureFiles) {
    test(`fixture schema: ${fixtureFile}`, () => {
      const raw = readFileSync(join(fixtureDir, fixtureFile), "utf8");
      const fixture = fixtureSchema.parse(JSON.parse(raw));
      if (fixture.expectedError !== undefined) {
        expect(fixture.expected).toBeUndefined();
        expect(fixture.expectedError.message.length).toBeGreaterThan(0);
      } else {
        expect(fixture.expected?.summary.length).toBeGreaterThan(0);
      }
      expect(fixture.api.length).toBeGreaterThan(0);
    });
  }

  for (const fixtureFile of fixtureFiles) {
    const raw = readFileSync(join(fixtureDir, fixtureFile), "utf8");
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    if (
      fixture.tool === "dataset_upload_file" ||
      fixture.tool === "dataset_upload_folder" ||
      fixture.tool === "dataset_upload_video"
    ) {
      continue;
    }
    // Error case: the live API refuses with a 400 carrying its own message.
    // Replayed by the dedicated test below, which asserts the refusal.
    if (fixtureFile === "training_cancel_refused.json") {
      continue;
    }
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

  test("parity output: training_cancel_refused.json", async () => {
    // Live capture: DELETE /api/models/{owner}/{project}/{model}/training
    // on an already-cancelled job -> 400 {"error":"Cannot cancel training with status: cancelled"}
    const raw = readFileSync(
      join(fixtureDir, "training_cancel_refused.json"),
      "utf8",
    );
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: replayFetch(fixture.api),
    });
    const error = await trainingCancel(
      client,
      fixture.args.model as string,
    ).catch((e) => e as UltralyticsApiError);
    expect(error).toBeInstanceOf(UltralyticsApiError);
    expect(error.statusCode).toBe(fixture.expectedError?.status);
    expect(error.apiMessage).toBe(fixture.expectedError?.message);
  });

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

  test("parity output: dataset_upload_file.json", async () => {
    const raw = readFileSync(
      join(fixtureDir, "dataset_upload_file.json"),
      "utf8",
    );
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-"));
    try {
      const args = replaceTmp(fixture.args, tmp) as Record<string, unknown>;
      const expected = replaceTmp(fixture.expected, tmp);
      await writeFile(
        args.file_path as string,
        fixture.upload?.body_text ?? "",
      );

      const signedStep = fixture.api.find(
        (step) => step.path === "/api/upload/signed-url",
      );
      const signedHeaders = (
        (signedStep?.response.json ?? {}) as Record<string, unknown>
      ).headers as Record<string, string> | undefined;

      let uploadAuth: string | null | undefined = "unset";
      const uploadFetch = (async (
        url: string | URL,
        init: RequestInit = {},
      ) => {
        const headers = new Headers(init.headers);
        uploadAuth = headers.get("Authorization");
        expect(String(url)).toBe(fixture.upload?.url);
        expect((init.method ?? "GET").toUpperCase()).toBe("PUT");
        expect(headers.get("Content-Type")).toBe(fixture.upload?.content_type);
        if (signedHeaders) {
          for (const [key, value] of Object.entries(signedHeaders)) {
            expect(headers.get(key)).toBe(value);
          }
        }
        expect(await new Response(init.body).text()).toBe(
          fixture.upload?.body_text ?? "",
        );
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;

      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: replayFetch(fixture.api),
        uploadFetchImpl: uploadFetch,
      });

      const result = await datasetUploadFile(client, {
        dataset: args.dataset as string,
        filePath: args.file_path as string,
        targetSplit: args.targetSplit as string | undefined,
        conflictPolicy: args.conflictPolicy as string | undefined,
      });

      expect(result).toEqual(expected);
      expect(uploadAuth).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("parity output: dataset_upload_folder.json", async () => {
    const raw = readFileSync(
      join(fixtureDir, "dataset_upload_folder.json"),
      "utf8",
    );
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-"));
    try {
      const args = replaceTmp(fixture.args, tmp) as Record<string, unknown>;
      const expected = replaceTmp(fixture.expected, tmp);
      if (fixture.folder_files) {
        for (const [relativePath, content] of Object.entries(
          fixture.folder_files,
        )) {
          const path = join(args.folder_path as string, relativePath);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content);
        }
      }

      const signedStep = fixture.api.find(
        (step) => step.path === "/api/upload/signed-url",
      );
      const signedHeaders = (
        (signedStep?.response.json ?? {}) as Record<string, unknown>
      ).headers as Record<string, string> | undefined;

      let uploadAuth: string | null | undefined = "unset";
      const uploadFetch = (async (
        url: string | URL,
        init: RequestInit = {},
      ) => {
        const headers = new Headers(init.headers);
        uploadAuth = headers.get("Authorization");
        expect(String(url)).toBe(fixture.upload?.url);
        expect((init.method ?? "GET").toUpperCase()).toBe("PUT");
        expect(headers.get("Content-Type")).toBe(fixture.upload?.content_type);
        if (signedHeaders) {
          for (const [key, value] of Object.entries(signedHeaders)) {
            expect(headers.get(key)).toBe(value);
          }
        }
        const bytes = new Uint8Array(
          await new Response(init.body).arrayBuffer(),
        );
        const files = Object.fromEntries(
          Object.entries(unzipSync(bytes)).map(([path, value]) => [
            path,
            new TextDecoder().decode(value),
          ]),
        );
        expect(files).toEqual(fixture.upload?.zip_files ?? {});
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;

      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: replayFetch(fixture.api),
        uploadFetchImpl: uploadFetch,
      });

      const result = await datasetUploadFolder(client, {
        dataset: args.dataset as string,
        folderPath: args.folder_path as string,
        targetSplit: args.targetSplit as string | undefined,
        conflictPolicy: args.conflictPolicy as string | undefined,
      });

      expectMatch(result, expected);
      expect(uploadAuth).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("parity output: dataset_upload_video.json", async () => {
    const raw = readFileSync(
      join(fixtureDir, "dataset_upload_video.json"),
      "utf8",
    );
    const fixture = fixtureSchema.parse(JSON.parse(raw));
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-"));
    try {
      const args = replaceTmp(fixture.args, tmp) as Record<string, unknown>;
      const expected = replaceTmp(fixture.expected, tmp);
      await writeFile(args.video_path as string, "video");

      let uploadAuth: string | null | undefined = "unset";
      const uploadFetch = (async (
        url: string | URL,
        init: RequestInit = {},
      ) => {
        const headers = new Headers(init.headers);
        uploadAuth = headers.get("Authorization");
        expect(String(url)).toBe(fixture.upload?.url);
        expect((init.method ?? "GET").toUpperCase()).toBe("PUT");
        expect(headers.get("Content-Type")).toBe(fixture.upload?.content_type);
        const bytes = new Uint8Array(
          await new Response(init.body).arrayBuffer(),
        );
        const files = Object.fromEntries(
          Object.entries(unzipSync(bytes)).map(([path, value]) => [
            path,
            new TextDecoder().decode(value),
          ]),
        );
        expect(files).toEqual(fixture.upload?.zip_files ?? {});
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;

      const client = new UltralyticsClient({
        apiKey: KEY,
        baseUrl: BASE,
        fetchImpl: replayFetch(fixture.api),
        uploadFetchImpl: uploadFetch,
      });

      const result = await datasetUploadVideo(client, {
        dataset: args.dataset as string,
        videoPath: args.video_path as string,
        fps: args.fps as number | undefined,
        maxFrames: args.max_frames as number | undefined,
        targetSplit: args.targetSplit as string | undefined,
        _findTool: (name) => `/usr/bin/${name}`,
        _probeDuration: async () => 200,
        _extractFrames: async ({ outputDir, ffmpegPath, rate, maxFrames }) => {
          expect(ffmpegPath).toBe("/usr/bin/ffmpeg");
          expect(rate).toBe(0.5);
          expect(maxFrames).toBe(100);
          await mkdir(outputDir, { recursive: true });
          for (const [path, content] of Object.entries(
            fixtureUploadVideoZipFiles,
          )) {
            const filePath = join(outputDir, path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, content);
          }
        },
      });

      expectMatch(result, expected);
      expect(uploadAuth).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
