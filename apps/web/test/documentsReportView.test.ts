/**
 * The rendered Documents Check report.
 *
 * Rendered to static markup and interrogated, never eyeballed. Every treatment the mockup says
 * carries meaning is asserted **structurally** — a class name, a data attribute, an element count —
 * because "it looks right" is not a property a test can hold and the treatments here are not
 * decoration: dashed against solid is D-100, hatched against coloured is the difference between
 * "could not run" and "passed".
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { DocumentsReportView } from '../src/components/DocumentsReportView.js';
import type { documents as documentsNs } from '@mintro/engine';

type RunRecord = documentsNs.RunRecord;
type StoredSlot = documentsNs.StoredSlot;
type StoredDocument = documentsNs.StoredDocument;
type StoredFinding = documentsNs.StoredFinding;

const RULES = loadDocumentsRules();

const slot = (over: Partial<StoredSlot> = {}): StoredSlot => ({
  slotId: 's-ein', slotKey: 'ein_letter', instanceLabel: null, state: 'satisfied',
  reason: null, requiredCount: 1, examined: true, ...over,
});

const document_ = (over: Partial<StoredDocument> = {}): StoredDocument => ({
  versionId: 'ver-1', slotId: 's-ein', slotKey: 'ein_letter', filename: 'ein.pdf',
  outcome: 'extracted', tier: 'character', ...over,
});

let n = 0;
const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  checkId: 'A-01', state: 'pass', notEvaluableReason: null, note: 'ein.pdf was read.',
  subjectKind: 'document', slotId: null, documentVersionId: 'ver-1', tier: 'character',
  readVersionIds: ['ver-1'], evidence: [], evidenceNote: null, ordinal: n++, ...over,
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-e402e078', packageId: 'pkg-1', runAt: '2026-05-15T00:00:00.000Z',
  identity: { merchantName: 'Northwind Peptides LLC', merchantDomain: 'northwind.example', dba: null },
  rulesetVersion: '1.0.0', engineVersion: '0.1.0',
  slots: [slot()], documents: [document_()], findings: [finding()], ...over,
});

function render(record: RunRecord, previous?: RunRecord): string {
  const report = documents.buildDocumentsReport(record, RULES, previous);
  return renderToStaticMarkup(
    createElement(DocumentsReportView, {
      report,
      packageRef: 'NW-2026-0812',
      processor: 'Default',
      reportNumber: '3 of 3',
      previousSentAt: '19 Aug',
    }),
  );
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;

// --- purity ----------------------------------------------------------------------------------

describe('the rendered report is byte-identical from the same run (D-085)', () => {
  it('renders the same markup when the rows arrive in a different order', () => {
    const original = run({
      slots: [slot(), slot({ slotId: 's-app', slotKey: 'application' }), slot({ slotId: 's-bank', slotKey: 'bank_statement', state: 'missing', requiredCount: 3 })],
      documents: [document_(), document_({ versionId: 'ver-2', slotId: 's-app', slotKey: 'application' })],
      findings: [
        finding({ checkId: 'A-01' }),
        finding({ checkId: 'A-03', documentVersionId: 'ver-2' }),
        finding({ checkId: 'B-01', subjectKind: 'slot', slotId: 's-bank', documentVersionId: null, state: 'fail', tier: null, readVersionIds: [], note: 'bank_statement is unresolved: missing.' }),
        finding({ checkId: 'C-03', subjectKind: 'package', documentVersionId: null, state: 'pass', tier: null, readVersionIds: [], note: 'three documents agree.' }),
      ],
    });
    const shuffled: RunRecord = {
      ...original,
      slots: [...original.slots].reverse(),
      documents: [...original.documents].reverse(),
      findings: [...original.findings].reverse(),
    };
    expect(render(shuffled)).toBe(render(original));
  });

  /**
   * D-126, and the gap it closed.
   *
   * `merchantName` was a prop read live at render time, so the report data was pure and the page
   * was not: renaming a merchant changed the masthead of a run that had not changed, and a sent
   * PDF disagreed with a regenerated page while both claimed the same run id.
   *
   * The component now takes it off `report.identity`, so there is no path by which a later read
   * can reach the masthead — asserted by rendering the same run twice with the merchant row
   * conceptually renamed in between, which is what the two records represent.
   */
  it('renders the identity the run recorded, not one supplied at render time', () => {
    const asRun = run({ identity: { merchantName: 'Northwind Peptides LLC', merchantDomain: 'northwind.example', dba: null } });
    const html = render(asRun);
    expect(html).toContain('Northwind Peptides LLC');

    // The same run, rendered later, after somebody edited the merchant row. Nothing the renderer
    // can see has changed, because the name is on the run.
    expect(render(asRun)).toBe(html);
  });

  it('shows a DBA line only when the report carries one', () => {
    expect(render(run())).not.toContain('class="dba"');
    const withDba = run({ identity: { merchantName: 'Northwind Peptides LLC', merchantDomain: 'northwind.example', dba: 'Northwind Labs' } });
    expect(render(withDba)).toContain('DBA Northwind Labs');
  });

  it('renders nothing derived from a clock', () => {
    const html = render(run({ runAt: '2026-03-01T09:30:00.000Z' }));
    expect(html).toContain('2026-03-01T09:30:00.000Z');
    expect(render(run({ runAt: '2026-03-01T09:30:00.000Z' }))).toBe(html);
  });
});

// --- D-100 made visible ------------------------------------------------------------------------

describe('page-tier and character-tier render distinguishably (D-100)', () => {
  const mixed = () =>
    run({
      slots: [slot(), slot({ slotId: 's-app', slotKey: 'application' })],
      documents: [
        document_({ versionId: 'ver-1', tier: 'page' }),
        document_({ versionId: 'ver-2', slotId: 's-app', slotKey: 'application', tier: 'character' }),
      ],
      findings: [
        finding({ checkId: 'C-03', documentVersionId: 'ver-1', tier: 'page', readVersionIds: ['ver-1'],
          evidence: [{ source: 'ein letter · p.1', value: '47-2841903', differs: false }] }),
        finding({ checkId: 'C-01', documentVersionId: 'ver-2', tier: 'character', readVersionIds: ['ver-2'],
          evidence: [{ source: 'application · field', value: 'Northwind Peptides LLC', differs: false }] }),
      ],
    });

  it('marks the document group with its tier, dashed for page', () => {
    const html = render(mixed());
    expect(html).toContain('class="tier page" data-tier="page"');
    expect(html).toContain('class="tier" data-tier="character"');
  });

  /** The dashed left border on the evidence block is the tier, in layout rather than in words. */
  it('marks the evidence block, dashed for page', () => {
    const html = render(mixed());
    expect(html).toContain('class="evidence pagetier" data-tier="page"');
    expect(html).toContain('class="evidence" data-tier="character"');
  });

  it('does not render the two identically', () => {
    const html = render(mixed());
    expect(count(html, 'data-tier="page"')).toBeGreaterThan(0);
    expect(count(html, 'data-tier="character"')).toBeGreaterThan(0);
    expect(html).not.toContain('class="evidence pagetier" data-tier="character"');
  });
});

describe('not_evaluable is hatched wherever it appears', () => {
  it('uses the hatched state class in slot states and finding states', () => {
    const html = render(
      run({
        slots: [slot({ state: 'not_evaluable', requiredCount: null })],
        findings: [finding({ checkId: 'A-04', state: 'not_evaluable', notEvaluableReason: 'markers_not_searchable', note: 'not searchable.' })],
      }),
    );
    // `.state.notevaluable` is the hatched rule in the stylesheet — asserted by class, because the
    // paint itself is CSS and the test's job is that the element asks for it.
    expect(count(html, 'state notevaluable')).toBe(2);
  });

  it('gives the coverage bar a hatched segment rather than a fourth colour', () => {
    const html = render(run({ findings: [finding({ checkId: 'A-04', state: 'not_evaluable', notEvaluableReason: 'markers_not_searchable', note: 'x.' })] }));
    expect(html).toContain('class="cov-seg n"');
  });

  it('says a check that could not run has established nothing', () => {
    expect(render(run())).toContain('has established nothing');
  });
});

// --- D-120 collapse -------------------------------------------------------------------------------

describe('the collapse renders one block naming its dependents (D-120)', () => {
  const unreadable = () =>
    run({
      documents: [document_({ outcome: 'unreadable', tier: 'page' })],
      findings: [
        finding({ checkId: 'A-01', state: 'fail', note: 'ein.pdf yielded no readable content.' }),
        ...['A-06', 'A-02', 'A-07', 'A-04', 'A-05'].map((id) =>
          finding({ checkId: id, state: 'not_evaluable', notEvaluableReason: 'document_not_readable', note: `${id} had nothing to evaluate.` }),
        ),
      ],
    });

  it('renders one hatched block listing the ids', () => {
    const html = render(unreadable());
    expect(count(html, 'class="collapsed"')).toBe(1);
    expect(html).toContain('A-02 · A-04 · A-05 · A-06 · A-07');
  });

  it('leaves the five findings out of the finding list but present in the run', () => {
    const record = unreadable();
    const html = render(record);
    // Collapsed, so not rendered individually...
    expect(html).not.toContain('data-check="A-04"');
    // ...but still in the run, and still counted.
    expect(record.findings.filter((f: StoredFinding) => f.notEvaluableReason === 'document_not_readable')).toHaveLength(5);
    expect(html).toContain('<b>5</b> not evaluated');
  });

  it('does not collapse fewer_than_two_sources', () => {
    const html = render(
      run({
        findings: ['C-01', 'C-03', 'C-05'].map((id) =>
          finding({ checkId: id, state: 'not_evaluable', notEvaluableReason: 'fewer_than_two_sources', note: `nothing to compare for ${id}.` }),
        ),
      }),
    );
    expect(count(html, 'class="collapsed"')).toBe(0);
    for (const id of ['C-01', 'C-03', 'C-05']) expect(html).toContain(`data-check="${id}"`);
  });
});

// --- evidence rows ----------------------------------------------------------------------------------

describe('evidence rows show every source, with the differing value marked', () => {
  it('renders all three sources and marks only the outlier', () => {
    const html = render(
      run({
        findings: [
          finding({
            checkId: 'C-08', state: 'fail', note: 'routing numbers differ.',
            evidence: [
              { source: 'application · field', value: '121000248', differs: false },
              { source: 'voided check · p.1', value: '121000243', differs: true },
              { source: 'bank statement · p.1', value: '121000248', differs: false },
            ],
          }),
        ],
      }),
    );
    expect(count(html, 'class="evrow"')).toBe(3);
    expect(count(html, 'evval differs')).toBe(1);
    expect(html).toContain('>121000243<');
  });

  it('prints the qualification under the evidence when there is one', () => {
    const html = render(
      run({
        findings: [finding({ checkId: 'C-10', state: 'pass', note: 'resolves.', evidence: [{ source: 'FRB directory', value: 'WELLS FARGO BANK, N.A.', differs: false }], evidenceNote: 'This says nothing about the account.' })],
      }),
    );
    expect(html).toContain('class="evnote"');
    expect(html).toContain('says nothing about the account');
  });
});

// --- slot table and diff --------------------------------------------------------------------------

describe('the slot table leads and tints the rows needing action', () => {
  it('tints missing and not_evaluable, and leaves resolved rows alone', () => {
    const html = render(
      run({
        slots: [
          slot({ slotId: 'a', slotKey: 'application', state: 'satisfied' }),
          slot({ slotId: 'b', slotKey: 'bank_statement', state: 'missing', requiredCount: 3 }),
          slot({ slotId: 'c', slotKey: 'owner_photo_id', state: 'not_evaluable', requiredCount: null }),
          slot({ slotId: 'd', slotKey: 'w9', state: 'waived', reason: 'not_applicable_to_entity_type' }),
        ],
        documents: [], findings: [],
      }),
    );
    expect(count(html, 'class="chase"')).toBe(2);
    expect(html).toContain('Not applicable to this entity type');
  });

  it('comes before the findings section in document order', () => {
    const html = render(run());
    expect(html.indexOf('>Documents<')).toBeLessThan(html.indexOf('>Findings<'));
  });
});

describe('the diff renders across two runs with a document added between them', () => {
  const before = run({
    id: 'run-1',
    slots: [slot({ slotId: 's-bank', slotKey: 'bank_statement', state: 'missing', requiredCount: 3 }), slot()],
    findings: [finding({ checkId: 'C-08', state: 'fail', subjectKind: 'package', documentVersionId: null, tier: null, readVersionIds: [], note: 'routing differs.' })],
  });
  const after = run({
    id: 'run-2',
    slots: [slot({ slotId: 's-bank', slotKey: 'bank_statement', state: 'satisfied', requiredCount: 3 }), slot()],
    documents: [document_(), document_({ versionId: 'ver-9', slotId: 's-bank', slotKey: 'bank_statement' })],
    findings: [finding({ checkId: 'C-09', state: 'fail', subjectKind: 'package', documentVersionId: null, tier: null, readVersionIds: [], note: 'account differs.' })],
  });

  it('names what moved', () => {
    const html = render(after, before);
    expect(html).toContain('bank statement — now satisfied.');
    expect(html).toContain('C-08 — no longer present in this run.');
    expect(html).toContain('C-09 — newly present in this run.');
  });

  it('is absent on a first report', () => {
    expect(render(before)).not.toContain('Changed since');
  });

  /** D-083: absence is what we observed. The wording must not award credit for a fix. */
  it('never says a finding was corrected', () => {
    expect(render(after, before)).not.toMatch(/corrected|fixed|remedied|resolved by/i);
  });
});

// --- §7 ------------------------------------------------------------------------------------------

describe('section 05 renders in full from the rule file', () => {
  it('carries every item and the external-verification line', () => {
    const html = render(run());
    for (const item of RULES.checks.not_checked.items) {
      expect(html).toContain(item.subject);
    }
    expect(count(html, 'class="nc-row"')).toBe(RULES.checks.not_checked.items.length);
    expect(html).toContain(RULES.checks.not_checked.external_verification);
  });
});
