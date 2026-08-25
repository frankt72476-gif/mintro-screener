/**
 * D-126, live: renaming a merchant does not change the masthead of a run that did not change.
 *
 *     node --env-file=.env.test scripts/live/m5-identity-live.mjs
 *
 * The check is not that the name renders — that was already true. It is that the name renders **the
 * same** after the merchant row underneath it has been edited, because a sent PDF and a regenerated
 * page must not disagree while both claim one run id.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { renderDocumentsReportPdf } from '../../apps/worker/dist/src/documentsPdf.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { banner, assertTestProject } from './guard.mjs';

banner('D-126 — the run carries the identity it rendered under');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const store = createDocumentRunStore(service);
const rules = loadDocumentsRules();

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`);
};

const { data: row } = await service
  .from('document_runs')
  .select('id, package_id, run_at, ruleset_version, engine_version, slots, documents, merchant_name, merchant_domain')
  .order('created_at', { ascending: false }).limit(1).single();

check('the run recorded who it renders under', (row.merchant_name ?? '') !== '',
  `merchant_name="${row.merchant_name}", merchant_domain="${row.merchant_domain}"`);

const findings = await store.findingsOf(row.id);
const recordFrom = (r) => ({
  id: r.id, packageId: r.package_id, runAt: r.run_at,
  rulesetVersion: r.ruleset_version, engineVersion: r.engine_version,
  identity: { merchantName: r.merchant_name, merchantDomain: r.merchant_domain, dba: null },
  slots: r.slots ?? [], documents: r.documents ?? [],
  findings: findings.map((f) => ({
    checkId: f.check_id, state: f.state, notEvaluableReason: f.not_evaluable_reason, note: f.note,
    subjectKind: f.subject_kind, slotId: f.slot_id, documentVersionId: f.document_version_id,
    tier: f.tier, readVersionIds: f.read_versions ?? [], evidence: f.evidence ?? [],
    evidenceNote: f.evidence_note ?? null, ordinal: f.ordinal,
  })),
});

const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const printOnce = async (record) => {
  const r = await renderDocumentsReportPdf(browser, {
    origin: server.origin,
    inject: { report: documents.buildDocumentsReport(record, rules), packageRef: record.packageId.slice(0, 8), processor: 'default', reportNumber: '1 of 1', previousSentAt: null },
  });
  return Buffer.from(r.bytes);
};

const { data: pkg } = await service.from('packages').select('merchant_id').eq('id', row.package_id).single();
const original = row.merchant_name;

try {
  const before = await printOnce(recordFrom(row));

  // Somebody edits the merchant. Nothing about the run changes.
  await service.from('merchants').update({ legal_name: 'RENAMED HOLDINGS INC' }).eq('id', pkg.merchant_id);

  const { data: reread } = await service
    .from('document_runs')
    .select('id, package_id, run_at, ruleset_version, engine_version, slots, documents, merchant_name, merchant_domain')
    .eq('id', row.id).single();

  check('the run still names the merchant it ran for', reread.merchant_name === original,
    `run says "${reread.merchant_name}", merchants row now says "RENAMED HOLDINGS INC"`);

  const after = await printOnce(recordFrom(reread));
  const rendersSame = !after.includes('RENAMED HOLDINGS') && before.length === after.length;
  check('the regenerated report carries the original name, not the new one', rendersSame,
    `${before.length} bytes → ${after.length}; "RENAMED HOLDINGS" ${after.includes('RENAMED HOLDINGS') ? 'LEAKED INTO THE PDF' : 'absent from the PDF'}`);
} finally {
  await service.from('merchants').update({ legal_name: original }).eq('id', pkg.merchant_id);
  await browser.close().catch(() => undefined);
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
