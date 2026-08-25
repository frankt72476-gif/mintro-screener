/**
 * D-002, verified rather than reasoned about: a re-run creates a new run and leaves the prior
 * run's persisted findings byte-identical.
 *
 *     node --env-file=.env.test scripts/live/m1-eight-steps.mjs        # builds the package
 *     node --env-file=.env.test scripts/live/m3-persistence-live.mjs
 *
 * This is the check that was reported UNVERIFIABLE before 0027 existed. It could not be faked: two
 * runs of a pure function returning equal arrays shows the function is pure, which is not the
 * property. The property is that something written to a database survives a later write, and that
 * needs a database.
 *
 * The re-run is given **different inputs** — another document arrives between the two — so the
 * second run genuinely produces different findings. A re-run that changed nothing would pass this
 * test for the wrong reason.
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { ingestDocument } from '../../apps/worker/dist/src/ingest.js';
import { createIngestStore, DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { snapshotOf } from './snapshot.mjs';
import { packageDigest } from '../../apps/worker/dist/src/documentsReportGate.js';
import { identityOf } from '../../apps/worker/dist/src/documentsSendJob.js';
import { banner, assertTestProject } from './guard.mjs';

banner('D-002 — a re-run leaves the prior run untouched');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const rules = loadDocumentsRules();
const runStore = createDocumentRunStore(service);
const ingestStore = createIngestStore({ client: service, bucket: DOCUMENTS_BUCKET }, DOCUMENTS_BUCKET);

const { data: pkg } = await service
  .from('packages').select('id').order('created_at', { ascending: false }).limit(1).single();
if (!pkg) throw new Error('no package found — run m1-eight-steps.mjs first');
console.log(`package ${pkg.id}\n`);

const RUN_AT = new Date('2026-05-15T00:00:00Z');
const identity = await identityOf(service, pkg.id);
const meta = { merchantName: identity.merchantName, merchantDomain: identity.merchantName, rulesetVersion: rules.checks.version ?? 'documents-1', engineVersion: '0.1.0', families: ['A', 'B'] };

/** What a run must record about its inputs (D-123). */
const inputsOf = (snap) => {
  const slots = snap.slots.map((s) => ({
    slotId: s.id, slotKey: s.slotKey, instanceLabel: s.instanceLabel, state: s.state,
    reason: s.reason, requiredCount: s.requiredCount, examined: s.examined,
  }));
  const docs = snap.documents.map((d) => ({
    versionId: d.versionId, slotId: d.slotId, slotKey: d.slotKey,
    filename: d.originalFilename, outcome: d.outcome, tier: documents.tierOf(d),
  }));
  return {
    slots,
    documents: docs,
    packageDigest: packageDigest({
      slots: slots.map((s) => ({ slotId: s.slotId, state: s.state, reason: s.reason, requiredCount: s.requiredCount })),
      documents: docs.map((d) => ({ versionId: d.versionId, outcome: d.outcome })),
    }),
  };
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`);
};

// --- run 1 --------------------------------------------------------------------------------------
const snap1 = await snapshotOf(service, pkg.id, RUN_AT);
const engine1 = documents.runDocumentChecks(snap1, rules, { runId: 'pending', families: ['A', 'B'] });
const run1 = await runStore.persist({ packageId: pkg.id, runAt: RUN_AT, ...meta, findings: engine1.findings, ...inputsOf(snap1) });
const stored1 = await runStore.findingsOf(run1.runId);
const before = JSON.stringify(stored1);

check('run 1 persisted', stored1.length === engine1.findings.length && stored1.length > 0,
  `run ${run1.runId.slice(0, 8)}… — ${engine1.findings.length} findings from the engine, ${stored1.length} rows read back`);

// State, reason and tier survived the round trip, which is the part a JSON blob would fake.
const ne = stored1.filter((f) => f.state === 'not_evaluable');
const tiered = stored1.filter((f) => f.tier !== null);
check('state, named reason and computed tier all persisted',
  ne.length > 0 && ne.every((f) => f.not_evaluable_reason) && tiered.every((f) => f.read_versions.length > 0),
  `${ne.length} not_evaluable, all with a reason; ${tiered.length} carry a tier and each names the version(s) it read`);

// --- the package changes --------------------------------------------------------------------------
/**
 * A distinct EIN letter per execution.
 *
 * The first version of this script used fixed bytes, and on its second execution the "new" document
 * was content-addressed to the one already there — so the package did not change, the two runs
 * produced identical findings, and the vacuity guard below failed the script rather than letting it
 * pass for the wrong reason. The nonce comes from how many runs the package already has, so it is a
 * function of state rather than of the clock.
 */
async function einLetter(nonce) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const put = (t, y) => page.drawText(t, { x: 50, y, size: 11, font });
  put('INTERNAL REVENUE SERVICE — Notice CP 575 A', 740);
  put('We assigned you an Employer Identification Number', 716);
  put('Business Legal Name: Northwind Peptides LLC', 690);
  put('EIN: 47-2841903', 666);
  put(`Notice sequence: ${nonce}`, 642);
  return new Uint8Array(await doc.save());
}

const einSlot = snap1.slots.find((s) => s.slotKey === 'ein_letter');
const nonce = (await runStore.runsOf(pkg.id)).length;
const added = await ingestDocument(
  { packageId: pkg.id, slotId: einSlot.id, filename: `ein-letter-${nonce}.pdf`, bytes: await einLetter(nonce) },
  { store: ingestStore },
);
console.log(`\n  a document arrives between the runs: ${added.kind}, outcome=${added.outcome}\n`);

// --- run 2 --------------------------------------------------------------------------------------
const snap2 = await snapshotOf(service, pkg.id, RUN_AT);
const engine2 = documents.runDocumentChecks(snap2, rules, { runId: 'pending', families: ['A', 'B'] });
const run2 = await runStore.persist({ packageId: pkg.id, runAt: RUN_AT, ...meta, findings: engine2.findings, ...inputsOf(snap2) });

const after = JSON.stringify(await runStore.findingsOf(run1.runId));
const stored2 = await runStore.findingsOf(run2.runId);

check('a re-run created a new run, not a replacement', run2.runId !== run1.runId,
  `run 1 ${run1.runId.slice(0, 8)}…, run 2 ${run2.runId.slice(0, 8)}…`);

check('the second run genuinely differs, so the test is not vacuous',
  stored2.length !== stored1.length,
  `${stored1.length} findings → ${stored2.length}`);

check("run 1's findings are byte-identical after run 2", before === after,
  before === after ? `${before.length} bytes, unchanged` : 'THE PRIOR RUN CHANGED');

const runs = await runStore.runsOf(pkg.id);
check('both runs are listed against the package', runs.length >= 2,
  `${runs.length} runs on this package`);

// --- and the triggers, because a property nobody attacked is a property nobody has ----------------
const { error: updErr } = await service
  .from('document_findings').update({ state: 'pass' }).eq('run_id', run1.runId);
const { error: delErr } = await service
  .from('document_findings').delete().eq('run_id', run1.runId);
const { error: runUpdErr } = await service
  .from('document_runs').update({ run_at: new Date().toISOString() }).eq('id', run1.runId);
const { error: runDelErr } = await service
  .from('document_runs').delete().eq('id', run1.runId);
const afterAttack = JSON.stringify(await runStore.findingsOf(run1.runId));

check('append-only holds against service_role, which bypasses RLS',
  !!updErr && !!delErr && !!runUpdErr && !!runDelErr && afterAttack === before,
  `finding update ${updErr ? 'refused' : 'ALLOWED'}, delete ${delErr ? 'refused' : 'ALLOWED'}; ` +
  `run update ${runUpdErr ? 'refused' : 'ALLOWED'}, delete ${runDelErr ? 'refused' : 'ALLOWED'}; ` +
  `bytes ${afterAttack === before ? 'unchanged' : 'CHANGED'}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`failed: ${failed.map((f) => f.name).join('; ')}`);
process.exit(failed.length === 0 ? 0 : 1);
