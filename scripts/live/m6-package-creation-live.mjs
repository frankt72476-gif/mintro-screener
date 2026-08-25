/**
 * Package creation, live, through the same calls the UI makes.
 *
 *     node --env-file=.env.test scripts/live/m6-package-creation-live.mjs
 *
 * Nothing here inserts a package row. It calls `ensure_merchant` and `create_document_package` —
 * the two `security definer` functions the browser calls — and then takes the package the whole
 * way: upload, checks, report, send.
 *
 * It calls them **as a signed-in analyst**, not as `service_role`. That distinction turned out to
 * matter: `service_role` has no `auth.uid()`, so it fails `is_analyst()` and cannot exercise these
 * functions at all — a script holding it tests what a privileged process may do, which is a
 * different question from what an operator may do. The anon refusal is asserted at the end.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadDocumentsRules, loadSlotTemplate, composeSet, impossibleSlotKeys, toRows } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { ingestDocument } from '../../apps/worker/dist/src/ingest.js';
import { createIngestStore, DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { identityOf, claimNextSend, runSend } from '../../apps/worker/dist/src/documentsSendJob.js';
import { packageDigest } from '../../apps/worker/dist/src/documentsReportGate.js';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { snapshotOf } from './snapshot.mjs';
import { ensureAnalyst, analystClient } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('Package creation to send, through the calls the UI makes');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const rules = loadDocumentsRules();
const template = loadSlotTemplate(rules);
const store = createIngestStore({ client: service, bucket: DOCUMENTS_BUCKET }, DOCUMENTS_BUCKET);
const runStore = createDocumentRunStore(service);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`);
};

const analystId = await ensureAnalyst(service);

// The operator's own session. `service_role` bypasses RLS and has no `auth.uid()`, so it fails
// `is_analyst()` — a script holding it cannot exercise what an analyst may do, only what a
// privileged process may do, which is a different question.
const asAnalyst = await analystClient(createClient, url, process.env.VITE_SUPABASE_ANON_KEY, service);

const { data: merchantId, error: mErr } = await asAnalyst.rpc('ensure_merchant', {
  p_legal_name: 'Harborline Peptides LLC',
  p_domain: `harborline-${Date.now()}.example`,
  // The operator's label for finding this package. NOT the report's DBA — that one is extracted
  // and compared in C-02, and nothing here reaches the masthead (D-126, D-129).
  p_dba: 'Harborline',
});
check('a merchant is created through ensure_merchant', !mErr && Boolean(merchantId),
  mErr ? mErr.message : `merchant ${String(merchantId).slice(0, 8)}...`);

/*
  The three answers.

  A sole proprietorship has no Articles to supply (D-081). Domicile is left **unanswered**, which
  under D-129 is not a default but a recorded state: both tax forms stay in the set, because with
  nobody having established the domicile neither can be called impossible. The assertion below is
  on that, not merely on the Articles.
*/
const facts = { entityType: 'sole_proprietor', hasExistingProcessor: null, usDomiciled: null };
const composed = composeSet(facts, template);
check('a sole proprietorship is not offered Articles',
  !composed.offered.some((s) => s.slotKey === 'articles_of_incorporation')
    && composed.impossible.some((s) => s.slotKey === 'articles_of_incorporation'),
  `${composed.offered.length} offered, ${composed.impossible.length} impossible: `
    + composed.impossible.map((s) => s.slotKey).join(', '));

const offeredKeys = composed.offered.map((s) => s.slotKey);
check('an unanswered domicile leaves both tax forms in the set',
  offeredKeys.includes('w9') && offeredKeys.includes('w8ben')
    && !composed.impossible.some((s) => s.slotKey === 'w9' || s.slotKey === 'w8ben'),
  `offered: ${offeredKeys.filter((k) => k === 'w9' || k === 'w8ben').join(', ') || 'neither'}`);

// The operator adjusts: one default out, one named instance in.
const { slots, removals } = toRows(composed, [
  { slotKey: 'proof_of_domain', included: false },
  { slotKey: 'business_license', included: true, instanceLabel: 'DE pharmacy licence' },
]);
check('the adjustment produces slots and a recorded removal',
  removals.length === 1 && slots.some((s) => s.instance_label === 'DE pharmacy licence'),
  `${slots.length} slots, removing ${removals.map((r) => `${r.slot_key} (${r.origin})`).join(', ')}`);

const { data: packageId, error: pErr } = await asAnalyst.rpc('create_document_package', {
  p_merchant_id: merchantId,
  p_processor_key: 'default',
  p_slots: slots,
  p_removals: removals,
  p_entity_type: facts.entityType,
  p_has_existing_processor: facts.hasExistingProcessor,
  p_us_domiciled: facts.usDomiciled,
});
if (pErr) throw new Error(`create_document_package: ${pErr.message}`);

// The answers reach the row, and the unanswered ones stay unanswered (D-129). Before 0034 they
// were React state that produced a slot list and was then discarded, so "why is this slot here"
// answered "because of an answer nobody recorded".
const { data: factRow } = await service.from('packages')
  .select('entity_type, has_existing_processor, us_domiciled, facts_set_by')
  .eq('id', packageId).single();
check('the answers are recorded on the package, unknown included',
  factRow.entity_type === 'sole_proprietor' && factRow.has_existing_processor === null
    && factRow.us_domiciled === null && factRow.facts_set_by !== null,
  JSON.stringify(factRow));

const { data: created } = await service.from('slots')
  .select('id, slot_key, origin, instance_label, state, required_count').eq('package_id', packageId);
const { data: recorded } = await service.from('package_slot_removals')
  .select('slot_key, origin').eq('package_id', packageId);

const origins = new Set(created.map((s) => s.origin));
check('origin survives to the database for all three kinds', origins.size === 3, [...origins].sort().join(', '));

/*
  Answering the domicile afterwards.

  `slots_are_never_deleted` (D-097), so this is a waive: the W-8BEN row that was created while the
  domicile was unknown stays, with `not_applicable_to_entity_type` and `resolved_by = 'fact'`. The
  row before and after is what proves it was a transition rather than a removal.
*/
const w8Before = created.find((s) => s.slot_key === 'w8ben');
const { data: waivedCount, error: fErr } = await asAnalyst.rpc('set_package_facts', {
  p_package_id: packageId,
  p_entity_type: 'sole_proprietor',
  p_has_existing_processor: null,
  p_us_domiciled: true,
  p_waive: impossibleSlotKeys({ ...facts, usDomiciled: true }, template),
});
const { data: afterFacts } = await service.from('slots')
  .select('slot_key, state, reason, resolved_by').eq('package_id', packageId).eq('slot_key', 'w8ben').single();
check('answering the domicile waives the W-8BEN rather than deleting it',
  !fErr && waivedCount === 1 && afterFacts.state === 'waived'
    && afterFacts.reason === 'not_applicable_to_entity_type' && afterFacts.resolved_by === 'fact',
  fErr ? fErr.message : `waived ${waivedCount}: ${JSON.stringify(afterFacts)}`);
check('the W-8BEN row still exists, because slots are never deleted',
  Boolean(w8Before) && Boolean(afterFacts) && w8Before.state === 'missing',
  `before: ${w8Before?.state ?? 'absent'}, after: ${afterFacts?.state ?? 'absent'}`);

check('the removal is recorded, not merely absent',
  recorded.length === 1 && recorded[0].slot_key === 'proof_of_domain' && recorded[0].origin === 'required'
    && !created.some((s) => s.slot_key === 'proof_of_domain'),
  `removals: ${recorded.map((r) => r.slot_key).join(', ')}; the slot itself is absent from the set`);

check('the named instance carries its label',
  created.find((s) => s.slot_key === 'business_license')?.instance_label === 'DE pharmacy licence',
  created.find((s) => s.slot_key === 'business_license')?.instance_label ?? '(none)');

const unknown = created.find((s) => s.required_count === null);
check('an unknown-count slot is not_evaluable, never missing (D-107)',
  unknown?.state === 'not_evaluable', `${unknown?.slot_key} -> ${unknown?.state}`);

async function page(lines) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  lines.forEach((l, i) => p.drawText(l, { x: 50, y: 740 - i * 22, size: 11, font }));
  return new Uint8Array(await doc.save());
}

const appSlot = created.find((s) => s.slot_key === 'application');
await ingestDocument(
  {
    packageId,
    slotId: appSlot.id,
    filename: 'application.pdf',
    bytes: await page([
      'Business Legal Name: Harborline Peptides LLC',
      'EIN: 47-2841903',
      'Entity Type: Sole Proprietorship',
    ]),
  },
  { store },
);

const RUN_AT = new Date('2026-05-15T00:00:00Z');
const snapshot = await snapshotOf(service, packageId, RUN_AT);
const result = documents.runDocumentChecks(snapshot, rules, { runId: 'pending', families: ['A', 'B', 'C', 'D'] });
const identity = await identityOf(service, packageId);

const runSlots = snapshot.slots.map((s) => ({
  slotId: s.id, slotKey: s.slotKey, instanceLabel: s.instanceLabel,
  state: s.state, reason: s.reason, requiredCount: s.requiredCount, examined: s.examined,
}));
const runDocs = snapshot.documents.map((d) => ({
  versionId: d.versionId, slotId: d.slotId, slotKey: d.slotKey,
  filename: d.originalFilename, outcome: d.outcome, tier: documents.tierOf(d),
}));

const run = await runStore.persist({
  packageId, runAt: RUN_AT, rulesetVersion: rules.checks.version, engineVersion: '0.1.0',
  families: ['A', 'B', 'C', 'D'], findings: result.findings, slots: runSlots, documents: runDocs,
  packageDigest: packageDigest({
    slots: runSlots.map((s) => ({ slotId: s.slotId, state: s.state, reason: s.reason, requiredCount: s.requiredCount })),
    documents: runDocs.map((d) => ({ versionId: d.versionId, outcome: d.outcome })),
  }),
  merchantName: identity.merchantName,
  merchantDomain: identity.merchantName,
});
check('a package created through the flow runs checks', run.findingCount > 0,
  `${run.findingCount} findings, ${JSON.stringify(documents.tally(result.findings))}`);

await service.from('document_send_requests').insert({
  package_id: packageId, run_id: run.runId, to_email: 'underwriting@iqwallet.example',
  requested_by: analystId, status: 'queued',
});

const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const claimed = await claimNextSend(service);
  await runSend(claimed, { client: service, browser, origin: server.origin });
  const { data: done } = await service.from('document_send_requests')
    .select('status, outcome').eq('id', claimed.id).single();
  const sends = await runStore.sendsOf(packageId);
  check('and the report sends', done.status === 'done' && sends.length === 1,
    `status=${done.status}, outcome=${done.outcome}, ${sends[0]?.pdf_bytes} bytes`);
} finally {
  await browser.close().catch(() => undefined);
  await server.close();
}

// The functions are reachable by an analyst, not by anyone.
const { error: anonErr } = await anon.rpc('ensure_merchant', { p_legal_name: 'Nope Ltd', p_domain: null });
check('an unauthenticated caller cannot create a merchant', anonErr !== null,
  anonErr ? anonErr.message.slice(0, 80) : 'ALLOWED - the function is open');

console.log(`\npackage ${packageId}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
