/**
 * Sending, and the send log.
 *
 * D-001: send is never blocked by an outcome. Because of that, the send log is the only record
 * of what went out and when — which makes the log the part these tests are really about.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, type Finding, type ScreeningReport } from '@mintro/engine';
import {
  createDryRunMailer,
  createMemorySendLog,
  sendReport,
  type Mailer,
} from '../src/send.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

function reportWith(fails: number): ScreeningReport {
  const findings: Finding[] = ruleset.rules
    .filter((rule) => rule.tier === 'auto_fail')
    .slice(0, fails)
    .map((rule) => ({
      ruleId: rule.id,
      state: 'fail' as const,
      note: 'Observed on the rendered page.',
      evidenceKind: 'document' as const,
      evidence: [],
    }));

  return assembleReport(
    {
      runId: 'run-abc',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      findings,
      politeness: 'no Crawl-delay declared',
    },
    ruleset,
  );
}

const request = (report: ScreeningReport) => ({
  report,
  pdf: Buffer.from('%PDF-1.4 fixture'),
  to: 'underwriting@iqwallet.com',
  from: 'reports@mintro.com',
  note: 'Captures attached.',
  sentBy: 'analyst@mintro.com',
});

describe('send is never blocked by the outcome (D-001)', () => {
  it.each([0, 1, 16])('sends a report with %i failures', async (fails) => {
    const mailer = createDryRunMailer();
    const log = createMemorySendLog();

    const entry = await sendReport(mailer, log, request(reportWith(fails)));

    expect(entry.outcome).toBe('accepted');
    expect(mailer.outbox).toHaveLength(1);
  });

  it('has no code path that inspects the fail count before sending', async () => {
    // Two reports at opposite extremes must produce identical send behaviour.
    const clean = createDryRunMailer();
    const failing = createDryRunMailer();
    await sendReport(clean, createMemorySendLog(), request(reportWith(0)));
    await sendReport(failing, createMemorySendLog(), request(reportWith(16)));

    expect(clean.outbox).toHaveLength(1);
    expect(failing.outbox).toHaveLength(1);
  });
});

describe('the send log', () => {
  it('records the fields the sends table needs', async () => {
    const log = createMemorySendLog();
    const entry = await sendReport(createDryRunMailer(), log, request(reportWith(2)));

    // docs/ARCHITECTURE.md § Data model: run_id, to_email, resend_id, sent_at, sent_by.
    expect(entry.runId).toBe('run-abc');
    expect(entry.toEmail).toBe('underwriting@iqwallet.com');
    expect(entry.resendId).not.toBeNull();
    expect(entry.sentBy).toBe('analyst@mintro.com');
    expect(entry.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await log.all()).toHaveLength(1);
  });

  /**
   * A log that only recorded successes would answer the easy half of the question. "We tried to
   * send and the provider refused" is precisely the fact a dispute turns on.
   */
  it('records a rejection as well as an acceptance', async () => {
    const rejecting: Mailer = {
      description: 'always rejects',
      send: async () => ({ resendId: null, accepted: false, error: '422 domain not verified' }),
    };
    const log = createMemorySendLog();

    const entry = await sendReport(rejecting, log, request(reportWith(1)));

    expect(entry.outcome).toBe('rejected');
    expect(entry.error).toContain('domain not verified');
    expect(await log.all()).toHaveLength(1);
  });

  it('records the attachment size, so a truncated PDF is visible after the fact', async () => {
    const entry = await sendReport(createDryRunMailer(), createMemorySendLog(), request(reportWith(1)));
    expect(entry.attachmentBytes).toBe(16);
  });

  it('records every send, not just the first', async () => {
    const log = createMemorySendLog();
    await sendReport(createDryRunMailer(), log, request(reportWith(1)));
    await sendReport(createDryRunMailer(), log, { ...request(reportWith(1)), to: 'second@iqwallet.com' });

    expect((await log.all()).map((row) => row.toEmail)).toEqual([
      'underwriting@iqwallet.com',
      'second@iqwallet.com',
    ]);
  });
});

describe('the dry-run mailer', () => {
  it('says plainly that nothing was transmitted', () => {
    // A distinct implementation rather than a flag, so a test send cannot be mistaken for a
    // delivered report. Its description goes into the run record.
    expect(createDryRunMailer().description).toContain('not transmitted');
  });

  it('composes the message it would have sent', async () => {
    const mailer = createDryRunMailer();
    await sendReport(mailer, createMemorySendLog(), request(reportWith(3)));

    expect(mailer.outbox[0]?.pdf.byteLength).toBeGreaterThan(0);
    expect(mailer.outbox[0]?.to).toBe('underwriting@iqwallet.com');
  });
});

describe('the analyst note audit (D-029)', () => {
  const flagged = (note: string) => ({ ...request(reportWith(1)), note });

  it('warns but never blocks: a directive note still sends', async () => {
    // D-001: we surface, we do not gate. A screener that refused to send would be making the
    // determination it exists to avoid making.
    const mailer = createDryRunMailer();
    const entry = await sendReport(mailer, createMemorySendLog(), flagged('Recommend declining this merchant.'));

    expect(entry.outcome).toBe('accepted');
    expect(mailer.outbox).toHaveLength(1);
  });

  it('records what was flagged, so the log shows a directive note went anyway', async () => {
    const entry = await sendReport(
      createDryRunMailer(),
      createMemorySendLog(),
      flagged('Recommend declining. You should not approve this.'),
    );

    expect(entry.noteFlagged).toContain('recommend');
    expect(entry.noteFlagged).toContain('should');
  });

  it('records the note verbatim, since it is the part a recipient reads first', async () => {
    const entry = await sendReport(createDryRunMailer(), createMemorySendLog(), flagged('Recommend declining.'));
    expect(entry.note).toBe('Recommend declining.');
  });

  it('records whether the analyst was shown the warning and proceeded', async () => {
    const acknowledged = await sendReport(createDryRunMailer(), createMemorySendLog(), {
      ...flagged('Recommend declining.'),
      noteWarningAcknowledged: true,
    });
    expect(acknowledged.noteWarningAcknowledged).toBe(true);

    // A send that never passed through the modal still produces a truthful record: the terms
    // are flagged, and the acknowledgement is false because nobody saw a warning.
    const scripted = await sendReport(createDryRunMailer(), createMemorySendLog(), flagged('Recommend declining.'));
    expect(scripted.noteFlagged.length).toBeGreaterThan(0);
    expect(scripted.noteWarningAcknowledged).toBe(false);
  });

  it('leaves a clean note unflagged', async () => {
    const entry = await sendReport(
      createDryRunMailer(),
      createMemorySendLog(),
      flagged('4 failed, 18 for review. Captures attached.'),
    );

    expect(entry.noteFlagged).toEqual([]);
    expect(entry.noteWarningAcknowledged).toBe(false);
  });

  it('audits at send time, not only at compose time', async () => {
    // The modal is one caller. A scripted send or a future API is another, and the record has to
    // be honest either way.
    const entry = await sendReport(createDryRunMailer(), createMemorySendLog(), flagged('We suggest rejecting.'));
    expect(entry.noteFlagged).toContain('we suggest');
  });
});
