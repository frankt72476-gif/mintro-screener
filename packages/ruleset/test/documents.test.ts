/**
 * The two Documents Check rule files, their loader, and every refusal.
 *
 * The refusal tests matter more than the round-trip ones. A malformed rule set that loads is a
 * report built on rules nobody checked, and the specific case this file is built around — a
 * template naming a slot the catalog does not define — is a requirement that *silently does not
 * exist*. It renders as a package with one fewer thing to chase, indistinguishable from a package
 * that never needed it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DocumentsValidationError,
  checksInRelease,
  loadDocumentsRules,
  loadSlotTemplate,
  parseDocumentsRules,
  slotsForPackage,
  type DocumentsRules,
  type PackageFacts,
} from '@mintro/ruleset';

const CHECKS = JSON.parse(readFileSync('rules/documents.checks.json', 'utf8')) as Record<string, unknown>;
const TEMPLATES = JSON.parse(readFileSync('rules/documents.templates.json', 'utf8')) as Record<string, unknown>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Parse a mutated pair and return the defects, or fail loudly if it was accepted. */
function refuses(checks: unknown, templates: unknown): DocumentsValidationError {
  try {
    parseDocumentsRules(checks, templates);
  } catch (error) {
    if (error instanceof DocumentsValidationError) return error;
    throw error;
  }
  throw new Error('expected the load to be refused, and it was accepted');
}

describe('the files load', () => {
  it('parses both together', () => {
    const rules = loadDocumentsRules();
    expect(rules.checks.checks.length).toBeGreaterThan(0);
    expect(rules.templates.processors.length).toBeGreaterThan(0);
  });

  /**
   * The count in §6's header once said "31 checks, 24 in v1" while the tables under it contained
   * 39 and 36. The tables are the content, so they are what is transcribed — and this pins the real
   * number so a future edit to either has to reckon with the other. D-117 withdrew B-06, taking it
   * to 38 and 35.
   */
  it('carries every check in §6 and nothing else', () => {
    const rules = loadDocumentsRules();
    const expected = [
      ...Array.from({ length: 7 }, (_, i) => `A-0${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `B-0${i + 1}`), // B-06 withdrawn — D-117
      ...Array.from({ length: 20 }, (_, i) => `C-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 6 }, (_, i) => `D-0${i + 1}`),
    ];
    expect(rules.checks.checks.map((c) => c.id).sort()).toEqual(expected.sort());
  });

  it('marks exactly the three checks §6 defers', () => {
    const rules = loadDocumentsRules();
    expect(checksInRelease(rules, 'deferred').map((c) => c.id).sort()).toEqual(['C-20', 'D-05', 'D-06']);
    expect(checksInRelease(rules, 'v1')).toHaveLength(35);
  });

  it('carries §3\'s catalog, 13 examined and 7 collected-only', () => {
    const { catalog } = loadDocumentsRules().checks;
    expect(catalog).toHaveLength(20);
    expect(catalog.filter((c) => c.examined)).toHaveLength(13);
    expect(catalog.filter((c) => !c.examined)).toHaveLength(7);
  });

  it('carries §5\'s enumerations, 9 and 4', () => {
    const { reasons } = loadDocumentsRules().checks;
    expect(reasons.not_provided).toHaveLength(9);
    expect(reasons.waived).toHaveLength(4);
  });

  it('gives every check the six properties it can have', () => {
    for (const check of loadDocumentsRules().checks.checks) {
      expect(check.id, check.id).toMatch(/^[ABCD]-\d{2}$/);
      expect(check.reads, check.id).toBeDefined();
      expect(check.compares.kind, check.id).toBeTruthy();
      expect(check.states, check.id).toContain('pass');
      expect(Array.isArray(check.not_evaluable_when), check.id).toBe(true);
      expect(['v1', 'deferred'], check.id).toContain(check.release);
    }
  });

  /**
   * D-098 makes the two-source rule binding on family C. C-14 is the one exception and it is
   * deliberate: summing ownership percentages is arithmetic within one document, so one source is
   * all it can ever have. §6's blanket "all subject to the two-source rule" is imprecise there.
   */
  it('applies the two-source rule to family C except the one check that cannot have two', () => {
    const c = loadDocumentsRules().checks.checks.filter((x) => x.id.startsWith('C-'));
    const without = c.filter((x) => !x.not_evaluable_when.includes('fewer_than_two_sources'));
    expect(without.map((x) => x.id)).toEqual(['C-14', 'C-19']);
  });
});

describe('it refuses rather than warns', () => {
  it('a template naming a slot the catalog does not define', () => {
    const templates = clone(TEMPLATES) as { processors: { slots: { slot_key: string }[] }[] };
    templates.processors[0]!.slots[3]!.slot_key = 'bank_statment';

    const error = refuses(CHECKS, templates);
    const defect = error.defects.find((d) => d.id === 'bank_statment');
    expect(defect, 'the offending slot key must be named').toBeDefined();
    // Two files reference each other, so an error that does not say which is half an error.
    expect(defect?.file).toBe('documents.templates.json');
    expect(defect?.message).toMatch(/catalog does not define/);
    expect(defect?.message).toMatch(/silently not exist/);
  });

  it('a check reading a document absent from the catalog', () => {
    const checks = clone(CHECKS) as { checks: { id: string; reads: { documents?: string[] } }[] };
    const target = checks.checks.find((c) => c.id === 'C-03')!;
    target.reads.documents = ['application', 'ein_leter'];

    const error = refuses(checks, TEMPLATES);
    const defect = error.defects.find((d) => d.id === 'C-03');
    expect(defect?.file).toBe('documents.checks.json');
    expect(defect?.message).toMatch(/ein_leter/);
    expect(defect?.message).toMatch(/catalog does not define/);
  });

  /**
   * A collected-only document is present-not-examined (D-082). A check consuming one is a
   * contradiction between two halves of the same file, and it would surface as a finding about a
   * document nobody read.
   */
  it('a check reading a collected_only document', () => {
    const checks = clone(CHECKS) as { checks: { id: string; reads: { documents?: string[] } }[] };
    checks.checks.find((c) => c.id === 'C-01')!.reads.documents = ['application', 'coa'];

    const error = refuses(checks, TEMPLATES);
    const defect = error.defects.find((d) => d.id === 'C-01');
    expect(defect?.file).toBe('documents.checks.json');
    expect(defect?.message).toMatch(/collected_only/);
    expect(defect?.message).toMatch(/D-082/);
  });

  it('a not_evaluable condition outside the enumeration (D-079 discipline)', () => {
    const checks = clone(CHECKS) as { checks: { id: string; not_evaluable_when: string[] }[] };
    checks.checks.find((c) => c.id === 'A-02')!.not_evaluable_when = ['looks_a_bit_off'];

    const error = refuses(checks, TEMPLATES);
    const defect = error.defects.find((d) => d.id === 'A-02');
    expect(defect?.file).toBe('documents.checks.json');
    expect(defect?.message).toMatch(/looks_a_bit_off/);
  });

  it('a slot reason used outside its enumeration (D-079)', () => {
    const checks = clone(CHECKS) as { checks: { id: string; compares: Record<string, unknown> }[] };
    checks.checks.find((c) => c.id === 'C-19')!.compares['expected_reason'] = 'seemed fine';

    const error = refuses(checks, TEMPLATES);
    const defect = error.defects.find((d) => d.id === 'C-19');
    expect(defect?.file).toBe('documents.checks.json');
    expect(defect?.message).toMatch(/not in the not_provided or waived enumerations/);
  });

  it('a check id whose family prefix is not a family', () => {
    const checks = clone(CHECKS) as { checks: { id: string }[] };
    checks.checks.find((c) => c.id === 'A-01')!.id = 'X-01';

    const error = refuses(checks, TEMPLATES);
    expect(error.defects.some((d) => d.id === 'X-01' && /family prefix/.test(d.message))).toBe(true);
  });

  it('a duplicate check id', () => {
    const checks = clone(CHECKS) as { checks: { id: string }[] };
    checks.checks.find((c) => c.id === 'C-02')!.id = 'C-01';

    const error = refuses(checks, TEMPLATES);
    const defect = error.defects.find((d) => d.id === 'C-01' && /duplicate/.test(d.message));
    expect(defect?.file).toBe('documents.checks.json');
  });

  it('a duplicate catalog key', () => {
    const checks = clone(CHECKS) as { catalog: { key: string }[] };
    checks.catalog[1]!.key = 'application';
    expect(refuses(checks, TEMPLATES).defects.some((d) => d.id === 'application' && /duplicate/.test(d.message))).toBe(true);
  });

  it('a slot appearing twice in one processor', () => {
    const templates = clone(TEMPLATES) as { processors: { slots: { slot_key: string }[] }[] };
    templates.processors[0]!.slots[1]!.slot_key = 'application';
    const error = refuses(CHECKS, templates);
    expect(error.defects.some((d) => d.file === 'documents.templates.json' && /appears twice/.test(d.message))).toBe(true);
  });

  it('a predicate on something other than the three questions (D-081)', () => {
    const templates = clone(TEMPLATES) as {
      processors: { slots: { slot_key: string; predicate?: { field: string } }[] }[];
    };
    const conditional = templates.processors[0]!.slots.find((s) => s.predicate !== undefined)!;
    conditional.predicate!.field = 'merchant_seems_fine';

    const error = refuses(CHECKS, templates);
    const defect = error.defects.find((d) => /merchant_seems_fine/.test(d.message));
    expect(defect?.file).toBe('documents.templates.json');
    expect(defect?.message).toMatch(/three questions/);
  });

  it('reports every defect at once rather than the first', () => {
    const checks = clone(CHECKS) as { checks: { id: string; reads: { documents?: string[] } }[] };
    checks.checks.find((c) => c.id === 'C-01')!.reads.documents = ['nope_one'];
    checks.checks.find((c) => c.id === 'C-03')!.reads.documents = ['nope_two'];

    const error = refuses(checks, TEMPLATES);
    // A rule set with six problems should take one pass to fix, not six.
    expect(error.defects.length).toBeGreaterThanOrEqual(2);
    expect(error.message).toMatch(/documents.checks.json \[C-01\]/);
    expect(error.message).toMatch(/documents.checks.json \[C-03\]/);
  });

  it('a check that is exact and fuzzy at once (D-099)', () => {
    const checks = clone(CHECKS) as { checks: { id: string; states: string[] }[] };
    checks.checks.find((c) => c.id === 'C-03')!.states = ['fail', 'review', 'pass'];
    expect(refuses(checks, TEMPLATES).defects.some((d) => /exact or fuzzy/.test(d.message))).toBe(true);
  });
});

describe('the loadSlotTemplate swap preserves M1 behaviour', () => {
  /**
   * The nine slots M1's hard-coded seed produced for an LLC, US-domiciled, with a prior processor.
   * Written out here rather than derived from the loader — a expectation computed from the thing
   * under test proves only that it agrees with itself (D-026).
   */
  const M1_LLC_US = [
    'application',
    'ein_letter',
    'voided_check',
    'bank_statement',
    'processing_statement',
    'owner_photo_id',
    'proof_of_domain',
    'articles_of_incorporation',
    'w9',
  ];

  const facts: PackageFacts = { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true };

  it('resolves the default template to the set M1 seeded', () => {
    expect(slotsForPackage(facts).map((s) => s.slotKey).sort()).toEqual([...M1_LLC_US].sort());
  });

  it('carries the same counts, coverage and flags M1 had', () => {
    const bySlot = new Map(slotsForPackage(facts).map((s) => [s.slotKey, s]));

    expect(bySlot.get('bank_statement')).toMatchObject({
      requiredCount: 3, monthly: true, graceDays: 10, examined: true, allowsInstances: false,
    });
    expect(bySlot.get('voided_check')).toMatchObject({ requiredCount: 1, monthly: false, examined: true });
    // The one with an unknown count, which is why the sixth slot state exists (D-107).
    expect(bySlot.get('owner_photo_id')).toMatchObject({
      requiredCount: null, expiryAfterRun: true, countDerivedFrom: 'application_ownership_section',
    });
  });

  it('titles come from the catalog, which is the half the template does not carry', () => {
    const bySlot = new Map(loadSlotTemplate().slots.map((s) => [s.slotKey, s]));
    expect(bySlot.get('ein_letter')?.title).toBe('EIN Letter (CP-575 / 147C)');
    // examined/collected_only is catalog data too, and it reaches the slot through the join.
    expect(bySlot.get('coa')?.examined).toBe(false);
    expect(bySlot.get('application')?.examined).toBe(true);
  });

  it('still exposes the full catalogue including slots that are off', () => {
    expect(loadSlotTemplate().slots).toHaveLength(20);
  });
});

describe('conditionals (D-081)', () => {
  const base: PackageFacts = { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true };
  const keys = (facts: PackageFacts): string[] => slotsForPackage(facts).map((s) => s.slotKey);

  it('a sole proprietorship drops Articles — it has none to give', () => {
    expect(keys({ ...base, entityType: 'sole_proprietor' })).not.toContain('articles_of_incorporation');
    expect(keys(base)).toContain('articles_of_incorporation');
  });

  it('a domestic entity gets W-9 and no W-8BEN, and a foreign one the reverse (D-111)', () => {
    const domestic = keys({ ...base, usDomiciled: true });
    expect(domestic).toContain('w9');
    expect(domestic).not.toContain('w8ben');

    const foreign = keys({ ...base, usDomiciled: false });
    expect(foreign).toContain('w8ben');
    expect(foreign).not.toContain('w9');
  });

  /**
   * "Startup" is not structural impossibility — plenty of new merchants have processing history
   * under another entity — so the slot stays and resolves to `not_provided` with a reason. The
   * report then says we asked and there are none, rather than never mentioning it.
   */
  it('a merchant with no existing processor still gets Processing Statements', () => {
    expect(keys({ ...base, hasExistingProcessor: false })).toContain('processing_statement');
  });

  it('slots marked added are never seeded', () => {
    for (const key of ['business_license', 'dba_filing', 'additional_document', 'coa']) {
      expect(keys(base), key).not.toContain(key);
    }
  });
});

describe('D-101\'s claim: a processor is an entry in one file and nothing else', () => {
  /**
   * The whole reason the two files are split. Asserted rather than intended: a second processor is
   * added to the templates document alone — no code, no schema change, no touch to the checks
   * file — and it produces a different required set.
   */
  it('adds a processor with a different set, changing nothing else', () => {
    const templates = clone(TEMPLATES) as {
      processors: { key: string; label: string; slots: unknown[] }[];
    };
    const slots = clone(templates.processors[0]!.slots) as { slot_key: string; origin: string }[];

    // This processor does not want a domain proof and does want a DBA filing.
    const trimmed = slots.filter((s) => s.slot_key !== 'proof_of_domain');
    trimmed.find((s) => s.slot_key === 'dba_filing')!.origin = 'required';

    templates.processors.push({ key: 'northlake', label: 'Northlake Bancorp', slots: trimmed });

    // The checks file is passed through untouched — same object, not a copy.
    const rules: DocumentsRules = parseDocumentsRules(CHECKS, templates);

    const facts: PackageFacts = { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true };
    const def = slotsForPackage(facts, loadSlotTemplate('default', rules)).map((s) => s.slotKey);
    const northlake = slotsForPackage(facts, loadSlotTemplate('northlake', rules)).map((s) => s.slotKey);

    expect(def).toContain('proof_of_domain');
    expect(northlake).not.toContain('proof_of_domain');
    expect(northlake).toContain('dba_filing');
    expect(def).not.toContain('dba_filing');
  });

  it('names the processors it does know when asked for one it does not', () => {
    expect(() => loadSlotTemplate('not-a-processor')).toThrow(/defines no processor 'not-a-processor'/);
    expect(() => loadSlotTemplate('not-a-processor')).toThrow(/it defines: default/);
  });
});

describe('the field vocabulary stays in step with the extractor', () => {
  /**
   * A cross-package assertion rather than a runtime dependency. `packages/extraction`'s vocabulary
   * was derived from these very checks (D-086), so a field named here that the extractor cannot
   * produce is a check that can never run — and a test is the right place to catch that without
   * making the ruleset package depend on the extractor.
   */
  it('every field a check reads is one the extractor can produce', async () => {
    const { FIELD_IDS } = await import('@mintro/extraction');
    const known = new Set<string>(FIELD_IDS);
    const unknown: string[] = [];
    for (const check of loadDocumentsRules().checks.checks) {
      // Deferred checks are exempt: D-086 deliberately keeps a field out of the vocabulary until
      // the check that reads it ships, so C-20's residential address is absent on purpose.
      if (check.release === 'deferred') continue;
      for (const field of check.reads.fields ?? []) {
        if (!known.has(field)) unknown.push(`${check.id}: ${field}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
