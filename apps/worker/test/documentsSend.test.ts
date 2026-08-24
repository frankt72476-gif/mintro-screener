/**
 * Sending a Documents Check report.
 *
 * The property that matters most here is the one that is easiest to get wrong quietly: **exactly
 * one row, always** — including when the provider refuses. A log that records only successes
 * answers the half of the question nobody asks, and it looks perfectly healthy while doing it.
 *
 * Nothing here renders a PDF. Bytes come in as an argument, which is what lets this be built and
 * tested before the report route exists.
 */

import { describe, expect, it, vi } from 'vitest';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import {
  attachmentName,
  bodyFor,
  createDryRunDocumentsMailer,
  createResendDocumentsMailer,
  documentsMailerFor,
  sendDocumentsReport,
  sha256,
  subjectFor,
  DocumentsSendError,
  type DocumentsMailer,
  type DocumentsSendLog,
  type DocumentsSendRow,
} from '../src/documentsSend.js';

const RULES = loadDocumentsRules();

const report = documents.buildDocumentsReport(
  {
    id: 'run-abcdef12',
    packageId: 'pkg-1',
    runAt: '2026-05-15T00:00:00.000Z',
    rulesetVersion: '1.0.0',
    engineVersion: '0.1.0',
    slots: [
      { slotId: 's1', slotKey: 'application', instanceLabel: null, state: 'satisfied', reason: null, requiredCount: 1, examined: true },
      { slotId: 's2', slotKey: 'bank_statement', instanceLabel: null, state: 'missing', reason: null, requiredCount: 3, examined: true },
    ],
    documents: [
      { versionId: 'ver-1', slotId: 's1', slotKey: 'application', filename: 'app.pdf', outcome: 'extracted', tier: 'character' },
    ],
    findings: [
      { checkId: 'A-01', state: 'pass', notEvaluableReason: null, note: 'app.pdf was read.', subjectKind: 'document', slotId: null, documentVersionId: 'ver-1', tier: 'character', readVersionIds: ['ver-1'], ordinal: 0 },
      { checkId: 'B-01', state: 'fail', notEvaluableReason: null, note: 'bank_statement is unresolved: missing.', subjectKind: 'slot', slotId: 's2', documentVersionId: null, tier: null, readVersionIds: [], ordinal: 1 },
      { checkId: 'C-03', state: 'not_evaluable', notEvaluableReason: 'fewer_than_two_sources', note: 'nothing to compare.', subjectKind: 'package', slotId: null, documentVersionId: null, tier: null, readVersionIds: [], ordinal: 2 },
    ],
  },
  RULES,
);

const PDF = Buffer.from('%PDF-1.7 a rendered report');

function memoryLog(): DocumentsSendLog & { rows: DocumentsSendRow[] } {
  const rows: DocumentsSendRow[] = [];
  return { rows, recordSend: async (row) => void rows.push(row) };
}

const request = (over: Partial<Parameters<typeof sendDocumentsReport>[2]> = {}) => ({
  report,
  pdf: PDF,
  to: 'underwriting@iqwallet.com',
  from: 'reports@gomintro.com',
  sentByAnalystId: 'analyst-1',
  diffAgainstRunId: null,
  merchantName: 'Northwind Peptides LLC',
  ...over,
});

// --- the record ------------------------------------------------------------------------------

describe('a send writes exactly one row', () => {
  it('records an accepted send', async () => {
    const log = memoryLog();
    const mailer = createDryRunDocumentsMailer();
    const row = await sendDocumentsReport(mailer, log, request());

    expect(log.rows).toHaveLength(1);
    expect(row.outcome).toBe('accepted');
    expect(row.error).toBeNull();
    expect(row.runId).toBe('run-abcdef12');
    expect(row.recipient).toBe('underwriting@iqwallet.com');
  });

  /**
   * The case a log of successes would miss entirely. "We tried to send this to the underwriter and
   * the provider refused it" is the fact a dispute turns on.
   */
  it('records a rejected send, with the reason', async () => {
    const refusing: DocumentsMailer = {
      description: 'refuses',
      kind: 'resend',
      send: async () => ({ resendId: null, accepted: false, error: '422 domain not verified' }),
    };
    const log = memoryLog();
    const row = await sendDocumentsReport(refusing, log, request());

    expect(log.rows).toHaveLength(1);
    expect(row.outcome).toBe('rejected');
    expect(row.error).toBe('422 domain not verified');
  });

  it('records a rejection even when the provider gave no reason', async () => {
    const silent: DocumentsMailer = {
      description: 'refuses silently',
      kind: 'resend',
      send: async () => ({ resendId: null, accepted: false }),
    };
    const row = await sendDocumentsReport(silent, memoryLog(), request());
    // Never null on a rejection: the schema's `error_belongs_to_a_rejection` would refuse the row,
    // and a rejection with no reason recorded says something went wrong and declines to say what.
    expect(row.error).toBe('the provider rejected the send');
  });

  it('carries the hash and size of the bytes that were actually sent', async () => {
    const row = await sendDocumentsReport(createDryRunDocumentsMailer(), memoryLog(), request());
    expect(row.pdfSha256).toBe(sha256(PDF));
    expect(row.pdfBytes).toBe(PDF.byteLength);
  });

  it('refuses an empty attachment rather than recording a send of nothing', async () => {
    const log = memoryLog();
    await expect(
      sendDocumentsReport(createDryRunDocumentsMailer(), log, request({ pdf: Buffer.alloc(0) })),
    ).rejects.toBeInstanceOf(DocumentsSendError);
    // Nothing was sent, so nothing is recorded — the row would claim a report went out.
    expect(log.rows).toHaveLength(0);
  });
});

describe('sending does not mutate the report (D-083)', () => {
  it('leaves the report byte-identical', async () => {
    const before = JSON.stringify(report);
    await sendDocumentsReport(createDryRunDocumentsMailer(), memoryLog(), request());
    expect(JSON.stringify(report)).toBe(before);
  });

  /**
   * A second send is ordinary. Not forbidden, and not an edit to the first — which is what
   * "sending is an event, not a state transition" means in practice.
   */
  it('a second send is a second row against the same run', async () => {
    const log = memoryLog();
    const mailer = createDryRunDocumentsMailer();
    await sendDocumentsReport(mailer, log, request());
    await sendDocumentsReport(mailer, log, request({ to: 'second@iqwallet.com' }));

    expect(log.rows).toHaveLength(2);
    expect(log.rows.map((r) => r.runId)).toEqual(['run-abcdef12', 'run-abcdef12']);
    expect(log.rows.map((r) => r.recipient)).toEqual(['underwriting@iqwallet.com', 'second@iqwallet.com']);
  });
});

// --- what goes in the email ---------------------------------------------------------------------

describe('the message says what the report contains and nothing about what it means', () => {
  it('carries no counts in the subject', () => {
    const subject = subjectFor(report, 'Northwind Peptides LLC');
    expect(subject).toBe('Documents check — Northwind Peptides LLC');
    expect(subject).not.toMatch(/\d/);
  });

  it('states that a not_evaluable check established nothing', () => {
    expect(bodyFor(report, 'Northwind Peptides LLC')).toMatch(/established nothing\. It is not a pass\./);
  });

  /** D-076: an underwriter skimming the email must not come away thinking anything was verified. */
  it('carries the no-external-verification line', () => {
    const body = bodyFor(report, 'Northwind Peptides LLC');
    expect(body).toContain(RULES.checks.not_checked.external_verification);
    expect(body).toMatch(/not compliance determinations/);
  });

  it('instructs nobody', () => {
    const body = bodyFor(report, 'Northwind Peptides LLC');
    expect(body).not.toMatch(/\byou should\b|\bplease (?:review|approve|decline)\b|\brecommend\b|\bdo not forward\b/i);
  });

  it('names the attachment for the run, so two reports in one day are two files', () => {
    expect(attachmentName(report, 'Northwind Peptides LLC')).toBe('northwind-peptides-llc-documents-run-abcd.pdf');
  });

  it('mentions the diff only when there is one', () => {
    expect(bodyFor(report, 'X')).not.toMatch(/what changed/);
    const withDiff = { ...report, diff: { againstRunId: 'run-earlier', slotsNewlySatisfied: [], findingsResolved: [], findingsAppeared: [] } };
    expect(bodyFor(withDiff, 'X')).toMatch(/what changed since the last one sent \(run run-earlier\)/);
  });
});

// --- the two mailers -----------------------------------------------------------------------------

describe('a dry run is never mistaken for a delivery', () => {
  it('records a different mailer value', async () => {
    const dry = await sendDocumentsReport(createDryRunDocumentsMailer(), memoryLog(), request());
    expect(dry.mailer).toBe('dry_run');
  });

  it('composes the message without transmitting it', async () => {
    const mailer = createDryRunDocumentsMailer();
    await sendDocumentsReport(mailer, memoryLog(), request());
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]?.to).toBe('underwriting@iqwallet.com');
  });

  it('chooses by key presence, in one place', () => {
    expect(documentsMailerFor({}).kind).toBe('dry_run');
    expect(documentsMailerFor({ RESEND_API_KEY: '' }).kind).toBe('dry_run');
    expect(documentsMailerFor({ RESEND_API_KEY: 're_live_x' }).kind).toBe('resend');
  });
});

describe('the Resend mailer posts what it says it posts', () => {
  it('sends the PDF as a base64 attachment and returns the provider id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );
    try {
      const row = await sendDocumentsReport(
        createResendDocumentsMailer('re_test'),
        memoryLog(),
        request(),
      );
      expect(row.outcome).toBe('accepted');
      expect(row.providerId).toBe('msg_123');

      const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
      expect(body.to).toEqual(['underwriting@iqwallet.com']);
      expect(body.attachments[0].content).toBe(PDF.toString('base64'));
      expect(body.attachments[0].filename).toMatch(/\.pdf$/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('turns a provider error into a recorded rejection rather than a throw', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('domain not verified', { status: 422 }),
    );
    try {
      const log = memoryLog();
      const row = await sendDocumentsReport(createResendDocumentsMailer('re_test'), log, request());
      expect(row.outcome).toBe('rejected');
      expect(row.error).toMatch(/422/);
      expect(log.rows).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('turns a network failure into a recorded rejection too', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    try {
      const row = await sendDocumentsReport(createResendDocumentsMailer('re_test'), memoryLog(), request());
      expect(row.outcome).toBe('rejected');
      expect(row.error).toMatch(/ECONNRESET/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
