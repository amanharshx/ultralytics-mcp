import { describe, expect, test } from "vitest";

import { ConfigError, getApiBase, getApiKey } from "../src/config.js";

const VALID_KEY = `ul_${"0123456789abcdef".repeat(2)}01234567`; // ul_ + 40 hex

describe("getApiKey", () => {
  test("returns a valid key", () => {
    expect(getApiKey({ ULTRALYTICS_API_KEY: VALID_KEY })).toBe(VALID_KEY);
  });

  test("trims surrounding whitespace", () => {
    expect(getApiKey({ ULTRALYTICS_API_KEY: `  ${VALID_KEY}  ` })).toBe(
      VALID_KEY,
    );
  });

  test("throws when missing", () => {
    expect(() => getApiKey({})).toThrow(ConfigError);
    expect(() => getApiKey({})).toThrow(/Missing ULTRALYTICS_API_KEY/);
  });

  test("throws when malformed", () => {
    for (const bad of [
      "ul_your_key_here",
      "not-a-key",
      "ul_123",
      `ul_${"g".repeat(40)}`,
    ]) {
      expect(() => getApiKey({ ULTRALYTICS_API_KEY: bad })).toThrow(
        /malformed/,
      );
    }
  });
});

describe("getApiBase", () => {
  test("defaults to the platform base", () => {
    expect(getApiBase({})).toBe("https://platform.ultralytics.com/api");
  });

  test("strips trailing slashes from an override", () => {
    expect(
      getApiBase({ ULTRALYTICS_API_BASE: "https://example.com/api/" }),
    ).toBe("https://example.com/api");
  });
});
