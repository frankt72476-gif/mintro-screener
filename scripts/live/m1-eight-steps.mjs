/**
 * The M1 live verification, against a real Supabase project.
 *
 *     node --env-file=.env.test scripts/live/m1-eight-steps.mjs
 *
 * **This is a reconstruction, not a replay.** The original eight steps were an inline heredoc that
 * no longer exists, so these are rebuilt from the M1 brief. Where a step here differs from what
 * was run against production, this file is now the definition — it is the one that can be run
 * again.
 *
 * What it is for: PGlite proves the schema, and fakes prove the pipeline, but neither exercises
 * `supabase-js → PostgREST → SQL`, and neither can test storage privacy at all. Both of those have
 * produced defects that every offline test passed.
 *
 * It writes. Runs are immutable and evidence is append-only (D-002, D-097), so everything it
 * writes stays written — which is why `assertTestProject()` runs first and refuses anything but
 * the test project.
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sha256 } from '@mintro/extraction';
import { slotsForPackage } from '@mintro/ruleset';
import { ingestDocument } from '../../apps/worker/dist/src/ingest.js';
import { createIngestStore, DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { openRasterizer } from '../../apps/worker/dist/src/rasterize.js';
import { banner, assertTestProject } from './guard.mjs';

banner('M1 — eight steps, live (reconstruction)');
const { url } = assertTestProject();
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const results = [];
const step = (n, name, ok, detail) => {
  results.push({ n, name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}. ${name}\n         ${detail}`);
};

/** A small, deterministic text-layer PDF standing in for a merchant document. */
async function statementPdf(marker) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const put = (t, y) => page.drawText(t, { x: 50, y, size: 11, font });
  put('Harbor Mutual Savings — Business Checking Statement', 740);
  put('Business Legal Name: Northwind Peptides LLC', 700);
  put('Statement Period: 2026-04-01 - 2026-04-30', 676);
  put('Bank Routing #: 122105155', 652);
  put('Account Number: 000123456789', 628);
  put(`Reference: ${marker}`, 604);
  return new Uint8Array(await doc.save());
}

const rasterizer = await openRasterizer();

try {
  // --- 1 ---------------------------------------------------------------------------------------
  const wanted = ['packages', 'slots', 'documents', 'document_versions', 'extractions', 'document_retrievals', 'document_uploads'];
  const present = [];
  for (const t of wanted) {
    const { error } = await service.from(t).select('*', { count: 'exact', head: true });
    if (error === null) present.push(t);
  }
  step(1, 'schema reachable through PostgREST', present.length === wanted.length,
    `${present.length}/${wanted.length} tables answer: ${present.join(', ')}`);

  // --- 2 ---------------------------------------------------------------------------------------
  const { data: merchant } = await service
    .from('merchants').upsert({ domain: 'northwind-peptides.example' }, { onConflict: 'domain' })
    .select('id').single();

  const { data: pkg, error: pkgError } = await service
    .from('packages')
    .insert({ merchant_id: merchant.id, processor_key: 'default', template_version: '1', lifecycle: 'open', retention_days: 365 })
    .select('id').single();
  if (pkgError) throw new Error(`package insert: ${pkgError.message}`);

  const facts = { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true };
  const definitions = slotsForPackage(facts);
  const { data: slots, error: slotError } = await service
    .from('slots')
    .insert(definitions.map((d) => ({
      package_id: pkg.id,
      slot_key: d.slotKey,
      required_count: d.requiredCount,
      coverage_monthly: d.monthly,
      // The schema requires grace exactly for monthly slots (`grace_is_set_exactly_for_monthly_slots`),
      // while SlotDefinition carries DEFAULT_GRACE_DAYS on every definition. Nothing in the repo maps
      // definitions to rows yet, so this is the first code to meet that mismatch — reported, not
      // papered over: the seeding code M1 still needs has to do this too.
      coverage_grace_days: d.monthly ? d.graceDays : null,
      expiry_after_run: d.expiryAfterRun,
      // MISMATCH, reported not resolved: `slots_origin_check` allows only 'template' | 'added',
      // while rules/documents.templates.json and the engine's SlotSnapshot use
      // 'required' | 'conditional' | 'added'. Mapped here so the run can proceed; the two
      // vocabularies need reconciling and that is a ruling, not a script's decision.
      origin: 'template',
      examined: d.examined,
      // `not_evaluable_means_the_count_is_unknown` is an iff, so D-107 is enforced by the schema:
      // a slot whose count is unknown cannot be recorded as `missing`. That is the constraint doing
      // exactly its job — we do not know how many to expect, so we cannot say any are absent.
      state: d.requiredCount === null ? 'not_evaluable' : 'missing',
    })))
    .select('id, slot_key, required_count, state');
  if (slotError) throw new Error(`slot insert: ${slotError.message}`);

  const unknownCount = slots.filter((s) => s.required_count === null).map((s) => s.slot_key);
  step(2, 'package and slots seeded from the template', slots.length === definitions.length,
    `${slots.length} slots; ${unknownCount.length} with an unknown required count (${unknownCount.join(', ') || 'none'})`);

  const bankSlot = slots.find((s) => s.slot_key === 'bank_statement');
  if (!bankSlot) throw new Error('no bank_statement slot was seeded');

  // --- 3 ---------------------------------------------------------------------------------------
  const bytes = await statementPdf('LIVE-M1');
  const stagingKey = `staging/${pkg.id}/statement.pdf`;
  const { error: upErr } = await service.storage.from(DOCUMENTS_BUCKET)
    .upload(stagingKey, bytes, { contentType: 'application/pdf', upsert: false });
  // `analysts.id` is a foreign key to `auth.users`, so an analyst is an authenticated person and
  // not a row someone can invent. An upload has to name one — which is the right shape, and is
  // also why this cannot be set up through PostgREST alone.
  const email = 'verify@gomintro.com';
  const existing = await service.auth.admin.listUsers();
  const found = (existing.data?.users ?? []).find((u) => u.email === email);
  const authUser = found ?? (await service.auth.admin.createUser({ email, email_confirm: true })).data?.user;
  if (!authUser) throw new Error('could not create the auth user the analyst row needs');
  const { data: analyst, error: analystError } = await service
    .from('analysts').upsert({ id: authUser.id, email, active: true }, { onConflict: 'id' })
    .select('id').single();
  if (analystError) throw new Error(`analyst upsert: ${analystError.message}`);
  const { data: uploadRow, error: rowErr } = await service
    .from('document_uploads')
    .insert({ package_id: pkg.id, slot_id: bankSlot.id, staging_key: stagingKey,
              original_filename: 'statement.pdf', requested_by: analyst.id, status: 'queued' })
    .select('id, status').single();
  step(3, 'browser-side staged upload: bytes to the bucket, a row to the queue',
    !upErr && !rowErr && uploadRow?.status === 'queued',
    `${(bytes.length / 1024).toFixed(1)} KB at ${stagingKey}; upload row ${uploadRow?.id?.slice(0, 8)}… status=${uploadRow?.status}`);

  // --- 4 ---------------------------------------------------------------------------------------
  const store = createIngestStore({ client: service, bucket: DOCUMENTS_BUCKET }, DOCUMENTS_BUCKET);
  const first = await ingestDocument(
    { packageId: pkg.id, slotId: bankSlot.id, filename: 'statement.pdf', bytes },
    { store, pageImage: rasterizer.pageImage },
  );
  const { data: versionRow } = await service
    .from('document_versions').select('id, version, sha256, outcome, extraction').eq('id', first.versionId).single();
  const values = versionRow?.extraction?.values ?? [];
  step(4, 'ingest: document, version and extraction persisted',
    first.kind === 'ingested' && versionRow?.outcome === 'extracted' && values.length > 0,
    `${first.kind}, v${first.version}, outcome=${versionRow?.outcome}, ${values.length} values, sha=${versionRow?.sha256?.slice(0, 12)}…`);

  // --- 5 ---------------------------------------------------------------------------------------
  const second = await ingestDocument(
    { packageId: pkg.id, slotId: bankSlot.id, filename: 'statement-again.pdf', bytes },
    { store, pageImage: rasterizer.pageImage },
  );
  const { count: versionCount } = await service
    .from('document_versions').select('*', { count: 'exact', head: true })
    .eq('package_id', pkg.id).eq('sha256', sha256(bytes));
  step(5, 'same bytes do not create a second version (content-addressed)',
    second.versionId === first.versionId && versionCount === 1,
    `second ingest returned kind=${second.kind}, versionId ${second.versionId === first.versionId ? 'identical' : 'DIFFERENT'}; ${versionCount} row(s) for that sha`);

  // --- 6 ---------------------------------------------------------------------------------------
  const { data: stored } = await service
    .from('document_versions').select('storage_key').eq('id', first.versionId).single();
  const { error: overwrite } = await service.storage.from(DOCUMENTS_BUCKET)
    .upload(stored.storage_key, bytes, { contentType: 'application/pdf', upsert: false });
  const { error: updateErr } = await service
    .from('document_versions').update({ outcome: 'unreadable' }).eq('id', first.versionId);
  const { error: deleteErr } = await service
    .from('document_versions').delete().eq('id', first.versionId);
  const { count: stillThere } = await service
    .from('document_versions').select('*', { count: 'exact', head: true }).eq('id', first.versionId);
  step(6, 'append-only: no overwrite, no update, no delete',
    overwrite !== null && updateErr !== null && deleteErr !== null && stillThere === 1,
    `storage overwrite ${overwrite ? 'refused' : 'ALLOWED'}; update ${updateErr ? 'refused' : 'ALLOWED'}; ` +
    `delete ${deleteErr ? 'refused' : 'ALLOWED'}; row still present=${stillThere === 1}`);

  // --- 7 ---------------------------------------------------------------------------------------
  // The first draft asserted `state !== 'missing'` after one document. That was wrong, and the
  // schema was right: bank_statement requires three, one had arrived, and `missing` is the correct
  // answer. What is worth testing is the transition, so this supplies the rest and watches it move.
  const { data: beforeFill } = await service
    .from('slots').select('state, required_count').eq('id', bankSlot.id).single();

  for (const month of ['2026-02', '2026-03']) {
    await ingestDocument(
      { packageId: pkg.id, slotId: bankSlot.id, filename: `statement-${month}.pdf`, bytes: await statementPdf(month) },
      { store, pageImage: rasterizer.pageImage },
    );
  }

  const { data: afterFill } = await service
    .from('slots').select('state, required_count').eq('id', bankSlot.id).single();
  const { count: live } = await service
    .from('documents').select('*', { count: 'exact', head: true }).eq('slot_id', bankSlot.id);

  const ownerIdSlot = slots.find((s) => s.required_count === null);
  const { data: ownerAfter } = ownerIdSlot
    ? await service.from('slots').select('state, required_count').eq('id', ownerIdSlot.id).single()
    : { data: null };

  // D-107, end to end: a slot whose count nobody knows is `not_evaluable`, never `missing`. The
  // difference is whether an agent has something to chase, and inventing a number gives them one
  // that is not real.
  const unknownStaysUnknown = ownerAfter === null || (ownerAfter.state === 'not_evaluable' && ownerAfter.required_count === null);

  step(7, 'slot state and counts move with the documents',
    beforeFill.state === 'missing' && afterFill.state === 'satisfied' && live === 3 && unknownStaysUnknown,
    `bank_statement: ${beforeFill.state} at 1 of ${beforeFill.required_count} → ${afterFill.state} at ${live} of ${afterFill.required_count}; ` +
    `${ownerIdSlot ? `${ownerIdSlot.slot_key} state=${ownerAfter?.state} count=${ownerAfter?.required_count}` : 'no unknown-count slot seeded'}`);

  // --- 8 ---------------------------------------------------------------------------------------
  const key = stored.storage_key;
  const publicUrl = `${url}/storage/v1/object/public/${DOCUMENTS_BUCKET}/${key}`;
  const publicGet = await fetch(publicUrl);
  const anonGet = await anon.storage.from(DOCUMENTS_BUCKET).download(key);
  const anonRows = await anon.from('document_versions').select('id').limit(1);
  const anonList = await anon.storage.from(DOCUMENTS_BUCKET).list();
  const { data: signed } = await service.storage.from(DOCUMENTS_BUCKET).createSignedUrl(key, 60);
  const signedGet = await fetch(signed.signedUrl);
  const signedBytes = new Uint8Array(await signedGet.arrayBuffer());

  const noAnonBytes = publicGet.status >= 400 && anonGet.error !== null;
  const noAnonRows = anonRows.error !== null || (anonRows.data ?? []).length === 0;
  const signedWorks = signedGet.ok && sha256(signedBytes) === sha256(bytes);
  step(8, 'no unauthenticated path returns document bytes; the signed URL does',
    noAnonBytes && noAnonRows && signedWorks,
    `public URL ${publicGet.status}; anon download ${anonGet.error ? 'refused' : 'RETURNED BYTES'}; ` +
    `anon list ${(anonList.data ?? []).length} entries; anon rows ${noAnonRows ? 'none' : 'READABLE'}; ` +
    `signed URL ${signedGet.status}, sha ${signedWorks ? 'matches the uploaded bytes' : 'DOES NOT MATCH'}`);

  console.log(`\npackage ${pkg.id}`);
} finally {
  await rasterizer.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
if (failed.length > 0) {
  console.log(`failed: ${failed.map((f) => f.n).join(', ')}`);
  process.exit(1);
}
