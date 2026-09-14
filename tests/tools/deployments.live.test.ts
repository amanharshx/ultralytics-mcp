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
import { getApiBase } from "../../src/config.js";
import { UltralyticsApiError } from "../../src/errors.js";
import {
  deploymentGet,
  deploymentHealth,
  deploymentLogs,
  deploymentMetrics,
  deploymentsList,
} from "../../src/tools/deployments.js";
import {
  disposableSlug,
  lastStatus,
  type RecordedCall,
  recordingClient,
  withDisposableCleanup,
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

/** Poll a deployment until `status` reaches `stopped`, or give up. */
async function pollUntilStopped(
  client: Parameters<typeof deploymentGet>[0],
  ref: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const result = await deploymentGet(client, ref);
    last = result.data as Record<string, unknown>;
    if (last.status === "stopped") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    `deployment '${ref}' did not reach stopped within ${timeoutMs}ms (last status: ${String(last.status)})`,
  );
}

/** Stop a deployment through the raw PATCH endpoint.
 *
 * No `deployment_stop` tool ships in this ticket (ticket 9, pass 1) -- the
 * client has no generic PATCH verb yet either, since only ticket 9 needs
 * one. This calls the endpoint directly, exactly as `deployment_get`'s live
 * suite calls `postJson`/`delete` directly to set up and tear down a
 * deployment outside of any tool under test.
 */
async function rawPatchStop(apiKeyValue: string, path: string): Promise<void> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKeyValue}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ action: "stop" }),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${path} failed: HTTP ${response.status}`);
  }
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

/** Deployments have no trash and no restore. `withDisposableCleanup` runs its
 * `cleanup` argument only as a safety net when `body` throws; the happy path
 * must delete the resource itself as its last step, exactly as the
 * projects/datasets/models live suites do (see `projectsDelete` called
 * inside `body` in projects.live.test.ts), so both the assertion-throws and
 * create-then-crash failure paths still delete it. */
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

      await withDisposableCleanup(
        "deployment",
        ref,
        async () => {
          await client.delete(`/deployments/${owner}/${slug}`);
        },
        async () => {
          await client.postJson(`/deployments/${owner}`, {
            project: "pothole",
            model: "yolo26s",
            deployment: slug,
            name: "zz mcp ticket4 delete me",
            region: "europe-west1",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);

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

          await client.delete(`/deployments/${owner}/${slug}`);
        },
      );

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

describe.skipIf(!apiKey)("deployment_health live smoke", () => {
  test(
    "probes health on a ready deployment and again once stopped",
    async () => {
      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);
      const owner = await client.getAccountOwner();

      const creditsBefore = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;

      const slug = disposableSlug("zz-mcp-ticket5");
      const ref = `${owner}/${slug}`;

      await withDisposableCleanup(
        "deployment",
        ref,
        async () => {
          await client.delete(`/deployments/${owner}/${slug}`);
        },
        async () => {
          await client.postJson(`/deployments/${owner}`, {
            project: "pothole",
            model: "yolo26s",
            deployment: slug,
            name: "zz mcp ticket5 delete me",
            region: "europe-west1",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);

          await pollUntilReady(client, ref, 5 * 60_000);

          const health = await deploymentHealth(client, ref);
          const data = health.data as Record<string, unknown>;
          expect(data.healthy).toBe(true);
          expect(typeof data.status).toBe("number");
          expect(typeof data.latencyMs).toBe("number");
          expect(health.summary).toContain("probe status");

          await rawPatchStop(apiKey as string, `/deployments/${owner}/${slug}`);
          await pollUntilStopped(client, ref, 2 * 60_000);

          const stoppedHealth = await deploymentHealth(client, ref);
          const stoppedData = stoppedHealth.data as Record<string, unknown>;
          expect(stoppedData.healthy).toBe(false);
          expect(typeof stoppedData.status).toBe("number");
          expect(typeof stoppedData.latencyMs).toBe("number");
          expect(typeof stoppedData.error).toBe("string");
          expect(stoppedHealth.summary).toContain("unhealthy");

          await client.delete(`/deployments/${owner}/${slug}`);
        },
      );

      const creditsAfter = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;
      expect(creditsAfter).toBe(creditsBefore);

      const listAfter = await deploymentsList(client, owner);
      const remaining = listAfter.data as Array<Record<string, unknown>>;
      expect(remaining.some((item) => item.deployment === slug)).toBe(false);
    },
    8 * 60_000,
  );
});

describe.skipIf(!apiKey)("deployment_logs live smoke", () => {
  test(
    "reads empty entries right after create, then real entries once ready, filters by severity, and surfaces a bad severity's own rejection",
    async () => {
      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);
      const owner = await client.getAccountOwner();

      const creditsBefore = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;

      const slug = disposableSlug("zz-mcp-ticket6");
      const ref = `${owner}/${slug}`;

      await withDisposableCleanup(
        "deployment",
        ref,
        async () => {
          await client.delete(`/deployments/${owner}/${slug}`);
        },
        async () => {
          await client.postJson(`/deployments/${owner}`, {
            project: "pothole",
            model: "yolo26s",
            deployment: slug,
            name: "zz mcp ticket6 delete me",
            region: "europe-west1",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);

          // Right after create, logs may legitimately be empty (verified live
          // separately) or may already carry container-startup lines; either
          // way this must read as a normal result, never an error.
          const fresh = await deploymentLogs(client, ref);
          const freshData = fresh.data as { entries: unknown[] };
          expect(Array.isArray(freshData.entries)).toBe(true);
          expect(fresh.summary).toContain("log entr");

          await pollUntilReady(client, ref, 5 * 60_000);

          const logs = await deploymentLogs(client, ref);
          const data = logs.data as {
            entries: Array<Record<string, unknown>>;
            nextPageToken: string | null;
          };
          expect(Array.isArray(data.entries)).toBe(true);
          for (const entry of data.entries) {
            expect(typeof entry.timestamp).toBe("string");
            expect(typeof entry.severity).toBe("string");
            expect(typeof entry.message).toBe("string");
          }

          const limited = await deploymentLogs(client, ref, { limit: 2 });
          const limitedData = limited.data as {
            entries: Array<Record<string, unknown>>;
          };
          expect(limitedData.entries.length).toBeLessThanOrEqual(2);

          const filtered = await deploymentLogs(client, ref, {
            severity: "INFO",
          });
          const filteredData = filtered.data as {
            entries: Array<Record<string, unknown>>;
          };
          expect(Array.isArray(filteredData.entries)).toBe(true);
          for (const entry of filteredData.entries) {
            expect(entry.severity).toBe("INFO");
          }

          const badSeverity = await deploymentLogs(client, ref, {
            severity: "NOT_A_REAL_SEVERITY",
          }).catch((error) => error as UltralyticsApiError);
          expect(badSeverity).toBeInstanceOf(UltralyticsApiError);
          expect((badSeverity as UltralyticsApiError).statusCode).toBe(400);
          expect(
            (badSeverity as UltralyticsApiError).apiMessage.length,
          ).toBeGreaterThan(0);

          await client.delete(`/deployments/${owner}/${slug}`);
        },
      );

      const creditsAfter = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;
      expect(creditsAfter).toBe(creditsBefore);

      const listAfter = await deploymentsList(client, owner);
      const remaining = listAfter.data as Array<Record<string, unknown>>;
      expect(remaining.some((item) => item.deployment === slug)).toBe(false);
    },
    8 * 60_000,
  );
});

describe.skipIf(!apiKey)("deployment_metrics live smoke", () => {
  test(
    "reads both anyOf branches at more than one range, with near-zero values on a fresh deployment",
    async () => {
      const records: RecordedCall[] = [];
      const client = recordingClient(apiKey as string, records);
      const owner = await client.getAccountOwner();

      const creditsBefore = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;

      const slug = disposableSlug("zz-mcp-ticket7");
      const ref = `${owner}/${slug}`;

      await withDisposableCleanup(
        "deployment",
        ref,
        async () => {
          await client.delete(`/deployments/${owner}/${slug}`);
        },
        async () => {
          await client.postJson(`/deployments/${owner}`, {
            project: "pothole",
            model: "yolo26s",
            deployment: slug,
            name: "zz mcp ticket7 delete me",
            region: "europe-west1",
          });
          expect(lastStatus(records)).toBe(EXPECTED_STATUS.create);

          await pollUntilReady(client, ref, 5 * 60_000);

          const detailed = await deploymentMetrics(client, ref, {
            range: "1h",
          });
          const detailedData = detailed.data as Record<string, unknown>;
          expect(detailedData.timeRange).toBeTruthy();
          expect(detailedData.summary).toBeTruthy();
          expect(detailedData.timeSeries).toBeTruthy();
          expect(detailedData).not.toHaveProperty("requests24h");

          const detailedOtherRange = await deploymentMetrics(client, ref, {
            range: "7d",
          });
          expect(
            (detailedOtherRange.data as Record<string, unknown>).timeRange,
          ).toBeTruthy();

          const sparkline = await deploymentMetrics(client, ref, {
            range: "1h",
            sparkline: true,
          });
          const sparklineData = sparkline.data as Record<string, unknown>;
          expect(Array.isArray(sparklineData.requests24h)).toBe(true);
          expect(typeof sparklineData.totalRequests).toBe("number");
          expect(typeof sparklineData.errorRate).toBe("number");
          expect(typeof sparklineData.avgLatencyMs).toBe("number");
          expect(sparklineData).not.toHaveProperty("timeSeries");
          expect(sparklineData).not.toHaveProperty("summary");
          // Fresh deployment: near-zero traffic is a valid result, not an error.
          expect(sparklineData.totalRequests as number).toBeGreaterThanOrEqual(
            0,
          );

          await client.delete(`/deployments/${owner}/${slug}`);
        },
      );

      const creditsAfter = (
        (await client.get("/account/summary")) as Record<string, unknown>
      ).creditsCents as number;
      expect(creditsAfter).toBe(creditsBefore);

      const listAfter = await deploymentsList(client, owner);
      const remaining = listAfter.data as Array<Record<string, unknown>>;
      expect(remaining.some((item) => item.deployment === slug)).toBe(false);
    },
    8 * 60_000,
  );
});
