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
import { renderDocumentsReportPdf } from './documentsPdf.js';
import { documentsMailerFor, sendDocumentsReport } from './documentsSend.js';
import { assertRunIsCurrent, packageDigest, StaleRunError, type DigestInput } from './documentsReportGate.js';

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

  return {
    id: String(claimed['id']),
    packageId: String(claimed['package_id']),
    runId: String(claimed['run_id']),
    toEmail: String(claimed['to_email']),
    requestedBy: String(claimed['requested_by']),
  };
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
  readonly merchantName: string;
  readonly dba: string | null;
  readonly processor: string;
}

export async function runSend(request: ClaimedSend, deps: RunSendDeps): Promise<void> {
  const { client } = deps;
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
      .select('id, package_id, run_at, ruleset_version, engine_version, slots, documents, package_digest')
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

    const findings = await store.findingsOf(request.runId);
    const previousRuns = await store.runsOf(request.packageId);
    const sends = await store.sendsOf(request.packageId);
    const lastSentRunId = sends.length === 0 ? null : sends[sends.length - 1]!.run_id;

    const record = {
      id: String(row['id']),
      packageId: String(row['package_id']),
      runAt: String(row['run_at']),
      rulesetVersion: String(row['ruleset_version']),
      engineVersion: String(row['engine_version']),
      slots: (row['slots'] as never) ?? [],
      documents: (row['documents'] as never) ?? [],
      findings: findings.map((f) => ({
        checkId: f.check_id,
        state: f.state as never,
        notEvaluableReason: f.not_evaluable_reason,
        note: f.note,
        subjectKind: f.subject_kind as never,
        slotId: f.slot_id,
        documentVersionId: f.document_version_id,
        tier: f.tier as never,
        readVersionIds: f.read_versions ?? [],
        evidence: f.evidence ?? [],
        evidenceNote: f.evidence_note,
        ordinal: f.ordinal,
      })),
    };

    // The diff is against the last run that was *sent*, not merely the previous run: D-083 answers
    // "what changed since the recipient last saw this", and a run nobody was shown is no baseline.
    let previous;
    if (lastSentRunId !== null && lastSentRunId !== request.runId) {
      const { data: prior } = await client
        .from('document_runs')
        .select('id, package_id, run_at, ruleset_version, engine_version, slots, documents')
        .eq('id', lastSentRunId)
        .maybeSingle();
      if (prior !== null) {
        const priorFindings = await store.findingsOf(lastSentRunId);
        previous = {
          ...record,
          id: String(prior['id']),
          runAt: String(prior['run_at']),
          slots: (prior['slots'] as never) ?? [],
          documents: (prior['documents'] as never) ?? [],
          findings: priorFindings.map((f) => ({
            checkId: f.check_id, state: f.state as never, notEvaluableReason: f.not_evaluable_reason,
            note: f.note, subjectKind: f.subject_kind as never, slotId: f.slot_id,
            documentVersionId: f.document_version_id, tier: f.tier as never,
            readVersionIds: f.read_versions ?? [], evidence: f.evidence ?? [],
            evidenceNote: f.evidence_note, ordinal: f.ordinal,
          })),
        };
      }
    }

    const report = documents.buildDocumentsReport(record, rules, previous);
    const sentBefore = sends.filter((s) => s.outcome === 'accepted');

    const rendered = await renderDocumentsReportPdf(deps.browser, {
      origin: deps.origin,
      inject: {
        report,
        merchantName: deps.merchantName,
        dba: deps.dba,
        packageRef: request.packageId.slice(0, 8),
        processor: deps.processor,
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
      merchantName: deps.merchantName,
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
