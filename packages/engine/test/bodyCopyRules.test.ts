/**
 * The five Mintro observations added by D-177, each against a constructed page.
 *
 * They are `source: mintro` because they come from a compliance plugin specification rather than
 * from the published standards — none of their clauses is a substring of the corpus, and claiming
 * `programme` would attribute an authority nobody stated.
 *
 * Every one of them locates its subject by **claim vocabulary in a merchant-authored sentence**,
 * never by the compliant form. There is no compliant phrasing of *"safe to inject"* to match
 * against, so constraint 9 is satisfied by construction on the four `expect: absent` rules. They
 * fail by under-matching: a claim worded outside the list is invisible, and on `absent` that reads
 * as clean. DISC-004 inverts and fails toward false decline, which is why it is `review_only`.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule } from '@mintro/ruleset';
import { scopeTerms, termsAt } from '../src/claimScope.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const ruleFor = (id: string): Rule => {
  const found = ruleset.rules.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

/** The `expect: absent` path: does any term register as a merchant claim in this text? */
const violates = (id: string, text: string): boolean => {
  const p = ruleFor(id).params as { terms: string[]; word_boundary?: boolean };
  return termsAt(scopeTerms(text, p.terms, p.word_boundary === true), 'claim').length > 0;
};

/**
 * The `expect: present` path, which is **a different matcher** (D-177).
 *
 * `termsFinding` returns before the claim-scoping branch when `expect` is `present`, and matches
 * with `containsTerm` — `\b<term>\b` over normalised text, with no separator flexibility and no
 * inflection. So DISC-004 gets none of the widening the other four rely on, and its terms are
 * chosen for that: punctuation-free, and several of them, because the check is satisfied by ANY.
 */
const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
const containsTerm = (haystack: string, term: string): boolean =>
  new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);

/** True when the required statement is missing — which is the violation for a present-expectation. */
const missing = (id: string, text: string): boolean => {
  const p = ruleFor(id).params as { terms: string[] };
  const hay = normalise(text);
  return p.terms.filter((t) => containsTerm(hay, normalise(t))).length === 0;
};

describe('every new rule is a Mintro observation, not a published standard', () => {
  it.each(['PROD-011', 'PROD-012', 'PROD-013', 'PROD-014', 'DISC-004'])('%s', (id) => {
    expect(ruleFor(id).source).toBe('mintro');
  });

  it('gives the auto_fail tier only to the two with no ambiguous term', () => {
    expect(ruleFor('PROD-011').tier).toBe('auto_fail');
    expect(ruleFor('PROD-013').tier).toBe('auto_fail');
    // Constraint 4: one ordinary word would have forced these to review_only, so they were split.
    expect(ruleFor('PROD-012').tier).toBe('review_only');
    expect(ruleFor('PROD-014').tier).toBe('review_only');
    expect(ruleFor('DISC-004').tier).toBe('review_only');
  });
});

describe('PROD-011 — unambiguous benefit claims', () => {
  it('reports a promised outcome in body copy', () => {
    expect(violates('PROD-011', 'Clients report steady weight loss and visible fat loss.')).toBe(true);
  });

  it('reports the hyphenated and closed spellings, which the matcher reaches', () => {
    expect(violates('PROD-011', 'Marketed for anti aging and muscle-building.')).toBe(true);
  });

  it('does not report ordinary research prose', () => {
    expect(
      violates('PROD-011', 'Lyophilised powder, characterised by mass spectrometry. Research use only.'),
    ).toBe(false);
  });

  it('does not report a claim the merchant disclaims', () => {
    // The scoping D-159 built: a negated sentence is not the merchant saying the thing.
    expect(violates('PROD-011', 'We make no weight-loss claims of any kind.')).toBe(false);
  });
});

describe('PROD-012 — benefit vocabulary with ordinary uses', () => {
  it('reports the word where it reads as a claim', () => {
    expect(violates('PROD-012', 'Supports recovery and athletic performance.')).toBe(true);
  });

  /**
   * And reports it where it does not, which is the whole reason this is `review_only` rather than
   * folded into PROD-011. The rule cannot tell these apart; a person can.
   */
  it('reports the same word in a sentence that is not a claim, by design', () => {
    expect(violates('PROD-012', 'Sample recovery exceeded 95% across all assay performance runs.')).toBe(true);
  });

  it('does not report prose that uses none of them', () => {
    expect(violates('PROD-012', 'Supplied as a lyophilised powder. Reconstitute before use.')).toBe(false);
  });
});

describe('PROD-013 — body copy addressing a human user', () => {
  it('reports wording that names the reader as the one taking it', () => {
    expect(violates('PROD-013', 'It is safe to inject.')).toBe(true);
    expect(violates('PROD-013', 'No prescription needed.')).toBe(true);
    expect(violates('PROD-013', 'Sold for personal use only.')).toBe(true);
  });

  /**
   * How this rule fails, stated rather than left to be found.
   *
   * The terms are phrases, and a word inserted inside one puts it out of reach: *"no prescription
   * is needed"* is the same claim and does not match. On an `expect: absent` rule that reads as
   * clean. The matcher collapses spacing and hyphens (D-177); it does not paraphrase, and nothing
   * here should pretend it does.
   */
  it('does not reach the same claim with a word inserted, which is how it under-matches', () => {
    expect(violates('PROD-013', 'No prescription is needed for this product.')).toBe(false);
  });

  it('does not report the standard research disclaimer', () => {
    expect(
      violates('PROD-013', 'Not for human consumption. For laboratory research use only.'),
    ).toBe(false);
  });

  /** `subcutaneously` was dropped so this rule could be `auto_fail`; PROD-007 still carries it. */
  it('does not report a route of administration, which belongs to PROD-007', () => {
    expect(violates('PROD-013', 'Administered subcutaneously in the cited study.')).toBe(false);
    expect((ruleFor('PROD-007').params as { terms: string[] }).terms).toContain('subcutaneous');
  });
});

describe('PROD-014 — absorption and uptake claims', () => {
  it('reports uptake language', () => {
    expect(violates('PROD-014', 'Highly bioavailable, with maximum uptake.')).toBe(true);
  });

  /** The noun is listed because no inflection reaches it from the adjective (D-177). */
  it('reports the noun, which is a listed term rather than a derived form', () => {
    expect(violates('PROD-014', 'Excellent bioavailability in this formulation.')).toBe(true);
    expect((ruleFor('PROD-014').params as { terms: string[] }).terms).toContain('bioavailability');
  });

  it('does not report ordinary handling instructions', () => {
    expect(violates('PROD-014', 'Store lyophilised at -20C. Reconstitute in bacteriostatic water.')).toBe(false);
  });
});

describe('DISC-004 — the FDA statement, on the expect: present path', () => {
  it('is declared as a required-presence check', () => {
    expect((ruleFor('DISC-004').params as { expect: string }).expect).toBe('present');
  });

  /** The violation is the statement being **absent**, which inverts positive and negative. */
  it('reports a page carrying no such statement', () => {
    expect(missing('DISC-004', 'Premium research peptides. Third-party tested. Fast shipping.')).toBe(true);
  });

  it('does not report a page carrying the full statement', () => {
    expect(
      missing(
        'DISC-004',
        'These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.',
      ),
    ).toBe(false);
  });

  /**
   * Satisfied by **any** term, not all — `found.length === 0` is the violation. Several phrasings
   * are listed for that reason: each one that matches is one fewer way a real disclaimer reads as
   * missing.
   */
  it('is satisfied by one phrasing alone', () => {
    expect(missing('DISC-004', 'This product is not intended to diagnose any condition.')).toBe(false);
    expect(missing('DISC-004', 'Not evaluated by the FDA.')).toBe(false);
  });

  /**
   * Why the terms carry no punctuation. `containsTerm` matches the term as written against
   * normalised text, so a comma the page places differently would read as an absent disclaimer —
   * a false decline on the one rule whose failure mode is false decline.
   */
  it('survives a page that punctuates the list differently', () => {
    const oxford = 'not intended to diagnose, treat, cure, or prevent any disease';
    const without = 'not intended to diagnose treat cure or prevent any disease';
    for (const text of [oxford, without]) expect(missing('DISC-004', text), text).toBe(false);
  });
});
