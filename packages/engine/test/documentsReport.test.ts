/**
 * The report.
 *
 * Two properties here would sit green while broken, and both are tested against something that
 * would notice:
 *
 * - **Purity** (D-085). "Same run in, byte-identical report out" passes trivially if you build the
 *   report twice in one process from the same object. It is asserted here by rebuilding from a
 *   *reconstructed* run whose rows arrive in a different order, because the failure this property
 *   guards against is a report that depends on something other than the run.
 * - **The stale-run precondition** (D-117) is in `apps/worker/test/documentsReportGate.test.ts`,
 *   next to the code that owns it.
 */

import { describe, expect, it } from 'vitest';
import { loadDocumentsRules, type DocumentsRules } from '@mintro/ruleset';
import { documents } from '../src/index.js';
import type { RunRecord, StoredFinding, StoredSlot, StoredDocument } from '../src/documents/report.js';

const { buildDocumentsReport, diffRuns } = documents;
const RULES: DocumentsRules = loadDocumentsRules();

const slot = (over: Partial<StoredSlot> = {}): StoredSlot => ({
  slotId: 'slot-ein',
  slotKey: 'ein_letter',
  instanceLabel: null,
  state: 'satisfied',
  reason: null,
  requiredCount: 1,
  examined: true,
  ...over,
});

const document = (over: Partial<StoredDocument> = {}): StoredDocument => ({
  versionId: 'ver-1',
  slotId: 'slot-ein',
  slotKey: 'ein_letter',
  filename: 'ein.pdf',
  outcome: 'extracted',
  tier: 'character',
  ...over,
});

let ordinal = 0;
const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  checkId: 'A-01',
  state: 'pass',
  notEvaluableReason: null,
  note: 'ein.pdf was read; 1 page(s) yielded content.',
  subjectKind: 'document',
  slotId: null,
  documentVersionId: 'ver-1',
  tier: 'character',
  readVersionIds: ['ver-1'],
  evidence: [],
  evidenceNote: null,
  ordinal: ordinal++,
  ...over,
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  packageId: 'pkg-1',
  runAt: '2026-05-15T00:00:00.000Z',
  rulesetVersion: '1.0.0',
  engineVersion: '0.1.0',
  slots: [slot()],
  documents: [document()],
  findings: [finding()],
  ...over,
});

// --- D-085 ---------------------------------------------------------------------------------------

describe('the report is a pure function of a run (D-085)', () => {
  /**
   * The shuffle is the point.
   *
   * Building twice from the same array proves nothing — any function is deterministic on an
   * identical argument. What must hold is that a run *reconstructed from its rows* produces the
   * same bytes whatever order the database returned them in, because that is what regenerating a
   * report actually is.
   */
  it('is byte-identical when the same run arrives in a different row order', () => {
    const original = run({
      slots: [slot(), slot({ slotId: 'slot-app', slotKey: 'application' }), slot({ slotId: 'slot-bank', slotKey: 'bank_statement', state: 'missing' })],
      documents: [document(), document({ versionId: 'ver-2', slotId: 'slot-app', slotKey: 'application' })],
      findings: [
        // Several of each kind, deliberately. With one package-level finding and one collapsible
        // cause, reversing the input cannot change the output and the shuffle proves nothing —
        // which is exactly what break-testing this test found.
        finding({ checkId: 'A-01' }),
        finding({ checkId: 'A-05', state: 'not_evaluable', notEvaluableReason: 'document_not_readable', note: 'nothing to evaluate.' }),
        finding({ checkId: 'A-02', state: 'not_evaluable', notEvaluableReason: 'document_not_readable', note: 'nothing to evaluate.' }),
        finding({ checkId: 'A-07', state: 'not_evaluable', notEvaluableReason: 'markers_not_searchable', note: 'not searchable.' }),
        finding({ checkId: 'A-04', state: 'not_evaluable', notEvaluableReason: 'markers_not_searchable', note: 'not searchable.' }),
        finding({ checkId: 'A-03', documentVersionId: 'ver-2' }),
        finding({ checkId: 'B-01', subjectKind: 'slot', slotId: 'slot-bank', documentVersionId: null, state: 'fail', tier: null, readVersionIds: [], note: 'bank_statement is unresolved: missing.' }),
        finding({ checkId: 'B-02', subjectKind: 'slot', slotId: 'slot-bank', documentVersionId: null, state: 'fail', tier: null, readVersionIds: [], note: 'bank_statement holds 0 of 3 required.' }),
        finding({ checkId: 'C-03', subjectKind: 'package', documentVersionId: null, state: 'pass', tier: null, readVersionIds: [], note: '2 documents state the same ein.' }),
      ],
    });

    const shuffled: RunRecord = {
      ...original,
      slots: [...original.slots].reverse(),
      documents: [...original.documents].reverse(),
      findings: [...original.findings].reverse(),
    };

    const a = JSON.stringify(buildDocumentsReport(original, RULES));
    const b = JSON.stringify(buildDocumentsReport(shuffled, RULES));
    expect(b).toBe(a);
  });

  it('reads no clock — the same run built twice, minutes apart, is the same bytes', () => {
    const r = run();
    const first = JSON.stringify(buildDocumentsReport(r, RULES));
    // Nothing here can move except a clock, and there is not one in the builder.
    const second = JSON.stringify(buildDocumentsReport(structuredClone(r) as RunRecord, RULES));
    expect(second).toBe(first);
  });

  it('carries the run\'s own runAt, not the moment it was rendered', () => {
    const report = buildDocumentsReport(run({ runAt: '2026-03-01T09:30:00.000Z' }), RULES);
    expect(report.runAt).toBe('2026-03-01T09:30:00.000Z');
  });

  /**
   * D-079 is what makes purity reachable. A reason is an enumeration key and its label comes from
   * the enumeration — not from anything a person typed, which would make the report a function of
   * a run plus whoever was typing.
   */
  it('renders a reason label looked up from the enumeration, never free text', () => {
    const report = buildDocumentsReport(
      run({ slots: [slot({ state: 'not_provided', reason: 'new_business_no_processing_history' })] }),
      RULES,
    );
    const [only] = report.slots;
    expect(only?.reason).toBe('new_business_no_processing_history');
    expect(only?.reasonLabel).toBe('New business — no prior processing history');
  });
});

// --- structure -------------------------------------------------------------------------------------

describe('the slot table leads', () => {
  it('carries all six states with their reasons and counts', () => {
    const report = buildDocumentsReport(
      run({
        slots: [
          slot({ slotId: 's1', slotKey: 'application', state: 'satisfied' }),
          slot({ slotId: 's2', slotKey: 'bank_statement', state: 'missing', requiredCount: 3 }),
          slot({ slotId: 's3', slotKey: 'processing_statement', state: 'not_provided', reason: 'new_business_no_processing_history' }),
          slot({ slotId: 's4', slotKey: 'w9', state: 'waived', reason: 'not_applicable_to_entity_type' }),
          slot({ slotId: 's5', slotKey: 'voided_check', state: 'superseded' }),
          slot({ slotId: 's6', slotKey: 'owner_photo_id', state: 'not_evaluable', requiredCount: null }),
        ],
        documents: [],
        findings: [],
      }),
      RULES,
    );
    expect(report.slots.map((s) => s.state).sort()).toEqual(
      ['missing', 'not_evaluable', 'not_provided', 'satisfied', 'superseded', 'waived'],
    );
    expect(report.slots.find((s) => s.slotKey === 'w9')?.reasonLabel).toBe('Not applicable to this entity type');
    expect(report.slots.find((s) => s.slotKey === 'bank_statement')?.requiredCount).toBe(3);
  });

  it('names each slot from the catalog, not from its key', () => {
    const report = buildDocumentsReport(run(), RULES);
    expect(report.slots[0]?.title).toBe('EIN Letter (CP-575 / 147C)');
  });
});

describe('findings group by document and state their tier (D-100)', () => {
  it('renders mixed tiers distinguishably', () => {
    const report = buildDocumentsReport(
      run({
        slots: [slot(), slot({ slotId: 'slot-app', slotKey: 'application' })],
        documents: [
          document({ versionId: 'ver-1', tier: 'page' }),
          document({ versionId: 'ver-2', slotId: 'slot-app', slotKey: 'application', tier: 'character' }),
        ],
        findings: [
          finding({ checkId: 'A-01', documentVersionId: 'ver-1', tier: 'page', readVersionIds: ['ver-1'] }),
          finding({ checkId: 'A-01', documentVersionId: 'ver-2', tier: 'character', readVersionIds: ['ver-2'] }),
        ],
      }),
      RULES,
    );
    const tiers = report.documents.map((d) => [d.slotKey, d.tier]);
    // The photographed document and the AcroForm are not presented as equal evidence.
    expect(tiers).toContainEqual(['ein_letter', 'page']);
    expect(tiers).toContainEqual(['application', 'character']);
    expect(report.documents.flatMap((d) => d.findings.map((f) => f.tier)).sort()).toEqual(['character', 'page']);
  });

  it('leaves tier null on a finding that rests on no document (D-116)', () => {
    const report = buildDocumentsReport(
      run({
        findings: [finding({ checkId: 'B-01', subjectKind: 'slot', slotId: 'slot-ein', documentVersionId: null, tier: null, readVersionIds: [], note: 'ein_letter is resolved: satisfied.' })],
      }),
      RULES,
    );
    expect(report.packageFindings[0]?.tier).toBeNull();
  });
});

// --- D-120 collapse ----------------------------------------------------------------------------------

describe('the collapse is the report\'s job, not the engine\'s (D-120)', () => {
  const unreadable = () =>
    run({
      documents: [document({ outcome: 'unreadable', tier: 'page' })],
      findings: [
        finding({ checkId: 'A-01', state: 'fail', note: 'ein.pdf yielded no readable content: pdf could not be parsed.' }),
        finding({ checkId: 'A-03', state: 'pass', note: 'ein.pdf opened without a password.' }),
        // Out of order on purpose: sorted output from sorted input tests nothing.
        ...['A-06', 'A-02', 'A-07', 'A-04', 'A-05'].map((id) =>
          finding({ checkId: id, state: 'not_evaluable', notEvaluableReason: 'document_not_readable', note: `ein.pdf yielded no readable content, so ${id} had nothing to evaluate.` }),
        ),
      ],
    });

  it('produces one line naming its dependents', () => {
    const report = buildDocumentsReport(unreadable(), RULES);
    const [group] = report.documents;
    expect(group?.collapsed).toHaveLength(1);
    expect(group?.collapsed[0]?.line).toBe(
      'A-02, A-04, A-05, A-06, A-07 not evaluated — the document could not be read.',
    );
  });

  it('leaves the underlying findings individually present in the run', () => {
    const r = unreadable();
    const report = buildDocumentsReport(r, RULES);
    // Collapsing is a rendering, never a deletion: the run still carries all seven, and the counts
    // the report states are counts of findings, not of lines.
    expect(r.findings.filter((f) => f.notEvaluableReason === 'document_not_readable')).toHaveLength(5);
    expect(report.counts.not_evaluable).toBe(5);
    expect(report.documents[0]?.collapsed[0]?.checkIds).toEqual(['A-02', 'A-04', 'A-05', 'A-06', 'A-07']);
  });

  it('does not collapse a single finding into a summary of itself', () => {
    const report = buildDocumentsReport(
      run({
        findings: [finding({ checkId: 'A-04', state: 'not_evaluable', notEvaluableReason: 'document_not_readable', note: 'nothing to evaluate.' })],
      }),
      RULES,
    );
    expect(report.documents[0]?.collapsed).toHaveLength(0);
    expect(report.documents[0]?.findings.map((f) => f.checkId)).toEqual(['A-04']);
  });

  /**
   * Five checks lacking a second source are five different absences, not one event. Merging them
   * would tell a reader that one thing happened when five did.
   */
  it('does not collapse fewer_than_two_sources', () => {
    const report = buildDocumentsReport(
      run({
        // Document-subject, so they actually reach the grouper. As package-subject findings they
        // bypassed it entirely and the test passed without exercising anything.
        findings: ['C-01', 'C-03', 'C-05'].map((id) =>
          finding({ checkId: id, state: 'not_evaluable', notEvaluableReason: 'fewer_than_two_sources', note: `nothing to compare for ${id}.` }),
        ),
      }),
      RULES,
    );
    expect(report.documents.flatMap((d) => d.collapsed)).toHaveLength(0);
    expect(report.documents[0]?.findings.map((f) => f.checkId)).toEqual(['C-01', 'C-03', 'C-05']);
  });
});

// --- D-083 diff --------------------------------------------------------------------------------------

describe('the diff across two runs (D-083)', () => {
  const first = run({
    id: 'run-1',
    slots: [slot({ slotId: 's-bank', slotKey: 'bank_statement', state: 'missing' }), slot()],
    documents: [document()],
    findings: [
      finding({ checkId: 'C-08', state: 'fail', subjectKind: 'package', documentVersionId: null, tier: null, readVersionIds: [], note: 'routing numbers differ.' }),
      finding({ checkId: 'B-01', state: 'fail', subjectKind: 'slot', slotId: 's-bank', documentVersionId: null, tier: null, readVersionIds: [], note: 'bank_statement is unresolved: missing.' }),
    ],
  });

  const second = run({
    id: 'run-2',
    slots: [slot({ slotId: 's-bank', slotKey: 'bank_statement', state: 'satisfied' }), slot()],
    documents: [document(), document({ versionId: 'ver-2', slotId: 's-bank', slotKey: 'bank_statement' })],
    findings: [
      finding({ checkId: 'B-01', state: 'pass', subjectKind: 'slot', slotId: 's-bank', documentVersionId: null, tier: null, readVersionIds: [], note: 'bank_statement is resolved: satisfied.' }),
      finding({ checkId: 'C-09', state: 'fail', subjectKind: 'package', documentVersionId: null, tier: null, readVersionIds: [], note: 'account numbers differ.' }),
    ],
  });

  it('names slots newly satisfied, findings resolved and findings appeared', () => {
    const diff = diffRuns(first, second);
    expect(diff.againstRunId).toBe('run-1');
    expect(diff.slotsNewlySatisfied).toEqual(['bank_statement']);
    expect(diff.findingsResolved).toEqual(['B-01|s-bank', 'C-08|package']);
    expect(diff.findingsAppeared).toEqual(['C-09|package']);
  });

  it('is absent on a first report, because there is nothing to compare against', () => {
    expect(buildDocumentsReport(first, RULES).diff).toBeNull();
  });

  it('appears once a previous run is supplied', () => {
    const report = buildDocumentsReport(second, RULES, first);
    expect(report.diff?.slotsNewlySatisfied).toEqual(['bank_statement']);
  });

  /**
   * "Resolved" is a statement about two runs, not about a merchant fixing something. The wording
   * must not award credit for something we did not observe (D-083).
   */
  it('never claims a finding was corrected', () => {
    const report = buildDocumentsReport(second, RULES, first);
    expect(JSON.stringify(report.diff)).not.toMatch(/correct|fixed|remedied|resolved by|addressed/i);
  });
});

// --- §7 -------------------------------------------------------------------------------------------

describe('what is not checked renders in full (§7, D-076)', () => {
  it('carries every item from the rule file, verbatim', () => {
    const report = buildDocumentsReport(run(), RULES);
    expect(report.notChecked).toEqual(RULES.checks.not_checked.items);
    expect(report.notChecked).toHaveLength(7);
  });

  /**
   * D-076 exists because "EIN consistent" and "EIN verified" are different claims and an
   * underwriter will read the second into the first. Silence is not a boundary.
   */
  it('states that no external verification was performed beyond the routing lookup', () => {
    const report = buildDocumentsReport(run(), RULES);
    expect(report.externalVerification).toMatch(/No external verification/i);
    expect(report.externalVerification).toMatch(/routing/i);
  });

  it('never uses the word verified as a claim about a document', () => {
    const report = buildDocumentsReport(run(), RULES);
    for (const item of report.notChecked) {
      expect(`${item.subject} ${item.why}`).not.toMatch(/\bwe verified\b|\bverified that\b/i);
    }
  });
});

describe('no string in the report instructs or determines', () => {
  it('audits every rendered string, not only finding notes', () => {
    // The builder throws on one. Reaching this line with a report in hand is the assertion.
    const report = buildDocumentsReport(run(), RULES);
    expect(report.notChecked.length).toBeGreaterThan(0);
  });

  it('the audit fires when a determination is put in front of it', () => {
    const poisoned = {
      ...buildDocumentsReport(run(), RULES),
      externalVerification: 'This merchant is approved and the documents are authentic.',
    };
    expect(() => documents.assertReportCopyClean(poisoned)).toThrow(/determination|directive/i);
  });
});
