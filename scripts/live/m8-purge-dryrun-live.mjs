/**
 * The purge dry run, against real storage (D-130, P4).
 *
 *     node --env-file=.env.test scripts/live/m8-purge-dryrun-live.mjs
 *
 * **Dry run only. Nothing here deletes anything**, and `executePurge` is never called with
 * `confirm: true`. Nobody holds `purge_approver`, which is the resting state until the
 * reconciliation has been proven — this script is the proving.
 *
 * What it exercises that the unit tests cannot:
 *
 * 1. The **real** Storage listing, whose `list` is one level and returns `staging` as a folder. A
 *    reconciler that stopped at the top would miss the copies nobody knows about, and a fake bucket
 *    can only model that if the person writing it already knew.
 * 2. That `authenticated` gets **an empty list with no error** from the same bucket — the measured
 *    fact that put this job in the worker.
 * 3. A scratch package with a deliberately orphaned object: the dry run names it, the executor
 *    refuses, and nothing is removed.
 */

import { createClient } from '@supabase/supabase-js';
import { planPurge, executePurge, PurgeRefused } from '../../apps/worker/dist/src/export/purgeExecutor.js';
import { storageFor } from '../../apps/worker/dist/src/purgePlanJob.js';
import { DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { ensureAnalyst, analystClient } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('The purge dry run, against real storage — nothing is deleted');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const analystId = await ensureAnalyst(service);
const asAnalyst = await analystClient(createClient, url, process.env.VITE_SUPABASE_ANON_KEY, service);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n         ${detail}` : ''}`);
};

const storage = storageFor(service, DOCUMENTS_BUCKET);

/**
 * Every seed insert, checked.
 *
 * The first run of this script ignored the error from the `document_uploads` insert, the insert
 * failed, and the reconciliation reported the *known* staging object as unexpected — a correct
 * result about a package the script had built wrong. An unchecked write in the setup makes the
 * assertion about the thing under test.
 */
const insert = async (table, row, select = 'id') => {
  const { data, error } = await service.from(table).insert(row).select(select).single();
  if (error) throw new Error(`could not seed ${table}: ${error.message}`);
  return data;
};


// ── a scratch package, built for this and used for nothing else ───────────────────────────────
const suffix = Math.random().toString(36).slice(2, 8);
const merchant = await insert('merchants', { domain: `purge-dryrun-${suffix}.example`, legal_name: 'Dry Run Ltd' });
const pkg = await insert('packages', { merchant_id: merchant.id, processor_key: 'dry-run', template_version: 'documents-1' });
const slot = await insert('slots', { package_id: pkg.id, slot_key: 'ein_letter', required_count: 1, state: 'missing' });
console.log(`scratch package ${pkg.id}\n`);

const put = async (key, text) => {
  const { error } = await service.storage.from(DOCUMENTS_BUCKET).upload(key, new TextEncoder().encode(text), {
    contentType: 'application/octet-stream', upsert: true,
  });
  if (error) throw new Error(`could not stage ${key}: ${error.message}`);
};

// One body the database knows about, one staged upload it knows about, and one object it does not.
const bodyKey = `${pkg.id}/${'a'.repeat(64)}.pdf`;
const stagingKey = `${pkg.id}/staging/${crypto.randomUUID()}`;
const orphanKey = `${pkg.id}/staging/${crypto.randomUUID()}`;
await put(bodyKey, '%PDF-1.4 a body the database records');
await put(stagingKey, 'staged bytes the database records');
await put(orphanKey, 'an object no row explains — the invisible second copy');

const doc = await insert('documents', { package_id: pkg.id, slot_id: slot.id });
await insert('document_versions', {
  document_id: doc.id, package_id: pkg.id, version: 1, sha256: 'a'.repeat(64), bytes: 36,
  detected_type: 'pdf', storage_key: bodyKey, outcome: 'extracted',
});
// `queued`, not `done`: a finished upload must name the version it produced
// (`finished_uploads_say_what_happened`), and this one is staged bytes nothing has ingested — which
// is the realistic case for a staging object anyway.
await insert('document_uploads', {
  package_id: pkg.id, slot_id: slot.id, staging_key: stagingKey,
  original_filename: 'known.bin', requested_by: analystId, status: 'queued',
});

// ── 1 — the listing the reconciliation depends on ─────────────────────────────────────────────
const topLevel = await storage.list(pkg.id);
check('the Storage list is one level and returns staging as a folder',
  topLevel.some((e) => e.name === 'staging' && e.id === null),
  topLevel.map((e) => `${e.name}${e.id === null ? '/' : ''}`).join(', '));

const asAnalystList = await asAnalyst.storage.from(DOCUMENTS_BUCKET).list(pkg.id);
check('authenticated gets an empty list with NO error — why this job is in the worker',
  !asAnalystList.error && (asAnalystList.data ?? []).length === 0,
  asAnalystList.error ? `errored: ${asAnalystList.error.message}` : `${(asAnalystList.data ?? []).length} object(s), error null`);

// ── 2 — the dry run names the orphan ──────────────────────────────────────────────────────────
// A real export row is needed for the foreign key. This approval is written by service_role for
// the dry run and is never used to purge anything.
const exportRow = await insert('package_exports', {
  package_id: pkg.id, exported_by: analystId, package_digest: 'f'.repeat(64),
  manifest_sha256: 'f'.repeat(64), bytes: 1, counts: {},
});
const approval = await insert('package_purge_approvals', {
  package_id: pkg.id, export_id: exportRow.id, approved_by: analystId, package_digest: 'f'.repeat(64),
});

const plan = await planPurge({ client: service, storage }, approval.id);

check('the dry run finds every object, including the one under staging',
  plan.targets.length === 2 && plan.unexpected.length === 1,
  `${plan.targets.length} target(s), ${plan.unexpected.length} unexpected`);

check('and names the orphan exactly', plan.unexpected[0] === orphanKey, plan.unexpected[0] ?? 'none');

check('the orphan is a refusal, not a warning',
  plan.refusals.some((r) => /accounted for by no row/.test(r)),
  plan.refusals.join(' | ') || 'no refusals');

// ── 3 — the executor refuses, and removes nothing ─────────────────────────────────────────────
let refused = false;
try {
  await executePurge({ client: service, storage }, approval.id, { confirm: true, packageDigest: 'f'.repeat(64) });
} catch (error) {
  refused = error instanceof PurgeRefused || /refused/.test(error.message);
}
check('the executor refuses with confirm: true', refused, 'PurgeRefused');

const after = await storage.list(pkg.id);
const afterStaging = await storage.list(`${pkg.id}/staging`);
check('and every object is still in the bucket',
  after.some((e) => e.name === `${'a'.repeat(64)}.pdf`) && afterStaging.length === 2,
  `${after.length} at the top, ${afterStaging.length} under staging`);

// ── 4 — with the orphan explained, the plan would proceed ─────────────────────────────────────
await insert('document_uploads', {
  package_id: pkg.id, slot_id: slot.id, staging_key: orphanKey,
  original_filename: 'now-explained.bin', requested_by: analystId, status: 'failed',
  error: 'recorded by m8 to show the reconciliation clearing',
});
const cleared = await planPurge({ client: service, storage }, approval.id);
check('once a row explains it, the reconciliation clears',
  cleared.refusals.length === 0 && cleared.targets.length === 3,
  `${cleared.targets.length} target(s), ${cleared.refusals.length} refusal(s)`);

// ── 5 — an absence nothing explains is also a refusal ─────────────────────────────────────────
await service.storage.from(DOCUMENTS_BUCKET).remove([bodyKey]);
const missing = await planPurge({ client: service, storage }, approval.id);
check('a body the database expects and the bucket lacks is a refusal',
  missing.unexplained.includes(bodyKey) && missing.refusals.some((r) => /no purge recorded/.test(r)),
  missing.refusals.join(' | ') || 'no refusals');

// ── 6 — nobody may approve anything ───────────────────────────────────────────────────────────
const { error: approvalError } = await asAnalyst.rpc('approve_package_purge', {
  p_package_id: pkg.id, p_export_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', p_package_digest: 'f'.repeat(64),
});
check('and no analyst can approve a purge', /only a purge approver/.test(approvalError?.message ?? ''),
  approvalError ? approvalError.message.slice(0, 80) : 'APPROVED — the gate is open');

console.log(`\nscratch objects left in place for inspection under ${pkg.id}/`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
