/**
 * Re-rendering the report that went out, for the export (D-130, P3).
 *
 * `document_report_sends` stores `pdf_sha256` and **never the bytes** — the report is regenerable
 * from the run, so keeping the file was redundant while the app existed. The export is the moment
 * that stops being true: an archive that carries the hash and not the document leaves a reader with
 * a fingerprint and nothing to press it against.
 *
 * So the PDF is produced again here, from the same `RunRecord` the send job used — through
 * `loadRunRecord`, not a second mapping of the same rows (D-125).
 *
 * ## Two things this deliberately does not do
 *
 * **It does not fail on a hash that has moved.** A renderer change since the send moves the bytes,
 * and that is a fact about the renderer rather than a fault in the export. The mismatch is returned
 * and recorded; export time is the last moment anyone can check it at all.
 *
 * **It does not re-run the staleness gate.** `assertRunIsCurrent` refuses to *send* a report from a
 * run the package has moved past (D-117), which is right — a recipient must not receive a document
 * describing a package that no longer exists. This is the opposite situation: the run is historical
 * by definition, and refusing to export it because it is old would leave the sent document
 * unrecoverable precisely when it matters.
 */

import type { Browser } from 'playwright';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { createDocumentRunStore } from '../store/documentRunStore.js';
import { loadRunRecord } from '../documentsRunRecord.js';
import { renderDocumentsReportPdf } from '../documentsPdf.js';
import { identityOf } from '../documentsSendJob.js';
import type { SendRow } from './packageExport.js';

export interface SentReportRenderer {
  (send: SendRow): Promise<Uint8Array>;
}

export interface SentReportDeps {
  readonly client: SupabaseClient;
  readonly browser: Browser;
  /** Origin serving the report route, as the send job uses. */
  readonly origin: string;
  readonly packageId: string;
}

/**
 * A renderer for `buildPackageExport`'s `renderSentReport` port.
 *
 * Takes the full send row rather than an id, because the report's own header states which send it
 * was — "2 of 3" — and that is a property of the send, not of the run.
 */
export function createSentReportRenderer(deps: SentReportDeps): SentReportRenderer {
  const store = createDocumentRunStore(deps.client);
  const rules = loadDocumentsRules();

  return async (send: SendRow): Promise<Uint8Array> => {
    const sends = await store.sendsOf(deps.packageId);
    const row = sends.find((s) => s.id === send.id);
    if (row === undefined) {
      throw new Error(`send ${send.id} is not in this package's send log`);
    }

    const loaded = await loadRunRecord(deps.client, store, row.run_id);
    if (loaded === null) {
      // The run behind a send is never deleted (D-097), so this is a genuine inconsistency rather
      // than an expected absence — and it must stop the export rather than yield a blank PDF.
      throw new Error(`send ${send.id} cites run ${row.run_id}, which could not be read`);
    }

    /*
      The baseline this send's diff was computed against, from the send log rather than recomputed.

      `diff_against_run_id` is what the send actually used. Working it out again from the run order
      would be a second derivation that agrees until a send is re-ordered or a run is inserted.
    */
    const previous =
      row.diff_against_run_id === null
        ? undefined
        : (await loadRunRecord(deps.client, store, row.diff_against_run_id))?.record;

    const report = documents.buildDocumentsReport(loaded.record, rules, previous);
    const identity = await identityOf(deps.client, deps.packageId);

    // The numbering the recipient saw. Accepted sends only, in order, so "2 of 3" means what it
    // meant then rather than what it would mean now.
    const accepted = sends.filter((s) => s.outcome === 'accepted');
    const position = accepted.findIndex((s) => s.id === send.id);
    const priorSent = position <= 0 ? [] : accepted.slice(0, position);

    const rendered = await renderDocumentsReportPdf(deps.browser, {
      origin: deps.origin,
      inject: {
        report,
        packageRef: deps.packageId.slice(0, 8),
        processor: identity.processor,
        reportNumber: `${priorSent.length + 1} of ${Math.max(accepted.length, priorSent.length + 1)}`,
        previousSentAt:
          priorSent.length === 0 ? null : priorSent[priorSent.length - 1]!.sent_at.slice(0, 10),
      },
    });

    return new Uint8Array(rendered.bytes);
  };
}
