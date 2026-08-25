/**
 * The export builder, against real storage (D-130, P2).
 *
 *     node --env-file=.env.test scripts/live/m7-export-live.mjs
 *
 * **This is the point of the milestone, not a smoke test.** `buildPackageExport` is the first code
 * in this system that reads `document_versions.storage_key` back out of storage — bodies have been
 * write-only since M1, and D-035 is the precedent: the seventh consecutive storage defect surfaced
 * on the *first real use* of a path four milestones of testing had never exercised.
 *
 * The unit tests prove the assembly with a fake object store. A fake cannot fail the way storage
 * fails, and the failure that matters here is one the export must refuse rather than survive. So
 * this runs the real path against a real package with real bytes, and then:
 *
 * 1. **Reconciles the archive against a fresh database query**, not against its own manifest.
 * 2. **Records the export through `record_package_export`**, which recomputes the counts in the
 *    database and refuses a disagreement — a second, independent completeness check.
 * 3. **Deliberately hides an object** and confirms the export refuses rather than skipping it.
 *
 * It stops before approval. Nothing here holds `purge_approver`, and it is not this script's
 * business to grant it.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDocumentsRules } from '@mintro/ruleset';
import { buildPackageExport } from '../../apps/worker/dist/src/export/packageExport.js';
import { reconcileExport } from '../../apps/worker/dist/src/export/reconcile.js';
import { readTar } from '../../apps/worker/dist/src/export/tar.js';
import { DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { packageDigest } from '../../apps/worker/dist/src/documentsReportGate.js';
import { createSentReportRenderer } from '../../apps/worker/dist/src/export/sentReports.js';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { verifyExportArchive, sha256Hex } from '@mintro/engine';
import { ensureAnalyst, analystClient } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('The export builder, against real storage');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
await ensureAnalyst(service);
const asAnalyst = await analystClient(createClient, url, process.env.VITE_SUPABASE_ANON_KEY, service);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n         ${detail}` : ''}`);
};

/*
  Two packages, because the two halves of the completeness check need different ones.

  A package with sends cannot produce a complete export here — re-rendering a historical report
  needs a browser and the report route, which this script does not stand up — so it is used for the
  *refusal* case, which is the more interesting one anyway. A package without sends is used for the
  acceptance case.

  Choosing rather than assuming: the first run of this script picked whatever was newest, tried to
  record an export that omitted a report PDF, and the database refused it. That refusal was correct
  and is now an assertion.
*/
const { data: withBodies } = await service
  .from('document_versions').select('package_id').order('created_at', { ascending: false }).limit(200);
const bodyPackages = [...new Set((withBodies ?? []).map((v) => v.package_id))];
if (bodyPackages.length === 0) throw new Error('no package with a stored document body — run m6 first');

const sendCounts = new Map();
for (const id of bodyPackages) {
  const { count } = await service
    .from('document_report_sends').select('id', { count: 'exact', head: true }).eq('package_id', id);
  sendCounts.set(id, count ?? 0);
}
const packageId = bodyPackages.find((id) => sendCounts.get(id) === 0) ?? bodyPackages[0];
const sentPackageId = bodyPackages.find((id) => (sendCounts.get(id) ?? 0) > 0) ?? null;
console.log(`package ${packageId} (${sendCounts.get(packageId)} send(s))`);
console.log(`sent package ${sentPackageId ?? 'none available'}\n`);

// ── read the rows, once, the way the real caller will ─────────────────────────────────────────
const one = async (table, columns, key = 'package_id') => {
  const { data, error } = await service.from(table).select(columns).eq(key, packageId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
};

const [pkg] = await one('packages', '*', 'id');
const { data: merchant } = await service.from('merchants').select('*').eq('id', pkg.merchant_id).single();
const slots = await one('slots', '*');
const versions = await one('document_versions', '*');
const uploads = await one('document_uploads', '*');
const runs = await one('document_runs', '*');
const sends = await one('document_report_sends', '*');
const { data: findings } = await service
  .from('document_findings').select('*').in('run_id', runs.map((r) => r.id).length ? runs.map((r) => r.id) : ['none']);

const rows = {
  packageId,
  merchantName: merchant.legal_name ?? merchant.domain,
  versions,
  uploads,
  // Re-rendering every historical report needs a browser and the report route; this script does not
  // stand one up, so it exercises the storage path and leaves the PDF path to the unit tests. Named
  // rather than skipped silently — see the gap this reports at the end.
  sends: [],
  rulesetDeclared: [...new Set(runs.map((r) => r.ruleset_version))],
  tables: {
    packages: [pkg],
    merchants: [merchant],
    slots,
    slot_removals: await one('package_slot_removals', '*'),
    documents: await one('documents', '*'),
    document_versions: versions,
    document_uploads: uploads,
    document_runs: runs,
    document_findings: findings ?? [],
    report_sends: sends,
    retrievals: await one('document_retrievals', '*'),
  },
};

/** The same row read, for any package — so the sent-package case is not a second assembly. */
const one2 = async (table, columns, id, key = 'package_id') => {
  const { data, error } = await service.from(table).select(columns).eq(key, id);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
};

async function rowsFor(id) {
  const [row] = await one2('packages', '*', id, 'id');
  const { data: m } = await service.from('merchants').select('*').eq('id', row.merchant_id).single();
  const sl = await one2('slots', '*', id);
  const vs = await one2('document_versions', '*', id);
  const us = await one2('document_uploads', '*', id);
  const rs = await one2('document_runs', '*', id);
  const { data: fs } = await service.from('document_findings').select('*')
    .in('run_id', rs.length ? rs.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000']);
  const sn = await one2('document_report_sends', '*', id);
  return {
    packageId: id,
    merchantName: m.legal_name ?? m.domain,
    versions: vs,
    uploads: us,
    sends: [],
    rulesetDeclared: [...new Set(rs.map((r) => r.ruleset_version))],
    tables: {
      packages: [row], merchants: [m], slots: sl,
      slot_removals: await one2('package_slot_removals', '*', id),
      documents: await one2('documents', '*', id),
      document_versions: vs, document_uploads: us, document_runs: rs,
      document_findings: fs ?? [], report_sends: sn,
      retrievals: await one2('document_retrievals', '*', id),
    },
  };
}

const rulesetFiles = () => ({
  version: loadDocumentsRules().templates.version,
  files: {
    'documents.checks.json': new Uint8Array(readFileSync('rules/documents.checks.json')),
    'documents.templates.json': new Uint8Array(readFileSync('rules/documents.templates.json')),
  },
});

/** The real read path. Returns null on a miss so the builder can refuse rather than throw blindly. */
const readObject = async (key) => {
  const { data, error } = await service.storage.from(DOCUMENTS_BUCKET).download(key);
  if (error) return null;
  return new Uint8Array(await data.arrayBuffer());
};

/*
  Make sure there is a staged upload to read.

  m6 ingests through `ingestDocument` directly, so it leaves no `document_uploads` row and no
  staging object — and a staging check over an empty list passes without reading anything. Staging
  is the invisible second copy this whole ruling turns on, so the path gets exercised rather than
  skipped: one real object, one real row, read back through the same port as everything else.
*/
if (uploads.length === 0) {
  const stagingKey = `${packageId}/staging/${crypto.randomUUID()}`;
  const staged = new TextEncoder().encode('staged bytes that never became a document version');
  const up = await service.storage.from(DOCUMENTS_BUCKET).upload(stagingKey, staged, {
    contentType: 'application/octet-stream', upsert: false,
  });
  if (up.error) throw new Error(`could not stage a probe object: ${up.error.message}`);
  const { data: row, error } = await service.from('document_uploads').insert({
    package_id: packageId, slot_id: slots[0].id, staging_key: stagingKey,
    original_filename: 'never-ingested.bin', requested_by: (await ensureAnalyst(service)),
    status: 'failed', error: 'staged by m7-export-live to exercise the staging read path',
  }).select('id, staging_key').single();
  if (error) throw new Error(`could not record the probe upload: ${error.message}`);
  uploads.push(row);
  rows.tables.document_uploads = uploads;
  console.log(`staged one probe upload so the staging path is exercised: ${row.id}
`);
}

const ports = { readObject, renderSentReport: async () => { throw new Error('no renderer here'); }, rulesetFiles };
const exportedAt = new Date().toISOString();

// ── 1 — it reads real bodies ──────────────────────────────────────────────────────────────────
let built;
try {
  built = await buildPackageExport(rows, ports, exportedAt);
  check('the export reads every document body out of real storage', true,
    `${built.entries.length} entries, ${built.archive.length} bytes, manifest ${built.manifestSha256.slice(0, 12)}…`);
} catch (error) {
  check('the export reads every document body out of real storage', false, error.message);
  throw error;
}

const members = readTar(built.archive);
check('every stored body is in the archive under its version id',
  versions.every((v) => members.some((m) => m.path === `bodies/${v.id}`)),
  `${versions.length} version(s)`);

check('the archived bytes hash to what the database recorded',
  versions.every((v) => {
    const m = members.find((x) => x.path === `bodies/${v.id}`);
    return m && createHash('sha256').update(m.bytes).digest('hex') === v.sha256;
  }),
  'content-addressed identity holds end to end (D-091)');

check('staged bytes are exported too, including uploads that never became a version',
  uploads.every((u) => members.some((m) => m.path === `staging/${u.id}`)),
  `${uploads.length} upload(s) — the invisible second copy`);

// ── 2 — reconciled against a fresh query, not against itself ──────────────────────────────────
const fresh = await service.from('document_versions').select('id, sha256, original_sha256').eq('package_id', packageId);
const reconciled = reconcileExport(built.archive, {
  versions: (fresh.data ?? []).map((v) => ({ id: v.id, sha256: v.sha256 })),
  originals: (fresh.data ?? []).filter((v) => v.original_sha256).map((v) => ({ id: v.id, sha256: v.original_sha256 })),
  uploadIds: uploads.map((u) => u.id),
  sendIds: [],
  counts: {
    slots: slots.length, documents: rows.tables.documents.length, document_versions: versions.length,
    document_uploads: uploads.length, slot_removals: rows.tables.slot_removals.length,
    document_runs: runs.length, document_findings: (findings ?? []).length,
    report_sends: 0, retrievals: rows.tables.retrievals.length,
  },
});
check('the archive reconciles against a fresh database read', reconciled.ok,
  reconciled.ok ? `${reconciled.membersChecked} members checked` : reconciled.problems.join('; '));

// ── 3 — the database's own completeness check ─────────────────────────────────────────────────
const digest = packageDigest({
  slots: slots.map((s) => ({ slotId: s.id, state: s.state, reason: s.reason, requiredCount: s.required_count })),
  documents: versions.map((v) => ({ versionId: v.id, outcome: v.outcome })),
});
const { data: exportId, error: exportError } = await asAnalyst.rpc('record_package_export', {
  p_package_id: packageId,
  p_package_digest: digest,
  p_manifest_sha256: built.manifestSha256,
  p_bytes: built.archive.length,
  p_counts: built.counts,
});
check('record_package_export accepts counts that match the database', !exportError && Boolean(exportId),
  exportError ? exportError.message : `export ${String(exportId).slice(0, 8)}…`);

/*
  The completeness anchor, on a real gap rather than a synthetic one.

  This package has a report send. The export omits report PDFs, and its manifest says so —
  `report_sends: 0` against an archive holding zero report PDFs, entirely self-consistent. Only the
  database knows the package has one, which is the whole of D-130's correction: a manifest agreeing
  with itself proves nothing about what was left out.
*/
if (sentPackageId) {
  const { error: gapError } = await asAnalyst.rpc('record_package_export', {
    p_package_id: sentPackageId,
    p_package_digest: 'b'.repeat(64),
    p_manifest_sha256: built.manifestSha256,
    p_bytes: built.archive.length,
    p_counts: { ...built.counts, report_sends: 0 },
  });
  check('and refuses an export whose manifest is self-consistent but incomplete',
    /report_sends: exported 0, database holds/.test(gapError?.message ?? ''),
    gapError ? gapError.message.slice(0, 110) : 'ACCEPTED — an export missing a sent report was recorded');
}

const { error: wrongCounts } = await asAnalyst.rpc('record_package_export', {
  p_package_id: packageId,
  p_package_digest: 'a'.repeat(64),
  p_manifest_sha256: built.manifestSha256,
  p_bytes: built.archive.length,
  p_counts: { ...built.counts, document_versions: built.counts.document_versions + 1 },
});
// The message, not merely an error. The first version of this asserted `Boolean(wrongCounts)` and
// passed while the function did not exist at all — an assertion satisfied by the wrong failure is
// the same defect as one satisfied by no failure.
check('and refuses counts that do not', /does not match the package/.test(wrongCounts?.message ?? ''),
  wrongCounts ? wrongCounts.message.slice(0, 110) : 'ACCEPTED — the completeness check is not running');

// ── 4 — a missing object must stop the export, not be skipped ─────────────────────────────────
const hidden = versions[0].storage_key;
const blinded = { ...ports, readObject: async (key) => (key === hidden ? null : readObject(key)) };
let refused = false;
try {
  await buildPackageExport(rows, blinded, exportedAt);
} catch (error) {
  refused = /is not in storage/.test(error.message);
}
check('an unreadable body stops the export rather than being skipped', refused,
  'a gap here becomes a purge that deletes the only copy');

// ── 5 — the case the database used to refuse: a package that has been sent ────────────────────
if (sentPackageId) {
  const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
  const browser = await chromium.launch();
  try {
    const sentRows = { ...(await rowsFor(sentPackageId)) };
    sentRows.sends = (await one2('document_report_sends', '*', sentPackageId)).map((r) => ({
      id: r.id, pdf_sha256: r.pdf_sha256,
    }));

    const withRenderer = {
      readObject,
      rulesetFiles,
      renderSentReport: createSentReportRenderer({
        client: service, browser, origin: server.origin, packageId: sentPackageId,
      }),
    };

    const sentExport = await buildPackageExport(sentRows, withRenderer, new Date().toISOString());
    check('a package that has been sent now exports, PDFs and all', true,
      `${sentExport.entries.length} entries, ${sentRows.sends.length} report PDF(s)`);

    const sentMembers = readTar(sentExport.archive);
    check('every send has its report PDF in the archive',
      sentRows.sends.every((snd) => sentMembers.some((m) => m.path === `reports/${snd.id}.pdf`)),
      sentRows.sends.map((snd) => `reports/${snd.id}.pdf`).join(', '));

    check('and the re-rendered PDF is a PDF',
      sentMembers.filter((m) => m.path.startsWith('reports/'))
        .every((m) => new TextDecoder().decode(m.bytes.slice(0, 5)) === '%PDF-'),
      'magic bytes');

    // D-130 asks for this to be recorded at export time — the last moment it is checkable at all.
    console.log(`         re-render hash ${sentExport.reportHashMismatches.length === 0 ? 'matches the send log' : `differs for ${sentExport.reportHashMismatches.length} send(s)`}`);

    const { data: sentExportId, error: sentError } = await asAnalyst.rpc('record_package_export', {
      p_package_id: sentPackageId,
      p_package_digest: 'c'.repeat(64),
      p_manifest_sha256: sentExport.manifestSha256,
      p_bytes: sentExport.archive.length,
      p_counts: sentExport.counts,
    });
    check('record_package_export now accepts it, because nothing is missing', !sentError && Boolean(sentExportId),
      sentError ? sentError.message : `export ${String(sentExportId).slice(0, 8)}…`);

    // ── 6 — hop 1, over the real archive ──────────────────────────────────────────────────────
    const verified = await verifyExportArchive(sentExport.archive, sentExport.manifestSha256);
    check('the archive verifies member by member', verified.ok,
      verified.ok ? `${verified.membersChecked} members hashed against the manifest` : verified.problems.join('; '));

    const truncated = await verifyExportArchive(
      sentExport.archive.slice(0, Math.floor((sentExport.archive.length - 1024) / 512) * 512),
      sentExport.manifestSha256,
    );
    check('and refuses the same archive truncated on a block boundary', !truncated.ok,
      truncated.problems[0]?.slice(0, 90) ?? 'ACCEPTED — a truncated archive verified');

    const { data: outcome, error: vErr } = await asAnalyst.rpc('record_export_verification', {
      p_export_id: sentExportId, p_method: 'read_back',
      p_observed_sha256: verified.manifestSha256, p_members_checked: verified.membersChecked,
    });
    check('the verification records as matched', !vErr && outcome === 'matched',
      vErr ? vErr.message : String(outcome));

    // ── 7 — declared records and does not open the gate ───────────────────────────────────────
    const { data: dOut } = await asAnalyst.rpc('record_export_verification', {
      p_export_id: sentExportId, p_method: 'declared',
      p_observed_sha256: sentExport.manifestSha256, p_members_checked: 0,
    });
    check('a declared hash records as matched', dOut === 'matched', String(dOut));

    const { error: overstated } = await asAnalyst.rpc('record_export_verification', {
      p_export_id: sentExportId, p_method: 'declared',
      p_observed_sha256: sentExport.manifestSha256, p_members_checked: 9,
    });
    check('and cannot claim to have examined anything',
      /a_declared_hash_checks_nothing/.test(overstated?.message ?? ''),
      overstated ? overstated.message.slice(0, 90) : 'ACCEPTED — a declared hash claimed 9 members');

    // ── 8 — hop 2 is its own fact ─────────────────────────────────────────────────────────────
    const { error: aErr } = await asAnalyst.rpc('record_vault_attestation', {
      p_export_id: sentExportId,
      p_destination: 'Mintro vault (m7 live run — no file was actually moved)',
      p_statement: 'Recorded by scripts/live/m7-export-live.mjs to exercise the attestation path.',
    });
    check('an attestation records against the export', !aErr, aErr ? aErr.message : 'recorded');

    const { error: approvalError } = await asAnalyst.rpc('approve_package_purge', {
      p_package_id: sentPackageId, p_export_id: sentExportId, p_package_digest: 'c'.repeat(64),
    });
    check('and approval still refuses, because nobody holds purge_approver',
      /only a purge approver/.test(approvalError?.message ?? ''),
      approvalError ? approvalError.message.slice(0, 90) : 'APPROVED — the gate is open');
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log(`\nnot exercised by this run:`);
console.log(`  originals   — the packages here have ${versions.filter((v) => v.original_storage_key).length} converted file(s).`);
console.log('  the file picker — showSaveFilePicker is browser-only; the logic above it is unit-tested');
console.log('                    against a fake whose disk contents differ from what was written.');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
