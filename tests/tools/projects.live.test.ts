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

    const listBefore = await projectsList(client);
    expect(Array.isArray(listBefore.data)).toBe(true);
    expect(listBefore.summary).toContain(owner);

    const slug = `mcp-smoke-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const ref = `${owner}/${slug}`;
    let created = false;
    let bodyError: unknown;
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

      const fetched = await projectsGet(client, ref);
      const fetchedData = fetched.data as {
        project: Record<string, unknown>;
        models: unknown;
        isOwner: unknown;
      };
      expect(typeof fetchedData.project.id).toBe("string");
      expect(fetchedData.project.owner).toBe(owner);
      expect(fetchedData.project.project).toBe(slug);
      expect(typeof fetchedData.project.name).toBe("string");
      expect(typeof fetchedData.project.visibility).toBe("string");
      expect(fetchedData.project.visibility).toBe("private");
      expect(Array.isArray(fetchedData.models)).toBe(true);
      expect(typeof fetchedData.isOwner).toBe("boolean");

      const listAfter = await projectsList(client);
      const entries = listAfter.data as Array<Record<string, unknown>>;
      const listed = entries.find((entry) => entry.slug === slug);
      expect(listed).toBeDefined();
      expect(typeof listed?.id).toBe("string");
      expect(listed?.username).toBe(owner);

      // Raw contract the tool mapping depends on: the list response carries
      // `projects[]` whose items name the resource via `id`, `project`
      // (slug), and `owner`. A rename here must fail loudly instead of
      // surfacing as nulls downstream.
      const rawList = (await client.get(
        `/projects/${encodeURIComponent(owner)}`,
      )) as { projects?: unknown };
      expect(Array.isArray(rawList.projects)).toBe(true);
      const rawEntries = rawList.projects as Array<Record<string, unknown>>;
      const rawMatch = rawEntries.find((entry) => entry.project === slug);
      expect(rawMatch).toBeDefined();
      expect(typeof rawMatch?.id).toBe("string");
      expect(rawMatch?.owner).toBe(owner);

      const deleted = await projectsDelete(client, ref);
      created = false;
      const deletedData = deleted.data as Record<string, unknown>;
      expect(deletedData.success).toBe(true);
      expect(typeof deletedData.cascadedModels).toBe("number");
    } catch (error) {
      bodyError = error;
    }
    if (created) {
      try {
        await projectsDelete(client, ref);
        created = false;
      } catch (cleanupError) {
        throw new Error(
          `cleanup failed for disposable project '${ref}' (it may still exist in the workspace): ${String(cleanupError)}` +
            (bodyError === undefined
              ? ""
              : `; original failure: ${String(bodyError)}`),
        );
      }
    }
    if (bodyError !== undefined) {
      throw bodyError;
    }
  }, 120_000);
});
