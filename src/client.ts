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

export class UltralyticsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly downloadFetchImpl: FetchLike;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? getApiBase()).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? getApiKey();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.downloadFetchImpl = options.downloadFetchImpl ?? fetch;
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
    return this.request("POST", path, {
      jsonBody: payload,
      retryOn429: options.retryOn429 ?? false,
    });
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

  // -- internals -----------------------------------------------------------

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
          message = (obj.error as string) || (obj.message as string) || message;
        }
      } catch {
        message = text.slice(0, 300);
      }
    }
    throw new UltralyticsApiError(response.status, message, url);
  }
}
