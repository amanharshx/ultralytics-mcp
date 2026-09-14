/** Live smoke test for the deployment list tool.
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
 * suites. Deployment creation is out of scope for this tool (see the
 * deploy-eval epic's pass 1 read surface) so this suite only proves the
 * read path against whatever the workspace already has.
 */

import { describe, expect, test } from "vitest";
import { deploymentsList } from "../../src/tools/deployments.js";
import {
  lastStatus,
  type RecordedCall,
  recordingClient,
} from "./live-harness.js";

const apiKey = process.env.ULTRALYTICS_API_KEY?.trim();

const EXPECTED_STATUS = {
  accountSummary: 200,
  list: 200,
} as const;

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
