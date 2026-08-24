/**
 * Families C and D.
 *
 * Every check gets its adverse branch, its clean branch, and each declared `not_evaluable` reason
 * reached independently — and **the two-source rule is asserted per check, not once against the
 * helper**. That distinction is the point: `needsTwoSources()` being correct is a fact about one
 * function, and every check being bound by it is a fact about the family. Only the second is what
 * D-098 asks for, and only per-check cases can show it.
 *
 * C-14's exemption is pinned in both directions: it must answer with one source, and every other
 * family C check must refuse to.
 */

import { describe, expect, it } from 'vitest';
import { loadDocumentsRules, type DocumentsRules } from '@mintro/ruleset';
import type { ExtractionResult, ExtractedValue } from '@mintro/extraction';
import { documents } from '../src/index.js';
import type { DocumentFinding, DocumentSnapshot, PackageSnapshot, SlotSnapshot } from '../src/documents/types.js';

const { runDocumentChecks } = documents;
const RULES: DocumentsRules = loadDocumentsRules();
const RUN_AT = new Date('2026-05-15T00:00:00Z');

// --- builders ----------------------------------------------------------------------------------

function value(field: string, text: string, index = 0, tier: 'character' | 'page' = 'character'): ExtractedValue {
  return {
    field,
    index,
    presence: 'present',
    value: text,
    provenance:
      tier === 'character'
        ? { document_version: 'h'.repeat(64), page: 1, location: { kind: 'text', rect: { x: 0, y: 0, width: 1, height: 1 } }, snippet: `${field}: ${text}` }
        : { document_version: 'h'.repeat(64), page: 1 },
    tier,
  };
}

function extraction(values: ExtractedValue[], route: 'text' | 'vision' = 'text'): ExtractionResult {
  return {
    outcome: 'extracted',
    reason: null,
    pages: [{ page: 1, route, reason: null, glyphs: route === 'text' ? 200 : 0, usage: null }],
    values,
    hash: 'h'.repeat(64),
    extractor_version: '0.1.0',
    cached: false,
    detected_type: 'pdf',
  };
}

let seq = 0;
/** A document in a slot, carrying values. The slot is created to match. */
function doc(slotKey: string, values: ExtractedValue[], over: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  seq += 1;
  return {
    documentId: `doc-${seq}`,
    versionId: `ver-${seq}`,
    version: 1,
    slotId: `slot-${slotKey}`,
    slotKey,
    supersedes: null,
    supersededBy: null,
    detectedType: 'pdf',
    originalFilename: `${slotKey}.pdf`,
    outcome: 'extracted',
    outcomeReason: null,
    extraction: extraction(values),
    ...over,
  };
}

function slotFor(slotKey: string, over: Partial<SlotSnapshot> = {}): SlotSnapshot {
  return {
    id: `slot-${slotKey}`,
    slotKey,
    instanceLabel: null,
    requiredCount: 1,
    monthly: false,
    graceDays: null,
    expiryAfterRun: false,
    examined: true,
    origin: 'required',
    state: 'satisfied',
    reason: null,
    ...over,
  };
}

/** A package built from documents; slots are inferred so a test says only what it means. */
function pkg(docs: DocumentSnapshot[], slots: SlotSnapshot[] = []): PackageSnapshot {
  const keys = [...new Set(docs.map((d) => d.slotKey))];
  const named = new Map(slots.map((s) => [s.slotKey, s]));
  return {
    packageId: 'pkg-1',
    runAt: RUN_AT,
    facts: { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true },
    slots: [...new Set([...keys, ...named.keys()])].map((k) => named.get(k) ?? slotFor(k)),
    documents: docs,
  };
}

const run = (s: PackageSnapshot, families: ('C' | 'D')[] = ['C'], routingDirectory?: (n: string) => string | null) =>
  runDocumentChecks(s, RULES, {
    runId: 'r',
    families,
    ...(routingDirectory === undefined ? {} : { routingDirectory }),
  }).findings;

const one = (findings: readonly DocumentFinding[], id: string): DocumentFinding => {
  const f = findings.find((x) => x.checkId === id);
  if (f === undefined) throw new Error(`no ${id} finding`);
  return f;
};

// --- the rule that binds the whole family --------------------------------------------------------

describe('the two-source rule, per check (D-098)', () => {
  /**
   * One case per check, driven off the rules file rather than a hand-written list — so a check
   * added later is bound by this the day it appears, not the day someone remembers to add it.
   */
  const SINGLE_SOURCE: Readonly<Record<string, ExtractedValue[]>> = {
    'C-01': [value('legal_name', 'Northwind Peptides LLC')],
    'C-02': [value('dba_name', 'Northwind Labs')],
    'C-03': [value('ein', '47-2841903')],
    'C-04': [value('business_address', '1420 Harbor View Rd')],
    'C-05': [value('entity_type', 'LLC')],
    'C-06': [value('formation_state', 'Delaware')],
    'C-07': [value('formation_date', '2019-04-02')],
    'C-08': [value('routing_number', '122105155')],
    'C-09': [value('account_number', '000123456789')],
    'C-12': [value('owner_name', 'Jane Smith')],
    'C-16': [value('owner_dob', '1984-02-11')],
    'C-18': [value('processor_name', 'Stripe')],
  };

  for (const [id, values] of Object.entries(SINGLE_SOURCE)) {
    it(`${id} returns not_evaluable on one source, never pass`, () => {
      const f = one(run(pkg([doc('application', values)])), id);
      expect(f.state).toBe('not_evaluable');
      expect(f.notEvaluableReason).toBe('fewer_than_two_sources');
    });
  }

  /**
   * A source is a document that **stated the field**, not a document that was in scope.
   *
   * Found by break-testing: making `sources()` count every document it looked at turned a
   * single-source package into a pass, and nothing in the suite noticed. That is the exact D-098
   * failure — a lone value corroborating itself because a silent document was counted beside it.
   */
  it('a document that states nothing is not a second source', () => {
    const f = one(run(pkg([
      doc('application', [value('ein', '47-2841903')]),
      // In scope for C-03 and readable, but says nothing about the EIN.
      doc('w9', [value('legal_name', 'Northwind Peptides LLC')]),
    ])), 'C-03');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('fewer_than_two_sources');
  });

  it('C-11, C-15 and C-17 need both sides, not two copies of one', () => {
    // The subject present and nothing to set it against.
    const f11 = one(run(pkg([doc('voided_check', [value('account_holder_name', 'Northwind Peptides LLC')])])), 'C-11');
    expect(f11.state).toBe('not_evaluable');
    expect(f11.notEvaluableReason).toBe('fewer_than_two_sources');
  });

  it('C-10 says so when no bank name is stated beside the resolved routing number', () => {
    const directory = () => 'HARBOR MUTUAL SAVINGS BANK';
    const f = one(run(pkg([doc('voided_check', [value('routing_number', '122105155')])]), ['C'], directory), 'C-10');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('fewer_than_two_sources');
  });

  /**
   * The exemption, from the other side (D-116).
   *
   * If C-14 ever acquires `fewer_than_two_sources`, it becomes a rule that can never fire — worse
   * than an absent rule, because it looks like coverage. This pins the declaration and the
   * behaviour, because either alone could drift.
   */
  it('C-14 is exempt and answers from one document', () => {
    expect(RULES.checks.checks.find((c) => c.id === 'C-14')?.not_evaluable_when)
      .not.toContain('fewer_than_two_sources');

    const f = one(run(pkg([doc('application', [value('owner_ownership_pct', '60', 0), value('owner_ownership_pct', '40', 1)])])), 'C-14');
    expect(f.state).toBe('pass');
  });
});

// --- family C, check by check ---------------------------------------------------------------------

describe('C-01 — legal name', () => {
  it('passes when two documents agree after normalisation, and shows both raw forms', () => {
    const f = one(run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC')]),
      doc('ein_letter', [value('legal_name', 'NORTHWIND PEPTIDES, L.L.C.')]),
    ])), 'C-01');
    expect(f.state).toBe('pass');
    // §1: the normalisation is shown, so a reader can judge it rather than trust it.
    expect(f.note).toMatch(/Northwind Peptides LLC/);
    expect(f.note).toMatch(/NORTHWIND PEPTIDES, L\.L\.C\./);
  });

  it('reviews a genuine difference, and review not fail because the comparison is fuzzy (D-099)', () => {
    const f = one(run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC')]),
      doc('ein_letter', [value('legal_name', 'Southwind Peptides LLC')]),
    ])), 'C-01');
    expect(f.state).toBe('review');
  });
});

describe('C-02 — DBA name', () => {
  it('is not evaluable when the application declares no DBA', () => {
    const f = one(run(pkg([doc('application', [value('dba_same_as_legal', 'Yes')])])), 'C-02');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('no_dba_declared');
  });

  /**
   * There is no DBA filing in the required set, so nothing here has seen a register. Wording that
   * implied one would put a claim in the report that no document backs (Frank's ruling).
   */
  it('never implies the name is registered anywhere', () => {
    const findings = [
      one(run(pkg([doc('application', [value('dba_same_as_legal', 'Yes')])])), 'C-02'),
      one(run(pkg([
        doc('application', [value('dba_name', 'Northwind Labs')]),
        doc('bank_statement', [value('dba_name', 'Northwind Labs')]),
      ])), 'C-02'),
    ];
    for (const f of findings) {
      expect(f.note).not.toMatch(/registered|registration|filed|on file|filing/i);
    }
  });

  /**
   * The box being present is not the box being ticked.
   *
   * Break-testing found this too: treating any value of `dba_same_as_legal` as affirmative made
   * every application with the field on it skip C-02 entirely, including the ones that answered
   * "No". A skipped check reports nothing, which is the silence D-120 rules out.
   */
  it('compares normally when the box says No', () => {
    const f = one(run(pkg([
      doc('application', [value('dba_same_as_legal', 'No'), value('dba_name', 'Northwind Labs')]),
      doc('voided_check', [value('dba_name', 'Coastal Trading')]),
    ])), 'C-02');
    expect(f.state).toBe('review');
  });

  it('compares normally when a DBA is declared', () => {
    const f = one(run(pkg([
      doc('application', [value('dba_name', 'Northwind Labs')]),
      doc('voided_check', [value('dba_name', 'Northwind Labs')]),
    ])), 'C-02');
    expect(f.state).toBe('pass');
  });
});

describe('C-03 — EIN, an exact comparison', () => {
  it('fails a mismatch, because digits cannot differ innocently (D-099)', () => {
    const f = one(run(pkg([
      doc('application', [value('ein', '47-2841903')]),
      doc('ein_letter', [value('ein', '47-2841904')]),
    ])), 'C-03');
    expect(f.state).toBe('fail');
  });

  it('passes across formatting', () => {
    const f = one(run(pkg([
      doc('application', [value('ein', '47-2841903')]),
      doc('w9', [value('ein', '472841903')]),
    ])), 'C-03');
    expect(f.state).toBe('pass');
  });
});

describe('C-04 — business address', () => {
  it('passes across USPS abbreviation and suite formatting', () => {
    const f = one(run(pkg([
      doc('application', [value('business_address', '1420 Harbor View Road, Suite 200')]),
      doc('ein_letter', [value('business_address', '1420 HARBOR VIEW RD STE 200')]),
    ])), 'C-04');
    expect(f.state).toBe('pass');
  });

  it('reviews a different address', () => {
    const f = one(run(pkg([
      doc('application', [value('business_address', '1420 Harbor View Rd')]),
      doc('ein_letter', [value('business_address', '88 Pier Street')]),
    ])), 'C-04');
    expect(f.state).toBe('review');
  });
});

describe('C-05, C-06, C-07 — entity type, state, formation date', () => {
  it('folds entity type across how three documents write it', () => {
    const f = one(run(pkg([
      doc('application', [value('entity_type', 'Limited Liability Company')]),
      doc('w9', [value('entity_type', 'LLC')]),
    ])), 'C-05');
    expect(f.state).toBe('pass');
  });

  it('folds a state name against its code', () => {
    const f = one(run(pkg([
      doc('application', [value('formation_state', 'Delaware')]),
      doc('articles_of_incorporation', [value('formation_state', 'DE')]),
    ])), 'C-06');
    expect(f.state).toBe('pass');
  });

  it('folds date formats, and fails a genuinely different date', () => {
    const same = one(run(pkg([
      doc('application', [value('formation_date', '04/02/2019')]),
      doc('articles_of_incorporation', [value('formation_date', '2019-04-02')]),
    ])), 'C-07');
    expect(same.state).toBe('pass');

    const different = one(run(pkg([
      doc('application', [value('formation_date', '2019-04-02')]),
      doc('articles_of_incorporation', [value('formation_date', '2019-04-03')]),
    ])), 'C-07');
    expect(different.state).toBe('review');
  });
});

describe('C-08, C-09 — routing and account numbers', () => {
  it('fails a one-digit routing difference', () => {
    const f = one(run(pkg([
      doc('application', [value('routing_number', '122105155')]),
      doc('voided_check', [value('routing_number', '122105156')]),
    ])), 'C-08');
    expect(f.state).toBe('fail');
  });

  it('passes an account number across formatting', () => {
    const f = one(run(pkg([
      doc('application', [value('account_number', '000123456789')]),
      doc('bank_statement', [value('account_number', '0001-2345-6789')]),
    ])), 'C-09');
    expect(f.state).toBe('pass');
  });
});

describe('C-10 — the routing number resolves to an institution', () => {
  const withRouting = (bank: string) => pkg([
    doc('voided_check', [value('routing_number', '122105155'), value('bank_name', bank)]),
    doc('bank_statement', [value('bank_name', bank)]),
  ]);

  it('passes when the directory agrees with the letterhead', () => {
    const f = one(run(withRouting('Harbor Mutual Savings'), ['C'], () => 'HARBOR MUTUAL SAVINGS BANK, N.A.'), 'C-10');
    expect(f.state).toBe('pass');
  });

  it('reviews when the directory names a different institution', () => {
    const f = one(run(withRouting('Pier Street Credit Union'), ['C'], () => 'HARBOR MUTUAL SAVINGS BANK'), 'C-10');
    expect(f.state).toBe('review');
  });

  it('reviews a routing number the directory does not list', () => {
    const f = one(run(withRouting('Harbor Mutual Savings'), ['C'], () => null), 'C-10');
    expect(f.state).toBe('review');
    expect(f.note).toMatch(/does not appear in the Federal Reserve/);
  });

  it('reviews a routing number that fails the ABA checksum', () => {
    const bad = pkg([
      doc('voided_check', [value('routing_number', '122105150'), value('bank_name', 'Harbor Mutual Savings')]),
      doc('bank_statement', [value('bank_name', 'Harbor Mutual Savings')]),
    ]);
    const f = one(run(bad, ['C'], () => 'HARBOR MUTUAL SAVINGS BANK'), 'C-10');
    expect(f.state).toBe('review');
    expect(f.note).toMatch(/ABA checksum/);
  });

  it('is not evaluable when no routing number was read', () => {
    const f = one(run(pkg([doc('voided_check', [value('bank_name', 'Harbor Mutual Savings')])]), ['C'], () => 'X'), 'C-10');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('routing_number_not_extracted');
  });

  it('is not evaluable when the directory was not supplied, rather than passing on a lookup it never made', () => {
    const f = one(run(withRouting('Harbor Mutual Savings')), 'C-10');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('routing_directory_unavailable');
  });

  /** It confirms the institution and nothing about the account (§6, §7). */
  it('never says anything about the account', () => {
    for (const directory of [() => 'HARBOR MUTUAL SAVINGS BANK', () => null]) {
      const f = one(run(withRouting('Harbor Mutual Savings'), ['C'], directory), 'C-10');
      expect(f.note).not.toMatch(/account (is|exists|open|belongs|verified)/i);
    }
  });
});

describe('C-11, C-15, C-17 — a value that may match either of several', () => {
  it('passes an account held in the DBA rather than the legal name', () => {
    const f = one(run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC'), value('dba_name', 'Northwind Labs')]),
      doc('voided_check', [value('account_holder_name', 'Northwind Labs')]),
    ])), 'C-11');
    expect(f.state).toBe('pass');
  });

  it('reviews an account held in neither', () => {
    const f = one(run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC'), value('dba_name', 'Northwind Labs')]),
      doc('voided_check', [value('account_holder_name', 'Jane Smith')]),
    ])), 'C-11');
    expect(f.state).toBe('review');
  });

  it('passes a signer who is one of the owners, in either name order', () => {
    const f = one(run(pkg([
      doc('application', [value('signer_name', 'SMITH, JANE A'), value('owner_name', 'Jane A Smith')]),
      doc('articles_of_incorporation', [value('owner_name', 'Jane A Smith')]),
    ])), 'C-15');
    expect(f.state).toBe('pass');
  });

  it('reviews a domain registrant matching neither name', () => {
    const f = one(run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC'), value('dba_name', 'Northwind Labs')]),
      doc('proof_of_domain', [value('domain_registrant', 'Coastal Holdings Inc')]),
    ])), 'C-17');
    expect(f.state).toBe('review');
  });
});

describe('C-12, C-16 — owners against their IDs', () => {
  it('passes an owner name across ordering', () => {
    const f = one(run(pkg([
      doc('application', [value('owner_name', 'Jane A Smith')]),
      doc('owner_photo_id', [value('owner_name', 'SMITH, JANE A')]),
    ])), 'C-12');
    expect(f.state).toBe('pass');
  });

  it('fails a date of birth that differs, because the comparison is exact', () => {
    const f = one(run(pkg([
      doc('application', [value('owner_dob', '1984-02-11')]),
      doc('owner_photo_id', [value('owner_dob', '1984-02-12')]),
    ])), 'C-16');
    expect(f.state).toBe('fail');
  });
});

describe('C-13 — one ID per owner at 25% or more', () => {
  const application = (...pcts: string[]) =>
    doc('application', pcts.map((p, i) => value('owner_ownership_pct', p, i)));

  it('passes when every qualifying owner has an ID', () => {
    const f = one(run(pkg([
      application('60', '40'),
      doc('owner_photo_id', [value('owner_name', 'Jane Smith')]),
      doc('owner_photo_id', [value('owner_name', 'John Doe')]),
    ])), 'C-13');
    expect(f.state).toBe('pass');
  });

  it('ignores owners below the threshold', () => {
    const f = one(run(pkg([
      application('80', '10', '10'),
      doc('owner_photo_id', [value('owner_name', 'Jane Smith')]),
    ])), 'C-13');
    expect(f.state).toBe('pass');
  });

  it('fails a genuine shortfall', () => {
    const f = one(run(pkg([application('60', '40'), doc('owner_photo_id', [value('owner_name', 'Jane Smith')])])), 'C-13');
    expect(f.state).toBe('fail');
  });

  /**
   * D-118's general form. An unreadable ID is a document we hold and cannot count; reporting the
   * gap as a shortfall would chase a merchant for something they already sent.
   */
  it('does not report a shortfall covered by IDs it could not read', () => {
    const f = one(run(pkg([
      application('60', '40'),
      doc('owner_photo_id', [value('owner_name', 'Jane Smith')]),
      doc('owner_photo_id', [], { outcome: 'unreadable', outcomeReason: 'no page could be read', extraction: null }),
    ])), 'C-13');
    expect(f.state).toBe('not_evaluable');
    expect(f.note).toMatch(/could not be read/);
  });

  it('is not evaluable when the ownership section was not read', () => {
    const f = one(run(pkg([doc('application', [value('legal_name', 'Northwind Peptides LLC')])])), 'C-13');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('ownership_section_not_extracted');
  });
});

describe('C-14 — ownership percentages sum to no more than 100', () => {
  it('fails a sum over 100 and shows the arithmetic', () => {
    const f = one(run(pkg([doc('application', [value('owner_ownership_pct', '60', 0), value('owner_ownership_pct', '55', 1)])])), 'C-14');
    expect(f.state).toBe('fail');
    expect(f.note).toMatch(/115/);
  });

  it('passes a sum under 100, which is legitimate', () => {
    const f = one(run(pkg([doc('application', [value('owner_ownership_pct', '30', 0), value('owner_ownership_pct', '40', 1)])])), 'C-14');
    expect(f.state).toBe('pass');
  });

  it('is not evaluable when the ownership section was not read', () => {
    const f = one(run(pkg([doc('application', [value('legal_name', 'X Ltd')])])), 'C-14');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('ownership_section_not_extracted');
  });
});

describe('C-18, C-19 — prior processing', () => {
  it('reviews a stated processor that disagrees with the statement letterhead', () => {
    const f = one(run(pkg([
      doc('application', [value('processor_name', 'Stripe')]),
      doc('processing_statement', [value('processor_name', 'Square')]),
    ])), 'C-18');
    expect(f.state).toBe('review');
  });

  /** The startup case §6 names: "no prior processing history" beside a named prior processor. */
  it('C-19 reviews a not-provided reason the other documents contradict', () => {
    const snapshot = pkg(
      [doc('application', [value('processor_name', 'Stripe')])],
      [slotFor('processing_statement', { state: 'not_provided', reason: 'new_business_no_processing_history' })],
    );
    const f = one(run(snapshot), 'C-19');
    expect(f.state).toBe('review');
    expect(f.note).toMatch(/new_business_no_processing_history/);
    expect(f.note).toMatch(/Stripe/);
  });

  it('C-19 passes when nothing contradicts the recorded reason', () => {
    const snapshot = pkg(
      [doc('application', [value('legal_name', 'Northwind Peptides LLC')])],
      [slotFor('processing_statement', { state: 'not_provided', reason: 'new_business_no_processing_history' })],
    );
    expect(one(run(snapshot), 'C-19').state).toBe('pass');
  });

  it('C-19 is not evaluable when the slot is not resolved to not_provided', () => {
    const snapshot = pkg([], [slotFor('processing_statement', { state: 'missing' })]);
    const f = one(run(snapshot), 'C-19');
    expect(f.state).toBe('not_evaluable');
    expect(f.notEvaluableReason).toBe('slot_not_resolved_to_not_provided');
  });
});

// --- family D ------------------------------------------------------------------------------------

describe('family D — derived against stated', () => {
  const statements = (over: Record<string, string> = {}) =>
    doc('processing_statement', [
      value('processing_volume', over['volume'] ?? '410000'),
      value('processing_transaction_count', over['count'] ?? '3280'),
      value('processing_high_ticket', over['high'] ?? '2400'),
      value('chargeback_count', over['cb'] ?? '4'),
    ]);

  it('D-01 reports both figures and the derivation, and reviews a material gap', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_monthly_volume', '$250,000')]),
      statements(),
    ]), ['D']), 'D-01');
    expect(f.state).toBe('review');
    expect(f.note).toMatch(/\$250,000/);
    expect(f.note).toMatch(/\$410,000/);
    expect(f.note).toMatch(/over 1 statement/);
  });

  it('D-01 passes when the stated figure is close', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_monthly_volume', '$400,000')]),
      statements(),
    ]), ['D']), 'D-01');
    expect(f.state).toBe('pass');
  });

  it('D-02 derives an average ticket and names the arithmetic', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_average_ticket', '$125')]),
      statements(),
    ]), ['D']), 'D-02');
    expect(f.note).toMatch(/3280 transactions/);
  });

  it('D-03 takes the largest itemised high ticket', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_high_ticket', '$2,400')]),
      statements(),
    ]), ['D']), 'D-03');
    expect(f.state).toBe('pass');
  });

  it('D-04 derives a chargeback rate', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_chargeback_rate', '0.12%')]),
      statements(),
    ]), ['D']), 'D-04');
    expect(f.note).toMatch(/4 chargeback\(s\) over 3280 transactions/);
  });

  /**
   * D-078's whole point. A merchant with no processing history and a merchant whose statements
   * nobody asked for are different situations, and the reason has to reach the report.
   */
  it('carries the recorded not_provided reason through, for every one of D-01..D-04', () => {
    const snapshot = pkg(
      [doc('application', [value('stated_monthly_volume', '$250,000')])],
      [slotFor('processing_statement', { state: 'not_provided', reason: 'new_business_no_processing_history' })],
    );
    const findings = run(snapshot, ['D']);
    for (const id of ['D-01', 'D-02', 'D-03', 'D-04']) {
      const f = one(findings, id);
      expect(f.state, id).toBe('not_evaluable');
      expect(f.notEvaluableReason, id).toBe('processing_statements_not_provided');
      expect(f.note, id).toMatch(/new_business_no_processing_history/);
    }
  });

  it('says no statements rather than not_provided when the slot is simply unfilled', () => {
    const snapshot = pkg(
      [doc('application', [value('stated_monthly_volume', '$250,000')])],
      [slotFor('processing_statement', { state: 'missing' })],
    );
    const findings = run(snapshot, ['D']);
    expect(one(findings, 'D-01').notEvaluableReason).toBe('no_processing_statements');
    expect(one(findings, 'D-02').notEvaluableReason).toBe('no_processing_statements');
    // D-03 and D-04 reach the same situation through the condition each declares: a figure that
    // was never itemised is a fortiori not itemised on statements that do not exist.
    expect(one(findings, 'D-03').notEvaluableReason).toBe('high_ticket_not_itemized');
    expect(one(findings, 'D-04').notEvaluableReason).toBe('chargebacks_not_itemized');
  });

  it('D-03 is not evaluable when no statement itemises a high ticket', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_high_ticket', '$2,400')]),
      doc('processing_statement', [value('processing_volume', '410000')]),
    ]), ['D']), 'D-03');
    expect(f.notEvaluableReason).toBe('high_ticket_not_itemized');
  });

  it('D-04 is not evaluable when chargebacks are not itemised', () => {
    const f = one(run(pkg([
      doc('application', [value('stated_chargeback_rate', '0.1%')]),
      doc('processing_statement', [value('processing_volume', '410000'), value('processing_transaction_count', '3280')]),
    ]), ['D']), 'D-04');
    expect(f.notEvaluableReason).toBe('chargebacks_not_itemized');
  });

  it('never judges the gap', () => {
    const findings = run(pkg([
      doc('application', [value('stated_monthly_volume', '$100')]),
      statements(),
    ]), ['D']);
    for (const f of findings) {
      expect(f.note).not.toMatch(/understat|overstat|inflat|misrepresent|concern|suspicious|discrepan/i);
    }
  });

  it('runs no deferred check', () => {
    const findings = run(pkg([
      doc('application', [value('stated_monthly_volume', '$250,000')]),
      statements(),
      doc('bank_statement', [value('bank_deposits', '405000')]),
    ]), ['D']);
    expect(findings.map((f) => f.checkId)).not.toContain('D-05');
    expect(findings.map((f) => f.checkId)).not.toContain('D-06');
  });
});

// --- shape ----------------------------------------------------------------------------------------

describe('the shape holds across twenty-six more checks', () => {
  it('no handler declared its own tier — every tier matches the documents read', () => {
    const findings = run(pkg([
      doc('application', [value('legal_name', 'Northwind Peptides LLC'), value('ein', '47-2841903')]),
      doc('ein_letter', [value('legal_name', 'NORTHWIND PEPTIDES LLC'), value('ein', '47-2841903')], {
        extraction: extraction([value('legal_name', 'NORTHWIND PEPTIDES LLC', 0, 'page'), value('ein', '47-2841903', 0, 'page')], 'vision'),
      }),
    ]), ['C']);
    // One side page-tier drags the observation to page tier — §2, and nothing here chose it.
    expect(one(findings, 'C-03').tier).toBe('page');
  });

  it('no finding asserts a determination', () => {
    // The constructor throws on one, so reaching this line for a broad sweep of packages is itself
    // the assertion; the explicit check is here so a reader sees what is being claimed.
    const findings = [
      ...run(pkg([doc('application', [value('ein', '1')]), doc('w9', [value('ein', '2')])]), ['C']),
      ...run(pkg([doc('application', [value('stated_monthly_volume', '$1')]), doc('processing_statement', [value('processing_volume', '999999')])]), ['D']),
    ];
    expect(findings.length).toBeGreaterThan(0);
  });

  it('every C and D finding names a check the ruleset declares as v1', () => {
    const v1 = new Set(RULES.checks.checks.filter((c) => c.release === 'v1').map((c) => c.id));
    const findings = run(pkg([
      doc('application', [value('legal_name', 'A LLC'), value('stated_monthly_volume', '$1')]),
      doc('ein_letter', [value('legal_name', 'A LLC')]),
    ]), ['C', 'D']);
    for (const f of findings) expect(v1.has(f.checkId), f.checkId).toBe(true);
  });
});
