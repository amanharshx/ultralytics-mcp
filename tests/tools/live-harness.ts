/** Shared harness for the live smoke tests.
 *
 * The projects and datasets suites are separate cases over this one harness:
 * a recording client that pins each call's HTTP status, a disposable-slug
 * helper, and a cleanup wrapper that deletes whatever the body created even
 * when an assertion fails. Live-only: every suite using this harness skips
 * silently without `ULTRALYTICS_API_KEY` and stays out of `npm test` via the
 * `*.live.test.ts` exclusion.
 */

import { UltralyticsClient } from "../../src/client.js";
import { UltralyticsApiError } from "../../src/errors.js";

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

/** A workspace-unique slug that is obviously disposable. */
export function disposableSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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
