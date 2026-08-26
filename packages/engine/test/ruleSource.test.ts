/**
 * Whose statement a rule's clause is, and the rule that needed the distinction (D-138).
 *
 * The report prints `clause` verbatim under a heading. Until CATG-007 every rule quoted the program
 * document, so that heading read **"Program requirement"** unconditionally. CATG-007 is Mintro's
 * own observation about catalogue composition — the program document does not mention non-peptides
 * at all — and printing it under that heading would attribute Mintro's words to the program.
 *
 * Frank's ruling: that is worse than any overclaim already fixed here, because it fabricates the
 * authority rather than overstating the method, and wording beneath a heading cannot fix the
 * heading. So the distinction is structural and required.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import { checkUrlPattern, DIRECTIVE_TERMS, toSlugUrl, type Layer0Result } from '@mintro/engine';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const catg007 = ruleset.rules.find((r) => r.id === 'CATG-007') as RuleOfType<'url_pattern'>;

/** The catalogue actually crawled from sportstechnologylabs.com, by its sitemap slugs. */
const CATALOGUE = [
  '/product/lgd-4033-and-mk-677-stack/',
  '/product/rad-140-and-cardarine-stack/',
  '/product/mk-677-ostarine-rad-140-stack/',
  '/product/lgd-4033-and-yk-11-stack/',
  '/product/mk-677-cardarine-sr-9009-stack/',
  '/product/bpc-157-tb-500-ghk-cu-glow-stack/',
];

function layer0(paths: readonly string[]): Layer0Result {
  // Built through the real parser rather than by hand, so the scope a URL lands in is the one the
  // crawler would assign it, not one this test asserted into being.
  const urls = paths.map((path) => {
    const slug = toSlugUrl(`https://shop.example${path}`);
    if (slug === null) throw new Error(`unparseable fixture url: ${path}`);
    return slug;
  });

  return {
    origin: 'https://shop.example',
    usable: true,
    urls,
    artifacts: [
      {
        kind: 'sitemap',
        url: 'https://shop.example/sitemap.xml',
        sha256: 'a'.repeat(64),
        evidenceKey: 'run-1/layer0/sitemap.xml',
        capturedAt: '2026-08-26T00:00:00.000Z',
      },
    ],
    truncations: [],
  } as unknown as Layer0Result;
}

describe('every rule states whose requirement it is', () => {
  it('the field is on every rule, with nothing left to a default', () => {
    for (const rule of ruleset.rules) {
      expect(rule.source, rule.id).toBeDefined();
      expect(['programme', 'mintro'], rule.id).toContain(rule.source);
    }
  });

  /**
   * The one that matters. A rule whose authority nobody stated would be silently attributed to the
   * program, which is exactly what the field exists to prevent — so the schema requires it rather
   * than defaulting it, and this asserts the data has not drifted back.
   */
  it('everything quoting the program document says so, and only CATG-007 does not', () => {
    const mintro = ruleset.rules.filter((r) => r.source === 'mintro').map((r) => r.id);
    expect(mintro).toEqual(['CATG-007']);
    expect(ruleset.rules.filter((r) => r.source === 'programme')).toHaveLength(ruleset.rules.length - 1);
  });
});

describe('CATG-007 reports what the catalogue contains', () => {
  it('names the compounds it observed', () => {
    const finding = checkUrlPattern(catg007, layer0(CATALOGUE));

    expect(finding.state).toBe('review');
    for (const compound of ['lgd-4033', 'mk-677', 'rad-140', 'cardarine']) {
      expect(finding.note.toLowerCase()).toContain(compound);
    }
  });

  /**
   * The peptide page must not be swept in. `bpc-157` and `tb-500` are peptides and the rule is
   * about what is *not* a peptide; flagging them would make the observation meaningless.
   */
  it('does not flag a peptide product', () => {
    const finding = checkUrlPattern(catg007, layer0(['/product/bpc-157-tb-500-ghk-cu-glow-stack/']));
    expect(finding.state).toBe('pass');
  });

  it('says nothing at all about a catalogue with none of them', () => {
    const finding = checkUrlPattern(catg007, layer0(['/product/bpc-157/', '/product/tb-500/']));
    expect(finding.state).toBe('pass');
  });

  /**
   * Frank's ruling, and the reason this rule is `review_only`: it states what the catalogue
   * contains and nothing about whether it should. No "prohibited", no "should not", no
   * characterisation of scope as a problem — the underwriter draws the conclusion (D-001).
   */
  it('characterises nothing', () => {
    const note = checkUrlPattern(catg007, layer0(CATALOGUE)).note.toLowerCase();

    for (const word of [...DIRECTIVE_TERMS, 'prohibited', 'not permitted', 'should not', 'concern', 'inappropriate', 'outside scope', 'out of scope']) {
      expect(note, `note characterises: ${word}`).not.toContain(word.toLowerCase());
    }
  });

  /**
   * The other half of the branch. Only the program can prohibit, so a program rule must keep
   * saying "prohibited" — softening every url_pattern rule to neutral wording would lose the
   * distinction just as surely as hardening CATG-007 would.
   */
  it('a programme prohibition still says so', () => {
    const catg001 = ruleset.rules.find((r) => r.id === 'CATG-001') as RuleOfType<'url_pattern'>;
    const finding = checkUrlPattern(catg001, layer0(['/product/insulin-syringe-31g/']));

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('prohibited pattern');
  });

  it('is review_only, so it never auto-fails a merchant on catalogue composition', () => {
    expect(catg007.tier).toBe('review_only');
  });

  /**
   * The title is the claim on the tick strip, and D-133 is why it matters. USADA separates true
   * SARMs from five compounds "also sometimes marketed as SARMs" — of the seven families in the
   * one catalogue crawled, four are in the second group. A rule titled for SARMs would misname
   * them in a document going to an underwriter.
   */
  it('is titled for what it observes, not for what the compounds are', () => {
    expect(catg007.title).toBe('Non-peptide research compounds in the catalogue');
    expect(catg007.title.toLowerCase()).not.toContain('sarm');
  });

  it('cites its specimen and carries the limit of that specimen', () => {
    const note = catg007.params.note ?? '';
    expect(note).toContain('USADA');
    expect(note).toContain('WADA Prohibited List');
    expect(note).toContain('not a definition of the programme');
  });

  it('carries both groups, because it reports non-peptides rather than SARMs', () => {
    const patterns = catg007.params.patterns;
    for (const sarm of ['ostarine', 'lgd-4033', 'rad-140', 's23', 'andarine']) {
      expect(patterns, sarm).toContain(sarm);
    }
    for (const other of ['mk-677', 'cardarine', 'sr-9009', 'yk-11']) {
      expect(patterns, other).toContain(other);
    }
  });
});
