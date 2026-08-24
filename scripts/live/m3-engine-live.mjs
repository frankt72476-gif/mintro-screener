/**
 * M3 live — the check engine over a package read out of the database.
 *
 *     node --env-file=.env.test scripts/live/m1-eight-steps.mjs     # builds the package
 *     node --env-file=.env.test scripts/live/m3-engine-live.mjs
 *
 * Every engine test so far has run on hand-built snapshot literals. This assembles the snapshot
 * from real rows — slots the template seeded, documents ingest wrote, extractions the extractor
 * produced — and runs the same `runDocumentChecks` the worker would.
 *
 * Re-run immutability is NOT tested here — it needs persistence, and it lives in
 * `m3-persistence-live.mjs` since migration 0027 gave it something to persist into. This script
 * stays about the engine's output; that one is about what survives a second run.
 */

import { createClient } from '@supabase/supabase-js';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { ingestDocument } from '../../apps/worker/dist/src/ingest.js';
import { createIngestStore, DOCUMENTS_BUCKET } from '../../apps/worker/dist/src/store/ingestStore.js';
import { snapshotOf } from './snapshot.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('M3 — the check engine over a real package');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const rules = loadDocumentsRules();

/** The most recently opened package — the one m1-eight-steps just built. */
const { data: pkg } = await service
  .from('packages').select('id, created_at').order('created_at', { ascending: false }).limit(1).single();
if (!pkg) throw new Error('no package found — run m1-eight-steps.mjs first');
console.log(`package ${pkg.id}\n`);

const RUN_AT = new Date('2026-05-15T00:00:00Z');
const snapshot = await snapshotOf(service, pkg.id, RUN_AT);
console.log(`${snapshot.slots.length} slots, ${snapshot.documents.length} documents\n`);

const show = (findings, title) => {
  console.log(`${title}`);
  for (const f of findings) {
    const reason = f.notEvaluableReason ? ` [${f.notEvaluableReason}]` : '';
    console.log(`  ${f.checkId.padEnd(5)} ${String(f.state).padEnd(14)} tier=${String(f.tier).padEnd(10)}${reason}`);
  }
};

// --- 1: a real check pass -----------------------------------------------------------------------
const first = documents.runDocumentChecks(snapshot, rules, { runId: 'live-m3-1', families: ['A', 'B'] });
const t = documents.tally(first.findings);
console.log(`run 1 — ${first.findings.length} findings: ${JSON.stringify(t)}\n`);

// --- 2: state, named reason, computed tier, on real findings ------------------------------------
const notEvaluable = first.findings.filter((f) => f.state === 'not_evaluable');
const allNamed = notEvaluable.every((f) => typeof f.notEvaluableReason === 'string' && f.notEvaluableReason.length > 0);
const declared = new Map(rules.checks.checks.map((c) => [c.id, c.not_evaluable_when]));
const allDeclared = notEvaluable.every((f) => declared.get(f.checkId)?.includes(f.notEvaluableReason));
console.log(`every not_evaluable carries a reason        : ${allNamed} (${notEvaluable.length} of them)`);
console.log(`every reason is one the check declares      : ${allDeclared}`);
console.log(`  reasons seen: ${[...new Set(notEvaluable.map((f) => f.notEvaluableReason))].join(', ')}`);

const tiers = new Set(first.findings.map((f) => String(f.tier)));
const tierOk = first.findings.every((f) => (f.read.length === 0 ? f.tier === null : f.tier !== null));
console.log(`tier is computed from documents read (D-116): ${tierOk}`);
console.log(`  tiers seen: ${[...tiers].join(', ')} — null where a finding rests on no document\n`);

// --- 3: family B against real slot states -------------------------------------------------------
const b = first.findings.filter((f) => f.checkId.startsWith('B-'));
show(b.slice(0, 8), 'family B (first 8):');
const ownerB02 = first.findings.find(
  (f) => f.checkId === 'B-02' && snapshot.slots.find((s) => s.id === f.subject.slotId)?.requiredCount === null,
);
console.log(`\nunknown-count slot under B-02: ${ownerB02?.state} [${ownerB02?.notEvaluableReason}]`);
console.log(`  ${ownerB02?.note}\n`);

// --- 4: an unreadable document ------------------------------------------------------------------
const store = createIngestStore({ client: service, bucket: DOCUMENTS_BUCKET }, DOCUMENTS_BUCKET);
const einSlot = snapshot.slots.find((s) => s.slotKey === 'ein_letter');
const corrupt = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...Buffer.from('not actually a pdf body'.repeat(20))]);
const bad = await ingestDocument(
  { packageId: pkg.id, slotId: einSlot.id, filename: 'corrupt-ein.pdf', bytes: corrupt },
  { store },
);
console.log(`ingested a corrupt PDF: outcome=${bad.outcome}, reason=${String(bad.outcomeReason).slice(0, 70)}`);

const withBad = await snapshotOf(service, pkg.id, RUN_AT);
const second = documents.runDocumentChecks(withBad, rules, { runId: 'live-m3-2', families: ['A', 'B'] });
const badDoc = withBad.documents.find((d) => d.versionId === bad.versionId);
const aboutBad = second.findings.filter((f) => f.subject.versionId === badDoc.versionId);
show(aboutBad, '\nfindings about the unreadable document:');
const a01 = aboutBad.find((f) => f.checkId === 'A-01');
console.log(`\nA-01 is fail                                : ${a01?.state === 'fail'}`);
console.log(`  ${a01?.note}`);
const downstream = aboutBad.filter((f) => f.checkId !== 'A-01');
console.log(`downstream checks on it: ${downstream.map((f) => `${f.checkId}=${f.state}${f.notEvaluableReason ? `[${f.notEvaluableReason}]` : ''}`).join(', ') || '(none emitted)'}`);

// --- 5: re-run immutability ---------------------------------------------------------------------
console.log('\nre-run immutability (D-002)               : see m3-persistence-live.mjs');
console.log('  It was unverifiable while nothing persisted findings — two runs of a pure function');
console.log('  returning equal arrays shows the function is pure, which is not the property.');
console.log('  Migration 0027 added the runs and findings tables, so it now has something to hold');
console.log('  about, and that script verifies it against the database.');

const ok = allNamed && allDeclared && tierOk && a01?.state === 'fail' && ownerB02?.state === 'not_evaluable';
console.log(`\n${ok ? 'all verifiable properties held' : 'SOMETHING FAILED'}`);
process.exit(ok ? 0 : 1);
