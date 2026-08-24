/**
 * Sending a report to IQwallet, and recording that it went.
 *
 * **Send is never blocked** (D-001). There is no confirmation interstitial, no supervisor
 * override, and nothing here consults the fail count before sending. Mintro's role is triage and
 * evidence; the determination is IQwallet's, and a tool that withheld a report would be making
 * one — and creating a record of Mintro deciding what IQwallet does and does not get to see,
 * which is the wrong artifact to hold in a dispute.
 *
 * Because sending is never blocked, **the send log is the only record of what went out and
 * when.** That makes it the load-bearing part of this module, not the email.
 */

import { auditAnalystNote, type ScreeningReport } from '@mintro/engine';
import { REPORT_CONTACT_LINE } from './contactLine.js';

/** A row in the `sends` table (docs/ARCHITECTURE.md § Data model). */
export interface SendRecord {
  readonly runId: string;
  readonly toEmail: string;
  /** Resend's message id. Null when the provider did not accept it. */
  readonly resendId: string | null;
  /** UTC, ISO 8601. */
  readonly sentAt: string;
  /** Who triggered the send, as an address. */
  readonly sentBy: string;
  /** Their analyst id, when the send came from the queue rather than a script. */
  readonly sentById?: string;
  /**
   * The mailer implementation that handled this attempt.
   *
   * Real and dry-run are separate implementations rather than one behind a flag, so a test send
   * cannot be mistaken for a delivered report (M5). That distinction is worth nothing if the
   * record does not carry it — this is where it is carried.
   */
  readonly mailer: string;
  readonly merchantDomain: string;
  /** Whether the provider accepted it, and why not when it did not. */
  readonly outcome: 'accepted' | 'rejected';
  readonly error?: string;
  readonly attachmentBytes: number;
  /**
   * The analyst's covering note, as sent.
   *
   * It is the part of the email a recipient reads first and the only text Mintro does not
   * generate, so the record of what went out has to include it verbatim.
   */
  readonly note: string;
  /**
   * Directive language found in the note at compose time (D-029). Empty when it was clean.
   *
   * Recorded whether or not the analyst changed the note, so the log shows a flagged note was
   * sent anyway rather than leaving that invisible.
   */
  readonly noteFlagged: readonly string[];
  /** True when the analyst was shown the warning and chose to send regardless. */
  readonly noteWarningAcknowledged: boolean;
}

export interface SendLog {
  record(entry: SendRecord): Promise<void>;
  all(): Promise<readonly SendRecord[]>;
}

/** In-memory log, for the harness. Production writes to the `sends` table in Postgres. */
export function createMemorySendLog(): SendLog {
  const rows: SendRecord[] = [];
  return {
    record: async (entry) => void rows.push(entry),
    all: async () => rows,
  };
}

export interface SendRequest {
  readonly report: ScreeningReport;
  readonly pdf: Buffer;
  readonly to: string;
  readonly from: string;
  /**
   * Where a reply lands. Never a no-reply address — `addressesFor` refuses one.
   *
   * An underwriter reading a finding may reasonably reply asking what a capture shows or how a
   * rule was scoped. A report that arrives from an address which discards replies invites them to
   * guess instead, which is the opposite of what an evidence-backed document is for.
   */
  readonly replyTo?: string;
  readonly note: string;
  readonly sentBy: string;
  /** The analyst id behind `sentBy`, when there is one. */
  readonly sentById?: string;
  /**
   * Set when the analyst was shown a directive-language warning and sent anyway (D-029).
   *
   * The audit runs here regardless — this records whether a human saw it. A caller that never
   * warned still produces a truthful record: flagged terms present, acknowledgement false.
   */
  readonly noteWarningAcknowledged?: boolean;
}

export interface SendOutcome {
  readonly resendId: string | null;
  readonly accepted: boolean;
  readonly error?: string;
}

export interface Mailer {
  send(request: SendRequest): Promise<SendOutcome>;
  /** What this mailer is, shown in the run record so a test send is never mistaken for a real one. */
  readonly description: string;
}

/* -------------------------------------------------------------------------------------------
 * Resend
 * ----------------------------------------------------------------------------------------- */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The Resend POST, in one place.
 *
 * Three callers now compose different payloads — the Site Check report with its attachment, a
 * plain message, and the Documents Check report — and all three want the same transport: accept a
 * 2xx, turn anything else into a recorded rejection rather than a throw, and never let a network
 * error escape as an exception. A second copy of that is the shape D-034 warns about, where a fix
 * lands in one and not the other.
 *
 * It returns an outcome rather than throwing, because a refused send is a fact the log has to
 * carry, not an exception the caller may or may not catch.
 */
export async function postToResend(apiKey: string, payload: Record<string, unknown>): Promise<SendOutcome> {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { resendId: null, accepted: false, error: `${response.status} ${detail.slice(0, 200)}` };
    }

    const body = (await response.json()) as { id?: string };
    return { resendId: body.id ?? null, accepted: true };
  } catch (error) {
    return {
      resendId: null,
      accepted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


export function createResendMailer(apiKey: string): Mailer {
  return {
    description: 'Resend',
    async send(request) {
      return postToResend(apiKey, {
        from: request.from,
        to: [request.to],
        subject: subjectFor(request.report),
        text: bodyFor(request.report, request.note),
        attachments: [
          { filename: attachmentName(request.report), content: request.pdf.toString('base64') },
        ],
        ...(request.replyTo === undefined ? {} : { reply_to: [request.replyTo] }),
      });
    },
  };
}

/**
 * A mailer that composes everything and posts nothing.
 *
 * Used until the sending domain is verified. It is a distinct implementation rather than a flag
 * on the real one, so a test send cannot be mistaken for a delivered report: its `description`
 * says what it is, and that string goes into the run record.
 */
export function createDryRunMailer(): Mailer & { readonly outbox: readonly SendRequest[] } {
  const outbox: SendRequest[] = [];
  return {
    description: 'dry run — composed but not transmitted (no verified sending domain yet)',
    outbox,
    async send(request) {
      outbox.push(request);
      return { resendId: `dryrun_${request.report.runId.slice(0, 8)}`, accepted: true };
    },
  };
}

/* -------------------------------------------------------------------------------------------
 * Composition and the log
 * ----------------------------------------------------------------------------------------- */

/**
 * Sends, and records the send whatever the outcome.
 *
 * The log entry is written for a rejection as well as an acceptance. "We tried to send and the
 * provider refused it" is exactly the fact a dispute would turn on, and a log that only recorded
 * successes would answer the easy half of the question.
 */
export async function sendReport(
  mailer: Mailer,
  log: SendLog,
  request: SendRequest,
): Promise<SendRecord> {
  // Audited at send time, not only at compose time. A note that reached here without passing
  // through the modal — a scripted send, a future API — is still recorded honestly.
  const noteAudit = auditAnalystNote(request.note);

  // D-029 and D-001 together: we surface, we do not gate. Nothing below consults `noteAudit`
  // before sending.
  const outcome = await mailer.send(request);

  const entry: SendRecord = {
    runId: request.report.runId,
    toEmail: request.to,
    resendId: outcome.resendId,
    sentAt: new Date().toISOString(),
    sentBy: request.sentBy,
    ...(request.sentById === undefined ? {} : { sentById: request.sentById }),
    mailer: mailer.description,
    merchantDomain: request.report.merchantDomain,
    outcome: outcome.accepted ? 'accepted' : 'rejected',
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    attachmentBytes: request.pdf.byteLength,
    note: request.note,
    noteFlagged: noteAudit.flagged,
    noteWarningAcknowledged: request.noteWarningAcknowledged ?? false,
  };

  await log.record(entry);
  return entry;
}

/**
 * Subject and body.
 *
 * Descriptive, never directive (D-001). They state counts and coverage as facts. They do not
 * recommend, advise, characterise the merchant, or tell the recipient what to do with the
 * report — the same discipline the verdict banner follows, applied to the covering email, which
 * is the part most likely to slip back into a recommendation.
 */
/**
 * The subject line: the domain, and nothing more (D-064).
 *
 * It used to carry the counts. **Counts in a subject line are a characterisation of the merchant
 * travelling in the most-forwarded, least-contextual part of the message** — a phone notification,
 * a thread title in someone else's inbox, a forward with no body in view. "3 failed" seen there is
 * a verdict, which is IQwallet's to reach and not Mintro's to broadcast.
 *
 * The body carries the same counts with the coverage line beside them, which is where a reader can
 * weigh them: three failures out of ninety-seven evaluable findings is a different fact from three
 * out of five, and the subject line cannot hold the difference.
 *
 * **The cost, recorded honestly so nobody re-adds it without knowing what it was traded for**: an
 * underwriter loses inbox-level triage. They must open the report to see whether it needs them
 * today. That is a real loss and it was accepted deliberately.
 */
export function subjectFor(report: ScreeningReport): string {
  return `Screening report — ${report.merchantDomain}`;
}

export function bodyFor(report: ScreeningReport, note: string): string {
  const { counts, coverage } = report;

  return [
    note.trim(),
    '',
    `Merchant:  ${report.merchantDomain}`,
    `Run:       ${report.runId}`,
    `Rule set:  v${report.rulesetVersion}, effective ${report.rulesetEffective}`,
    `Completed: ${report.finishedAt}`,
    '',
    `${counts.fail} failed · ${counts.review} for review · ${counts.pass} passed · ${counts.not_evaluable} not evaluable`,
    `${coverage.evaluable} of ${coverage.total} findings were evaluable from this crawl.`,
    coverage.notReachable > 0
      ? `${coverage.notReachable} require a surface no crawl reaches and are reported as not evaluable.`
      : '',
    '',
    'The attached report carries a capture behind every finding.',
    'Findings state what was observed. They are not compliance determinations.',
    '',
    // D-065, extended to this audience on Frank's ruling. IQwallet knowing who Mintro is removes
    // the need to verify the sender, not the need to reach a person: an underwriter with a question
    // about a capture is mid-decision on a merchant, and the reply-to here is a no-reply address.
    REPORT_CONTACT_LINE,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function attachmentName(report: ScreeningReport): string {
  return `${report.merchantDomain}-${report.finishedAt.slice(0, 10)}.pdf`;
}

/* -------------------------------------------------------------------------------------------
 * Plain messages
 *
 * The report send carries a PDF and is shaped around a `ScreeningReport`. The merchant invitation
 * (D-063) is a plain message with a link in it, and it must reach Resend through the **same gate**:
 * the moment `RESEND_API_KEY` is set, both sends work with no further code.
 * ----------------------------------------------------------------------------------------- */

export interface Message {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
}

export interface Messenger {
  send(message: Message): Promise<SendOutcome>;
  /** What this messenger is. Goes into the record, so a dry run is never mistaken for a delivery. */
  readonly description: string;
}

export function createResendMessenger(apiKey: string): Messenger {
  return {
    description: 'Resend',
    async send(message) {
      return postToResend(apiKey, {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo === undefined ? {} : { reply_to: [message.replyTo] }),
      });
    },
  };
}

/** Composes and posts nothing. A distinct implementation, for the reason `createDryRunMailer` is. */
export function createDryRunMessenger(): Messenger & { readonly outbox: readonly Message[] } {
  const outbox: Message[] = [];
  return {
    description: 'dry run — composed but not transmitted (no verified sending domain yet)',
    outbox,
    async send(message) {
      outbox.push(message);
      return { resendId: null, accepted: true };
    },
  };
}

/**
 * The one place either sender is chosen (D-063).
 *
 * Both the report send and the merchant invitation route through this, so verifying the domain and
 * setting `RESEND_API_KEY` turns both on together. Two call sites each reading the environment is
 * how one of them ends up still dry-running after the gate lifts — the same argument D-034 makes
 * about a rule expressed in two places.
 */
export function mailersFor(env: NodeJS.ProcessEnv = process.env): {
  readonly mailer: Mailer;
  readonly messenger: Messenger;
  readonly live: boolean;
} {
  const apiKey = env['RESEND_API_KEY'];
  const live = apiKey !== undefined && apiKey !== '';

  return {
    mailer: live ? createResendMailer(apiKey) : createDryRunMailer(),
    messenger: live ? createResendMessenger(apiKey) : createDryRunMessenger(),
    live,
  };
}
