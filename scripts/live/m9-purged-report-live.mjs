/**
 * How a purged package's report reads (D-130, P5).
 *
 *     node --env-file=.env.test scripts/live/m9-purged-report-live.mjs
 *
 * **Nothing is deleted.** The purge rows are written directly on a scratch package built for this
 * and nothing else — which is the only way to reach the purged rendering without performing a
 * purge, and Frank has not named that moment. The bodies this package's rows point at are left
 * exactly where they are.
 *
 * The hazard being demonstrated is not that a purged report breaks. `buildDocumentsReport` reads no
 * document body, so before P5 it regenerated **byte-identically** after a purge and gave no sign
 * the files were gone — a page that looks complete and rests on nothing retrievable, which is
 * D-097's *chain that resolves to nothing* one level up.
 *
 * So this asserts both halves: the same run before and after, and that only the retrievability
 * statement changed.
 */

import { createClient } from '@supabase/supabase-js';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { loadRunRecord, loadRetentionState } from '../../apps/worker/dist/src/documentsRunRecord.js';
import { ensureAnalyst } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('A purged package’s report — nothing is deleted');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const analystId = await ensureAnalyst(service);
const rules = loadDocumentsRules();
const store = createDocumentRunStore(service);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n         ${detail}` : ''}`);
};

const insert = async (table, row, select = 'id') => {
  const { data, error } = await service.from(table).insert(row).select(select).single();
  if (error) throw new Error(`could not seed ${table}: ${error.message}`);
  return data;
};

// ── a run to render, on a package built for this ──────────────────────────────────────────────
const suffix = Math.random().toString(36).slice(2, 8);
const merchant = await insert('merchants', { domain: `purged-report-${suffix}.example`, legal_name: 'Purged Report Ltd' });
const pkg = await insert('packages', { merchant_id: merchant.id, processor_key: 'p5', template_version: 'documents-1' });
const slot = await insert('slots', { package_id: pkg.id, slot_key: 'ein_letter', required_count: 1, state: 'satisfied' });

const run = await insert('document_runs', {
  package_id: pkg.id, ruleset_version: 'documents-1', engine_version: '0.1.0',
  run_at: new Date().toISOString(), families: ['A'],
  slots: [{ slotId: slot.id, slotKey: 'ein_letter', instanceLabel: null, state: 'satisfied', reason: null, requiredCount: 1, examined: true }],
  documents: [{ versionId: 'v-1', slotId: slot.id, slotKey: 'ein_letter', filename: 'ein.pdf', outcome: 'extracted', tier: 'character' }],
  package_digest: 'a'.repeat(64), merchant_name: 'Purged Report Ltd', merchant_domain: `purged-report-${suffix}.example`,
});
await insert('document_findings', {
  run_id: run.id, package_id: pkg.id, ordinal: 0, check_id: 'A-01', state: 'pass', note: 'Observed.',
  /*
    A slot subject that read nothing.

    `subject_matches_its_kind` wants a real document_version_id for a document finding, and this
    scratch run's document list is a literal rather than an ingested version;
    `tier_exactly_when_something_was_read` then wants a null tier when no document was read. Both
    constraints are right and the seed was wrong twice — a fair reminder that this schema does not
    let a run describe something that did not happen.
  */
  subject_kind: 'slot', slot_id: slot.id, tier: null, read_versions: [],
}, 'id');

const loaded = await loadRunRecord(service, store, run.id);
if (loaded === null) throw new Error('the run could not be read back');

// ── 1 — before any purge, the report is what it has always been ───────────────────────────────
const before = await loadRetentionState(service, pkg.id);
check('a package nobody has purged reads as not purged',
  before.purged === false && before.objects === 0, JSON.stringify(before));

const reportBefore = documents.buildDocumentsReport(loaded.record, rules, undefined, before);
const bareReport = documents.buildDocumentsReport(loaded.record, rules);
check('and its report is byte-identical to one built with no retention input at all',
  JSON.stringify(reportBefore) === JSON.stringify(bareReport),
  'the second input moves nothing for the packages that have not been purged — which is all of them');

// ── 2 — write the purge rows. No object is removed. ───────────────────────────────────────────
const exportRow = await insert('package_exports', {
  package_id: pkg.id, exported_by: analystId, package_digest: 'a'.repeat(64),
  manifest_sha256: 'b'.repeat(64), bytes: 4096, counts: {},
});
const approval = await insert('package_purge_approvals', {
  package_id: pkg.id, export_id: exportRow.id, approved_by: analystId, package_digest: 'a'.repeat(64),
});
const purge = await insert('package_purges', {
  package_id: pkg.id, approval_id: approval.id, purged_by: analystId,
  objects_planned: 4, bytes_planned: 4096,
});
// `report_pdf`, which is the one kind that references neither a version nor an upload —
// `purged_object_reference_matches_its_kind` (P4) refused a document_body with a null version id,
// which is the constraint working on this script's seed exactly as intended.
await insert('purged_objects', {
  purge_id: purge.id, kind: 'report_pdf', document_version_id: null, upload_id: null,
  storage_key: `${pkg.id}/never-existed.pdf`, sha256: 'c'.repeat(64), bytes: 4096,
}, 'id');

// ── 3 — interrupted first: begun, not completed ───────────────────────────────────────────────
const interrupted = await loadRetentionState(service, pkg.id);
check('a purge begun and not completed reads as purged, with no date',
  interrupted.purged === true && interrupted.purgedAt === null && interrupted.objects === 4,
  JSON.stringify(interrupted));

// ── 4 — completed ─────────────────────────────────────────────────────────────────────────────
await insert('package_purge_completions', {
  purge_id: purge.id, completed_by: analystId, objects_removed: 4,
}, 'id');

const after = await loadRetentionState(service, pkg.id);
check('a completed purge carries the date, the count and the export',
  after.purged === true && after.purgedAt !== null && after.objects === 4
    && after.exportRef === exportRow.id.slice(0, 8),
  JSON.stringify(after));

// ── 5 — the same run, rendered differently ────────────────────────────────────────────────────
const reportAfter = documents.buildDocumentsReport(loaded.record, rules, undefined, after);

check('the same run renders differently once its bodies are gone',
  JSON.stringify(reportAfter) !== JSON.stringify(reportBefore),
  'if these matched, the second input would be decoration');

check('and only the retrievability statement changed',
  JSON.stringify(reportAfter.documents) === JSON.stringify(reportBefore.documents)
    && JSON.stringify(reportAfter.packageFindings) === JSON.stringify(reportBefore.packageFindings)
    && JSON.stringify(reportAfter.counts) === JSON.stringify(reportBefore.counts),
  'the observations were made while the documents were held and are unaffected by their removal');

check('the report names somewhere to look rather than ending at "gone"',
  reportAfter.retention?.exportRef === exportRow.id.slice(0, 8),
  `export ${reportAfter.retention?.exportRef}`);

// ── 6 — nothing was deleted ───────────────────────────────────────────────────────────────────
const { data: stillThere } = await service.storage.from('documents').list(pkg.id);
check('no object was removed by this script', (stillThere ?? []).length === 0,
  'this scratch package never had objects; the purge rows describe keys that never existed');

const { count: purgeCount } = await service
  .from('package_purges').select('id', { count: 'exact', head: true });
console.log(`\npurge rows in the test project: ${purgeCount} (all on scratch packages)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
