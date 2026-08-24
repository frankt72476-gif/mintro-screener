/**
 * The send path, live against the test project.
 *
 *     node --env-file=.env.test scripts/live/m5-send-live.mjs
 *
 * Builds a report from a real persisted run, prints it through the report route, and sends it.
 *
 * `RESEND_API_KEY` is not set in `.env.test`, so this exercises the dry-run mailer: it composes the
 * message, transmits nothing, and records `mailer='dry_run'`. That distinction is a column value,
 * not a flag, so a test send here can never be read later as a delivered report.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import {
  attachmentName,
  bodyFor,
  documentsMailerFor,
  sendDocumentsReport,
  subjectFor,
} from '../../apps/worker/dist/src/documentsSend.js';
import { chromium } from 'playwright';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { renderDocumentsReportPdf } from '../../apps/worker/dist/src/documentsPdf.js';
import { ensureAnalyst } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('M5 — the send path, live');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const rules = loadDocumentsRules();
const store = createDocumentRunStore(service);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`);
};

// The most recent run with findings — whatever the M4 script last produced.
const { data: runRow } = await service
  .from('document_runs')
  .select('id, package_id, run_at, ruleset_version, engine_version, slots, documents')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();
if (!runRow) throw new Error('no run found — run m4-all-checks-live.mjs first');

const stored = await store.findingsOf(runRow.id);
console.log(`run ${runRow.id} — ${stored.length} findings\n`);

/**
 * The run as the report builder wants it.
 *
 * `slots` and `documents` come off the run row (D-123), not off the package: that is what makes the
 * report a function of the run rather than of the run and the clock.
 */
const asRecord = (row, findings) => ({
  id: row.id,
  packageId: row.package_id,
  runAt: row.run_at,
  rulesetVersion: row.ruleset_version,
  engineVersion: row.engine_version,
  slots: row.slots ?? [],
  documents: row.documents ?? [],
  findings: findings.map((f) => ({
    checkId: f.check_id,
    state: f.state,
    notEvaluableReason: f.not_evaluable_reason,
    note: f.note,
    subjectKind: f.subject_kind,
    slotId: f.slot_id,
    documentVersionId: f.document_version_id,
    tier: f.tier,
    readVersionIds: f.read_versions ?? [],
    evidence: f.evidence ?? [],
    evidenceNote: f.evidence_note ?? null,
    ordinal: f.ordinal,
  })),
});

const record = asRecord(runRow, stored);
const report = documents.buildDocumentsReport(record, rules);

check('a report built from a persisted run', report.runId === runRow.id,
  `${report.slots.length} slots, ${report.documents.length} document group(s), ` +
  `${report.packageFindings.length} package finding(s), counts ${JSON.stringify(report.counts)}`);

// Rebuilt from the same rows, reversed. This is the property D-085 actually asserts.
const reversed = { ...record, findings: [...record.findings].reverse(), slots: [...record.slots].reverse() };
check('byte-identical when the rows arrive reversed (D-085)',
  JSON.stringify(documents.buildDocumentsReport(reversed, rules)) === JSON.stringify(report),
  'same run, different row order, same bytes');

const analystId = await ensureAnalyst(service);
const mailer = documentsMailerFor(process.env);

// page.pdf() against the report route — the same component an analyst sees, in print mode.
const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let pdf;
try {
  const rendered = await renderDocumentsReportPdf(browser, {
    origin: server.origin,
    inject: {
      report,
      merchantName: 'Northwind Peptides LLC',
      dba: 'Northwind Labs',
      packageRef: report.packageId.slice(0, 8),
      processor: 'Default',
      reportNumber: '1 of 1',
      previousSentAt: null,
    },
  });
  pdf = Buffer.from(rendered.bytes);
  mkdirSync('scripts/live/out', { recursive: true });
  writeFileSync('scripts/live/out/documents-report.pdf', pdf);
  check(
    'the report route printed to PDF',
    pdf.byteLength > 0 && rendered.pages > 0,
    `${rendered.pages} page(s), ${(pdf.byteLength / 1024).toFixed(1)} KB → scripts/live/out/documents-report.pdf`,
  );
} finally {
  await browser.close().catch(() => undefined);
  await server.close();
}

console.log(`\n  mailer      : ${mailer.kind} — ${mailer.description}`);
console.log(`  subject     : ${subjectFor(report, 'Northwind Peptides LLC')}`);
console.log(`  attachment  : ${attachmentName(report, 'Northwind Peptides LLC')}`);
console.log('  body:');
for (const line of bodyFor(report, 'Northwind Peptides LLC').split('\n')) console.log(`    ${line}`);
console.log('');

const before = await store.sendsOf(report.packageId);
const row = await sendDocumentsReport(mailer, store, {
  report,
  pdf,
  to: 'underwriting@iqwallet.example',
  from: 'reports@gomintro.com',
  sentByAnalystId: analystId,
  diffAgainstRunId: null,
  merchantName: 'Northwind Peptides LLC',
});
const after = await store.sendsOf(report.packageId);

check('the send wrote exactly one row', after.length === before.length + 1,
  `${before.length} → ${after.length}; outcome=${row.outcome}, mailer=${row.mailer}`);

const persisted = after[after.length - 1];
check('the row carries the bytes that were sent',
  persisted.pdf_sha256 === row.pdfSha256 && persisted.pdf_bytes === pdf.byteLength,
  `sha ${persisted.pdf_sha256.slice(0, 12)}…, ${persisted.pdf_bytes} bytes`);

// D-083: a sent report never changes. The findings behind it must be exactly as they were.
const afterSend = await store.findingsOf(runRow.id);
check('sending did not touch the report', JSON.stringify(afterSend) === JSON.stringify(stored),
  `${afterSend.length} findings, unchanged`);

// A second send is an ordinary second row, not an edit to the first.
await sendDocumentsReport(mailer, store, {
  report, pdf, to: 'second@iqwallet.example', from: 'reports@gomintro.com',
  sentByAnalystId: analystId, diffAgainstRunId: null, merchantName: 'Northwind Peptides LLC',
});
const twice = await store.sendsOf(report.packageId);
check('a second send is a second row', twice.length === after.length + 1,
  `${twice.length} sends on this package; the first is untouched`);

// And the log cannot be tidied afterwards.
const { error: updErr } = await service
  .from('document_report_sends').update({ recipient: 'x@y.com' }).eq('run_id', report.runId);
const { error: delErr } = await service
  .from('document_report_sends').delete().eq('run_id', report.runId);
check('the send log is append-only against service_role', !!updErr && !!delErr,
  `update ${updErr ? 'refused' : 'ALLOWED'}, delete ${delErr ? 'refused' : 'ALLOWED'}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`failed: ${failed.map((f) => f.name).join('; ')}`);
process.exit(failed.length === 0 ? 0 : 1);
