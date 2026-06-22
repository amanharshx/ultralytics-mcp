/** Configuration and environment handling for the Ultralytics MCP server. */

const DEFAULT_API_BASE = "https://platform.ultralytics.com/api";
const API_KEY_ENV = "ULTRALYTICS_API_KEY";
const API_BASE_ENV = "ULTRALYTICS_API_BASE";

/** Documented key format: 'ul_' followed by exactly 40 hex characters. */
const API_KEY_RE = /^ul_[0-9a-fA-F]{40}$/;

/** Raised when required configuration is missing or invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Return the API base URL, without a trailing slash. */
export function getApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env[API_BASE_ENV] ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

/** Return a validated Ultralytics API key from the environment. */
export function getApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = (env[API_KEY_ENV] ?? "").trim();
  if (!key) {
    throw new ConfigError(
      `Missing ${API_KEY_ENV}. Generate a key at ` +
        "https://platform.ultralytics.com (Settings > API Keys) and set it.",
    );
  }
  if (!API_KEY_RE.test(key)) {
    throw new ConfigError(
      `${API_KEY_ENV} looks malformed: expected 'ul_' followed by 40 hex characters.`,
    );
  }
  return key;
}
