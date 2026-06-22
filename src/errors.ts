/** Normalized error type for non-success Ultralytics API responses. */

const STATUS_HINTS: Record<number, string> = {
  400: "invalid request",
  401: "authentication failed - check your ULTRALYTICS_API_KEY",
  403: "insufficient permissions for this resource",
  404: "resource not found",
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
