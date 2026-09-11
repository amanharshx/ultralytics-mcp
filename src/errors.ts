/** Normalized error type for non-success Ultralytics API responses.
 *
 * The API message is surfaced verbatim alongside a static per-status hint.
 * Messages reflect which route matched rather than what failed and differ
 * between resource types, so callers must never branch on message text.
 */

const STATUS_HINTS: Record<number, string> = {
  400: "invalid request",
  401: "authentication failed - check your ULTRALYTICS_API_KEY",
  403: "insufficient permissions for this resource",
  404: "not found - the owner may not exist, the resource may not exist, or the API key may lack access",
  405: "method not allowed",
  409: "conflict",
  429: "rate limit exceeded",
  500: "server error",
};

/** A non-success response from the Ultralytics API. */
export class UltralyticsApiError extends Error {
  readonly statusCode: number;
  readonly apiMessage: string;
  readonly url: string;

  constructor(statusCode: number, message: string, url: string) {
    const hint = STATUS_HINTS[statusCode];
    const suffix = hint ? ` (${hint})` : "";
    super(`HTTP ${statusCode}${suffix}: ${message} [${url}]`);
    this.name = "UltralyticsApiError";
    this.statusCode = statusCode;
    this.apiMessage = message;
    this.url = url;
  }
}
