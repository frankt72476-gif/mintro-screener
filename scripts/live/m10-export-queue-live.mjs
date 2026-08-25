/**
 * The export queue, end to end (D-130, P6).
 *
 *     node --env-file=.env.test scripts/live/m10-export-queue-live.mjs
 *
 * The operator's sequence, driven through the calls the panel makes:
 *
 *     request (as an analyst)  →  worker builds  →  download  →  verify  →  attest  →  discard
 *
 * **Nothing is purged.** The last step removes the *staged archive* — an artifact this system made
 * a minute earlier — and never a merchant's document. Nobody holds `purge_approver`.
 *
 * The request is made as a **signed-in analyst**, not as `service_role`, because the RLS policy is
 * half the thing under test: an operator may queue a request and may not answer for one.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { verifyExportArchive } from '@mintro/engine';
import { claimNextExport, runExport, claimNextExportDiscard, runExportDiscard, EXPORT_PREFIX }
  from '../../apps/worker/dist/src/exportJob.js';
import { DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { ensureAnalyst, analystClient } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('The export queue, end to end — nothing is purged');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const analystId = await ensureAnalyst(service);
const asAnalyst = await analystClient(createClient, url, process.env.VITE_SUPABASE_ANON_KEY, service);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n         ${detail}` : ''}`);
};

/*
  A package with bodies that are actually there, and no sends.

  No sends so the run needs no historical re-render. **Bodies present** because earlier scripts
  leave deliberately broken scratch packages behind — m8 removes a body to prove the purge refuses
  an unexplained absence — and the first run of this script picked one of those. The export refused,
  correctly, and the failure was about the fixture rather than the code.

  So the candidate is checked rather than assumed: every stored body must download.
*/
const { data: versions } = await service
  .from('document_versions')
  .select('package_id, storage_key')
  .order('created_at', { ascending: false })
  .limit(200);

const byPackage = new Map();
for (const v of versions ?? []) {
  byPackage.set(v.package_id, [...(byPackage.get(v.package_id) ?? []), v.storage_key]);
}

let packageId = null;
for (const [id, keys] of byPackage) {
  const { count } = await service
    .from('document_report_sends').select('id', { count: 'exact', head: true }).eq('package_id', id);
  if ((count ?? 0) > 0) continue;
  const present = await Promise.all(keys.map(async (key) => {
    const { error } = await service.storage.from(DOCUMENTS_BUCKET).download(key);
    return error === null;
  }));
  if (present.every(Boolean)) { packageId = id; break; }
}
if (packageId === null) {
  throw new Error('no package with intact bodies and no sends — run m6 first');
}
console.log(`package ${packageId}\n`);

// ── 1 — an operator queues, and cannot answer ─────────────────────────────────────────────────
const { data: requested, error: requestError } = await asAnalyst
  .from('document_export_requests')
  .insert({ package_id: packageId, requested_by: analystId, status: 'queued' })
  .select('id').single();
check('an analyst can queue an export request', !requestError && Boolean(requested?.id),
  requestError ? requestError.message : `request ${String(requested?.id).slice(0, 8)}…`);

const { error: forged } = await asAnalyst
  .from('document_export_requests')
  .insert({ package_id: packageId, requested_by: analystId, status: 'done', storage_key: 'exports/made-up.tar' });
check('and cannot write a finished one', Boolean(forged),
  forged ? forged.message.slice(0, 80) : 'ACCEPTED — an operator could record an export nobody built');

// ── 2 — the worker builds it ──────────────────────────────────────────────────────────────────
const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
const browser = await chromium.launch();
let request;
try {
  request = await claimNextExport(service);
  check('the worker claims it', request?.id === requested.id, request ? 'claimed' : 'nothing claimed');

  await runExport(request, { client: service, browser, origin: server.origin, bucket: DOCUMENTS_BUCKET });
} finally {
  await browser.close();
  await server.close();
}

const { data: finished } = await service
  .from('document_export_requests').select('*').eq('id', requested.id).single();
check('and finishes it, pointing at what it produced',
  finished.status === 'done' && Boolean(finished.export_id) && Boolean(finished.storage_key),
  finished.status === 'done'
    ? `export ${String(finished.export_id).slice(0, 8)}… · ${finished.bytes} bytes · ${finished.storage_key}`
    : `${finished.status}: ${finished.error}`);

check('the archive is staged outside every package prefix',
  String(finished.storage_key).startsWith(`${EXPORT_PREFIX}/`)
    && !String(finished.storage_key).startsWith(`${packageId}/`),
  // An archive under {packageId}/ is an object the purge reconciliation cannot account for, so it
  // would refuse — the export making the purge it exists for impossible.
  finished.storage_key);

const { data: planCheck } = await service.storage.from(DOCUMENTS_BUCKET).list(packageId);
check('and the package prefix is unchanged by the export',
  !(planCheck ?? []).some((e) => e.name.endsWith('.tar')),
  `${(planCheck ?? []).length} entries, no archive among them`);

// ── 3 — the operator downloads and verifies ───────────────────────────────────────────────────
/*
  Through the signed link, not the storage client.

  The first run of this script failed here: `authenticated` has no select on the documents bucket,
  so `download()` returned an error and the archive was unreachable. A read policy would have fixed
  it by granting every analyst standing access to every document body — the inverse of the regime
  D-097 describes — so the worker mints a URL for one object instead (0041).
*/
const noSelect = await asAnalyst.storage.from(DOCUMENTS_BUCKET).download(finished.storage_key);
check('an analyst still cannot read the bucket directly', Boolean(noSelect.error),
  noSelect.error ? 'download refused, as it should be' : 'ALLOWED — analysts can read every body');

check('the finished request carries a download link', typeof finished.download_url === 'string',
  finished.download_url ? `expires ${finished.download_expires_at}` : 'no link');

const response = await fetch(finished.download_url);
check('and the link fetches the archive', response.ok, `HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());
const { data: exportRow } = await service
  .from('package_exports').select('manifest_sha256, counts').eq('id', finished.export_id).single();

const verified = await verifyExportArchive(archive, exportRow.manifest_sha256);
check('the archive verifies member by member', verified.ok,
  verified.ok ? `${verified.membersChecked} members hashed against the manifest` : verified.problems.join('; '));

const tampered = await verifyExportArchive(
  archive.slice(0, Math.floor((archive.length - 1024) / 512) * 512), exportRow.manifest_sha256);
check('and refuses the same archive truncated on a block boundary', !tampered.ok,
  tampered.problems[0]?.slice(0, 80) ?? 'ACCEPTED — a truncated archive verified');

const { data: outcome, error: verifyError } = await asAnalyst.rpc('record_export_verification', {
  p_export_id: finished.export_id, p_method: 'read_back',
  p_observed_sha256: verified.manifestSha256, p_members_checked: verified.membersChecked,
});
check('the verification records as matched', !verifyError && outcome === 'matched',
  verifyError ? verifyError.message : String(outcome));

// ── 4 — the attestation, and what it does not unlock ──────────────────────────────────────────
const { error: attestError } = await asAnalyst.rpc('record_vault_attestation', {
  p_export_id: finished.export_id,
  p_destination: 'm10 live run — no file was actually moved',
  p_statement: 'Recorded by scripts/live/m10-export-queue-live.mjs to exercise the attestation path.',
});
check('an attestation records against the export', !attestError, attestError ? attestError.message : 'recorded');

const { error: approvalError } = await asAnalyst.rpc('approve_package_purge', {
  p_package_id: packageId, p_export_id: finished.export_id, p_package_digest: 'a'.repeat(64),
});
check('and approval still refuses, because nobody holds purge_approver',
  /only a purge approver/.test(approvalError?.message ?? ''),
  approvalError ? approvalError.message.slice(0, 80) : 'APPROVED — the gate is open');

// ── 5 — the staged copy goes; the record stays ────────────────────────────────────────────────
const { error: discardError } = await asAnalyst.rpc('request_export_discard', { p_request_id: requested.id });
check('an analyst can ask for the staged copy to go', !discardError,
  discardError ? discardError.message : 'requested');

const discard = await claimNextExportDiscard(service);
check('the worker claims the discard', discard?.id === requested.id, discard ? 'claimed' : 'nothing claimed');
await runExportDiscard(discard, { client: service, bucket: DOCUMENTS_BUCKET });

const { data: exportsLeft } = await service.storage.from(DOCUMENTS_BUCKET).list(EXPORT_PREFIX);
check('the staged archive is gone from the bucket',
  !(exportsLeft ?? []).some((e) => e.name === `${requested.id}.tar`),
  `${(exportsLeft ?? []).length} archive(s) still staged`);

const { data: after } = await service
  .from('package_exports').select('id, manifest_sha256').eq('id', finished.export_id).single();
check('and the export record — the anchor the gate reads — is untouched',
  after?.manifest_sha256 === exportRow.manifest_sha256,
  // The whole point of the discard: the export happened, and the second full copy of the PII did
  // not have to outlive the download.
  `export ${String(after?.id).slice(0, 8)}… still recorded`);

const { data: bodiesLeft } = await service.storage.from(DOCUMENTS_BUCKET).list(packageId);
check('no document body was removed by any of this', (bodiesLeft ?? []).length > 0,
  `${(bodiesLeft ?? []).length} entries still under ${packageId}/`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
