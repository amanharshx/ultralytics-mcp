import { UltralyticsClient } from "../src/client.js";

export const KEY = `ul_${"0".repeat(40)}`;
export const BASE = "https://platform.ultralytics.com/api";

/** Build a client whose fetch routes through `handler`, recording call paths. */
export function routeClient(
  handler: (path: string, params: URLSearchParams) => Response,
) {
  const calls: { path: string; params: URLSearchParams }[] = [];
  const impl = (async (url: string | URL) => {
    const parsed = new URL(String(url));
    calls.push({ path: parsed.pathname, params: parsed.searchParams });
    return handler(parsed.pathname, parsed.searchParams);
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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
