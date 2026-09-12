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

/** Build a client that records one entry per HTTP call it makes. */
export function recordingClient(
  key: string,
  records: RecordedCall[],
): UltralyticsClient {
  const recordingFetch = (async (url: string | URL, init: RequestInit = {}) => {
    const response = await fetch(url, init);
    records.push({
      method: (init.method ?? "GET").toUpperCase(),
      path: new URL(String(url)).pathname,
      status: response.status,
    });
    return response;
  }) as unknown as typeof fetch;
  return new UltralyticsClient({ apiKey: key, fetchImpl: recordingFetch });
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
