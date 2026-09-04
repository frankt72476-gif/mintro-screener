/**
 * Finding the captured report for a run.
 *
 * This replaces `pdfQueue`. The button used to queue a render and download whatever came back;
 * there is nothing to queue any more, because the report was captured once at assembly and that
 * file is what everyone gets.
 *
 * ## Why the old button had to go
 *
 * A PDF rendered on demand from the live app is a **fresh re-render under whatever bundle is
 * deployed that day**. Its content is frozen — run data is immutable and clauses snapshot onto
 * findings — but its render is not: section headings are constants in the app, components change,
 * the ruleset has been re-based once. So the file an analyst downloaded in March and the file
 * IQwallet was sent in March could differ, look identical in kind, and carry nothing that says
 * which is which. That is not a second artifact; it is an unlabelled counterfeit of the first.
 *
 * One capture, one link, and the analyst opens the same bytes the underwriter did.
 */

import { reportLinkForKey } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CapturedReport {
  /** The link to open, on this origin. Proxied to storage; never a storage URL. */
  readonly url: string;
  readonly capturedAt: string;
  readonly bytes: number;
}

/**
 * The run's most recent capture, or null.
 *
 * **Null is "there is not one", and the caller must not render it as anything else.** A run
 * screened before this shipped has no capture and never will — nothing is back-filled, per D-002 —
 * so the honest thing on screen is that there is no captured report for this run, not a dead
 * control and not a spinner waiting for a job that nobody queued.
 *
 * A read failure is also null, and that is a real limitation of this signature rather than a
 * choice worth defending: the two are different facts. It matches what the surrounding readers do
 * today, and widening it is a change to every caller.
 */
export async function readReportCapture(
  client: SupabaseClient,
  runId: string,
  origin: string,
): Promise<CapturedReport | null> {
  const { data, error } = await client
    .from('report_captures')
    .select('storage_key, captured_at, bytes')
    // Several captures per run is normal: a re-capture mints a new token and writes a new object
    // rather than replacing one that may already have been sent (D-002). The newest is the one to
    // open; the older rows stay because they record what was delivered.
    .order('captured_at', { ascending: false })
    .eq('run_id', runId)
    .limit(1);

  if (error !== null) return null;

  const row = (data ?? [])[0] as
    | { storage_key: string; captured_at: string; bytes: number }
    | undefined;
  if (row === undefined) return null;

  try {
    return {
      url: reportLinkForKey(origin, row.storage_key),
      capturedAt: row.captured_at,
      bytes: row.bytes,
    };
  } catch {
    // A key the link builder refuses. Better no link than one that 404s in front of the person
    // who came to read the report.
    return null;
  }
}
