/**
 * Renders a report to PDF and, optionally, sends it.
 *
 *     npm run pdf -- swisschems.is
 *     npm run pdf -- swisschems.is --send underwriting@iqwallet.com
 *
 * The PDF is `page.pdf()` against the report route — the same component the analyst sees. Sending
 * uses the dry-run mailer unless `RESEND_API_KEY` is set, because the sending domain is not
 * verified yet and a report that silently failed to send would be worse than one that plainly
 * did not.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import type { ScreeningReport } from '@mintro/engine';
import { startReportServer } from '../src/reportServer.js';
import { createWorkerSupabase, signEvidenceUrl } from '../src/store/supabase.js';
import { renderReportPdf } from '../src/pdf.js';
import {
  createDryRunMailer,
  createMemorySendLog,
  createResendMailer,
  sendReport,
  attachmentName,
  subjectFor,
  bodyFor,
} from '../src/send.js';

async function main(argv: readonly string[]): Promise<number> {
  const domain = argv.find((arg) => !arg.startsWith('--'));
  if (domain === undefined) {
    console.error('usage: npm run pdf -- <merchant-domain> [--send <email>] [--out <dir>]');
    return 2;
  }

  const sendIndex = argv.indexOf('--send');
  const recipient = sendIndex === -1 ? null : argv[sendIndex + 1] ?? null;
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex === -1 ? 'out' : argv[outIndex + 1] ?? 'out';

  const server = await startReportServer({
    webRoot: 'apps/web/dist',
    mounts: { '/reports/': 'reports', '/evidence/': 'evidence' },
  });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    console.log(`report route  ${server.origin}/?report=${domain}&print=1`);

    const report = (await fetch(`${server.origin}/reports/${domain}.json`).then((r) =>
      r.json(),
    )) as ScreeningReport;

    // Pre-mint a signed URL for every capture the report cites. The headless browser therefore
    // needs no session of its own — see the note on `PdfOptions.inject`.
    const evidence = await signEvidence(report, server.origin);

    const started = Date.now();
    const pdf = await renderReportPdf(browser, {
      origin: server.origin,
      domain,
      inject: { report, evidence },
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
      const apiKey = process.env['RESEND_API_KEY'];
      const mailer = apiKey === undefined ? createDryRunMailer() : createResendMailer(apiKey);
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
