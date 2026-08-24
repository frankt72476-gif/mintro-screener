/**
 * The Documents Check engine, families A and B.
 *
 * Every check gets its adverse branch, its clean branch, and each declared `not_evaluable` reason
 * reached independently — because a reason that no input can produce is a reason nobody can act on,
 * and §1's enumeration would be describing conditions that never occur.
 *
 * Two exceptions are recorded rather than faked, and both are in the build report: A-01 declares no
 * `not_evaluable` reason at all, and A-05's adverse branch is unreachable until extraction can
 * locate a signature block.
 */

import { describe, expect, it } from 'vitest';
import { loadDocumentsRules, type DocumentsRules } from '@mintro/ruleset';
import type { ExtractionResult, ExtractedValue } from '@mintro/extraction';
import { documents } from '../src/index.js';
import type {
  DocumentFinding,
  DocumentSnapshot,
  PackageSnapshot,
  SlotSnapshot,
} from '../src/documents/types.js';

const { runDocumentChecks, tally, tierOf, weakestTier } = documents;

const RULES: DocumentsRules = loadDocumentsRules();
const RUN_AT = new Date('2026-05-15T00:00:00Z');

// --- snapshot builders -----------------------------------------------------------------------

function value(field: string, text: string | null, tier: 'character' | 'page' = 'character'): ExtractedValue {
  const provenance =
    tier === 'character'
      ? {
          document_version: 'h'.repeat(64),
          page: 1,
          location: { kind: 'text' as const, rect: { x: 0, y: 0, width: 10, height: 10 } },
          snippet: `${field}: ${text ?? ''}`,
        }
      : { document_version: 'h'.repeat(64), page: 1 };
  return {
    field,
    index: 0,
    presence: text === null ? 'empty' : 'present',
    value: text,
    provenance,
    tier,
  };
}

function extraction(
  values: ExtractedValue[],
  route: 'text' | 'vision' | 'none' = 'text',
  pages = 1,
): ExtractionResult {
  return {
    outcome: 'extracted',
    reason: null,
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      route,
      reason: route === 'none' ? 'no page imager was supplied' : null,
      glyphs: route === 'text' ? 200 : 0,
      usage: route === 'vision' ? { input_tokens: 2364, output_tokens: 144 } : null,
    })),
    values,
    hash: 'h'.repeat(64),
    extractor_version: '0.1.0',
    cached: false,
    detected_type: 'pdf',
  };
}

let seq = 0;
function doc(over: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  seq += 1;
  return {
    documentId: `doc-${seq}`,
    versionId: `ver-${seq}`,
    version: 1,
    slotId: 'slot-ein',
    slotKey: 'ein_letter',
    supersedes: null,
    supersededBy: null,
    detectedType: 'pdf',
    originalFilename: 'ein-letter.pdf',
    outcome: 'extracted',
    outcomeReason: null,
    extraction: extraction([]),
    ...over,
  };
}

function slot(over: Partial<SlotSnapshot> = {}): SlotSnapshot {
  return {
    id: 'slot-ein',
    slotKey: 'ein_letter',
    instanceLabel: null,
    requiredCount: 1,
    monthly: false,
    graceDays: 10,
    expiryAfterRun: false,
    examined: true,
    origin: 'required',
    state: 'missing',
    reason: null,
    ...over,
  };
}

function snapshot(over: Partial<PackageSnapshot> = {}): PackageSnapshot {
  return {
    packageId: 'pkg-1',
    runAt: RUN_AT,
    facts: { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true },
    slots: [slot()],
    documents: [],
    ...over,
  };
}

const run = (s: PackageSnapshot, families: ('A' | 'B')[] = ['A', 'B']): readonly DocumentFinding[] =>
  runDocumentChecks(s, RULES, { runId: 'run-1', families }).findings;

const of = (findings: readonly DocumentFinding[], id: string): DocumentFinding[] =>
  findings.filter((f) => f.checkId === id);
const one = (findings: readonly DocumentFinding[], id: string): DocumentFinding => {
  const [first] = of(findings, id);
  if (first === undefined) throw new Error(`no ${id} finding`);
  return first;
};

// --- family A --------------------------------------------------------------------------------

describe('A-01 — readable content', () => {
  it('passes a document that was read', () => {
    const f = one(run(snapshot({ documents: [doc()] }), ['A']), 'A-01');
    expect(f.state).toBe('pass');
  });

  it('fails a document that was not, carrying the recorded reason', () => {
    const f = one(
      run(snapshot({ documents: [doc({ outcome: 'encrypted', outcomeReason: 'pdf is encrypted', extraction: null })] }), ['A']),
      'A-01',
    );
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/pdf is encrypted/);
  });

  /**
   * The inventory is explicit and it is the reason A-01 exists first: we attempted the read, so
   * unreadability is a fact we established rather than one we failed to. That is a fail here and a
   * cause downstream — never a shrug.
   */
  it('declares no not_evaluable reason at all, so it can never return one', () => {
    const check = RULES.checks.checks.find((c) => c.id === 'A-01');
    expect(check?.not_evaluable_when).toEqual([]);
    for (const outcome of ['extracted', 'unreadable', 'unsupported', 'encrypted'] as const) {
      const f = one(run(snapshot({ documents: [doc({ outcome, outcomeReason: outcome === 'extracted' ? null : 'why' })] }), ['A']), 'A-01');
      expect(f.state, outcome).not.toBe('not_evaluable');
    }
  });

  it('accounts for every family A check on an unreadable document, none silently absent', () => {
    const findings = run(
      snapshot({ documents: [doc({ outcome: 'unreadable', outcomeReason: 'no page could be read', extraction: null })] }),
      ['A'],
    );
    const seen = new Set(findings.map((f) => f.checkId));
    expect([...seen].sort()).toEqual(['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07']);
  });

  it('an unreadable document produces named not_evaluable causes downstream', () => {
    const findings = run(
      snapshot({ documents: [doc({ outcome: 'unreadable', outcomeReason: 'no page could be read', extraction: null })] }),
      ['A'],
    );
    // D-120. These were skipped until the live run made the cost visible: a reader cannot tell a
    // check that could not answer from one that was never asked, and both look the same in the
    // direction that flatters us. Every check in the inventory is accounted for in every run.
    expect(one(findings, 'A-01').state).toBe('fail');
    for (const id of ['A-02', 'A-04', 'A-05', 'A-06', 'A-07']) {
      const f = one(findings, id);
      expect(f.state, id).toBe('not_evaluable');
      expect(f.notEvaluableReason, id).toBe('document_not_readable');
      expect(f.note, id).toMatch(/no page could be read/);
    }
    // A-03 still runs and still answers: whether the file needed a password is exactly what we did
    // establish by failing to open it. It is not downstream of anything.
    expect(one(findings, 'A-03').state).toBe('pass');
  });
});

describe('A-02 — declared page range', () => {
  it('passes when every declared page is present', () => {
    const d = doc({ extraction: extraction([value('page_marker', '1 of 2'), value('page_marker', '2 of 2')], 'text', 2) });
    expect(one(run(snapshot({ documents: [d] }), ['A']), 'A-02').state).toBe('pass');
  });

  it('fails and names the pages that are not there', () => {
    const d = doc({ extraction: extraction([value('page_marker', '1 of 3'), value('page_marker', '3 of 3')], 'text', 2) });
    const f = one(run(snapshot({ documents: [d] }), ['A']), 'A-02');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/page\(s\) 2 are not among those supplied/);
  });

  it('is not evaluable when there is no numbering', () => {
    const f = one(run(snapshot({ documents: [doc()] }), ['A']), 'A-02');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('page_numbering_absent');
  });
});

describe('A-03 — password protection', () => {
  it('fails an encrypted PDF', () => {
    const f = one(run(snapshot({ documents: [doc({ outcome: 'encrypted', outcomeReason: 'password', extraction: null })] }), ['A']), 'A-03');
    expect(f.state).toBe('fail');
  });

  it('passes one that opened', () => {
    expect(one(run(snapshot({ documents: [doc()] }), ['A']), 'A-03').state).toBe('pass');
  });

  it('is not asked of a document that is not a PDF', () => {
    // A JPEG cannot be password-protected. A pass here would answer a question nobody asked, and
    // in a report that reads exactly like a question that was asked.
    const findings = run(snapshot({ documents: [doc({ detectedType: 'jpeg' })] }), ['A']);
    expect(of(findings, 'A-03')).toHaveLength(0);
  });

  it('declares no not_evaluable reason', () => {
    expect(RULES.checks.checks.find((c) => c.id === 'A-03')?.not_evaluable_when).toEqual([]);
  });
});

describe('A-04 — markers of the declared type', () => {
  it('passes when a marker is present', () => {
    const d = doc({ extraction: extraction([value('legal_name', 'Northwind Peptides LLC')]) });
    // The snippet carries the marker, which is where A-04 finds it.
    const withMarker = { ...d, extraction: extraction([value('legal_name', 'CP-575 Northwind Peptides LLC')]) };
    expect(one(run(snapshot({ documents: [withMarker] }), ['A']), 'A-04').state).toBe('pass');
  });

  it('reviews when none of the expected markers appear', () => {
    const d = doc({ extraction: extraction([value('legal_name', 'Northwind Peptides LLC')]) });
    const f = one(run(snapshot({ documents: [d] }), ['A']), 'A-04');
    // Fuzzy comparison, so review rather than fail (D-099).
    expect(f.state).toBe('review');
    expect(f.note).toMatch(/none of the markers expected/);
  });

  /**
   * D-118, and the case that produced it.
   *
   * A scanned EIN letter printing INTERNAL REVENUE SERVICE in bold returned `review` — "carries
   * none of the markers expected". The page said so; the search could not see it. A vision page
   * has no snippets (D-100) and returns only the closed field list the prompt permits, so marker
   * text is never in the haystack and no amount of it being on the page changes that.
   */
  it('is not evaluable on a vision-routed page, because the marker text was never searchable', () => {
    const d = doc({ extraction: extraction([value('legal_name', 'NORTHWIND PEPTIDES LLC', 'page')], 'vision') });
    const f = one(run(snapshot({ documents: [d] }), ['A']), 'A-04');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('markers_not_searchable');
    expect(f.note).toMatch(/vision route/);
  });

  /**
   * The asymmetry is the whole ruling: a partial search proves presence and cannot prove absence.
   * If this returned not_evaluable too, D-118 would have been implemented as "distrust vision",
   * which is a different and weaker rule.
   */
  it('still passes on a vision page when a marker IS found, because finding one is conclusive', () => {
    const d = doc({
      extraction: extraction([value('legal_name', 'CP 575 A NORTHWIND PEPTIDES LLC', 'page')], 'vision'),
    });
    expect(one(run(snapshot({ documents: [d] }), ['A']), 'A-04').state).toBe('pass');
  });

  it('reports absent only where every page was searchable', () => {
    const complete = doc({ extraction: extraction([value('legal_name', 'Northwind Peptides LLC')], 'text', 2) });
    expect(one(run(snapshot({ documents: [complete] }), ['A']), 'A-04').state).toBe('review');
  });

  it('a hybrid document is judged by the hole, not by the majority', () => {
    // Two text pages and one vision page. The text pages carry no marker; the vision page might.
    const hybrid = doc({
      extraction: {
        ...extraction([value('legal_name', 'Northwind Peptides LLC')], 'text', 3),
        pages: [
          { page: 1, route: 'text', reason: null, glyphs: 200, usage: null },
          { page: 2, route: 'vision', reason: null, glyphs: 0, usage: { input_tokens: 2364, output_tokens: 144 } },
          { page: 3, route: 'text', reason: null, glyphs: 200, usage: null },
        ],
      },
    });
    const f = one(run(snapshot({ documents: [hybrid] }), ['A']), 'A-04');
    expect(f.state).toBe('not_evaluable');
    expect(f.note).toMatch(/page\(s\) 2 were read by the vision route/);
  });

  /**
   * "CP-575" is what the notice is called in prose. "CP 575 A" is what is printed on it. A marker
   * list written from memory rather than from a specimen matches the first and misses the second.
   */
  it('matches across spacing, punctuation and case', () => {
    for (const printed of ['Notice CP 575 A', 'CP-575', 'cp575', 'NOTICE  CP   575   G']) {
      const d = doc({ extraction: extraction([value('legal_name', `${printed} Northwind`)]) });
      expect(one(run(snapshot({ documents: [d] }), ['A']), 'A-04').state, printed).toBe('pass');
    }
  });

  /**
   * The marker set has to discriminate, or the check cannot do the one thing D-117 credits it with.
   * A W-9 header reads "Department of the Treasury Internal Revenue Service" — which is why that
   * string was removed from the ein_letter set when D-118 corrected it against a specimen.
   */
  it('does not pass a W-9 filed in the EIN Letter slot', () => {
    const w9 = doc({
      extraction: extraction([
        value('legal_name', 'Form W-9 (Rev. March 2024) Department of the Treasury Internal Revenue Service'),
      ]),
    });
    expect(one(run(snapshot({ documents: [w9] }), ['A']), 'A-04').state).toBe('review');
  });

  it('is not evaluable for a type with no marker set', () => {
    const s = snapshot({
      slots: [slot({ id: 'slot-vc', slotKey: 'voided_check' })],
      documents: [doc({ slotId: 'slot-vc', slotKey: 'voided_check' })],
    });
    const f = one(run(s, ['A']), 'A-04');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('no_marker_set_for_type');
  });

  /** §6: it does not catch a forgery and must never be described as if it does. */
  it('never produces a note that reads as forgery detection', () => {
    for (const d of [doc(), doc({ extraction: extraction([value('legal_name', 'CP-575')]) })]) {
      const f = one(run(snapshot({ documents: [d] }), ['A']), 'A-04');
      expect(f.note.toLowerCase()).not.toMatch(/forg|authentic|genuine|fraud/);
    }
  });
});

describe('A-05 — signature and date', () => {
  it('passes when a signature date was read', () => {
    const d = doc({ extraction: extraction([value('signature_date', '2026-03-14')]) });
    expect(one(run(snapshot({ documents: [d] }), ['A']), 'A-05').state).toBe('pass');
  });

  /**
   * The adverse branch is unreachable today, and that is the honest answer rather than a gap.
   * Extraction reads a signature *date*; it cannot locate a signature *block*. So a document with
   * no date is either unsigned or one whose block we never found, and we cannot tell which —
   * constraint 2 makes that `not_evaluable`, not `fail`.
   */
  it('is not evaluable when no signature block was located', () => {
    const f = one(run(snapshot({ documents: [doc()] }), ['A']), 'A-05');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('signature_block_not_located');
  });
});

describe('A-06 — expiry after the run', () => {
  const idSlot = slot({ id: 'slot-id', slotKey: 'owner_photo_id', expiryAfterRun: true });
  const idDoc = (expiry: string | null): DocumentSnapshot =>
    doc({
      slotId: 'slot-id',
      slotKey: 'owner_photo_id',
      originalFilename: 'licence.jpg',
      detectedType: 'jpeg',
      extraction: extraction(expiry === null ? [] : [value('expiry_date', expiry)]),
    });

  it('passes an ID that expires after the run', () => {
    const f = one(run(snapshot({ slots: [idSlot], documents: [idDoc('2027-01-01')] }), ['A']), 'A-06');
    expect(f.state).toBe('pass');
  });

  it('fails one that expired before it', () => {
    const f = one(run(snapshot({ slots: [idSlot], documents: [idDoc('2025-01-01')] }), ['A']), 'A-06');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/expired 2025-01-01/);
  });

  it('is not evaluable when no expiry was read', () => {
    const f = one(run(snapshot({ slots: [idSlot], documents: [idDoc(null)] }), ['A']), 'A-06');
    expect(f.notEvaluableReason).toBe('expiry_not_extracted');
  });

  it('is not asked of documents that do not expire', () => {
    expect(of(run(snapshot({ documents: [doc()] }), ['A']), 'A-06')).toHaveLength(0);
  });
});

describe('A-07 — the document\'s own period', () => {
  const stSlot = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true });
  const stDoc = (period: string | null): DocumentSnapshot =>
    doc({
      slotId: 'slot-bank',
      slotKey: 'bank_statement',
      originalFilename: 'statement.pdf',
      extraction: extraction(period === null ? [] : [value('statement_period', period)]),
    });

  it('passes a period inside the span its slot covers', () => {
    expect(one(run(snapshot({ slots: [stSlot], documents: [stDoc('2026-04-01')] }), ['A']), 'A-07').state).toBe('pass');
  });

  it('fails one far outside it', () => {
    const f = one(run(snapshot({ slots: [stSlot], documents: [stDoc('2024-01-01')] }), ['A']), 'A-07');
    expect(f.state).toBe('fail');
  });

  it('is not evaluable when no period was read', () => {
    const f = one(run(snapshot({ slots: [stSlot], documents: [stDoc(null)] }), ['A']), 'A-07');
    expect(f.notEvaluableReason).toBe('date_not_extracted');
  });
});

// --- family B --------------------------------------------------------------------------------

describe('B-01 — every required slot resolved', () => {
  it('passes a resolved slot and names how', () => {
    const s = snapshot({ slots: [slot({ state: 'not_provided', reason: 'merchant_declines' })] });
    const f = one(run(s, ['B']), 'B-01');
    expect(f.state).toBe('pass');
    expect(f.note).toMatch(/merchant_declines/);
  });

  it('fails an unresolved one', () => {
    expect(one(run(snapshot(), ['B']), 'B-01').state).toBe('fail');
  });

  it('declares no not_evaluable reason', () => {
    expect(RULES.checks.checks.find((c) => c.id === 'B-01')?.not_evaluable_when).toEqual([]);
  });

  it('carries no tier — it read no document', () => {
    expect(one(run(snapshot(), ['B']), 'B-01').tier).toBeNull();
  });
});

describe('B-02 — count satisfaction, orthogonal to state (D-110)', () => {
  it('passes when the count is met', () => {
    const s = snapshot({ slots: [slot({ requiredCount: 1 })], documents: [doc()] });
    expect(one(run(s, ['B']), 'B-02').state).toBe('pass');
  });

  it('fails one of three, which is chase-this', () => {
    const s = snapshot({ slots: [slot({ requiredCount: 3 })], documents: [doc()] });
    const f = one(run(s, ['B']), 'B-02');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/holds 1 of 3 required/);
  });

  /** Unknown is not zero: we do not know how many to expect, so we cannot say any are absent. */
  it('is not evaluable when the required count is unknown (D-107)', () => {
    const s = snapshot({ slots: [slot({ slotKey: 'owner_photo_id', requiredCount: null, state: 'not_evaluable' })] });
    const f = one(run(s, ['B']), 'B-02');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('required_count_unknown');
    expect(f.state).not.toBe('fail');
  });
});

describe('B-03 — consecutive periods', () => {
  const bank = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true });
  const period = (p: string): DocumentSnapshot =>
    doc({ slotId: 'slot-bank', slotKey: 'bank_statement', extraction: extraction([value('statement_period', p)]) });

  it('passes three consecutive months', () => {
    const s = snapshot({ slots: [bank], documents: [period('2026-02-01'), period('2026-03-01'), period('2026-04-01')] });
    expect(one(run(s, ['B']), 'B-03').state).toBe('pass');
  });

  it('fails a gap and names the month', () => {
    const s = snapshot({ slots: [bank], documents: [period('2026-02-01'), period('2026-04-01')] });
    const f = one(run(s, ['B']), 'B-03');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/March 2026/);
  });

  it('is not evaluable when no period was read', () => {
    const s = snapshot({ slots: [bank], documents: [doc({ slotId: 'slot-bank', slotKey: 'bank_statement' })] });
    expect(one(run(s, ['B']), 'B-03').notEvaluableReason).toBe('periods_not_extracted');
  });
});

describe('B-04 — the months the run requires (D-113 at the run clock, D-109)', () => {
  const bank = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true });
  const period = (p: string): DocumentSnapshot =>
    doc({ slotId: 'slot-bank', slotKey: 'bank_statement', extraction: extraction([value('statement_period', p)]) });

  it('passes when every required month is covered', () => {
    // Run 15 May, grace 10 → April, March, February.
    const s = snapshot({ slots: [bank], documents: [period('2026-02-10'), period('2026-03-10'), period('2026-04-10')] });
    expect(one(run(s, ['B']), 'B-04').state).toBe('pass');
  });

  it('fails and names the months nothing covers', () => {
    const s = snapshot({ slots: [bank], documents: [period('2026-01-10'), period('2026-02-10'), period('2026-03-10')] });
    const f = one(run(s, ['B']), 'B-04');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/April 2026/);
  });

  it('measures against the run, not the reader\'s clock', () => {
    const docs = [period('2026-02-10'), period('2026-03-10'), period('2026-04-10')];
    expect(one(run(snapshot({ slots: [bank], documents: docs }), ['B']), 'B-04').state).toBe('pass');
    const later = snapshot({ slots: [bank], documents: docs, runAt: new Date('2026-08-15T00:00:00Z') });
    expect(one(run(later, ['B']), 'B-04').state).toBe('fail');
  });

  it('is not evaluable when no period was read', () => {
    const s = snapshot({ slots: [bank], documents: [doc({ slotId: 'slot-bank', slotKey: 'bank_statement' })] });
    expect(one(run(s, ['B']), 'B-04').notEvaluableReason).toBe('periods_not_extracted');
  });
});

describe('B-05 — conditional predicates resolved', () => {
  const conditional = slot({ id: 'slot-w9', slotKey: 'w9', origin: 'conditional' });

  it('passes when all three creation answers are recorded', () => {
    expect(one(run(snapshot({ slots: [conditional] }), ['B']), 'B-05').state).toBe('pass');
  });

  it('is not evaluable when one is missing, and names it', () => {
    const s = snapshot({
      slots: [conditional],
      facts: { entityType: null, hasExistingProcessor: true, usDomiciled: true },
    });
    const f = one(run(s, ['B']), 'B-05');
    expect(f.notEvaluableReason).toBe('predicate_inputs_not_extracted');
    expect(f.note).toMatch(/entity type/);
  });

  it('says nothing at all when the set has no conditional slots', () => {
    expect(of(run(snapshot(), ['B']), 'B-05')).toHaveLength(0);
  });
});

/**
 * B-06 was withdrawn by D-117 — do not add a check for it here.
 *
 * It re-evaluated freshness at report generation. D-109 made that one clock, and what was left
 * reduced to B-04 asked a second way against the same slots. What it guarded — that a report is
 * never generated from a stale run — is a precondition on report generation and belongs to M5's
 * tests, not to the engine's: nothing in a `PackageSnapshot` distinguishes a run created a minute
 * ago from one created in March.
 */
describe('B-06 is withdrawn (D-117)', () => {
  it('is absent from the ruleset, so the engine cannot emit it', () => {
    expect(RULES.checks.checks.find((c) => c.id === 'B-06')).toBeUndefined();
    const s = snapshot({
      slots: [slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true })],
      documents: [
        doc({ slotId: 'slot-bank', slotKey: 'bank_statement', extraction: extraction([value('statement_period', '2026-04-10')]) }),
      ],
    });
    expect(of(run(s, ['B']), 'B-06')).toHaveLength(0);
  });

  it('leaves family B at five checks', () => {
    const b = RULES.checks.checks.filter((c) => c.id.startsWith('B-')).map((c) => c.id);
    expect(b).toEqual(['B-01', 'B-02', 'B-03', 'B-04', 'B-05']);
  });
});

// --- the shape --------------------------------------------------------------------------------

describe('tier is computed, never declared (D-116)', () => {
  it('a page-tier document makes a page-tier finding', () => {
    const scanned = doc({ extraction: extraction([value('legal_name', 'X', 'page')], 'vision') });
    expect(tierOf(scanned)).toBe('page');
    expect(one(run(snapshot({ documents: [scanned] }), ['A']), 'A-01').tier).toBe('page');
  });

  it('a finding reading one character and one page document reports page', () => {
    const bank = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 2, monthly: true });
    const text = doc({
      slotId: 'slot-bank', slotKey: 'bank_statement',
      extraction: extraction([value('statement_period', '2026-04-10')], 'text'),
    });
    const scanned = doc({
      slotId: 'slot-bank', slotKey: 'bank_statement',
      extraction: extraction([value('statement_period', '2026-03-10', 'page')], 'vision'),
    });

    const f = one(run(snapshot({ slots: [bank], documents: [text, scanned] }), ['B']), 'B-04');
    expect(f.read).toHaveLength(2);
    expect(f.read.map((r) => r.tier).sort()).toEqual(['character', 'page']);
    // The observation is only as good as its weakest side.
    expect(f.tier).toBe('page');
  });

  it('weakestTier is null when nothing was read', () => {
    expect(weakestTier([])).toBeNull();
  });
});

describe('a run is a value, and re-running produces another', () => {
  it('leaves the prior run byte-identical', () => {
    const s = snapshot({ documents: [doc()] });
    const first = runDocumentChecks(s, RULES, { runId: 'run-1', families: ['A', 'B'] });
    const before = JSON.stringify(first);

    const second = runDocumentChecks(s, RULES, { runId: 'run-2', families: ['A', 'B'] });

    expect(JSON.stringify(first)).toBe(before);
    expect(second.runId).not.toBe(first.runId);
    expect(second.findings).toEqual(first.findings);
  });

  it('reports counts and nothing that reduces a package to a judgement', () => {
    const findings = run(snapshot({ documents: [doc()] }));
    const counts = tally(findings);
    expect(Object.keys(counts).sort()).toEqual(['fail', 'not_evaluable', 'pass', 'review']);
    // No score, no verdict, no recommendation anywhere in the run's shape (D-001).
    const runValue = runDocumentChecks(snapshot({ documents: [doc()] }), RULES, { runId: 'r' });
    expect(JSON.stringify(runValue)).not.toMatch(/"(score|verdict|recommendation|risk|decision)"/i);
  });
});

describe('no finding asserts a determination, checked structurally', () => {
  /**
   * Every finding every fixture in this file can produce, audited against the same term list the
   * rest of the project uses. Mechanical rather than read — a wordlist is not a proof, but it is
   * the difference between a rule enforced and a rule remembered.
   */
  it('across every branch these fixtures reach', () => {
    const bank = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true });
    const idSlot = slot({ id: 'slot-id', slotKey: 'owner_photo_id', expiryAfterRun: true });
    const snapshots = [
      snapshot({ documents: [doc()] }),
      snapshot({ documents: [doc({ outcome: 'unreadable', outcomeReason: 'nothing could be read', extraction: null })] }),
      snapshot({ documents: [doc({ outcome: 'encrypted', outcomeReason: 'password', extraction: null })] }),
      snapshot({ slots: [idSlot], documents: [doc({ slotId: 'slot-id', slotKey: 'owner_photo_id', extraction: extraction([value('expiry_date', '2020-01-01')]) })] }),
      snapshot({ slots: [bank], documents: [doc({ slotId: 'slot-bank', slotKey: 'bank_statement', extraction: extraction([value('statement_period', '2024-01-01')]) })] }),
      snapshot({ slots: [slot({ state: 'waived', reason: 'processor_confirmed_not_required' })] }),
    ];
    // The constructors throw on a determination, so reaching this line at all is the assertion.
    for (const s of snapshots) expect(() => run(s)).not.toThrow();
  });

  it('and the guard fires when a determination is put in front of it', async () => {
    const { adverse, DeterminationError } = documents;
    const check = RULES.checks.checks.find((c) => c.id === 'A-01')!;
    expect(() =>
      adverse(check, 'The EIN was verified against the IRS.', { kind: 'package' }),
    ).toThrow(DeterminationError);
    expect(() =>
      adverse(check, 'This document is a forgery.', { kind: 'package' }),
    ).toThrow(/forgery/);
    expect(() =>
      adverse(check, 'We recommend declining this merchant.', { kind: 'package' }),
    ).toThrow(DeterminationError);
  });
});

describe('not_evaluable always carries a declared reason', () => {
  it('never a bare state', () => {
    const bank = slot({ id: 'slot-bank', slotKey: 'bank_statement', requiredCount: 3, monthly: true });
    const findings = run(
      snapshot({
        slots: [bank, slot({ slotKey: 'owner_photo_id', id: 'slot-oid', requiredCount: null, state: 'not_evaluable' })],
        documents: [doc({ slotId: 'slot-bank', slotKey: 'bank_statement' })],
      }),
    );
    const nev = findings.filter((f) => f.state === 'not_evaluable');
    expect(nev.length).toBeGreaterThan(0);
    for (const f of nev) {
      expect(f.notEvaluableReason, f.checkId).toBeTruthy();
      const check = RULES.checks.checks.find((c) => c.id === f.checkId)!;
      expect(check.not_evaluable_when, f.checkId).toContain(f.notEvaluableReason);
    }
  });

  it('and a reason a check does not declare is refused', () => {
    const { notEvaluable, UndeclaredReasonError } = documents;
    const check = RULES.checks.checks.find((c) => c.id === 'A-02')!;
    expect(() => notEvaluable(check, 'made_up_reason', 'note', { kind: 'package' })).toThrow(UndeclaredReasonError);
    expect(() => notEvaluable(check, 'page_numbering_absent', 'note', { kind: 'package' })).not.toThrow();
  });
});

describe('scope', () => {
  it('skips collected-only documents entirely (D-082)', () => {
    const s = snapshot({
      slots: [slot({ id: 'slot-coa', slotKey: 'coa', examined: false })],
      documents: [doc({ slotId: 'slot-coa', slotKey: 'coa' })],
    });
    // Present, not examined. No finding is different from a finding that passed.
    expect(run(s, ['A'])).toHaveLength(0);
  });

  it('skips superseded versions — the live one is what the slot holds', () => {
    const old = doc({ supersededBy: 'ver-new', outcome: 'unreadable', outcomeReason: 'x', extraction: null });
    const live = doc({ supersedes: old.versionId });
    const findings = run(snapshot({ documents: [old, live] }), ['A']);
    expect(of(findings, 'A-01')).toHaveLength(1);
    expect(one(findings, 'A-01').state).toBe('pass');
  });

  it('runs no deferred check', () => {
    const ids = new Set(run(snapshot({ documents: [doc()] })).map((f) => f.checkId));
    for (const deferred of ['C-20', 'D-05', 'D-06']) expect(ids.has(deferred)).toBe(false);
  });
});
