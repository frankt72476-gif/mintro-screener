/**
 * Two-sided fixtures for the matchers repaired in D-159.
 *
 * Every case is a pair: a page or URL that **plainly violates** the standard's own words, and one
 * that **plainly complies** while carrying a nearby distractor — the thing the old matcher got
 * wrong, or the thing a careless fix would newly get wrong.
 *
 * Written against the clause, not against the implementation. Each block quotes the clause it is
 * testing, so a reader can check the fixture without reading the matcher, and so a fixture cannot
 * quietly drift into asserting whatever the code happens to do.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '@mintro/ruleset';
import { findMatches, findCooccurrences, scopeTerms, termsAt, toSlugUrl, type SlugUrl } from '@mintro/engine';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);
const ruleFor = (id: string): Rule => {
  const found = ruleset.rules.find((r: Rule) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

const urls = (...paths: string[]): SlugUrl[] =>
  paths.map((p) => toSlugUrl(`https://shop.example${p}`)).filter((u): u is SlugUrl => u !== null);

/** Does this rule's pattern list match this path? */
const matches = (id: string, path: string): boolean => {
  const rule = ruleFor(id) as RuleOfType<'url_pattern'>;
  return findMatches(urls(path), rule.params.patterns).length > 0;
};

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   CATG-001 — "needles or syringes"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('CATG-001 — injection accessories', () => {
  it('violates: a product page for syringes', () => {
    expect(matches('CATG-001', '/product/syringes-10pack/')).toBe(true);
    expect(matches('CATG-001', '/product/needles/')).toBe(true);
    // The singular still works. Widening must not narrow.
    expect(matches('CATG-001', '/product/1ml-syringe-kit/')).toBe(true);
  });

  it('complies: a peptide sold in a vial, with "needle" nowhere in the path', () => {
    expect(matches('CATG-001', '/product/bpc-157-5mg-vial/')).toBe(false);
  });

  it('complies with a distractor: "needle" as part of another word is not a needle', () => {
    // `needlepoint` is not an injection accessory, and a matcher that widened to substrings
    // rather than to inflections would have taken it.
    expect(matches('CATG-001', '/product/needlepoint-kit/')).toBe(false);
    expect(matches('CATG-001', '/product/syringeless-filter/')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   CATG-002 — "alcohol wipes"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('CATG-002 — alcohol wipes', () => {
  it('violates: alcohol wipes and prep pads, in the plural they are sold in', () => {
    expect(matches('CATG-002', '/product/alcohol-wipes/')).toBe(true);
    expect(matches('CATG-002', '/product/alcohol-prep-pads/')).toBe(true);
  });

  it('complies with a distractor: a sterile wipe that is not an alcohol wipe', () => {
    // The clause names alcohol wipes. A wipe of another kind is out of scope, and the pattern is
    // two tokens precisely so that stays true.
    expect(matches('CATG-002', '/product/sterile-wipes/')).toBe(false);
  });

  it('complies with a distractor: benzalkonium in the name is not alcohol', () => {
    expect(matches('CATG-002', '/product/benzalkonium-towelettes/')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   CATG-003 — "HCG or HGH"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('CATG-003 — HCG and HGH', () => {
  it('violates: HCG with and without a separator before the strength', () => {
    expect(matches('CATG-003', '/product/hcg-5000-iu/')).toBe(true);
    // `hcg5000` was one token before D-159 and matched nothing.
    expect(matches('CATG-003', '/product/hcg5000/')).toBe(true);
  });

  it('complies with a distractor: a short identifier that merely contains the letters', () => {
    // Guards against a substring widening. `hcgx` and `ahcg` are not HCG.
    expect(matches('CATG-003', '/product/ahcg-carrier-protein/')).toBe(false);
  });

  it('complies: an ordinary research peptide', () => {
    expect(matches('CATG-003', '/product/bpc-157-5mg/')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   CATG-004 — "tablets or pills"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('CATG-004 — oral dose forms', () => {
  it('violates: tablets, pills and softgels', () => {
    expect(matches('CATG-004', '/product/mk-677-tablets/')).toBe(true);
    expect(matches('CATG-004', '/product/rad-140-pills/')).toBe(true);
    expect(matches('CATG-004', '/product/60-softgels/')).toBe(true);
  });

  it('complies: a lyophilised powder, which is not an oral dose form', () => {
    expect(matches('CATG-004', '/product/tb-500-lyophilised-powder/')).toBe(false);
  });

  it('complies with a distractor: capsules are CATG-006, not this rule', () => {
    // The rule's own note says so. Widening inflection must not widen scope.
    expect(matches('CATG-004', '/product/mk-677-60-capsules/')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   NAME-001 — "therapeutic categories"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('NAME-001 — therapeutic collection names', () => {
  it('violates: a nootropics collection, in the plural a shop actually uses', () => {
    const rule = ruleFor('NAME-001') as RuleOfType<'url_pattern'>;
    // The live case: swisschems.is/product-category/nootropics/
    expect(findMatches(urls('/product-category/nootropics/'), rule.params.patterns).length).toBe(1);
    expect(findMatches(urls('/collections/weight-loss/'), rule.params.patterns).length).toBe(1);
  });

  it('complies: a collection named for the compound class, not an outcome', () => {
    const rule = ruleFor('NAME-001') as RuleOfType<'url_pattern'>;
    expect(findMatches(urls('/collections/peptides/'), rule.params.patterns).length).toBe(0);
    expect(findMatches(urls('/collections/research-chemicals/'), rule.params.patterns).length).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   PROD-005 — "Never publish dosing information of any kind"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('PROD-005 — dosing information', () => {
  const rule = ruleFor('PROD-005') as RuleOfType<'text_cooccurrence'>;
  const hits = (text: string): number =>
    findCooccurrences(text, rule.params.class_a, rule.params.class_b, rule.params.window_tokens).length;

  it('violates: a schedule against a mass, in every spelling of the unit', () => {
    expect(hits('BPC-157 5mg twice daily subcutaneous injection')).toBeGreaterThan(0);
    expect(hits('BPC-157 5 mg twice daily subcutaneous injection')).toBeGreaterThan(0);
    expect(hits('Suggested research dosage: 250mcg per day')).toBeGreaterThan(0);
    expect(hits('Administer 10IU dose weekly')).toBeGreaterThan(0);
    expect(hits('Protocol: 2.5mg/week subcutaneous')).toBeGreaterThan(0);
  });

  it('complies: a mass alone is a legitimate quantity spec', () => {
    // The rule's own note: "Mass alone is a legitimate quantity spec. Only co-occurrence with
    // schedule or route is a signal."
    expect(hits('Vial contains 10mg of lyophilised powder.')).toBe(0);
    expect(hits('BPC-157 5mg vial, 99% purity, for laboratory research only')).toBe(0);
  });

  it('complies with a distractor: a unit inside another word is not a unit', () => {
    // `mg` must not match inside `mgmt`, `ml` must not match inside `html`.
    expect(hits('See the mgmt daily briefing and the html cycle notes')).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   PROD-008 — "Nothing may state or imply that a compound treats a disease"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('PROD-008 — disease claims', () => {
  const rule = ruleFor('PROD-008') as RuleOfType<'text_match'>;
  const terms = rule.params.terms ?? [];
  // Mirrors the handler: the rule's own word_boundary setting, not a choice made here.
  const wb = rule.params.word_boundary === true;
  const claimed = (text: string): string[] => termsAt(scopeTerms(text, terms, wb), 'claim');

  it('violates: a plain therapeutic claim', () => {
    expect(claimed('BPC-157 treats tendon injury and speeds recovery.').length).toBeGreaterThan(0);
    expect(claimed('This peptide cures inflammation.')).toContain('cure');
  });

  it('complies: the FDA disclaimer, which is the sentence compliance looks like', () => {
    // The single largest source of false hits before D-159. It contains four terms and its
    // presence is evidence the merchant is complying.
    const disclaimer =
      'The statements and the products of this company are not intended to diagnose, treat, cure or prevent any disease.';
    expect(claimed(disclaimer)).toEqual([]);
  });

  it('complies with a distractor: "secure checkout" is not a cure', () => {
    expect(claimed('99% Purity Guaranteed. Secure checkout. Accepted secure payments.')).toEqual([]);
  });

  it('complies with a distractor: the footer link to Terms & Conditions', () => {
    // `condition` was removed from the term list in D-159 — it is a disease word and a legal
    // boilerplate word, and every storefront carries the second.
    expect(terms).not.toContain('condition');
    expect(claimed('Shipping Terms & Conditions Privacy Policy Accessibility')).toEqual([]);
  });

  it('a real claim about a condition is still caught, by the verb', () => {
    // Dropping `condition` must not drop the claim. `treat` carries it.
    expect(claimed('Shown to treat this condition in rodent models.')).toContain('treat');
  });

  it('quoted literature is neither a claim nor a clean result', () => {
    const cited = 'Sikiric P, et al. Therapeutic potential of BPC-157 in injury models. J. Biol. Chem. (2019).';
    const scoped = scopeTerms(cited, terms, wb);
    expect(termsAt(scoped, 'claim')).toEqual([]);
    expect(termsAt(scoped, 'attributed').length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   PROD-007 — "Products cannot be labeled injectable or nasal spray"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('PROD-007 — route-of-administration labels', () => {
  const rule = ruleFor('PROD-007') as RuleOfType<'text_match'>;
  const terms = rule.params.terms ?? [];
  const wb = rule.params.word_boundary === true;

  it('violates: the merchant labelling its own product by route', () => {
    expect(termsAt(scopeTerms('Injectable BPC-157, ready to use.', terms, wb), 'claim')).toContain('injectable');
  });

  it('complies: a cited abstract using the same words', () => {
    const cited =
      'Chang CH, et al. Subcutaneous administration of BPC-157 in a rat model. J. Pharm. Sci. 2011;100(8):3204.';
    const scoped = scopeTerms(cited, terms, wb);
    expect(termsAt(scoped, 'claim')).toEqual([]);
    expect(termsAt(scoped, 'attributed').length).toBeGreaterThan(0);
  });

  it('complies: an explicit denial of a route', () => {
    expect(
      termsAt(scopeTerms('This product is not for injection and is not injectable.', terms, wb), 'claim'),
    ).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   PAY-001 — "No peer-to-peer payment methods named on public pages"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('PAY-001 — peer-to-peer rails', () => {
  const rule = ruleFor('PAY-001') as RuleOfType<'text_match'>;
  const terms = rule.params.terms ?? [];
  const wb = rule.params.word_boundary === true;

  it('violates: a rail offered in the merchant’s own words', () => {
    expect(termsAt(scopeTerms('Pay by Zelle for a 10% discount.', terms, wb), 'claim')).toContain('Zelle');
  });

  it('complies with a distractor: a policy stating the rails are refused', () => {
    // A sentence listing what a merchant does *not* accept is compliance, and it used to auto-fail.
    const refusal = 'We do not accept Venmo, Cash App or Zelle.';
    expect(termsAt(scopeTerms(refusal, terms, wb), 'claim')).toEqual([]);
  });

  it('complies with a distractor: ordinary marketing copy containing the phrase', () => {
    expect(termsAt(scopeTerms('A gift for friends and family this season.', terms, wb), 'claim')).toEqual([
      'friends and family',
    ]);
    // Documented limitation rather than a silent one: the phrase is matched literally, so this is
    // a hit. It is the reason PAY-001 needs a human before it declines anyone on that term alone.
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   PROD-010 — "Never 'Sema', 'Tirz' or similar shorthand"
   ──────────────────────────────────────────────────────────────────────────────────────────── */
describe('PROD-010 — community abbreviations', () => {
  const rule = ruleFor('PROD-010') as RuleOfType<'text_match'>;
  const terms = rule.params.terms ?? [];
  const wb = rule.params.word_boundary === true;
  const claimed = (text: string): string[] => termsAt(scopeTerms(text, terms, wb), 'claim');

  it('violates: the shorthand on its own', () => {
    expect(claimed('Sema 5mg vial — research grade.')).toContain('Sema');
  });

  /*
    The regression this exists to stop.

    Claim scoping was written with a leading word boundary only, and `Cagri` then matched
    `Cagrilintide` — the correct chemical name the rule exists to encourage. Caught by re-running
    comopeptides, where PROD-010 went pass -> review on a page selling cagrilintide.
  */
  it('complies: the full chemical name is not the shorthand', () => {
    expect(rule.params.word_boundary).toBe(true);
    expect(claimed('Cagrilintide 5mg, 99% purity.')).toEqual([]);
    expect(claimed('Semaglutide and Tirzepatide reference standards.')).toEqual([]);
    expect(claimed('Retatrutide, lyophilised.')).toEqual([]);
  });
});
