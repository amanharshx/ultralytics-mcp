/** Live smoke test for the project tools.
 *
 * Fails when the platform changes its contract underneath us (paths,
 * statuses, or response field names). Skipped silently without a key so
 * contributors without credentials are unaffected, and excluded from
 * `npm test` so ordinary development stays offline and fast.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npm run test:live
 * ```
 *
 * The key is read from the `ULTRALYTICS_API_KEY` environment variable, the
 * same variable the server reads. Creates one disposable `mcp-smoke-*`
 * project and deletes it again, even when an assertion fails.
 */

import { describe, expect, test } from "vitest";

import { UltralyticsClient } from "../../src/client.js";
import {
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "../../src/tools/projects.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

describe.skipIf(!apiKey)("projects live smoke", () => {
  test("list, create, get, and delete round-trip", async () => {
    const client = new UltralyticsClient({ apiKey: apiKey as string });
    const owner = await client.getAccountOwner();
    expect(typeof owner).toBe("string");
    expect(owner.length).toBeGreaterThan(0);

    const before = await projectsList(client);
    expect(Array.isArray(before.data)).toBe(true);
    expect(before.summary).toContain(owner);

    const slug = `mcp-smoke-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let created = false;
    try {
      const createdResult = await projectsCreate(client, {
        name: "MCP smoke (disposable)",
        project: slug,
      });
      created = true;
      const createdRecord = createdResult.data as Record<string, unknown>;
      expect(typeof createdRecord.id).toBe("string");
      expect(createdRecord.owner).toBe(owner);
      expect(createdRecord.project).toBe(slug);

      const got = await projectsGet(client, `${owner}/${slug}`);
      const gotData = got.data as {
        project: Record<string, unknown>;
        models: unknown;
        isOwner: unknown;
      };
      expect(typeof gotData.project.id).toBe("string");
      expect(gotData.project.owner).toBe(owner);
      expect(gotData.project.project).toBe(slug);
      expect(typeof gotData.project.name).toBe("string");
      expect(typeof gotData.project.visibility).toBe("string");
      expect(gotData.project.visibility).toBe("private");
      expect(Array.isArray(gotData.models)).toBe(true);
      expect(typeof gotData.isOwner).toBe("boolean");

      const after = await projectsList(client);
      const entries = after.data as Array<Record<string, unknown>>;
      const listed = entries.find((entry) => entry.slug === slug);
      expect(listed).toBeDefined();
      expect(typeof listed?.id).toBe("string");
      expect(listed?.username).toBe(owner);

      const deleted = await projectsDelete(client, `${owner}/${slug}`);
      created = false;
      const deletedData = deleted.data as Record<string, unknown>;
      expect(deletedData.success).toBe(true);
      expect(typeof deletedData.cascadedModels).toBe("number");
      expect(deletedData.owner).toBe(owner);
      expect(deletedData.project).toBe(slug);
    } finally {
      if (created) {
        await projectsDelete(client, `${owner}/${slug}`).catch(() => {});
      }
    }
  }, 120_000);
});
