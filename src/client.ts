/** HTTP client wrapper for the Ultralytics Platform REST API.
 *
 * Mirrors the Python `UltralyticsClient` safety behaviors exactly:
 * - Bearer auth + Accept: application/json on API calls.
 * - GET retries 429 (idempotent); POST defaults to NO retry (no duplicate
 *   state-changing/cost calls).
 * - `Retry-After` numeric header wins over exponential backoff.
 * - Non-2xx responses normalize into `UltralyticsApiError`.
 * - `downloadBytes` fetches signed URLs WITHOUT forwarding `Authorization`.
 *
 * `fetchImpl` / `downloadFetchImpl` are injectable for tests.
 */

import { getApiBase, getApiKey } from "./config.js";
import { UltralyticsApiError } from "./errors.js";

export type FetchLike = typeof fetch;

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchLike;
  downloadFetchImpl?: FetchLike;
  uploadFetchImpl?: FetchLike;
}

export interface MultipartFile {
  blob: Blob;
  filename?: string;
}

interface RequestSpec {
  params?: Record<string, unknown>;
  jsonBody?: unknown;
  formBody?: FormData;
  retryOn429: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Pull a non-empty message out of an error-response field.
 *
 * Accepts the field as a plain non-empty string, or one level of
 * `{message: string}` nesting (some error sources wrap it, e.g. a body-size
 * gate in front of the app). An empty string is treated as absent so the
 * caller falls through to the next field instead of surfacing a blank
 * message.
 */
function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (value && typeof value === "object") {
    const nested = (value as Record<string, unknown>).message;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }
  return undefined;
}

export class UltralyticsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly downloadFetchImpl: FetchLike;
  private readonly uploadFetchImpl: FetchLike;
  private accountOwner: string | undefined;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? getApiBase()).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? getApiKey();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.downloadFetchImpl = options.downloadFetchImpl ?? fetch;
    this.uploadFetchImpl = options.uploadFetchImpl ?? fetch;
  }

  // -- public verbs --------------------------------------------------------

  /** GET requests are idempotent and retry 429 responses. */
  async get(path: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.request("GET", path, { params, retryOn429: true });
  }

  /** POST JSON. Defaults to no retry to avoid duplicate state-changing calls. */
  async postJson(
    path: string,
    payload: unknown,
    options: { retryOn429?: boolean } = {},
  ): Promise<unknown> {
    return this.jsonRequest("POST", path, payload, options);
  }

  /** POST multipart/form-data. Defaults to no retry. */
  async postMultipart(
    path: string,
    content: {
      data?: Record<string, unknown>;
      files?: Record<string, MultipartFile>;
    },
    options: { retryOn429?: boolean } = {},
  ): Promise<unknown> {
    const form = new FormData();
    if (content.data) {
      for (const [key, value] of Object.entries(content.data)) {
        form.append(key, String(value));
      }
    }
    if (content.files) {
      for (const [key, file] of Object.entries(content.files)) {
        if (file.filename) {
          form.append(key, file.blob, file.filename);
        } else {
          form.append(key, file.blob);
        }
      }
    }
    return this.request("POST", path, {
      formBody: form,
      retryOn429: options.retryOn429 ?? false,
    });
  }

  /** PATCH JSON. Defaults to no retry to avoid duplicate state-changing calls. */
  async patchJson(
    path: string,
    payload: unknown,
    options: { retryOn429?: boolean } = {},
  ): Promise<unknown> {
    return this.jsonRequest("PATCH", path, payload, options);
  }

  /** DELETE requests are state-changing and do not retry 429 responses. */
  async delete(path: string): Promise<unknown> {
    return this.request("DELETE", path, { retryOn429: false });
  }

  /** Return the workspace owner for this API key.
   *
   * Read once from `GET /api/account/summary` and cached for the lifetime of
   * the client. The API key determines the workspace, so the owner cannot
   * change without a new client and the cache is never invalidated.
   */
  async getAccountOwner(): Promise<string> {
    if (this.accountOwner !== undefined) {
      return this.accountOwner;
    }
    const data = await this.get("/account/summary");
    const username =
      data && typeof data === "object"
        ? (data as Record<string, unknown>).username
        : undefined;
    if (typeof username !== "string" || !username.trim()) {
      throw new Error(
        "Account summary did not include a username; cannot determine the workspace owner.",
      );
    }
    this.accountOwner = username;
    return this.accountOwner;
  }

  /** Download bytes from a signed URL WITHOUT forwarding API credentials. */
  async downloadBytes(url: string): Promise<Uint8Array> {
    let attempt = 0;
    while (true) {
      const response = await this.fetchWithTimeout(
        this.downloadFetchImpl,
        url,
        {
          method: "GET",
          headers: { Accept: "*/*" }, // deliberately no Authorization
        },
      );
      if (response.status === 429 && attempt < this.maxRetries) {
        attempt += 1;
        await sleep(this.retryAfterMs(response, attempt));
        continue;
      }
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      await this.handle(response, url); // throws UltralyticsApiError
      throw new Error("unreachable");
    }
  }

  /** Upload bytes to a signed URL WITHOUT forwarding API credentials.
   *
   * Sends the declared content type together with any runtime headers the
   * signed-url response returned (for example GCS preconditions). Omitting
   * either fails at the storage layer with an error that does not name the
   * cause.
   */
  async uploadBytes(
    url: string,
    content: Uint8Array,
    contentType: string,
    extraHeaders?: Record<string, string>,
  ): Promise<void> {
    const bytes = new Uint8Array(content.byteLength);
    bytes.set(content);
    return this.putSignedBytes(url, bytes, contentType, extraHeaders);
  }

  /** PUT a body to a signed URL WITHOUT forwarding API credentials.
   *
   * Accepts bytes or a stream. Streams are never buffered here, so archives
   * larger than the in-memory limit can still upload; each PUT attempt must
   * open a fresh stream because a consumed stream cannot be re-read.
   * Streaming bodies require `duplex: "half"` on Node's fetch.
   */
  async putSignedBytes(
    url: string,
    body: BodyInit,
    contentType: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<void> {
    // Undici's RequestInit type lags the runtime: streaming bodies require
    // `duplex: "half"`, so it is typed here rather than on RequestInit.
    const init: RequestInit & { duplex?: "half" } = {
      method: "PUT",
      headers: {
        Accept: "*/*",
        ...extraHeaders,
        "Content-Type": contentType,
      },
      body,
    };
    if (
      typeof ReadableStream !== "undefined" &&
      body instanceof ReadableStream
    ) {
      init.duplex = "half";
    }
    const response = await this.fetchWithTimeout(
      this.uploadFetchImpl,
      url,
      init,
    );
    if (response.ok) {
      return;
    }
    await this.handle(response, url);
  }

  // -- internals -----------------------------------------------------------

  /** Shared body for `postJson`/`patchJson`: only the HTTP verb differs. */
  private async jsonRequest(
    method: "POST" | "PATCH",
    path: string,
    payload: unknown,
    options: { retryOn429?: boolean },
  ): Promise<unknown> {
    return this.request(method, path, {
      jsonBody: payload,
      retryOn429: options.retryOn429 ?? false,
    });
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(this.baseUrl + suffix);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    spec: RequestSpec,
  ): Promise<unknown> {
    const url = this.buildUrl(path, spec.params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (spec.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(spec.jsonBody);
    } else if (spec.formBody !== undefined) {
      // Let fetch set multipart Content-Type with boundary.
      body = spec.formBody;
    }

    let attempt = 0;
    while (true) {
      const response = await this.fetchWithTimeout(this.fetchImpl, url, {
        method,
        headers,
        body,
      });
      if (
        response.status === 429 &&
        spec.retryOn429 &&
        attempt < this.maxRetries
      ) {
        attempt += 1;
        await sleep(this.retryAfterMs(response, attempt));
        continue;
      }
      return this.handle(response, url);
    }
  }

  private async fetchWithTimeout(
    impl: FetchLike,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await impl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private retryAfterMs(response: Response, attempt: number): number {
    const raw = response.headers.get("Retry-After");
    if (raw) {
      const seconds = Number(raw);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    return 2 ** attempt * 1000;
  }

  private async handle(response: Response, url: string): Promise<unknown> {
    const text = await response.text();
    if (response.ok) {
      if (!text) {
        return {};
      }
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    let message = response.statusText || "request failed";
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          // The app's own ErrorResponse.error is always a non-empty string,
          // but a gate in front of the app (a body-size limit, for example)
          // can return its own shape instead, e.g. {error: {code, message}}.
          // Try error, then message, unwrapping one level of {message}
          // object each time, so the server's actual message still surfaces
          // rather than an unreadable stringified object or a blank string.
          message =
            extractErrorMessage(obj.error) ??
            extractErrorMessage(obj.message) ??
            message;
        }
      } catch {
        message = text.slice(0, 300);
      }
    }
    throw new UltralyticsApiError(response.status, message, url);
  }
}
