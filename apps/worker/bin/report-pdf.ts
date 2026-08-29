/**
 * Renders a report to PDF and, optionally, sends it.
 *
 *     npm run pdf -- 74eefa47                              # by run id
 *     npm run pdf -- swisschems.is                         # by domain, where it names one run
 *     npm run pdf -- c268f8d7 --report-dir fixtures/reports
 *     npm run pdf -- 74eefa47 --send underwriting@iqwallet.com
 *
 * **The run id is the key.** This read `reports/<domain>.json`, which was fine while one storefront
 * meant one file and wrong as soon as it did not: `fixtures/reports/` holds two runs of
 * sportstechnologylabs.com at different rule-set versions, and keying on domain would render one of
 * them without saying which. A domain still works where it names exactly one run; where it names
 * more, `selectRun` refuses and lists them (D-169).
 *
 * The PDF is `page.pdf()` against the report route — the same component the analyst sees. Sending
 * uses the dry-run mailer unless `RESEND_API_KEY` is set, because the sending domain is not
 * verified yet and a report that silently failed to send would be worse than one that plainly
 * did not.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { readRunAttestations, resolveAttestations, type ScreeningReport } from '@mintro/engine';
import { describeRun, readStoredRuns, selectRun } from '../src/selectRun.js';
import { flagValue, positionals, requiredValue } from '../src/cliArgs.js';
import { startReportServer } from '../src/reportServer.js';
import { createWorkerSupabase, signEvidenceUrl } from '../src/store/supabase.js';
import { renderReportPdf } from '../src/pdf.js';
import {
  createMemorySendLog,
  mailersFor,
  sendReport,
  attachmentName,
  subjectFor,
  bodyFor,
} from '../src/send.js';
import type { StoredRun } from '../src/selectRun.js';

/** Flags that consume the token after them, so it is never read as the run selector. */
const VALUE_FLAGS = ['--send', '--out', '--report-dir'] as const;

async function main(argv: readonly string[]): Promise<number> {
  const selector = positionals(argv, VALUE_FLAGS)[0];
  if (selector === undefined) {
    console.error(
      'usage: npm run pdf -- <run-id|domain> [--report-dir <dir>] [--send <email>] [--out <dir>]',
    );
    return 2;
  }

  // `--send` with no address is an error, not a default — see `requiredValue` (D-170).
  let recipient: string | null;
  try {
    recipient = requiredValue(argv, '--send');
  } catch {
    console.error(
      '--send needs an address: npm run pdf -- <run-id> --send underwriting@iqwallet.com\n' +
        '  Omit --send entirely to render without sending.',
    );
    return 2;
  }
  const outDir = flagValue(argv, '--out', 'out');
  const reportDir = flagValue(argv, '--report-dir', 'reports');

  // Resolved before anything is launched: an ambiguous selector should cost nothing but the message.
  let chosen: StoredRun;
  try {
    chosen = selectRun(readStoredRuns(reportDir), selector);
  } catch (error) {
    console.error(`${(error as Error).message}
`);
    return 1;
  }
  const report = chosen.report;
  const slug = chosen.file.replace(/\.json$/, '');

  const server = await startReportServer({
    webRoot: 'apps/web/dist',
    mounts: { '/reports/': reportDir, '/evidence/': 'evidence' },
  });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    console.log(`run           ${describeRun(chosen)}`);
    console.log(`report route  ${server.origin}/?report=${slug}&print=1`);

    // Pre-mint a signed URL for every capture the report cites. The headless browser therefore
    // needs no session of its own — see the note on `PdfOptions.inject`.
    const evidence = await signEvidence(report, server.origin);

    const started = Date.now();
    /*
      The attestation section, which this CLI was rendering without.

      `pdfJob` resolves it and injects it; this path did not, so a PDF rendered here was missing
      nineteen questions the queue's PDF carries — and the two are supposed to be the same document.
      Found while comparing a re-render against a stored PDF for the report restructure: the
      comparison was not like for like, and the CLI was the half that was wrong.

      A failed read leaves the section out rather than rendering nineteen unanswered questions,
      which would be a read failure of ours printed as the merchant's silence — the same reasoning
      `pdfJob` records.
    */
    const stored =
      process.env['SUPABASE_URL'] === undefined || process.env['SUPABASE_SERVICE_KEY'] === undefined
        ? null
        : await readRunAttestations(createWorkerSupabase().client, report.runId);
    const attestations =
      stored === null ? undefined : resolveAttestations(report.attestationQuestions ?? [], stored);

    const pdf = await renderReportPdf(browser, {
      origin: server.origin,
      domain: report.merchantDomain,
      slug,
      inject: { report, evidence, ...(attestations === undefined ? {} : { attestations }) },
    });

    const path = resolve(outDir, attachmentName(report));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, pdf.bytes);

    console.log(`  pages       ${pdf.pages}`);
    console.log(`  captures    ${pdf.images} screenshots resolved`);
    console.log(`  size        ${(pdf.bytes.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  elapsed     ${Date.now() - started}ms`);
    console.log(`  written     ${path}`);

    if (recipient !== null) {
      // One selector for both sends, so verifying the domain turns both on together (D-063).
      const { mailer } = mailersFor();
      const log = createMemorySendLog();

      console.log(`\n  mailer      ${mailer.description}`);
      console.log(`  subject     ${subjectFor(report)}`);

      // D-001: no confirmation, no check on the fail count. The report goes.
      const entry = await sendReport(mailer, log, {
        report,
        pdf: pdf.bytes,
        to: recipient,
        from: 'reports@mintro.com',
        note: `${report.counts.fail} failed, ${report.counts.review} for review, ${report.counts.not_evaluable} not evaluable. Captures attached.`,
        sentBy: process.env['USER'] ?? process.env['USERNAME'] ?? 'unknown',
      });

      console.log('\n  sends row:');
      for (const [key, value] of Object.entries(entry)) {
        console.log(`    ${key.padEnd(18)} ${String(value)}`);
      }

      console.log('\n  covering email:');
      for (const line of bodyFor(report, 'Captures attached.').split('\n')) {
        console.log(`    ${line}`);
      }
    }

    return 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));

/**
 * Signed URLs for every capture a report cites.
 *
 * Falls back to the local report server when Supabase is not configured, which is what makes the
 * PDF pipeline usable before a project exists. The report states which access produced a capture,
 * so a locally served screenshot is never mistaken for one from the private bucket.
 */
async function signEvidence(
  report: ScreeningReport,
  localOrigin: string,
): Promise<Record<string, string>> {
  const keys = new Set<string>();
  for (const category of report.categories) {
    for (const finding of category.findings) {
      for (const entry of finding.evidence) {
        if (entry.evidenceKey !== '' && entry.evidenceKey.endsWith('.png')) {
          keys.add(entry.evidenceKey);
        }
      }
    }
  }

  const signed: Record<string, string> = {};

  if (process.env['SUPABASE_URL'] !== undefined && process.env['SUPABASE_SERVICE_KEY'] !== undefined) {
    const supabase = createWorkerSupabase();
    for (const key of keys) {
      const url = await signEvidenceUrl(supabase, key, 300);
      if (url !== null) signed[key] = url;
    }
    return signed;
  }

  for (const key of keys) signed[key] = `${localOrigin}/evidence/${key}`;
  return signed;
}
