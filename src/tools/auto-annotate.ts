/** Auto-annotate tools. Pure reads only in this ticket; start/stop are separate. */

import type { UltralyticsClient } from "../client.js";
import { resolveDataset } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, pyField } from "./shared.js";

/** Get an auto-annotation run's status for one dataset.
 *
 * Resolves the dataset reference by pure string parsing (ids are not
 * addressable), fills a missing owner from the account summary, and reads
 * the live dataset-scoped endpoint. `activeJob` and `lastRun` are surfaced
 * unmodified: the server already distinguishes a never-run dataset (both
 * null), an active run (`progress`), a finished run (`failed`/`stopped`
 * booleans plus `results` or `null`), and a failed run (`error` plus null
 * `results`) — this tool does not collapse those into an invented status
 * field. `lastRun.error` is surfaced verbatim; it is the only place a
 * class-mismatch failure states its reason.
 */
export async function autoAnnotateStatus(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveDataset(dataset);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const data = await client.get(
    `/datasets/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolved.dataset)}/predict/batch`,
  );
  const record = asRecord(data);
  const activeJob = record.activeJob ?? null;
  const lastRun = record.lastRun ?? null;

  let summary = `Dataset '${resolved.dataset}' for owner '${resolvedOwner}': `;
  if (activeJob && typeof activeJob === "object") {
    const job = asRecord(activeJob);
    const progress = asRecord(job.progress);
    summary +=
      `run '${pyField(job.id)}' active, ` +
      `processed ${pyField(progress.processed)}/${pyField(progress.total)}, ` +
      `started at ${pyField(job.startedAt)}.`;
  } else if (lastRun && typeof lastRun === "object") {
    const run = asRecord(lastRun);
    summary += `last run finished, failed=${pyField(run.failed)} stopped=${pyField(run.stopped)}`;
    if (run.error !== null && run.error !== undefined) {
      summary += `. Error: ${String(run.error)}`;
    } else if (run.results && typeof run.results === "object") {
      const results = asRecord(run.results);
      summary +=
        `, processed ${pyField(results.processed)}, ` +
        `annotations ${pyField(results.annotations)}, ` +
        `classes ${pyField(results.classes)}.`;
    } else {
      summary += ".";
    }
  } else {
    summary += "no auto-annotation run recorded.";
  }

  return {
    summary,
    data: { activeJob, lastRun },
  };
}
