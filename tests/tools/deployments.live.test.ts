/** Live smoke tests for the deployment read tools.
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
 * `deployments_list` is a pure read: it creates nothing and so needs no
 * disposable-resource cleanup, unlike the projects/datasets/models live
 * suites, and its suite below only proves the read path against whatever
 * the workspace already has. `deployment_get` needs an actual deployment to
 * read, though, and no `deploy` tool ships in this epic's pass 1 (see the
 * deploy-eval epic's Pass 2 section) -- so its suite creates one directly
 * through the client, not through a tool, and deletes it in a `finally`.
 */

import { describe, expect, test } from "vitest";
import { deploymentGet, deploymentsList } from "../../src/tools/deployments.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const EXPECTED_STATUS = {
  accountSummary: 200,
  list: 200,
  create: 201,
  get: 200,
} as const;

/** Poll a deployment until `status` reaches `ready`, or give up.
 *
 * Provisioning takes 40-60s (verified live, twice); this caps at 5 minutes
 * so a stuck provision fails the test instead of hanging it.
 */
async function pollUntilReady(
  client: Parameters<typeof deploymentGet>[0],
  ref: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const result = await deploymentGet(client, ref);
    last = result.data as Record<string, unknown>;
    if (last.status === "ready") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `deployment '${ref}' did not reach ready within ${timeoutMs}ms (last status: ${String(last.status)})`,
  );
}

describe.skipIf(!apiKey)("deployments_list live smoke", () => {
  test("lists deployments for the default owner and an explicit owner", async () => {
    const records: RecordedCall[] = [];
    const client = recordingClient(apiKey as string, records);
    const owner = await client.getAccountOwner();
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.accountSummary);

    const defaulted = await deploymentsList(client);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(defaulted.summary).toContain(owner);
    expect(Array.isArray(defaulted.data)).toBe(true);
    const items = defaulted.data as Array<Record<string, unknown>>;
    expect(defaulted.summary).toBe(
      `${items.length} deployment(s) for owner '${owner}'.`,
    );
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.owner).toBe("string");
      expect(typeof item.deployment).toBe("string");
      expect(typeof item.name).toBe("string");
      expect(typeof item.status).toBe("string");
      expect(typeof item.region).toBe("string");
      expect(item.resources).toBeTruthy();
      expect(typeof item.createdAt).toBe("string");
      expect(typeof item.updatedAt).toBe("string");
    }

    const explicit = await deploymentsList(client, owner);
    expect(lastStatus(records)).toBe(EXPECTED_STATUS.list);
    expect(explicit.summary).toBe(
      `${items.length} deployment(s) for owner '${owner}'.`,
    );
    expect(explicit.data).toEqual(defaulted.data);
  }, 60_000);
});

/** Deployments have no trash and no restore: cleanup must run even when an
 * assertion throws, so creation and deletion are wrapped in try/finally. */
describe.skipIf(!apiKey)("deployment_get live smoke", () => {
  test(
    "reads a deployment at deploying and again at ready, then is gone after delete",
    async () => {
      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);
      const owner = await client.getAccountOwner();

      const creditsBefore = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;

      const slug = disposableSlug("zz-mcp-ticket4");
      const ref = `${owner}/${slug}`;
      let created = false;
      try {
        await client.postJson(`/deployments/${owner}`, {
          project: "pothole",
          model: "yolo26s",
          deployment: slug,
          name: "zz mcp ticket4 delete me",
          region: "europe-west1",
        });
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);
        created = true;

        const deploying = await deploymentGet(client, ref);
        expect(lastStatus(records)).toBe(EXPECTED_STATUS.get);
        const deployingData = deploying.data as Record<string, unknown>;
        expect(deployingData.status).not.toBe("ready");
        expect(deployingData.serviceUrl).toBeNull();
        expect(deployingData.deployedAt).toBeNull();
        expect(deploying.summary).toContain("not yet available");

        const ready = await pollUntilReady(client, ref, 5 * 60_000);
        expect(typeof ready.serviceUrl).toBe("string");
        expect(typeof ready.deployedAt).toBe("string");
        expect(ready.resources).toMatchObject({
          cpu: expect.any(Number),
          memoryGi: expect.any(Number),
          minInstances: expect.any(Number),
          maxInstances: expect.any(Number),
        });
        expect(ready).not.toHaveProperty("apiKeyId");
      } finally {
        if (created) {
          await client.delete(`/deployments/${owner}/${slug}`);
        }
      }

      const creditsAfter = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;
      expect(creditsAfter).toBe(creditsBefore);

      const listAfter = await deploymentsList(client, owner);
      const remaining = listAfter.data as Array<Record<string, unknown>>;
      expect(remaining.some((item) => item.deployment === slug)).toBe(false);
    },
    6 * 60_000,
  );
});
