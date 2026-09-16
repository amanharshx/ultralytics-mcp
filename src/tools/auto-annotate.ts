/** Auto-annotate tools. */

import type { UltralyticsClient } from "../client.js";
import { resolveDataset, resolveModel } from "../resolve.js";
import type { NormalizedToolResult } from "../tool-result.js";
import { asRecord, pyField } from "./shared.js";

/** Path for the dataset-scoped predict/batch endpoint every auto-annotate
 * tool reads or writes. */
function predictBatchPath(owner: string, dataset: string): string {
  return `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(dataset)}/predict/batch`;
}

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
    predictBatchPath(resolvedOwner, resolved.dataset),
  );
  const record = asRecord(data);
  if (!("activeJob" in record) || !("lastRun" in record)) {
    throw new Error(
      `Malformed auto-annotate status for dataset '${resolved.dataset}' for owner ` +
        `'${resolvedOwner}': expected 'activeJob' and 'lastRun', got ${JSON.stringify(record)}.`,
    );
  }
  const activeJob = record.activeJob;
  const lastRun = record.lastRun;

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

export interface AutoAnnotateStartOptions {
  project?: string;
  confidence?: number;
  iou?: number;
  classMapping?: (number | null)[];
  includeAnnotated?: boolean;
  confirmCost?: boolean;
}

/** Start an auto-annotation run for a dataset. This is state-changing,
 * billable, and gated by `confirm_cost`.
 *
 * Resolves the dataset by pure string parsing, resolves `model` (plus an
 * optional `project` ref for a bare slug) into an owner/project/model
 * triple, and formats it into the `ul://owner/project/model` URI the
 * server's `modelId` field requires — it is not a slug passthrough. A
 * missing dataset or model owner is filled from the account summary; the
 * client caches that lookup, so supplying both bare defaults to one network
 * call, not two.
 *
 * The request body sends only the five documented parameters
 * (`modelId`, `confidence`, `iou`, `classMapping`, `includeAnnotated`),
 * omitting any the caller left unset so the server's own defaults apply —
 * `confidence` (0.25) and `iou` (0.7) are never mirrored locally, which
 * would silently override a server-side retune. `classMapping` passes
 * through with no length check; a 1-class model against an 80-class dataset
 * needs one to bridge the mismatch, but an over-length array is accepted by
 * the server regardless.
 *
 * Every start snapshots a dataset version before labelling begins,
 * regardless of outcome; `datasets_get` lists the versions and
 * `dataset_version_restore` is the verified exact undo. Labels are
 * additive — the platform never overwrites an existing annotation — so no
 * `confirm_label_overwrite` gate exists. Billing settles at run time, not
 * at dismissal or on stop: this call, not `auto_annotate_stop`, is the
 * unrecoverable one.
 */
export async function autoAnnotateStart(
  client: UltralyticsClient,
  dataset: string,
  model: string,
  options: AutoAnnotateStartOptions = {},
): Promise<NormalizedToolResult> {
  const {
    project,
    confidence,
    iou,
    classMapping,
    includeAnnotated,
    confirmCost = false,
  } = options;
  if (!confirmCost) {
    throw new Error(
      "Set confirm_cost=true to start an auto-annotation run. It is billable " +
        "immediately with no published rate; a 402 signals insufficient " +
        "credits. Gauge magnitude with datasets_get (the unlabeled image " +
        "count by default, the total count when includeAnnotated is true). " +
        "Billing settles at run time, not at dismissal, so stopping a run " +
        "does not refund a charge already incurred.",
    );
  }

  const resolvedDataset = resolveDataset(dataset);
  const resolvedModel = resolveModel(model, project);
  const datasetOwner =
    resolvedDataset.owner ?? (await client.getAccountOwner());
  const modelOwner = resolvedModel.owner ?? (await client.getAccountOwner());
  const modelId = `ul://${modelOwner}/${resolvedModel.project}/${resolvedModel.model}`;

  const payload: Record<string, unknown> = { modelId };
  if (confidence !== undefined) {
    payload.confidence = confidence;
  }
  if (iou !== undefined) {
    payload.iou = iou;
  }
  if (classMapping !== undefined) {
    payload.classMapping = classMapping;
  }
  if (includeAnnotated !== undefined) {
    payload.includeAnnotated = includeAnnotated;
  }

  const data = await client.postJson(
    predictBatchPath(datasetOwner, resolvedDataset.dataset),
    payload,
  );
  const record = asRecord(data);
  const jobId = record.jobId ?? null;
  return {
    summary:
      `Started auto-annotation run '${pyField(jobId)}' on dataset ` +
      `'${resolvedDataset.dataset}' for owner '${datasetOwner}' with model '${modelId}'.`,
    data: { jobId },
  };
}

/** Stop or dismiss a dataset's auto-annotation run. Ships ungated — an
 * off-switch is never gated — but reads status first and refuses to send
 * `DELETE` when no run is active.
 *
 * Resolves the dataset by pure string parsing, fills a missing owner from
 * the account summary, and reads `GET` on the same predict/batch endpoint
 * `auto_annotate_status` uses. When `activeJob` is null there is nothing to
 * stop and the tool refuses without issuing the `DELETE`: an undismissed
 * terminal run does not block the next start, so there is no deadlock to
 * break here, and dismissal moves no money. When `activeJob` is present the
 * `DELETE` is sent and the server's own `action` field
 * (`"cancelled"` or `"dismissed"`; `"none"` when nothing acted on) is
 * surfaced verbatim rather than inferred, since the verb is overloaded and
 * the response already names which branch fired.
 */
export async function autoAnnotateStop(
  client: UltralyticsClient,
  dataset: string,
): Promise<NormalizedToolResult> {
  const resolved = resolveDataset(dataset);
  const resolvedOwner = resolved.owner ?? (await client.getAccountOwner());
  const path = predictBatchPath(resolvedOwner, resolved.dataset);

  const statusRecord = asRecord(await client.get(path));
  if (statusRecord.activeJob === null || statusRecord.activeJob === undefined) {
    throw new Error(
      `Dataset '${resolved.dataset}' for owner '${resolvedOwner}' has no active ` +
        "auto-annotation run to stop.",
    );
  }

  const data = await client.delete(path);
  const record = asRecord(data);
  const action = record.action ?? null;
  const jobId = record.jobId ?? null;
  return {
    summary: `Dataset '${resolved.dataset}' for owner '${resolvedOwner}': ${pyField(action)}.`,
    data: { owner: resolvedOwner, dataset: resolved.dataset, action, jobId },
  };
}
