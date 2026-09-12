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
 * project and deletes it again, even when an assertion fails. The recording
 * and cleanup harness is shared with the datasets suite (live-harness.ts).
 */

import { describe, expect, test } from "vitest";
import {
  projectsCreate,
  projectsDelete,
  projectsGet,
  projectsList,
} from "../../src/tools/projects.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

/** Success statuses captured against the live API; a change fails loudly. */
const EXPECTED_STATUS = {
  accountSummary: 200,
  list: 200,
  create: 201,
  get: 200,
  delete: 200,
} as const;

describe.skipIf(!apiKey)("projects live smoke", () => {
  test("list, create, get, and delete round-trip", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);
    expect(typeof owner).toBe("string");
    expect(owner.length).toBeGreaterThan(0);

    const listBefore = await projectsList(client);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(Array.isArray(listBefore.data)).toBe(true);
    expect(listBefore.summary).toContain(owner);

    const slug = disposableSlug("mcp-smoke");
    const ref = `${owner}/${slug}`;
    await withDisposableCleanup(
      "project",
      ref,
      async () => {
        const cleanup = await projectsDelete(client, ref);
        const cleanupData = cleanup.data as Record<string, unknown>;
        if (cleanupData.success !== true) {
          throw new Error(`cleanup delete reported success:false for '${ref}'`);
        }
      },
      async () => {
        const createdResult = await projectsCreate(client, {
          name: "MCP smoke (disposable)",
          project: slug,
        });
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);
        const createdRecord = createdResult.data as Record<string, unknown>;
        expect(typeof createdRecord.id).toBe("string");
        expect(createdRecord.owner).toBe(owner);
        expect(createdRecord.project).toBe(slug);

        const fetched = await projectsGet(client, ref);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
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
        expect(typeof fetchedData.project.modelCount).toBe("number");
        expect(Array.isArray(fetchedData.models)).toBe(true);
        expect(typeof fetchedData.isOwner).toBe("boolean");

        const listAfter = await projectsList(client);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
        const entries = listAfter.data as Array<Record<string, unknown>>;
        const listed = entries.find((entry) => entry.slug === slug);
        expect(listed).toBeDefined();
        expect(typeof listed?.id).toBe("string");
        expect(listed?.username).toBe(owner);
        expect(typeof listed?.name).toBe("string");
        expect(typeof listed?.visibility).toBe("string");
        expect(typeof listed?.modelCount).toBe("number");

        // Raw contract the tool mapping depends on: the list response carries
        // `projects[]` whose items name the resource via `id`, `project`
        // (slug), `owner`, `name`, `visibility`, and `modelCount`. A rename
        // here must fail loudly instead of surfacing as nulls downstream.
        const rawList = (await client.get(
          `/projects/${encodeURIComponent(owner)}`,
        )) as { projects?: unknown };
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
        expect(Array.isArray(rawList.projects)).toBe(true);
        const rawEntries = rawList.projects as Array<Record<string, unknown>>;
        const rawMatch = rawEntries.find((entry) => entry.project === slug);
        expect(rawMatch).toBeDefined();
        expect(typeof rawMatch?.id).toBe("string");
        expect(rawMatch?.owner).toBe(owner);
        expect(typeof rawMatch?.name).toBe("string");
        expect(typeof rawMatch?.visibility).toBe("string");
        expect(typeof rawMatch?.modelCount).toBe("number");

        const deleted = await projectsDelete(client, ref);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.delete);
        const deletedData = deleted.data as Record<string, unknown>;
        expect(deletedData.success).toBe(true);
        expect(typeof deletedData.cascadedModels).toBe("number");
      },
    );
  }, 120_000);
});
