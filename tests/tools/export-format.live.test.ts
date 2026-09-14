/** Live smoke test asserting the platform still validates export formats
 * server-side.
 *
 * Export formats were one of the four confirmed platform divergences from
 * our old client-side allowlist: it accepted two formats the server rejects
 * and blocked four it accepts, including `litert`, the current name for
 * TensorFlow Lite. Ticket 10 deleted that allowlist and now relies entirely
 * on the server's own validation and its own error message — but until now
 * that reliance was only asserted against a hand-written fixture in the unit
 * tests, which stays green even if the platform's accepted-format enum moves
 * again. This suite asserts it live instead.
 *
 * An invalid format is rejected before any export job starts, so this check
 * spends nothing and creates nothing. Skipped silently without
 * `ULTRALYTICS_API_KEY` and excluded from `npm test`, exactly like the other
 * live smoke suites.
 *
 * Run with:
 *
 * ```bash
 * export ULTRALYTICS_API_KEY=ul_...
 * npm run test:live
 * ```
 */

import { describe, expect, test } from "vitest";
import { UltralyticsApiError } from "../../src/errors.js";
import { exportCreate, exportsList } from "../../src/tools/exports.js";
import { modelsDelete } from "../../src/tools/models.js";
import { projectsCreate, projectsDelete } from "../../src/tools/projects.js";
import {
  assertDeleted,
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

/** Not a real export format, so the server refuses it before any job is
 * queued. */
const INVALID_FORMAT = "mcp-smoke-not-a-real-format";

/** The old client-side allowlist blocked this format; the server accepts it.
 * Sending it through the tool and seeing the request actually reach the
 * network — rather than being rejected locally — proves the removal took. */
const FORMERLY_BLOCKED_FORMAT = "litert";

async function catchApiError(
  promise: Promise<unknown>,
): Promise<UltralyticsApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UltralyticsApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject with an UltralyticsApiError");
}

describe.skipIf(!apiKey)("export format validation live smoke", () => {
  test("refuses an invalid format with the server's own message and creates no export", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();

    // Prove `litert` reaches the server as valid input rather than being
    // rejected by the tool itself: sent against a model that cannot exist,
    // the request still reaches the network and fails on "model not found"
    // rather than "unrecognized format" or a client-thrown error. A
    // reintroduced client-side gate blocking this specific format would
    // fail this assertion even if it left every other format alone. Because
    // the model doesn't exist, no export job is ever created.
    const nonexistentModelRef = `${owner}/${disposableSlug("mcp-smoke-missing-project")}/${disposableSlug("missing-model")}`;
    const notFoundError = await catchApiError(
      exportCreate(client, nonexistentModelRef, FORMERLY_BLOCKED_FORMAT, {
        confirmCost: true,
      }),
    );
    expect(lastStatus(records)).toBe(404);
    expect(notFoundError.statusCode).toBe(404);

    const projectSlug = disposableSlug("mcp-smoke");
    const projectRef = `${owner}/${projectSlug}`;
    await withDisposableCleanup(
      "project",
      projectRef,
      async () => {
        assertDeleted(
          "project",
          projectRef,
          await projectsDelete(client, projectRef),
        );
      },
      async () => {
        await projectsCreate(client, {
          name: "MCP smoke (disposable)",
          project: projectSlug,
        });

        // `models_create` is not a tool the server exposes; model creation
        // itself starts no compute and is free, exactly as in the models
        // live smoke suite.
        const created = (await client.postJson("/models", {
          owner,
          project: projectSlug,
          task: "detect",
        })) as Record<string, unknown>;
        const modelSlug = created.model as string;
        const modelRef = `${owner}/${projectSlug}/${modelSlug}`;

        await withDisposableCleanup(
          "model",
          modelRef,
          async () => {
            assertDeleted(
              "model",
              modelRef,
              await modelsDelete(client, modelRef),
            );
          },
          async () => {
            // An independent, direct call to the same endpoint with the
            // same invalid payload captures the server's raw refusal,
            // uncoupled from `exportCreate`'s own handling.
            const rawError = await catchApiError(
              client.postJson(
                `/models/${owner}/${projectSlug}/${modelSlug}/exports`,
                { format: INVALID_FORMAT },
              ),
            );
            expect(rawError.statusCode).toBe(400);

            const toolError = await catchApiError(
              exportCreate(client, modelRef, INVALID_FORMAT, {
                confirmCost: true,
              }),
            );
            expect(lastStatus(records)).toBe(400);

            // The tool surfaces the server's own message rather than
            // substituting its own: this is an exact match against the
            // independent raw call above, not just a similar-looking string.
            expect(toolError.apiMessage).toBe(rawError.apiMessage);

            // The refusal names the formats the platform accepts, and
            // `litert` — a format the deleted client-side allowlist used to
            // block — is now among them. A reintroduced client-side gate
            // would fail this assertion even though the server's own
            // message still lists the format as valid.
            expect(toolError.apiMessage.toLowerCase()).toContain(
              FORMERLY_BLOCKED_FORMAT,
            );

            // No export job was created by any of the above.
            const listed = await exportsList(client, modelRef);
            expect(listed.data).toEqual([]);

            assertDeleted(
              "model",
              modelRef,
              await modelsDelete(client, modelRef),
            );
          },
        );

        assertDeleted(
          "project",
          projectRef,
          await projectsDelete(client, projectRef),
        );
      },
    );
  }, 60_000);
});
