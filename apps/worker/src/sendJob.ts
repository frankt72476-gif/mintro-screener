/**
 * Sending a report to IQwallet, as a queued job.
 *
 * "Send to IQwallet" said *not connected*, and that was honest — nothing reached a mailer. It
 * needed the rendered PDF, and the PDF is Playwright printing the report route, which a browser
 * cannot do. So the send becomes a job with the same shape as the other three (D-035).
 *
 * ## The send log is the load-bearing part, not the email
 *
 * **Send is never blocked** (D-001). Nothing here consults the fail count, and a rejection by the
 * provider is recorded exactly as an acceptance is. A log that held only successes would answer
 * the easy half of the question a dispute actually turns on.
 *
 * ## One PDF, stored and attached
 *
 * The job renders once. The bytes go to the attachment and the same bytes go to the evidence
 * bucket, so what an analyst can retrieve later is *the artifact that was sent* rather than a
 * re-render that might differ — the rule set could have moved, and a report is a document about a
 * moment (D-002).
 */

import type { Browser } from 'playwright';
import type { ScreeningReport } from '@mintro/engine';
import { renderRunPdf } from './pdfJob.js';
import { sendReport, type Mailer, type SendLog, type SendRecord } from './send.js';
import type { WorkerSupabase } from './store/supabase.js';

export interface SendJobInput {
  readonly runId: string;
  readonly requestId: string;
  readonly toEmail: string;
  readonly note: string;
  readonly noteWarningAcknowledged: boolean;
  readonly requestedBy: string;
  readonly from: string;
  readonly replyTo: string;
  readonly webRoot: string;
}

export interface SendJobResult {
  readonly record: SendRecord;
  readonly sendId: string;
  readonly storageKey: string;
  readonly pages: number;
}

/**
 * Thrown when the message went and the record did not.
 *
 * A plain error here reads as "the send failed", and the queue would mark the job `failed` — which
 * 0017 defines as *never reached a mailer*. An operator would re-send and IQwallet would receive
 * the report twice. This type exists so the caller can write down which of the two happened.
 */
export class SentButUnrecordedError extends Error {
  readonly transmitted = true;

  constructor(
    message: string,
    readonly resendId: string | null,
  ) {
    super(message);
    this.name = 'SentButUnrecordedError';
  }
}

/**
 * Renders, sends, and records.
 *
 * Throws only for the things that stop the attempt happening at all — a run with no report, a
 * render that broke. **A provider rejection is not one of them**: it returns normally with a
 * record whose outcome is `rejected`, because the attempt was made and the fact of it belongs in
 * the log rather than in an exception.
 */
export async function sendRunReport(
  supabase: WorkerSupabase,
  browser: Browser,
  mailer: Mailer,
  input: SendJobInput,
): Promise<SendJobResult> {
  const rendered = await renderRunPdf(supabase, browser, {
    runId: input.runId,
    requestId: input.requestId,
    webRoot: input.webRoot,
  });

  const report = await loadReport(supabase, input.runId);
  const log = createSupabaseSendLog(supabase);

  const request = {
    report,
    pdf: rendered.pdf,
    to: input.toEmail,
    from: input.from,
    replyTo: input.replyTo,
    note: input.note,
    sentBy: await addressOf(supabase, input.requestedBy),
    sentById: input.requestedBy,
    noteWarningAcknowledged: input.noteWarningAcknowledged,
  };

  let record: SendRecord;
  try {
    record = await sendReport(mailer, log, request);
  } catch (error) {
    /*
      `sendReport` transmits and then records — the provider's message id does not exist until it
      has — so a throw from here may mean the mail went.

      `log.transmitted` is set by the mailer's own answer, before the row is attempted. It is the
      only thing that can tell the two apart, and telling them apart is the difference between
      "re-send this" and "do not, IQwallet already has it".
    */
    if (log.transmitted) {
      throw new SentButUnrecordedError(
        `the report was TRANSMITTED to ${input.toEmail} but could not be recorded: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'Do not re-send without checking: the recipient may already have it.',
        log.resendId,
      );
    }
    throw error;
  }

  const sendId = log.lastId;
  if (sendId === null) {
    // The mail may have gone. Reported rather than guessed at: attaching the queue row to "the
    // newest send" is the substitution D-045 was about, and here it would misattribute a delivery.
    throw new Error(
      'the send was attempted but its log row could not be identified. ' +
        'Check the sends table for this run before re-sending — the mail may already have gone.',
    );
  }

  return { record, sendId, storageKey: rendered.storageKey, pages: rendered.pages };
}

/**
 * The `sends` table as a `SendLog`.
 *
 * Writes for a rejection as readily as for an acceptance — the table's own constraint only asks
 * that an *accepted* row carry a provider id. It also holds the id it wrote, because the queue row
 * has to point at the record and the alternative is looking up the newest.
 */
/**
 * The row this module writes, from a `SendRecord`.
 *
 * Exported so the schema test can compare it against the actual table rather than against a list
 * someone typed into a test file. The first version of that test hardcoded the column names, which
 * meant re-introducing the bug it was written for left it green — a test asserting its own
 * assumptions rather than the code's.
 *
 * There is no `merchant_domain`: `sends` has never had that column, and the domain is reachable
 * through `run_id`. Writing one cost a live send — the message had already gone to Resend when
 * PostgREST refused the row (0018).
 */
export function sendRowFor(entry: SendRecord): Record<string, unknown> {
  return {
    run_id: entry.runId,
    to_email: entry.toEmail,
    resend_id: entry.resendId,
    sent_at: entry.sentAt,
    sent_by: entry.sentById ?? null,
    sent_by_email: entry.sentBy,
    outcome: entry.outcome,
    error: entry.error ?? null,
    attachment_bytes: entry.attachmentBytes,
    note: entry.note,
    note_flagged: entry.noteFlagged,
    note_warning_acknowledged: entry.noteWarningAcknowledged,
    mailer: entry.mailer,
  };
}

export function createSupabaseSendLog(
  supabase: WorkerSupabase,
): SendLog & {
  readonly lastId: string | null;
  /** Whether the provider accepted the message, known before the row is attempted. */
  readonly transmitted: boolean;
  readonly resendId: string | null;
} {
  const state = { lastId: null as string | null, transmitted: false, resendId: null as string | null };

  return {
    get lastId() {
      return state.lastId;
    },
    get transmitted() {
      return state.transmitted;
    },
    get resendId() {
      return state.resendId;
    },

    async record(entry) {
      // Recorded before the write is attempted, because the write is what may fail. This is the
      // only in-memory fact that survives to tell "sent and unrecorded" from "not sent" (0018).
      state.transmitted = entry.outcome === 'accepted';
      state.resendId = entry.resendId;

      const { data, error } = await supabase.client.from('sends').insert(sendRowFor(entry)).select('id');

      if (error !== null) {
        // The mail has already been handed to the provider by the time this runs. Losing the row
        // is the worst outcome in this module, so it is raised rather than swallowed.
        throw new Error(`the send was attempted but could not be recorded: ${error.message}`);
      }

      state.lastId = ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
    },

    async all() {
      const { data, error } = await supabase.client
        .from('sends')
        .select('*')
        .order('sent_at', { ascending: true });

      if (error !== null) throw new Error(`could not read the send log: ${error.message}`);
      return (data ?? []) as unknown as readonly SendRecord[];
    },
  };
}

/**
 * The analyst's address, for the log.
 *
 * A send whose author cannot be named is still recorded — with `unknown` rather than with nothing,
 * and never silently attributed to whoever is convenient. The column is `not null` because a send
 * nobody is attached to is not a record anyone can act on.
 */
async function addressOf(supabase: WorkerSupabase, analystId: string): Promise<string> {
  const { data, error } = await supabase.client
    .from('analysts')
    .select('email')
    .eq('id', analystId)
    .maybeSingle();

  if (error !== null) return `unknown (${analystId})`;
  return (data as { email?: string } | null)?.email ?? `unknown (${analystId})`;
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`could not read run ${runId}: ${error.message}`);
  }

  const report = (data as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    throw new Error(`run ${runId} has no stored report, so there is nothing to send.`);
  }
  return report;
}
