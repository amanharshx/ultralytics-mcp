/** Shared harness for the live smoke tests.
 *
 * The projects and datasets suites are separate cases over this one harness:
 * a recording client that pins each call's HTTP status, a disposable-slug
 * helper, a cleanup wrapper that deletes whatever the body created even
 * when an assertion fails, and sweeps for what a killed run left behind.
 * Live-only: every suite using this harness skips silently without
 * `ULTRALYTICS_API_KEY` and stays out of `npm test` via the `*.live.test.ts`
 * exclusion.
 */

import { UltralyticsClient } from "../../src/client.js";
import { getApiBase } from "../../src/config.js";
import { UltralyticsApiError } from "../../src/errors.js";
import type { NormalizedToolResult } from "../../src/tool-result.js";
import { listField } from "../../src/tools/shared.js";

export interface RecordedCall {
  method: string;
  path: string;
  status: number;
}

export interface RecordedUpload {
  url: string;
  method: string;
  contentType: string | null;
  generationMatch: string | null;
  contentLength: string | null;
  auth: string | null;
}

/** One recording fetch shared by every live-smoke client. */
function makeRecordingFetch(records: RecordedCall[]): typeof fetch {
  return (async (url: string | URL, init: RequestInit = {}) => {
    const response = await fetch(url, init);
    records.push({
      method: (init.method ?? "GET").toUpperCase(),
      path: new URL(String(url)).pathname,
      status: response.status,
    });
    return response;
  }) as unknown as typeof fetch;
}

/** Build a client that records one entry per HTTP call it makes. */
export function recordingClient(
  key: string,
  records: RecordedCall[],
): UltralyticsClient {
  return new UltralyticsClient({
    apiKey: key,
    fetchImpl: makeRecordingFetch(records),
  });
}

/** Build a client that also records each storage PUT it makes.
 *
 * API calls are recorded exactly as `recordingClient` does. Storage
 * transfers still run for real through the platform fetch, but their
 * request headers are captured first so a live test can prove the runtime
 * headers and content type were actually sent without forwarding API
 * credentials.
 */
export function recordingClientWithUploads(
  key: string,
  records: RecordedCall[],
  uploads: RecordedUpload[],
): UltralyticsClient {
  const recordingUploadFetch = (async (
    url: string | URL,
    init: RequestInit = {},
  ) => {
    const headers = new Headers(init.headers);
    uploads.push({
      url: String(url),
      method: (init.method ?? "GET").toUpperCase(),
      contentType: headers.get("Content-Type"),
      generationMatch: headers.get("x-goog-if-generation-match"),
      contentLength: headers.get("Content-Length"),
      auth: headers.get("Authorization"),
    });
    return fetch(url, init);
  }) as unknown as typeof fetch;
  return new UltralyticsClient({
    apiKey: key,
    fetchImpl: makeRecordingFetch(records),
    uploadFetchImpl: recordingUploadFetch,
  });
}

/** Status of the most recent recorded call. */
export function lastStatus(records: RecordedCall[]): number {
  const last = records[records.length - 1];
  if (!last) {
    throw new Error("expected at least one recorded API call");
  }
  return last.status;
}

/** Assert a delete tool's result reported `success: true`, naming the
 * disposable resource on failure. Shared by the cleanup callback passed to
 * `withDisposableCleanup` and by an explicit happy-path delete, so both paths
 * fail the same way if the platform ever reports a delete that didn't work. */
export function assertDeleted(
  kind: string,
  ref: string,
  result: NormalizedToolResult,
): void {
  const data = result.data as Record<string, unknown>;
  if (data.success !== true) {
    throw new Error(`${kind} delete reported success:false for '${ref}'`);
  }
}

/** A workspace-unique slug that is obviously disposable. `isStaleDisposable`
 * parses this format, so change both together. */
export function disposableSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Older than any live test runs, so a parallel suite's resource is never
 * mistaken for a leftover. */
const STALE_DISPOSABLE_MS = 30 * 60_000;

/** Whether `slug` is a `zz-mcp-` disposable that outlived its run.
 *
 * Age comes from the base-36 timestamp `disposableSlug` embeds, so no
 * server timestamp field is relied on. Only the `zz-mcp-` prefix qualifies:
 * it is the one every billable or clone-based disposable shares.
 */
function isStaleDisposable(slug: string, now = Date.now()): boolean {
  const match = /^zz-mcp-.+-([0-9a-z]{8,})-[0-9a-z]+$/.exec(slug);
  return (
    match !== null && now - Number.parseInt(match[1], 36) > STALE_DISPOSABLE_MS
  );
}

/** Run `body` after marking the resource created; delete it on failure.
 *
 * The flag is set before `body` runs so a timeout after server-side creation
 * still cleans up, and cleared only when the body completes. A 404 from
 * `cleanup` means the resource is already gone. Any other cleanup failure
 * reports both errors so the original assertion is never swallowed.
 */
export async function withDisposableCleanup(
  kind: string,
  ref: string,
  cleanup: () => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  let created = false;
  let bodyError: unknown;
  try {
    created = true;
    await body();
    created = false;
  } catch (error) {
    bodyError = error;
  }
  if (created) {
    try {
      await cleanup();
      created = false;
    } catch (cleanupError) {
      const alreadyGone =
        cleanupError instanceof UltralyticsApiError &&
        cleanupError.statusCode === 404;
      if (!alreadyGone) {
        throw new Error(
          `cleanup failed for disposable ${kind} '${ref}' (it may still exist in the workspace): ${String(cleanupError)}` +
            (bodyError === undefined
              ? ""
              : `; original failure: ${String(bodyError)}`),
        );
      }
      created = false;
    }
  }
  if (bodyError !== undefined) {
    throw bodyError;
  }
}

/** Permanently purge a trashed dataset. Not a shipped tool, so the raw
 * endpoint is called directly for test cleanup. */
export async function purgeDatasetFromTrash(
  key: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${getApiBase()}/trash`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ id, type: "dataset" }),
  });
  if (!response.ok) {
    throw new Error(
      `trash purge failed for dataset '${id}': ${response.status} ${await response.text()}`,
    );
  }
}

/** Delete, ignoring a 404 from a concurrent sweep that got there first.
 * Returns whether this call did the delete. */
async function deleteUnlessGone(
  client: UltralyticsClient,
  path: string,
): Promise<boolean> {
  try {
    await client.delete(path);
    return true;
  } catch (error) {
    if (error instanceof UltralyticsApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/** Delete stale `zz-mcp-` deployments.
 *
 * `withDisposableCleanup` cannot run when the process is killed mid-test, and
 * a leaked deployment holds a slot of the plan's deployment quota, failing
 * every later create. Run in `beforeAll`: `afterAll` dies with the process.
 */
export async function sweepStaleDeployments(
  client: UltralyticsClient,
): Promise<void> {
  const owner = encodeURIComponent(await client.getAccountOwner());
  const deployments = listField(
    await client.get(`/deployments/${owner}`),
    "deployments",
  );
  for (const { deployment } of deployments) {
    if (isStaleDisposable(String(deployment))) {
      await deleteUnlessGone(client, `/deployments/${owner}/${deployment}`);
    }
  }
}

/** Delete and purge stale `zz-mcp-` datasets, for the same reason as
 * `sweepStaleDeployments`. */
export async function sweepStaleDatasets(
  client: UltralyticsClient,
  key: string,
): Promise<void> {
  const owner = encodeURIComponent(await client.getAccountOwner());
  const datasets = listField(
    await client.get(`/datasets/${owner}`),
    "datasets",
  );
  for (const { dataset, id } of datasets) {
    if (
      isStaleDisposable(String(dataset)) &&
      (await deleteUnlessGone(client, `/datasets/${owner}/${dataset}`))
    ) {
      await purgeDatasetFromTrash(key, String(id));
    }
  }
}
