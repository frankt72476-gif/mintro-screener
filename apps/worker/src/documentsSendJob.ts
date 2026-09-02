/**
 * Draining the Documents Check send queue.
 *
 * Claim a request, check the run is still current, render, send, record. The order matters: **the
 * gate runs before anything is rendered**, so a stale run costs nothing and produces no artifact
 * that could later be mistaken for a report somebody chose not to send.
 *
 * A refusal here is a failed request, not a failed send. `document_report_sends` gets no row when
 * nothing was sent — that log answers "what went out", and a stale-run refusal is not a thing that
 * went out.
 */

import type { Browser } from 'playwright';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { createDocumentRunStore } from './store/documentRunStore.js';
import { refuseIfRevoked } from './capabilityGate.js';
import { renderDocumentsReportPdf } from './documentsPdf.js';
import { documentsMailerFor, sendDocumentsReport } from './documentsSend.js';
import { assertRunIsCurrent, packageDigest, StaleRunError, type DigestInput } from './documentsReportGate.js';
import {
  loadRetentionState, loadRunRecord, toRunRecord, RUN_RECORD_COLUMNS, type RunRow,
} from './documentsRunRecord.js';

export interface ClaimedSend {
  readonly id: string;
  readonly packageId: string;
  readonly runId: string;
  readonly toEmail: string;
  readonly requestedBy: string;
}

/**
 * Take the oldest queued request.
 *
 * Conditional on `status = 'queued'`, so two workers racing produce one claim and one miss rather
 * than two sends of one report.
 */
export async function claimNextSend(client: SupabaseClient): Promise<ClaimedSend | null> {
  const { data: queued } = await client
    .from('document_send_requests')
    .select('id, package_id, run_id, to_email, requested_by')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (queued === null) return null;

  const { data: claimed } = await client
    .from('document_send_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', queued['id'])
    .eq('status', 'queued')
    .select('id, package_id, run_id, to_email, requested_by')
    .maybeSingle();
  if (claimed === null) return null;

  const job = {
    id: String(claimed['id']),
    packageId: String(claimed['package_id']),
    runId: String(claimed['run_id']),
    toEmail: String(claimed['to_email']),
    requestedBy: String(claimed['requested_by']),
  };

  /*
    The fourth gate (D-230). Sending a Documents Check report is Documents Check work, and this
    queue is the one that can outlive a revocation by longest — a render plus a transmission behind
    however many jobs are ahead of it.

    Before the render, not after: the point of refusing is that nothing is produced and nothing is
    transmitted, and a check that ran after the PDF existed would only be deciding whether to
    mention it.
  */
  if (await refuseIfRevoked(client, 'document_send_requests', job, 'can_run_documents_check')) {
    return null;
  }

  return job;
}

/** The package as it stands now, for the gate to compare the run against. */
export async function currentState(client: SupabaseClient, packageId: string): Promise<DigestInput> {
  const { data: slots } = await client
    .from('slots')
    .select('id, state, reason, required_count')
    .eq('package_id', packageId);
  const { data: versions } = await client
    .from('document_versions')
    .select('id, outcome')
    .eq('package_id', packageId);

  return {
    slots: (slots ?? []).map((s) => ({
      slotId: String(s['id']),
      state: String(s['state']),
      reason: (s['reason'] as string | null) ?? null,
      requiredCount: (s['required_count'] as number | null) ?? null,
    })),
    documents: (versions ?? []).map((v) => ({ versionId: String(v['id']), outcome: String(v['outcome']) })),
  };
}

export interface RunSendDeps {
  readonly client: SupabaseClient;
  readonly browser: Browser;
  readonly origin: string;
}

/**
 * Who the package is for, read from the merchant row.
 *
 * **Not a parameter.** It was one, and nothing real supplied it — the live scripts hardcoded a
 * name and the pane showed `processorKey` in its place. A fact carried down two paths is a fact
 * that can differ between them, and the two places it would differ are a report's masthead and the
 * screen the operator read before sending it.
 *
 * `legal_name` with `domain` as the fallback, matching `createPackages` in the frontend: a merchant
 * created from a crawl has a domain before anyone has typed a name, and a masthead reading nothing
 * looks like a rendering fault rather than missing data.
 */
export interface Identity {
  readonly merchantName: string;
  readonly dba: string | null;
  readonly processor: string;
}

/**
 * Since D-126 the send path takes the merchant name off the **run**, not from here. This remains
 * the place a name is resolved when one is being *captured* — at persist time — and it supplies the
 * processor, which is a property of the package rather than of the run.
 */

export async function identityOf(client: SupabaseClient, packageId: string): Promise<Identity> {
  const { data } = await client
    .from('packages')
    .select('processor_key, merchants!inner(legal_name, domain)')
    .eq('id', packageId)
    .single();

  const embedded = (data?.['merchants'] ?? null) as Record<string, unknown> | Record<string, unknown>[] | null;
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  const legal = row === null || row === undefined ? '' : String(row['legal_name'] ?? '');
  const domain = row === null || row === undefined ? '' : String(row['domain'] ?? '');

  return {
    merchantName: legal !== '' ? legal : domain,
    // The trading name is on no merchant column; it is a value extracted from the application, and
    // C-02 is the check that compares it. Sourcing it for the masthead is a separate job from
    // sending, and inventing one here would put a second derivation beside C-02's.
    dba: null,
    processor: String(data?.['processor_key'] ?? 'default'),
  };
}

export async function runSend(request: ClaimedSend, deps: RunSendDeps): Promise<void> {
  const { client } = deps;
  const identity = await identityOf(client, request.packageId);
  const store = createDocumentRunStore(client);
  const rules = loadDocumentsRules();

  const fail = async (error: string): Promise<void> => {
    await client
      .from('document_send_requests')
      .update({ status: 'failed', error, finished_at: new Date().toISOString() })
      .eq('id', request.id);
  };

  try {
    const { data: row } = await client
      .from('document_runs')
      .select(RUN_RECORD_COLUMNS)
      .eq('id', request.runId)
      .single();
    if (row === null) {
      await fail(`run ${request.runId} could not be read`);
      return;
    }

    // Before rendering. A stale run must not produce a PDF at all.
    const runInput: DigestInput = {
      slots: ((row['slots'] as Record<string, unknown>[]) ?? []).map((s) => ({
        slotId: String(s['slotId']),
        state: String(s['state']),
        reason: (s['reason'] as string | null) ?? null,
        requiredCount: (s['requiredCount'] as number | null) ?? null,
      })),
      documents: ((row['documents'] as Record<string, unknown>[]) ?? []).map((d) => ({
        versionId: String(d['versionId']),
        outcome: String(d['outcome']),
      })),
    };
    const stored = String(row['package_digest']);
    try {
      assertRunIsCurrent(request.runId, stored || packageDigest(runInput), runInput, await currentState(client, request.packageId));
    } catch (error) {
      if (error instanceof StaleRunError) {
        await fail(error.message);
        return;
      }
      throw error;
    }

    const previousRuns = await store.runsOf(request.packageId);
    const sends = await store.sendsOf(request.packageId);
    const lastSentRunId = sends.length === 0 ? null : sends[sends.length - 1]!.run_id;

    // One derivation, shared with the export builder (D-125). The row is already in hand from the
    // staleness check above, so only the findings are read here.
    const record = toRunRecord(row as unknown as RunRow, (await store.findingsOf(request.runId)) as never);

    // The diff is against the last run that was *sent*, not merely the previous run: D-083 answers
    // "what changed since the recipient last saw this", and a run nobody was shown is no baseline.
    /*
      The baseline, read as its own run rather than assembled from this one.

      It used to be `{ ...record, id, runAt, slots, documents, findings }`, which carried the
      current run's identity and versions under the previous run's id. Nothing rendered them, so it
      was invisible — and it was a record describing one run while labelled another.
    */
    let previous;
    if (lastSentRunId !== null && lastSentRunId !== request.runId) {
      previous = (await loadRunRecord(client, store, lastSentRunId))?.record;
    }

    /*
      The second input (D-130, P5).

      Resolved here, where the run's other inputs are gathered, so the PDF and the screen cannot
      disagree about whether the bodies are still held. A package that has not been purged resolves
      to `purged: false`, the report carries `retention: null`, and the document is byte-identical
      to one built before this existed.
    */
    const retention = await loadRetentionState(client, request.packageId);
    const report = documents.buildDocumentsReport(record, rules, previous, retention);
    const sentBefore = sends.filter((s) => s.outcome === 'accepted');

    const rendered = await renderDocumentsReportPdf(deps.browser, {
      origin: deps.origin,
      inject: {
        report,
        packageRef: request.packageId.slice(0, 8),
        processor: identity.processor,
        reportNumber: `${sentBefore.length + 1} of ${sentBefore.length + 1}`,
        previousSentAt: sentBefore.length === 0 ? null : sentBefore[sentBefore.length - 1]!.sent_at.slice(0, 10),
      },
    });

    const row2 = await sendDocumentsReport(documentsMailerFor(), store, {
      report,
      pdf: Buffer.from(rendered.bytes),
      to: request.toEmail,
      from: 'reports@gomintro.com',
      sentByAnalystId: request.requestedBy,
      diffAgainstRunId: previous?.id ?? null,
      // The same name the masthead carries, off the run — not a second live read.
      merchantName: record.identity.merchantName,
    });

    const { data: recorded } = await client
      .from('document_report_sends')
      .select('id')
      .eq('run_id', request.runId)
      .eq('pdf_sha256', row2.pdfSha256)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await client
      .from('document_send_requests')
      .update({
        status: 'done',
        send_id: recorded === null ? null : recorded['id'],
        outcome: row2.outcome,
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    void previousRuns;
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}
