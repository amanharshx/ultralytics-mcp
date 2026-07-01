import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
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
} from "../../src/tools/datasets.js";
import { BASE, jsonResponse, KEY, routeClient } from "../helpers.js";

function captureClient(responder: (url: string) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    let body: unknown;
    if (typeof init.body === "string") {
      body = JSON.parse(init.body);
    }
    calls.push({
      url: String(url),
      method: (init.method ?? "GET").toUpperCase(),
      body,
    });
    return responder(String(url));
  }) as unknown as typeof fetch;
  return {
    client: new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: impl,
    }),
    calls,
  };
}

describe("datasetsList", () => {
  test("normalizes items and summarizes count", async () => {
    const { client } = routeClient((path) => {
      if (path === "/api/datasets") {
        return jsonResponse({
          datasets: [
            {
              _id: "d".repeat(24),
              name: "Cars",
              slug: "cars",
              task: "detect",
              imageCount: 100,
              classCount: 5,
              visibility: "private",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await datasetsList(client);
    expect(result.summary).toBe("1 dataset(s).");
    expect(result.data).toEqual([
      {
        id: "d".repeat(24),
        name: "Cars",
        slug: "cars",
        task: "detect",
        imageCount: 100,
        classCount: 5,
        visibility: "private",
      },
    ]);
  });
});

describe("exploreDatasets", () => {
  test("builds query, validates task filter, and trims results", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/explore/search") {
        return jsonResponse({
          datasets: [
            {
              _id: "d".repeat(24),
              name: "Birds",
              slug: "birds",
              username: "user",
              task: "detect",
              imageCount: 65,
              classCount: 3,
              starCount: 7,
              extra: "omit",
            },
          ],
          hasMore: true,
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await exploreDatasets(client, {
      q: "bird",
      sort: "stars",
      offset: 20,
      task: ["detect", "segment"],
    });

    expect(calls[0]).toEqual({
      url:
        `${BASE}/explore/search` +
        "?type=datasets&q=bird&sort=stars&offset=20&task=detect%2Csegment",
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe("Search 'bird': 1 dataset(s) (more available)");
    expect(result.data).toEqual({
      datasets: [
        {
          id: "d".repeat(24),
          name: "Birds",
          slug: "birds",
          username: "user",
          task: "detect",
          imageCount: 65,
          classCount: 3,
          starCount: 7,
        },
      ],
      hasMore: true,
    });
  });

  test("validates q, sort, offset, and task before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as typeof fetch,
    });

    await expect(exploreDatasets(client, { q: "" })).rejects.toThrow(
      /q is required/,
    );
    await expect(
      exploreDatasets(client, { q: "bird", sort: "popular" }),
    ).rejects.toThrow(/Unsupported sort/);
    await expect(
      exploreDatasets(client, { q: "bird", offset: -1 }),
    ).rejects.toThrow(/offset/);
    await expect(
      exploreDatasets(client, { q: "bird", task: ["detect", "bad"] }),
    ).rejects.toThrow(/Unsupported dataset task/);
  });
});

describe("datasetsGet", () => {
  test("returns the dataset record and a summary", async () => {
    const id = "d".repeat(24);
    const { client } = routeClient((path) => {
      if (path === `/api/datasets/${id}`) {
        return jsonResponse({
          dataset: {
            _id: id,
            name: "Cars",
            task: "detect",
            imageCount: 100,
            classCount: 5,
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await datasetsGet(client, id);
    expect(result.summary).toBe(
      "Dataset 'Cars' [detect], 100 images, 5 classes.",
    );
    expect(result.data).toEqual({
      _id: id,
      name: "Cars",
      task: "detect",
      imageCount: 100,
      classCount: 5,
    });
  });

  test("renders missing fields like Python (None / ?) for sparse payloads", async () => {
    const id = "d".repeat(24);
    const { client } = routeClient((path) =>
      path === `/api/datasets/${id}`
        ? jsonResponse({ dataset: {} })
        : jsonResponse({}, 404),
    );
    const result = await datasetsGet(client, id);
    expect(result.summary).toBe("Dataset 'None' [None], ? images, ? classes.");
  });
});

describe("datasetImagesList", () => {
  test("resolves dataset, builds query, and normalizes images", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        images: [
          {
            _id: "i".repeat(24),
            name: "frame-001",
            ext: ".jpg",
            split: "train",
            width: 1280,
            height: 720,
            labelCount: 3,
            bytes: 12345,
            imageUrl: "https://cdn.example.com/frame-001.jpg",
            thumbnailUrl: "https://cdn.example.com/frame-001-thumb.jpg",
            hash: "omit",
          },
        ],
        total: 10,
        hasMore: true,
        classes: [],
        errorCount: 0,
        nextCursor: "cursor_2",
      });
    });

    const result = await datasetImagesList(client, {
      dataset: "user/data",
      split: "train",
      search: "frame",
      hasLabel: true,
      classIds: ["car", "person"],
      limit: 25,
      offset: 50,
      includeImageUrls: true,
    });

    expect(calls[1]).toEqual({
      url:
        `${BASE}/datasets/${"d".repeat(24)}/images` +
        "?split=train&search=frame&hasLabel=true&classIds=car%2Cperson&limit=25&offset=50&includeImageUrls=true",
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe("1 image(s) (total 10)");
    expect(result.data).toEqual({
      total: 10,
      hasMore: true,
      nextCursor: "cursor_2",
      images: [
        {
          id: "i".repeat(24),
          name: "frame-001",
          ext: ".jpg",
          split: "train",
          width: 1280,
          height: 720,
          labelCount: 3,
          bytes: 12345,
          imageUrl: "https://cdn.example.com/frame-001.jpg",
          thumbnailUrl: "https://cdn.example.com/frame-001-thumb.jpg",
        },
      ],
    });
  });

  test("validates split, limit, and offset before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as typeof fetch,
    });

    await expect(
      datasetImagesList(client, { dataset: "data", split: "bogus" }),
    ).rejects.toThrow(/Unsupported split/);
    await expect(
      datasetImagesList(client, { dataset: "data", limit: 5001 }),
    ).rejects.toThrow(/at most 5000/);
    await expect(
      datasetImagesList(client, { dataset: "data", offset: -1 }),
    ).rejects.toThrow(/greater than or equal to 0/);
  });
});

describe("datasetsCreate", () => {
  test("posts the dataset payload and validates task before network", async () => {
    const { client, calls } = captureClient(() =>
      jsonResponse({
        dataset: { _id: "d".repeat(24), slug: "data", task: "detect" },
      }),
    );
    const result = await datasetsCreate(client, {
      name: "Dataset",
      task: "detect",
      slug: "data",
      visibility: "private",
      classNames: ["car", "person"],
    });
    await expect(
      datasetsCreate(client, {
        name: "Bad",
        task: "bad-task",
        slug: "bad",
      }),
    ).rejects.toThrow(/Unsupported dataset task/);
    await expect(
      datasetsCreate(client, { name: "Bad", task: "detect", slug: "" }),
    ).rejects.toThrow(/`slug` is required/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: `${BASE}/datasets`,
      method: "POST",
      body: {
        name: "Dataset",
        task: "detect",
        slug: "data",
        visibility: "private",
        classNames: ["car", "person"],
      },
    });
    expect(result.summary).toBe(
      `Created dataset ${"d".repeat(24)} slug=data task=detect.`,
    );
  });
});

describe("datasetExport", () => {
  test("resolves dataset and returns export link", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        downloadUrl: "https://cdn.example.com/data-v3.ndjson",
        cached: false,
      });
    });

    const result = await datasetExport(client, {
      dataset: "user/data",
      version: 3,
    });

    expect(calls[1]).toEqual({
      url: `${BASE}/datasets/${"d".repeat(24)}/export?v=3`,
      method: "GET",
      body: undefined,
    });
    expect(result.summary).toBe(
      "Export link for user/data (version 3, cached=false)",
    );
    expect(result.data).toEqual({
      downloadUrl: "https://cdn.example.com/data-v3.ndjson",
      cached: false,
    });
  });
});

describe("datasetVersionCreate", () => {
  test("resolves dataset and posts version snapshot payload", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        version: 4,
        downloadUrl: "https://cdn.example.com/data-v4.ndjson",
      });
    });

    const result = await datasetVersionCreate(client, {
      dataset: "user/data",
      description: "Quarterly snapshot",
    });

    expect(calls[1]).toEqual({
      url: `${BASE}/datasets/${"d".repeat(24)}/export`,
      method: "POST",
      body: {
        description: "Quarterly snapshot",
      },
    });
    expect(result.summary).toBe("Created dataset version 4");
    expect(result.data).toEqual({
      version: 4,
      downloadUrl: "https://cdn.example.com/data-v4.ndjson",
    });
  });
});

describe("datasetUploadFolder", () => {
  test("orchestrates folder zip upload and ingest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-dataset-folder-"));
    await writeFile(join(dir, "bird.jpg"), "jpg");
    await writeFile(join(dir, "bird.png"), "png");
    await writeFile(join(dir, ".DS_Store"), "junk");
    await writeFile(join(dir, "notes.txt"), "ignore");
    const nested = join(dir, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "bird.webp"), "webp");

    const uploadCalls: { url: string; init: RequestInit }[] = [];
    const uploadImpl = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({ url: String(url), init });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const apiCalls: { url: string; method: string; body: unknown }[] = [];
    const apiImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      apiCalls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse({
          sessionId: "session_123",
          uploadUrl: "https://signed.example/upload",
        });
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    }) as unknown as typeof fetch;

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: apiImpl,
      uploadFetchImpl: uploadImpl,
    });

    const result = await datasetUploadFolder(client, {
      dataset: "user/data",
      folderPath: dir,
      targetSplit: "train",
    });

    expect(apiCalls[1]).toMatchObject({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        contentType: "application/zip",
      },
    });
    expect(uploadCalls[0].url).toBe("https://signed.example/upload");
    expect(
      (uploadCalls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(apiCalls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(apiCalls[3]).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sessionId: "session_123",
        targetSplit: "train",
      },
    });
    expect(result.summary).toContain("Zipped 3 image(s)");
  });

  test("rejects targetSplit when folder already has split dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-dataset-folder-"));
    const trainDir = join(dir, "train");
    await mkdir(trainDir);
    await writeFile(join(trainDir, "bird.jpg"), "jpg");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFolder(client, {
        dataset: "d".repeat(24),
        folderPath: dir,
        targetSplit: "train",
      }),
    ).rejects.toThrow(/Folder has split directories/);
  });
});

describe("datasetUploadVideo", () => {
  test("extracts frames and uploads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");

    const uploadCalls: { url: string; init: RequestInit }[] = [];
    const uploadImpl = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({ url: String(url), init });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const apiCalls: { url: string; method: string; body: unknown }[] = [];
    const apiImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      apiCalls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse({
          sessionId: "session_123",
          uploadUrl: "https://signed.example/upload",
        });
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    }) as unknown as typeof fetch;

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: apiImpl,
      uploadFetchImpl: uploadImpl,
    });

    const result = await datasetUploadVideo(client, {
      dataset: "user/data",
      videoPath,
      targetSplit: "train",
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => 200,
      _extractFrames: async ({ outputDir, ffmpegPath, rate, maxFrames }) => {
        expect(ffmpegPath).toBe("/usr/bin/ffmpeg");
        expect(rate).toBe(0.5);
        expect(maxFrames).toBe(100);
        await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
        await writeFile(join(outputDir, "frame_000002.jpg"), "jpg");
        await writeFile(join(outputDir, "frame_000003.jpg"), "jpg");
      },
    });

    expect(apiCalls[1]).toMatchObject({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        filename: "birds.zip",
        contentType: "application/zip",
      },
    });
    expect(uploadCalls[0].url).toBe("https://signed.example/upload");
    expect(
      (uploadCalls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(result.summary).toBe(
      `Extracted 3 frame(s) at ~0.5 fps from ${videoPath}; started ingest job job_123 for dataset ${"d".repeat(24)}.`,
    );
    expect(result.data).toMatchObject({
      datasetId: "d".repeat(24),
      frameCount: 3,
      fps: 1,
      maxFrames: 100,
      filename: "birds.zip",
      sessionId: "session_123",
    });
  });

  test("falls back when probe fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/datasets") {
          return jsonResponse({
            datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
          });
        }
        if (parsed.pathname === "/api/upload/signed-url") {
          return jsonResponse({
            sessionId: "session_123",
            uploadUrl: "https://signed.example/upload",
          });
        }
        if (parsed.pathname === "/api/upload/complete") {
          return jsonResponse({ ok: true });
        }
        return jsonResponse({
          jobId: "job_123",
          datasetId: "d".repeat(24),
          status: "queued",
        });
      }) as unknown as typeof fetch,
      uploadFetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });

    const result = await datasetUploadVideo(client, {
      dataset: "user/data",
      videoPath,
      _findTool: (name) => `/usr/bin/${name}`,
      _probeDuration: async () => {
        throw new Error("boom");
      },
      _extractFrames: async ({ outputDir, rate, maxFrames }) => {
        expect(rate).toBe(1);
        expect(maxFrames).toBe(100);
        await writeFile(join(outputDir, "frame_000001.jpg"), "jpg");
      },
    });

    expect(result.summary).toContain("probe fallback");
  });

  test("validates inputs and missing ffmpeg before network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ul-video-"));
    const videoPath = join(dir, "birds.mp4");
    await writeFile(videoPath, "video");
    const badPath = join(dir, "birds.txt");
    await writeFile(badPath, "bad");

    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network must not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadVideo(client, { dataset: "d".repeat(24), videoPath: "" }),
    ).rejects.toThrow(/videoPath/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath: join(dir, "missing.mp4"),
      }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath: badPath,
      }),
    ).rejects.toThrow(/Unsupported video file type/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        fps: 0,
      }),
    ).rejects.toThrow(/fps/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        maxFrames: 0,
      }),
    ).rejects.toThrow(/maxFrames/);
    await expect(
      datasetUploadVideo(client, {
        dataset: "d".repeat(24),
        videoPath,
        _findTool: () => null,
      }),
    ).rejects.toThrow(/ffmpeg\/ffprobe not found on PATH/);
  });
});

describe("datasetsDelete", () => {
  test("resolves a reference and deletes the dataset", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({ deleted: true });
    });
    const result = await datasetsDelete(client, "user/data");
    expect(calls.at(-1)).toMatchObject({
      url: `${BASE}/datasets/${"d".repeat(24)}`,
      method: "DELETE",
    });
    expect(result.summary).toBe(
      `Deleted dataset ${"d".repeat(24)} (soft delete).`,
    );
  });
});

describe("datasetsIngest", () => {
  test("resolves a dataset and posts the ingest payload", async () => {
    const { client, calls } = captureClient((url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    });
    const result = await datasetsIngest(client, {
      dataset: "user/data",
      sourceUrl: "https://example.com/dataset.zip",
      targetSplit: "train",
    });
    expect(calls.at(-1)).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sourceUrl: "https://example.com/dataset.zip",
        targetSplit: "train",
      },
    });
    expect(result.summary).toBe(
      `Started dataset ingest job job_123 for dataset ${"d".repeat(24)}.`,
    );
    expect((result.data as Record<string, unknown>).status).toBe("queued");
  });

  test("validates inputs before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });
    await expect(
      datasetsIngest(client, {
        dataset: "user/data",
        sourceUrl: "",
      }),
    ).rejects.toThrow(/`sourceUrl` is required/);
    await expect(
      datasetsIngest(client, {
        dataset: "user/data",
        sourceUrl: "https://example.com/dataset.zip",
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Unsupported targetSplit/);
  });
});

describe("datasetUploadFile", () => {
  test("uploads file through signed URL flow and starts ingest", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const filePath = join(tmp, "dataset.zip");
    await writeFile(filePath, "archive");

    const calls: { url: string; method: string; body: unknown }[] = [];
    const uploadCalls: Array<{
      url: string;
      method: string;
      body: string;
      contentType: string | null;
      auth: string | null;
    }> = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      let body: unknown;
      if (typeof init.body === "string") {
        body = JSON.parse(init.body);
      }
      calls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body,
      });
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/datasets") {
        return jsonResponse({
          datasets: [{ _id: "d".repeat(24), slug: "data", username: "user" }],
        });
      }
      if (parsed.pathname === "/api/upload/signed-url") {
        return jsonResponse({
          url: "https://signed.example/upload",
          sessionId: "session_123",
        });
      }
      if (parsed.pathname === "/api/upload/complete") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      });
    }) as unknown as typeof fetch;

    const uploadFetch = (async (url: string | URL, init: RequestInit = {}) => {
      uploadCalls.push({
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        body: await new Response(init.body).text(),
        contentType: new Headers(init.headers).get("Content-Type"),
        auth: new Headers(init.headers).get("Authorization"),
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const uploadClient = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl,
      uploadFetchImpl: uploadFetch,
    });

    const result = await datasetUploadFile(uploadClient, {
      dataset: "user/data",
      filePath,
      targetSplit: "train",
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/datasets?slug=data&username=user`,
      `${BASE}/upload/signed-url`,
      `${BASE}/upload/complete`,
      `${BASE}/datasets/ingest`,
    ]);
    expect(calls[1]).toEqual({
      url: `${BASE}/upload/signed-url`,
      method: "POST",
      body: {
        assetType: "datasets",
        assetId: "d".repeat(24),
        filename: "dataset.zip",
        contentType: "application/zip",
        totalBytes: 7,
      },
    });
    expect(uploadCalls).toEqual([
      {
        url: "https://signed.example/upload",
        method: "PUT",
        body: "archive",
        contentType: "application/zip",
        auth: null,
      },
    ]);
    expect(calls[2]).toEqual({
      url: `${BASE}/upload/complete`,
      method: "POST",
      body: { sessionId: "session_123" },
    });
    expect(calls[3]).toEqual({
      url: `${BASE}/datasets/ingest`,
      method: "POST",
      body: {
        datasetId: "d".repeat(24),
        sessionId: "session_123",
        targetSplit: "train",
      },
    });
    expect(result.summary).toBe(
      "Uploaded dataset.zip (7 bytes) and started dataset ingest job job_123.",
    );
    expect(result.data).toEqual({
      datasetId: "d".repeat(24),
      filename: "dataset.zip",
      bytes: 7,
      sessionId: "session_123",
      ingest: {
        jobId: "job_123",
        datasetId: "d".repeat(24),
        status: "queued",
      },
    });
  });

  test("validates file path and target split before network", async () => {
    const client = new UltralyticsClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
    });

    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: "",
      }),
    ).rejects.toThrow(/`filePath` is required/);
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: join(tmpdir(), "missing-dataset.zip"),
      }),
    ).rejects.toThrow(/does not exist/);

    const tmp = await mkdtemp(join(tmpdir(), "ul-mcp-upload-"));
    const badPath = join(tmp, "dataset.txt");
    await writeFile(badPath, "bad");
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: badPath,
      }),
    ).rejects.toThrow(/Unsupported dataset upload file type/);

    const goodPath = join(tmp, "dataset.zip");
    await writeFile(goodPath, "archive");
    await expect(
      datasetUploadFile(client, {
        dataset: "user/data",
        filePath: goodPath,
        targetSplit: "bad",
      }),
    ).rejects.toThrow(/Unsupported targetSplit/);
  });
});
