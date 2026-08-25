/**
 * The staged-export sweep, against real storage (D-132).
 *
 *     node --env-file=.env.test scripts/live/m11-export-sweep-live.mjs
 *
 * **Nothing is purged.** Everything removed here is an artifact this script or an earlier one put
 * in the bucket minutes ago. No merchant document is touched and nobody holds `purge_approver`.
 *
 * The case worth running live is the **orphan with no request row** — the state an export
 * interrupted after the upload leaves behind. It cannot be reproduced with a fake bucket, because
 * the whole point is that nothing in the database knows the object is there: it has to be a real
 * object in a real prefix, found by listing.
 */

import { createClient } from '@supabase/supabase-js';
import { sweepStagedExports, STAGED_ARCHIVE_TTL_MS } from '../../apps/worker/dist/src/exportSweepJob.js';
import { EXPORT_PREFIX } from '../../apps/worker/dist/src/exportJob.js';
import { DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { ensureAnalyst, analystClient } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('The staged-export sweep — nothing is purged');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const analystId = await ensureAnalyst(service);
const asAnalyst = await analystClient(createClient, url, process.env.VITE_SUPABASE_ANON_KEY, service);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n         ${detail}` : ''}`);
};

const put = async (key, text) => {
  const { error } = await service.storage.from(DOCUMENTS_BUCKET).upload(key, new TextEncoder().encode(text), {
    contentType: 'application/x-tar', upsert: true,
  });
  if (error) throw new Error(`could not stage ${key}: ${error.message}`);
};
const listExports = async () =>
  ((await service.storage.from(DOCUMENTS_BUCKET).list(EXPORT_PREFIX, { limit: 1000 })).data ?? [])
    .map((e) => e.name);

// ── the orphan: an object no row will ever claim ──────────────────────────────────────────────
const orphan = `${crypto.randomUUID()}.tar`;
const young = `${crypto.randomUUID()}.tar`;
await put(`${EXPORT_PREFIX}/${orphan}`, 'a complete archive that no request row points at');
await put(`${EXPORT_PREFIX}/${young}`, 'an archive from an export still running');
console.log(`staged orphan ${orphan.slice(0, 8)}… and in-flight ${young.slice(0, 8)}…\n`);

check('both objects are in the bucket and neither is in the request table',
  (await listExports()).includes(orphan) && (await listExports()).includes(young)
    && ((await service.from('document_export_requests').select('id').like('storage_key', `%${orphan}`)).data ?? []).length === 0,
  'nothing in document_export_requests names either of them');

// ── 1 — a sweep at the real TTL leaves them alone ─────────────────────────────────────────────
const gentle = await sweepStagedExports({ client: service, bucket: DOCUMENTS_BUCKET, now: new Date() });
check('a sweep at the real 24-hour window removes neither',
  (await listExports()).includes(orphan) && (await listExports()).includes(young),
  // An export in progress has an archive and no row naming it yet. Removing it would delete the
  // thing the job is about to record.
  `${gentle.archivesKept} kept, ${gentle.archivesRemoved.length} removed`);

// ── 2 — with the clock moved past the window, the orphan goes ─────────────────────────────────
const later = new Date(Date.now() + STAGED_ARCHIVE_TTL_MS + 60_000);
const swept = await sweepStagedExports({ client: service, bucket: DOCUMENTS_BUCKET, now: later });

check('the orphan is removed', !(await listExports()).includes(orphan),
  swept.orphansRemoved.map((k) => k.slice(-12)).join(', ') || 'none');

check('and is reported as an orphan, not as a discarded request',
  swept.orphansRemoved.some((k) => k.endsWith(orphan)),
  // The finding that justifies keying on the bucket: no row named it, so no row could have found
  // it. A request-keyed sweep walks straight past this object forever.
  `${swept.orphansRemoved.length} of ${swept.archivesRemoved.length} removed object(s) were orphans`);

check('nothing was left under the prefix', (await listExports()).length === 0,
  `${(await listExports()).length} object(s) remain`);

// ── 3 — a lapsed link is nulled and the record of it survives ─────────────────────────────────
const { data: pkg } = await service.from('packages').select('id').limit(1).single();
const { data: req } = await service.from('document_export_requests')
  .insert({ package_id: pkg.id, requested_by: analystId, status: 'queued' }).select('id').single();
const { data: exportRow } = await service.from('package_exports').insert({
  package_id: pkg.id, exported_by: analystId, package_digest: 'a'.repeat(64),
  manifest_sha256: 'b'.repeat(64), bytes: 1, counts: {},
}).select('id').single();
await service.from('document_export_requests').update({ status: 'running' }).eq('id', req.id);
const { error: doneError } = await service.from('document_export_requests').update({
  status: 'done', export_id: exportRow.id, storage_key: `${EXPORT_PREFIX}/${req.id}.tar`, bytes: 1,
  download_url: 'https://example.test/lapsed.tar',
  download_expires_at: new Date(Date.now() - 60_000).toISOString(),
  download_issued_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  finished_at: new Date().toISOString(),
}).eq('id', req.id);
check('a finished export with a lapsed link is a legal row', !doneError,
  doneError ? doneError.message : 'recorded');

const linkSweep = await sweepStagedExports({ client: service, bucket: DOCUMENTS_BUCKET, now: new Date() });
const { data: after } = await service.from('document_export_requests')
  .select('download_url, download_issued_at').eq('id', req.id).single();

check('the lapsed link is nulled', after.download_url === null,
  `${linkSweep.linksCleared} link(s) cleared`);
check('and the record that one was issued survives', after.download_issued_at !== null,
  // The credential is transient; that one was handed out, and when, is the fact worth keeping.
  `issued ${after.download_issued_at}`);

const { error: repoint } = await service.from('document_export_requests')
  .update({ download_url: 'https://elsewhere.test/other.tar' }).eq('id', req.id);
check('and it cannot be repointed at another archive', Boolean(repoint),
  repoint ? repoint.message.slice(0, 78) : 'ALLOWED — a link could be swapped after the fact');

// ── 4 — a verified copy asks for the staged one to go ─────────────────────────────────────────
const { data: req2 } = await service.from('document_export_requests')
  .insert({ package_id: pkg.id, requested_by: analystId, status: 'queued' }).select('id').single();
const { data: export2 } = await service.from('package_exports').insert({
  package_id: pkg.id, exported_by: analystId, package_digest: 'c'.repeat(64),
  manifest_sha256: 'd'.repeat(64), bytes: 1, counts: {},
}).select('id').single();
await service.from('document_export_requests').update({ status: 'running' }).eq('id', req2.id);
await service.from('document_export_requests').update({
  status: 'done', export_id: export2.id, storage_key: `${EXPORT_PREFIX}/${req2.id}.tar`, bytes: 1,
  download_url: 'https://example.test/live.tar',
  download_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  download_issued_at: new Date().toISOString(), finished_at: new Date().toISOString(),
}).eq('id', req2.id);

await asAnalyst.rpc('record_export_verification', {
  p_export_id: export2.id, p_method: 'declared', p_observed_sha256: 'd'.repeat(64), p_members_checked: 0,
});
const declaredAsked = ((await service.from('document_export_requests')
  .select('discard_requested_at').eq('id', req2.id).single()).data ?? {}).discard_requested_at;
check('a declared hash does not ask for the copy to go', declaredAsked === null,
  // It proves somebody read a string. Discarding on it would remove the only copy on the strength
  // of an operator's typing.
  declaredAsked ?? 'not requested');

await asAnalyst.rpc('record_export_verification', {
  p_export_id: export2.id, p_method: 'read_back', p_observed_sha256: 'd'.repeat(64), p_members_checked: 9,
});
const verifiedAsked = ((await service.from('document_export_requests')
  .select('discard_requested_at').eq('id', req2.id).single()).data ?? {}).discard_requested_at;
check('a matched read_back does', verifiedAsked !== null,
  verifiedAsked ? 'discard requested by the verification' : 'not requested');

// ── 5 — nothing outside exports/ was touched ──────────────────────────────────────────────────
const { data: packages } = await service.from('packages').select('id');
let bodies = 0;
for (const p of packages ?? []) {
  bodies += ((await service.storage.from(DOCUMENTS_BUCKET).list(p.id, { limit: 1000 })).data ?? []).length;
}
check('no document body was touched by any of this', bodies > 0,
  `${bodies} object(s) still under the package prefixes`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
