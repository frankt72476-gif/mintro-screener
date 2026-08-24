/**
 * M4 live — a package with documents across several types, all 38 v1 checks, findings persisted.
 *
 *     node --env-file=.env.test scripts/live/m4-all-checks-live.mjs
 *
 * Builds its own package rather than reusing the M1 one: families C and D need documents that
 * disagree with each other in specific, chosen ways, and a package assembled for a different
 * purpose would exercise the interesting branches by accident or not at all.
 *
 * The disagreements are deliberate and each one is named where it is planted, so a reader can
 * check the findings against what was actually put in front of the engine.
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadDocumentsRules, slotsForPackage } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { ingestDocument } from '../../apps/worker/dist/src/ingest.js';
import { createIngestStore, DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { snapshotOf } from './snapshot.mjs';
import { slotRow } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('M4 — all 38 v1 checks against a real package');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const rules = loadDocumentsRules();
const store = createIngestStore({ client: service, bucket: DOCUMENTS_BUCKET }, DOCUMENTS_BUCKET);
const runStore = createDocumentRunStore(service);

/** A one-page text PDF of label/value lines. Deterministic. */
async function page(lines) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  lines.forEach((line, i) => p.drawText(line, { x: 50, y: 740 - i * 22, size: 11, font }));
  return new Uint8Array(await doc.save());
}

const stamp = Date.now();
const { data: merchant } = await service
  .from('merchants').upsert({ domain: `m4-${stamp}.example` }, { onConflict: 'domain' }).select('id').single();
const { data: pkg } = await service
  .from('packages')
  .insert({ merchant_id: merchant.id, processor_key: 'default', template_version: '1', lifecycle: 'open', retention_days: 365 })
  .select('id').single();

const definitions = slotsForPackage({ entityType: 'llc', hasExistingProcessor: true, usDomiciled: true });
const { data: slots } = await service
  .from('slots').insert(definitions.map((d) => slotRow(pkg.id, d))).select('id, slot_key');
const slotId = (key) => slots.find((s) => s.slot_key === key)?.id;

console.log(`package ${pkg.id} — ${slots.length} slots\n`);

/**
 * The documents, with their disagreements marked.
 *
 * Where two documents state a field, they agree unless the comment says otherwise. The planted
 * discrepancies are the point: a run in which everything agrees exercises only the pass branches.
 */
const PLAN = [
  ['application', [
    'Business Legal Name: Northwind Peptides LLC',
    'DBA Name: Northwind Labs',
    'EIN: 47-2841903',
    'Business Address: 1420 Harbor View Road, Suite 200',
    'Entity Type: Limited Liability Company',
    'State of Formation: Delaware',
    'Formation Date: 04/02/2019',
    'Bank Name: Harbor Mutual Savings',
    'Bank Routing #: 122105155',
    'Account Number: 000123456789',
    'Owner Name: Jane A Smith',
    'Ownership %: 60%',
    'Owner Name: John B Doe',
    'Ownership %: 40%',
    'Date of Birth: 1984-02-11',
    'Signer Name: Jane A Smith',
    'Prior Processor: Stripe',
    'Stated Monthly Volume: $250,000',
    'Average Ticket Amount: $125',
    'High Ticket Amount: $2,400',
    'Chargeback Rate: 0.12%',
  ]],
  // Agrees with the application wherever it speaks — the pass side of C-01, C-03, C-04.
  ['ein_letter', [
    'INTERNAL REVENUE SERVICE — Notice CP 575 A',
    'We assigned you an Employer Identification Number',
    'Business Legal Name: NORTHWIND PEPTIDES, L.L.C.',
    'EIN: 47-2841903',
    'Business Address: 1420 HARBOR VIEW RD STE 200',
  ]],
  // Second source for C-05, C-06, C-07 and C-15. State written as a code, date in another format,
  // entity type in yet another wording — the normalisers should fold all three.
  ['articles_of_incorporation', [
    'Business Legal Name: Northwind Peptides, LLC',
    'Entity Type: LLC',
    'State of Formation: DE',
    'Formation Date: 2019-04-02',
    'Owner Name: Jane A Smith',
    'Signer Name: SMITH, JANE A',
  ]],
  ['w9', [
    'Business Legal Name: Northwind Peptides LLC',
    'Tax Classification: Limited Liability Company',
    'EIN: 47-2841903',
  ]],
  // PLANTED: routing number differs in the last digit. C-08 is exact, so a fail.
  ['voided_check', [
    'Bank Name: Harbor Mutual Savings',
    'Account Holder: Northwind Labs',
    'Bank Routing #: 122105156',
    'Account Number: 000123456789',
  ]],
  ['bank_statement', [
    'Bank Name: Harbor Mutual Savings',
    'Statement Period: 2026-04-01 - 2026-04-30',
    'Account Number: 000123456789',
    'Account Holder: Northwind Labs',
    'Deposits: $402,150.00',
  ]],
  // PLANTED: the letterhead names a different processor from the application. C-18 reviews.
  ['processing_statement', [
    'Processor Name: Square',
    'Statement Period: 2026-04-01 - 2026-04-30',
    'Processing Volume: $410,000.00',
    'Transaction Count: 3280',
    'High Ticket: $2,400.00',
    'Chargeback Count: 4',
  ]],
  // PLANTED: one ID for two owners at 60/40. C-13 is exact, so a fail.
  // PLANTED: the DOB differs from the application by one day. C-16 is exact, so a fail.
  ['owner_photo_id', [
    'Owner Name: SMITH, JANE A',
    'Date of Birth: 1984-02-12',
    'Expires: 2029-06-30',
  ]],
  ['proof_of_domain', [
    'Registrant Name: Northwind Labs',
    'Domain Name: northwindpeptides.com',
  ]],
];

for (const [slotKey, lines] of PLAN) {
  const id = slotId(slotKey);
  if (id === undefined) {
    console.log(`  (no ${slotKey} slot in this template — skipped)`);
    continue;
  }
  const result = await ingestDocument(
    { packageId: pkg.id, slotId: id, filename: `${slotKey}.pdf`, bytes: await page(lines) },
    { store },
  );
  const values = result.kind === 'ingested' ? '' : ` (${result.kind})`;
  console.log(`  ${slotKey.padEnd(24)} ${result.outcome ?? result.kind}${values}`);
}

/** A stand-in directory for C-10. The real one is a Federal Reserve download; this is one row. */
const routingDirectory = (n) => (n === '122105155' ? 'HARBOR MUTUAL SAVINGS BANK, N.A.' : null);

const RUN_AT = new Date('2026-05-15T00:00:00Z');
const snapshot = await snapshotOf(service, pkg.id, RUN_AT);
console.log(`\n${snapshot.documents.length} documents read\n`);

const result = documents.runDocumentChecks(snapshot, rules, {
  runId: 'pending',
  families: ['A', 'B', 'C', 'D'],
  routingDirectory,
});

const v1 = rules.checks.checks.filter((c) => c.release === 'v1').map((c) => c.id);
const seen = new Set(result.findings.map((f) => f.checkId));
const silent = v1.filter((id) => !seen.has(id));

const byState = documents.tally(result.findings);
console.log(`${result.findings.length} findings — ${JSON.stringify(byState)}\n`);

for (const family of ['A', 'B', 'C', 'D']) {
  const ids = v1.filter((id) => id.startsWith(`${family}-`));
  console.log(`family ${family}:`);
  for (const id of ids) {
    const f = result.findings.filter((x) => x.checkId === id);
    if (f.length === 0) {
      console.log(`  ${id}  (no finding)`);
      continue;
    }
    const summary = f.map((x) => `${x.state}${x.notEvaluableReason ? `[${x.notEvaluableReason}]` : ''}`);
    const counts = [...new Set(summary)].map((s) => `${s}${summary.filter((y) => y === s).length > 1 ? ` x${summary.filter((y) => y === s).length}` : ''}`);
    console.log(`  ${id}  ${counts.join(', ')}`);
  }
}

const run = await runStore.persist({
  packageId: pkg.id,
  runAt: RUN_AT,
  rulesetVersion: rules.checks.version,
  engineVersion: '0.1.0',
  families: ['A', 'B', 'C', 'D'],
  findings: result.findings,
});
const stored = await runStore.findingsOf(run.runId);

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`); };

console.log('');
check('every v1 check produced at least one finding', silent.length === 0,
  silent.length === 0 ? `all ${v1.length} accounted for` : `silent: ${silent.join(', ')}`);
check('findings persisted', stored.length === result.findings.length,
  `${result.findings.length} produced, ${stored.length} rows read back (run ${run.runId.slice(0, 8)}…)`);
check('every not_evaluable carries a declared reason',
  stored.filter((f) => f.state === 'not_evaluable').every((f) => f.not_evaluable_reason),
  `${stored.filter((f) => f.state === 'not_evaluable').length} not_evaluable`);
check('no deferred check ran',
  !seen.has('C-20') && !seen.has('D-05') && !seen.has('D-06'),
  'C-20, D-05, D-06 absent');

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed   package ${pkg.id}`);
process.exit(failed.length === 0 ? 0 : 1);
