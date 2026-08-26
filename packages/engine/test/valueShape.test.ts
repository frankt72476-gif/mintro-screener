/**
 * A value reported as found must be the kind of thing the rule names (D-135).
 *
 * The defect these guard, from run 730764d4 page 16:
 *
 *     Molecular formula listed — PASS
 *     Observed: 'national', 'center', 'for', 'biotechnology', 'information'.
 *
 * "National Center for Biotechnology Information" matched as a molecular formula. Two faults
 * compounded. `normalise` lowercases the text, and the pattern ran with the `i` flag — so
 * `[A-Z][a-z]?`, whose whole job is to recognise an element symbol, became "any letter". The rule
 * asserted it had found its subject when what it found was shaped nothing like it, which is
 * D-133's class of defect arriving one layer further in.
 *
 * The pair matters: removing the `i` flag *alone* would have turned the false pass into a false
 * fail, because `C62H98N16O22` is not in lowercased text either. Both tests below exist so a
 * future change cannot fix one half and call it done.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkTextMatch,
  isCasNumber,
  passesValidator,
  NO_GATE,
  type PageContext,
  type StyledText,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const rule = (id: string): RuleOfType<'text_match'> => {
  const found = ruleset.rules.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found as RuleOfType<'text_match'>;
};

/** A product page whose rendered text is exactly what the test supplies. */
function productPage(text: string): PageContext {
  return {
    requestedUrl: 'https://shop.example/product/bpc-157/',
    finalUrl: 'https://shop.example/product/bpc-157/',
    httpStatus: 200,
    title: 'BPC-157',
    text,
    html: `<html><body>${text}</body></html>`,
    htmlSha256: 'd'.repeat(64),
    footer: { found: false, text: '', styledText: [] },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: 'BPC-157',
    capturedAt: '2026-08-26T00:00:00.000Z',
    screenshotKey: 'run-1/layer2/shot.png',
    domKey: 'run-1/layer2/dom.html',
  };
}

/** The same page, but with the spec table as styled nodes, so the styled path is exercised. */
function styledProductPage(lines: readonly string[]): PageContext {
  const styledText: StyledText[] = lines.map((text, i) => ({
    text,
    selector: `div.spec > p:nth-child(${i + 1})`,
    fontSizePx: 14,
    color: { r: 0, g: 0, b: 0 },
    backgroundColor: { r: 255, g: 255, b: 255 },
    visible: true,
    collapsedAncestor: false,
  }));
  return { ...productPage(lines.join(' ')), styledText };
}

/** The page as it actually appeared: a spec table beside an NCBI credit line. */
const NCBI_PAGE =
  'Molecular Formula C62H98N16O22 Molecular Weight 1419.5 g/mol ' +
  'Source: National Center for Biotechnology Information';

/** The same page with the credit line but no formula — the case that must not pass. */
const NCBI_ONLY =
  'Molecular Formula see reference. Source: National Center for Biotechnology Information';

describe('PROD-002 — a molecular formula, not words near a label', () => {
  const prod002 = rule('PROD-002');

  it('does not report prose as a formula', () => {
    const finding = checkTextMatch(prod002, productPage(NCBI_ONLY));

    // The exact regression: this returned `pass` quoting five English words.
    expect(finding.state).not.toBe('pass');
    for (const word of ['national', 'center', 'biotechnology', 'information']) {
      expect(finding.note.toLowerCase()).not.toContain(`'${word}'`);
    }
  });

  it('still finds a real formula on the same page', () => {
    const finding = checkTextMatch(prod002, productPage(NCBI_PAGE));
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('C62H98N16O22');
  });

  /**
   * The half that is easy to lose. Case is the pattern's entire discrimination, so the text it
   * reads must keep its own — matching case-sensitively against lowercased text finds nothing at
   * all, which reads as "this page has no formula" about a page that plainly does.
   */
  it('reads case-preserved text, so the formula survives the search', () => {
    const finding = checkTextMatch(prod002, productPage(NCBI_PAGE));
    expect(finding.note).toContain('C62H98N16O22');
    expect(finding.note).not.toContain('c62h98n16o22');
  });

  /**
   * The styled path and the flat fallback are two ways into the same search, and only the second
   * was covered. `labelledRegion` lowercased what it returned on the styled path, which loses a
   * real formula exactly as the flat path did.
   */
  it('keeps case when the spec table is styled nodes rather than flat text', () => {
    const finding = checkTextMatch(
      prod002,
      styledProductPage(['Molecular Formula C62H98N16O22', 'Source: National Center for Biotechnology Information']),
    );
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('C62H98N16O22');
  });

  /**
   * The `i` flag on its own, isolated from the digit requirement.
   *
   * A lot number reads as a formula the moment case stops mattering: `b12x3y4` is three
   * element-shaped groups and carries digits, so the shape test alone waves it through. Only
   * capitalisation separates it from `C62H98N16O22`.
   */
  it('does not take a lowercase lot number for a formula', () => {
    for (const junk of ['batch b12x3y4', 'see lot a1b2c3']) {
      const finding = checkTextMatch(prod002, productPage(`Molecular Formula ${junk}`));
      expect(finding.state, junk).not.toBe('pass');
    }
  });

  it('does not take element-shaped acronyms for formulae', () => {
    for (const acronym of ['ATP', 'DNA', 'HPLC', 'USA']) {
      const finding = checkTextMatch(
        prod002,
        productPage(`Molecular Formula ${acronym} tested in house`),
      );
      expect(finding.state, `${acronym} was taken for a formula`).not.toBe('pass');
    }
  });

  it('is not evaluable when the page carries no such label at all', () => {
    const finding = checkTextMatch(prod002, productPage('BPC-157 5mg vial. In stock.'));
    expect(finding.state).toBe('not_evaluable');
  });
});

/**
 * The unlabelled path keeps case too.
 *
 * Built here rather than taken from the rule set, deliberately: every unlabelled pattern rule
 * today is PROD-001, whose values are digits, so no real rule can tell whether that branch
 * lowercases. The behaviour is still part of the handler's contract, and a guard nothing can
 * exercise is a guard nobody can prove works (D-131's lesson, applied to a branch).
 */
describe('a pattern with no labels reads case-preserved text', () => {
  const caseSensitiveRule = {
    id: 'TEST-001',
    cat: 'product',
    layer: 2,
    sev: 'minor',
    type: 'text_match',
    tier: 'review_only',
    title: 'An uppercase token is present',
    clause: 'Test fixture.',
    // String.raw, so the word boundaries are regex syntax rather than backspace characters.
    params: { surface: 'product', pattern: String.raw`\b[A-Z]{3}\b`, expect: 'present' },
  } as unknown as RuleOfType<'text_match'>;

  it('finds an uppercase token', () => {
    expect(checkTextMatch(caseSensitiveRule, productPage('lot ABC shipped')).state).toBe('pass');
  });

  it('does not find one that is not there', () => {
    expect(checkTextMatch(caseSensitiveRule, productPage('lot abc shipped')).state).not.toBe('pass');
  });
});

describe('PROD-001 — a CAS number proves itself', () => {
  const prod001 = rule('PROD-001');

  it('accepts a registry number whose check digit is right', () => {
    // 137525-51-0 is BPC-157.
    const finding = checkTextMatch(prod001, productPage('CAS 137525-51-0 · research use only'));
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('137525-51-0');
  });

  /**
   * The shape alone was the whole test before, and the shape is common. A phone number, an SKU or
   * a date range can carry it, and this rule searches the entire page.
   */
  it('rejects a number that is merely shaped like one', () => {
    const finding = checkTextMatch(prod001, productPage('Call 800261-53-7 for wholesale pricing'));
    expect(finding.state).not.toBe('pass');
    expect(finding.note).toContain('failed its validity test');
  });

  it('checks the digit itself, not the punctuation', () => {
    expect(isCasNumber('137525-51-0')).toBe(true);
    expect(isCasNumber('137525-51-9')).toBe(false);
    expect(isCasNumber('50-00-0')).toBe(true); // formaldehyde
    expect(isCasNumber('50-00-1')).toBe(false);
    expect(isCasNumber('not a number')).toBe(false);
  });
});

/**
 * A validator this engine does not implement must not read as "found it".
 *
 * The schema keeps rule set and engine in step, so this branch is only reachable when a rule set
 * is newer than the code reading it — a deploy ordering, which happens. Refusing is the safe
 * direction: the rule reports not finding its subject rather than reporting one it never tested.
 */
describe('an unknown validator refuses', () => {
  it('passes a value through when no validator is named', () => {
    expect(passesValidator('anything', undefined)).toBe(true);
  });

  it('applies the one it knows', () => {
    expect(passesValidator('137525-51-0', 'cas_checksum')).toBe(true);
    expect(passesValidator('137525-51-9', 'cas_checksum')).toBe(false);
  });

  it('rejects rather than waves through a validator it does not know', () => {
    expect(passesValidator('137525-51-0', 'checksum-from-a-newer-rule-set')).toBe(false);
  });
});

describe('PROD-003 and PROD-004 — the label is not the value', () => {
  /**
   * Both were labels-only, so the rule was satisfied by the words appearing and never looked at
   * what followed them. A page reading "Molecular weight: see datasheet" passed a rule titled
   * *Molecular weight listed*.
   */
  it('PROD-003 does not pass on a label with no figure', () => {
    const finding = checkTextMatch(rule('PROD-003'), productPage('Molecular Weight: see datasheet'));
    expect(finding.state).not.toBe('pass');
  });

  it('PROD-003 passes on a figure in g/mol', () => {
    const finding = checkTextMatch(rule('PROD-003'), productPage('Molecular Weight 1419.5 g/mol'));
    expect(finding.state).toBe('pass');
  });

  it('PROD-003 accepts the unit however the page cases it', () => {
    expect(checkTextMatch(rule('PROD-003'), productPage('MOLECULAR WEIGHT 1419.5 G/MOL')).state).toBe('pass');
  });

  it('PROD-004 does not pass on a heading with no condition', () => {
    const finding = checkTextMatch(rule('PROD-004'), productPage('Storage and handling information'));
    expect(finding.state).not.toBe('pass');
  });

  it('PROD-004 passes on a storage temperature', () => {
    for (const text of ['Store at -20C, desiccated.', 'Storage: 2-8 °C', 'STORAGE -20 DEGREES C']) {
      expect(checkTextMatch(rule('PROD-004'), productPage(text)).state, text).toBe('pass');
    }
  });
});

/**
 * The rule set says which patterns are case-agnostic; the engine no longer decides for them.
 *
 * Pinned because the default is the safe direction only while it stays the default: a future
 * change that reinstated a blanket `i` flag would revive the original defect exactly.
 */
describe('case sensitivity is the rule set\'s decision', () => {
  it('PROD-002 does not ask to ignore case', () => {
    expect(rule('PROD-002').params.ignore_case).toBeUndefined();
  });

  it('the unit patterns do ask to ignore case', () => {
    expect(rule('PROD-003').params.ignore_case).toBe(true);
    expect(rule('PROD-004').params.ignore_case).toBe(true);
  });
});

describe('PROD-009 names the surface it reads', () => {
  it('is titled for links rather than for citations', () => {
    const prod009 = ruleset.rules.find((r) => r.id === 'PROD-009');
    expect(prod009?.title).toBe('No links to study databases');
  });
});

/**
 * A rule that could not check something must not report the question as settled (D-137).
 *
 * `not_applicable` and `no_check_built` are different claims, and the coverage line treats them as
 * opposites: the first counts as **resolved**, the second as **outstanding**. Getting it wrong does
 * not merely mislabel a row, it inflates the headline number.
 */
describe('NAME-003 — an unknown compound is Mintro\'s gap, not the page\'s', () => {
  const name003 = rule('NAME-003');

  /**
   * Run 730764d4's case. The map holds two compounds; the catalogue is built on LGD-4033, MK-677,
   * YK-11, RAD-140, ostarine and cardarine. Four of five sampled pages said *the subject is not on
   * this page* about pages selling exactly the shorthand this rule exists to check.
   */
  it('does not claim the subject is absent from a page it cannot read', () => {
    const finding = checkTextMatch(name003, productPage('LGD-4033 Ligandrol 10mg — 30ml'));

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).not.toBe('not_applicable');
    expect(finding.notEvaluableKind).toBe('no_check_built');
  });

  it('names the limit as the map rather than as the page', () => {
    const note = checkTextMatch(name003, productPage('MK-677 Ibutamoren')).notEvaluableReason ?? '';
    expect(note).toContain('entries');
    expect(note).toContain('whether or not the page carries one');
  });

  /**
   * The rule cannot tell "no compound here" from "a compound with no entry", so it stops claiming
   * to — including on a page that genuinely carries no shorthand. Reporting no coverage is the
   * safe direction of hard constraint 2's asymmetry.
   */
  it('reports the same way on a page with no compound at all', () => {
    const finding = checkTextMatch(name003, productPage('Bacteriostatic Water 30ml'));
    expect(finding.notEvaluableKind).toBe('no_check_built');
  });

  it('still evaluates a compound it does have an entry for', () => {
    const withProper = checkTextMatch(
      name003,
      productPage('BPC-157 (Body Protection Compound 157) 5mg'),
    );
    expect(withProper.state).toBe('pass');

    const withoutProper = checkTextMatch(name003, productPage('BPC-157 5mg vial'));
    expect(withoutProper.state).toBe('review');
  });
});

/**
 * The audit's other half, pinned as a deliberate non-change.
 *
 * CATG-005 and CATG-006 scope themselves with `applies_when_title_contains`, and a page outside
 * that scope genuinely has nothing to check — capsule labelling on a product that is not a capsule
 * is D-044's own example of `not_applicable`. Their lists can under-match, which is a coverage gap
 * in the scope list; it is not the same defect.
 *
 * Reclassifying these would be the mirror error and a worse one: every ordinary product page would
 * move into "outstanding", saying Mintro failed to check capsule labelling on sixty products that
 * are not capsules. That understates coverage as badly as the other overstated it.
 */
describe('a rule scoped out of a page still does not apply', () => {
  it('CATG-006 does not apply to a product that is not a capsule', () => {
    const finding = checkTextMatch(rule('CATG-006'), productPage('BPC-157 5mg lyophilised vial'));
    expect(finding.notEvaluableKind).toBe('not_applicable');
  });

  it('CATG-005 does not apply to a product that is not a reconstitution solution', () => {
    const finding = checkTextMatch(rule('CATG-005'), productPage('BPC-157 5mg lyophilised vial'));
    expect(finding.notEvaluableKind).toBe('not_applicable');
  });
});
