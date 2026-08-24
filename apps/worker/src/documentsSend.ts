/**
 * Sending a Documents Check report, and recording that it went.
 *
 * ## Sending is an event, not a state transition (D-083)
 *
 * A sent report never changes. A second send is an ordinary second row, not a forbidden action and
 * not an edit to the first — which is why there is no `update` anywhere here and no column to hold
 * a "current" send. New documents produce a new run and a new report.
 *
 * ## Send is never blocked (D-001)
 *
 * Nothing here consults the fail count. Mintro's role is triage and evidence; the determination is
 * IQwallet's, and a tool that withheld a report on the strength of its own findings would be making
 * one — and creating a record of Mintro deciding what an underwriter does and does not get to see.
 *
 * The one thing that does refuse is the stale-run gate (D-117), and it refuses for the opposite
 * reason: not because of what the report says, but because it would describe a package that no
 * longer exists.
 *
 * ## There is no covering note
 *
 * Site Check's send carries one, audited for directive language. This does not, and the omission is
 * deliberate: D-085 makes the report machine output, the operator types an address and nothing
 * else, and `document_report_sends` has no column for prose. Adding one would need a schema change
 * and a ruling, which is the right amount of friction for putting an analyst's words into a
 * document forwarded under Mintro's name.
 *
 * ## The record is the load-bearing part
 *
 * Because sending is never blocked, this log is the only account of what went out. It is written
 * for a rejection as well as an acceptance (0029) — "we tried and the provider refused" is the fact
 * a dispute turns on, and a log of successes answers the half nobody asks about.
 */

import { createHash } from 'node:crypto';
import type { documents } from '@mintro/engine';
import { postToResend, type SendOutcome } from './send.js';
import { REPORT_CONTACT_LINE } from './contactLine.js';

type DocumentsReport = ReturnType<typeof documents.buildDocumentsReport>;

export interface DocumentsSendRequest {
  readonly report: DocumentsReport;
  /** The rendered report. Taken as an argument: this module composes and sends, it does not print. */
  readonly pdf: Buffer;
  readonly to: string;
  readonly from: string;
  readonly replyTo?: string;
  /** The analyst behind the send. A real `auth.users`-backed id — `analysts.id` is a foreign key. */
  readonly sentByAnalystId: string;
  /** The run this report's diff was computed against, or null for a package's first send. */
  readonly diffAgainstRunId: string | null;
  readonly merchantName: string;
}

export interface DocumentsMailer {
  send(request: DocumentsSendRequest): Promise<SendOutcome>;
  /** Goes into the record, so a dry run is never mistaken for a delivery. */
  readonly description: string;
  /** The `mailer` column's value. Two implementations, never one behind a flag. */
  readonly kind: 'resend' | 'dry_run';
}

export interface DocumentsSendRow {
  readonly runId: string;
  readonly packageId: string;
  readonly recipient: string;
  readonly sentBy: string;
  readonly mailer: 'resend' | 'dry_run';
  readonly providerId: string | null;
  readonly pdfSha256: string;
  readonly pdfBytes: number;
  readonly diffAgainstRunId: string | null;
  readonly outcome: 'accepted' | 'rejected';
  readonly error: string | null;
}

/**
 * Named to match the store that implements it, so `DocumentRunStore` satisfies this structurally
 * rather than through an adapter. Two names for one operation is how a call site ends up wired to
 * the wrong half — which is exactly what happened on the first live run.
 */
export interface DocumentsSendLog {
  recordSend(row: DocumentsSendRow): Promise<void>;
}

/* ---------------------------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------------------------- */

/**
 * The subject line.
 *
 * **It carries no counts**, on the same reasoning Site Check's does not: a subject line that says
 * "3 failed" invites triage from the inbox, and three failures out of ninety-seven evaluable checks
 * is a different fact from three out of five. The subject cannot hold the difference, so it does
 * not try. The cost — an underwriter must open the report to know whether it needs them today — is
 * real and was accepted deliberately.
 */
export function subjectFor(report: DocumentsReport, merchantName: string): string {
  return `Documents check — ${merchantName}`;
}

/**
 * The email body.
 *
 * States what the report contains and nothing about what it means. The two sentences at the end are
 * the ones that must survive any edit: **findings are observations, and nothing here was verified
 * externally** (D-076). An underwriter skimming the email and not the report should still not come
 * away believing the EIN was checked against the IRS.
 */
export function bodyFor(report: DocumentsReport, merchantName: string): string {
  const { counts } = report;
  const unresolved = report.slots.filter(
    (s) => s.state === 'missing' || s.state === 'not_evaluable',
  ).length;

  return [
    `Merchant:  ${merchantName}`,
    `Package:   ${report.packageId}`,
    `Run:       ${report.runId}`,
    `Rule set:  v${report.rulesetVersion}`,
    `Run at:    ${report.runAt}`,
    '',
    `${counts.fail} failed · ${counts.review} for review · ${counts.pass} passed · ${counts.not_evaluable} not evaluable`,
    `${report.slots.length} document slots, ${unresolved} unresolved.`,
    report.diff === null
      ? ''
      : `This report shows what changed since the last one sent (run ${report.diff.againstRunId}).`,
    '',
    'A check reported as not evaluable has established nothing. It is not a pass.',
    report.externalVerification,
    'Findings state what was observed across the documents supplied. They are not compliance determinations.',
    '',
    REPORT_CONTACT_LINE,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Named for the run, not the date: two reports on one day are two runs and two files. */
export function attachmentName(report: DocumentsReport, merchantName: string): string {
  const slug = merchantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'merchant';
  return `${slug}-documents-${report.runId.slice(0, 8)}.pdf`;
}

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/* ---------------------------------------------------------------------------------------------
 * Mailers — two implementations, never one behind a flag
 * ------------------------------------------------------------------------------------------- */

export function createResendDocumentsMailer(apiKey: string): DocumentsMailer {
  return {
    description: 'Resend',
    kind: 'resend',
    async send(request) {
      return postToResend(apiKey, {
        from: request.from,
        to: [request.to],
        subject: subjectFor(request.report, request.merchantName),
        text: bodyFor(request.report, request.merchantName),
        attachments: [
          {
            filename: attachmentName(request.report, request.merchantName),
            content: request.pdf.toString('base64'),
          },
        ],
        ...(request.replyTo === undefined ? {} : { reply_to: [request.replyTo] }),
      });
    },
  };
}

/**
 * Composes everything and posts nothing.
 *
 * A distinct implementation rather than a flag, so a test send cannot be mistaken for a delivered
 * report: `kind` is written to the row, and the two are different values in the database.
 */
export function createDryRunDocumentsMailer(): DocumentsMailer & {
  readonly outbox: readonly DocumentsSendRequest[];
} {
  const outbox: DocumentsSendRequest[] = [];
  return {
    description: 'dry run — composed but not transmitted',
    kind: 'dry_run',
    outbox,
    async send(request) {
      outbox.push(request);
      return { resendId: null, accepted: true };
    },
  };
}

/** One place chooses, so verifying the domain turns every sender on together (D-063). */
export function documentsMailerFor(env: NodeJS.ProcessEnv = process.env): DocumentsMailer {
  const apiKey = env['RESEND_API_KEY'];
  return apiKey === undefined || apiKey === ''
    ? createDryRunDocumentsMailer()
    : createResendDocumentsMailer(apiKey);
}

/* ---------------------------------------------------------------------------------------------
 * The send
 * ------------------------------------------------------------------------------------------- */

export class DocumentsSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentsSendError';
  }
}

/**
 * Send a report, and record the send whatever the outcome.
 *
 * **Exactly one row, always.** Not zero on a rejection, and not two on a retry inside this
 * function — there are no retries here, because a resend is an operator's decision and a second row
 * is what it should produce. The report is untouched: nothing in this function writes to
 * `document_runs` or `document_findings`, and the triggers would refuse it if it tried.
 */
export async function sendDocumentsReport(
  mailer: DocumentsMailer,
  log: DocumentsSendLog,
  request: DocumentsSendRequest,
): Promise<DocumentsSendRow> {
  if (request.pdf.byteLength === 0) {
    // Refused before sending rather than recorded as a send: an email with an empty attachment is
    // a report that arrived and says nothing, which is worse than one that plainly did not arrive.
    throw new DocumentsSendError('the rendered report is empty — nothing was sent');
  }

  const outcome = await mailer.send(request);

  const row: DocumentsSendRow = {
    runId: request.report.runId,
    packageId: request.report.packageId,
    recipient: request.to,
    sentBy: request.sentByAnalystId,
    mailer: mailer.kind,
    providerId: outcome.resendId,
    // The hash of what was actually attached. The report is regenerable from the run, so this is
    // what proves a regenerated document is the one that went out.
    pdfSha256: sha256(request.pdf),
    pdfBytes: request.pdf.byteLength,
    diffAgainstRunId: request.diffAgainstRunId,
    outcome: outcome.accepted ? 'accepted' : 'rejected',
    error: outcome.accepted ? null : outcome.error ?? 'the provider rejected the send',
  };

  await log.recordSend(row);
  return row;
}
