/**
 * A slug nothing recognises is sampled, not skipped (D-223).
 *
 * This is the defect that started the whole audit. The scorer read its vocabulary from the rule
 * set, so a product slug no rule named scored **zero** — the same score as a page positively
 * recognised as an ordinary compound — sank below a sample of five, and was never rendered. Its
 * page content went unexamined while the report read as a clean catalogue.
 *
 * On comopeptides that was `/shop/tz/`, `/shop/rt/` and `/shop/klow/`: a merchant's invented
 * shorthand, which is precisely the set a vocabulary built from known names cannot contain.
 * `CATG-008` now catches the GLP-1 pair at the pattern layer, but that is the acute case. The
 * general defect is that *unknown* and *ordinary* were the same answer, and the next merchant's
 * coinage would sink the same way.
 *
 * So the ordering is now three-tiered, and the middle tier is the whole change:
 *
 *     suspicious    something in the rule set matched it            highest
 *     unrecognised  nothing matched it and nothing recognised it    elevated
 *     benign        every part of it is a recognised compound       lowest, skippable
 *
 * ## The list that decides "benign" is short on purpose
 *
 * An incomplete benign list means a few ordinary pages get rendered, which costs time. A benign
 * list padded from recollection means a page stops being looked at on the strength of a name
 * somebody remembered — which is the blind spot, restored. Every entry is traced here to one of
 * two sources and nothing else is admitted.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { WEIGHT, benignVocabulary, scoreProductUrls, selectSample } from '../src/suspicion.js';
import { toSlugUrl, tokenizePath, type SlugUrl } from '../src/slug.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

/** The stored comopeptides catalogue, as the crawl classified it: `/shop/` is a product segment. */
const CATALOGUE: readonly string[] = readFileSync(
  'fixtures/catalogues/www.comopeptides.com.txt',
  'utf8',
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && line !== '/shop/');

const slug = (path: string): SlugUrl => {
  // `shop` is not a platform product segment; the live run learned it from the rendered homepage
  // (`toScopeOverrides`), which is how all 37 of these reached scope `products`.
  const parsed = toSlugUrl(`https://www.comopeptides.com${path}`, { segments: { products: ['shop'] } });
  if (parsed === null) throw new Error(`bad fixture url: ${path}`);
  return parsed;
};

const scored = scoreProductUrls(CATALOGUE.map(slug), ruleset);
const scoreOf = (path: string): number =>
  scored.find((entry) => entry.url.path === path)?.score ?? -1;
const classOf = (path: string): string =>
  scored.find((entry) => entry.url.path === path)?.slugClass ?? 'missing';

/* ---------------------------------------------------------------------------------------------
 * The answer key: the three slugs that sank
 * ------------------------------------------------------------------------------------------- */

describe('the coined slugs that were never rendered', () => {
  /**
   * The defect, reproduced as it was.
   *
   * `CATG-008` was added after this and now matches `tz` and `rt` at the pattern layer, so the
   * old behaviour is reconstructed by scoring against the rule set *without* it — which is what
   * the scorer saw on the run that missed them. `klow` needs no reconstruction: nothing matches it
   * even today, and it is the purest form of the defect.
   */
  it('scored zero under the old scoring, and sank', () => {
    /*
      The old scorer is this one without its unknown tier, so the reconstruction subtracts exactly
      that: every reason a rule produced, summed. `CATG-008` is removed too, because it was added
      after the run that missed these — scoring against today's rule set would reconstruct a
      catalogue the scorer never saw.
    */
    const beforeCATG008: Ruleset = {
      ...ruleset,
      rules: ruleset.rules.filter((rule) => rule.id !== 'CATG-008'),
    } as Ruleset;

    const old = scoreProductUrls(CATALOGUE.map(slug), beforeCATG008);
    const scoreThen = (path: string): number => {
      const entry = old.find((candidate) => candidate.url.path === path);
      if (entry === undefined) return -1;
      return entry.reasons
        .filter((reason) => reason.weight !== WEIGHT.unrecognised)
        .reduce((sum, reason) => sum + reason.weight, 0);
    };

    for (const path of ['/shop/tz/', '/shop/rt/', '/shop/klow/']) {
      expect(scoreThen(path), `${path} scored above zero under the old scoring`).toBe(0);
    }

    /*
      And sank. Ordered by the old score, with the tie broken on the URL exactly as the scorer
      does, none of the three is in the first five — every page ahead of them scored on a rule.
    */
    const ranked = [...old]
      .map((entry) => ({ path: entry.url.path, score: scoreThen(entry.url.path) }))
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
      .slice(0, 5)
      .map((entry) => entry.path);

    for (const path of ['/shop/tz/', '/shop/rt/', '/shop/klow/']) {
      expect(ranked, `${path} was already being sampled`).not.toContain(path);
    }
  });

  it('is elevated now, and rises above every recognised compound', () => {
    for (const path of ['/shop/tz/', '/shop/rt/', '/shop/klow/']) {
      expect(scoreOf(path), `${path} still scores zero`).toBeGreaterThan(0);
    }

    // `klow` is the one nothing matches even today, so it is carried entirely by being unknown.
    expect(classOf('/shop/klow/')).toBe('unrecognised');

    // Above the ordinary pages, which is what decides whether it gets rendered.
    // Not `semax`: PROD-010's `sema` is a prefix of it, so it scores a near-miss on its own and
    // is legitimately suspicious. That is pre-existing and correct (D-178).
    for (const ordinary of ['/shop/selank/', '/shop/glutathione/', '/shop/kpv/']) {
      expect(classOf(ordinary), `${ordinary} is not recognised as ordinary`).toBe('benign');
      expect(scoreOf('/shop/klow/')).toBeGreaterThan(scoreOf(ordinary));
    }
  });

  it('would now be rendered, where before it was not', () => {
    // The same five-page sample, against the current scoring.
    const picked = selectSample(scored, 5).map((entry) => entry.url.path);
    for (const path of ['/shop/tz/', '/shop/rt/']) {
      expect(picked, `${path} is still not sampled`).toContain(path);
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * The benign list, and what it is allowed to contain
 * ------------------------------------------------------------------------------------------- */

describe('the benign list', () => {
  const section = (ruleset as unknown as {
    readonly sampling: { readonly benign_compounds: { readonly from_ruleset: readonly string[]; readonly from_catalogue: readonly string[] } };
  }).sampling.benign_compounds;

  /**
   * The exclusion that matters most.
   *
   * `CATG-008`'s vocabulary is the opposite of benign — a GLP-1 term on this list would send the
   * page it names to the bottom of the sample, which is the exact failure this whole pass exists
   * to close, reintroduced through the fix.
   */
  it('carries no GLP-1 term', () => {
    const glp1 = (ruleset.rules.find((rule) => rule.id === 'CATG-008')?.params as { patterns: readonly string[] }).patterns;
    const entries = [...section.from_ruleset, ...section.from_catalogue];

    for (const term of glp1) {
      expect(entries, `${term} is on the benign list`).not.toContain(term);
      // And not hidden inside a longer entry, either.
      for (const entry of entries) {
        expect(
          tokenizePath(entry).join(' ') === tokenizePath(term).join(' '),
          `${entry} is ${term}`,
        ).toBe(false);
      }
    }

    // Named, because these three are the case.
    for (const coined of ['tz', 'rt', 'klow']) {
      expect(entries, `${coined} is on the benign list`).not.toContain(coined);
    }
  });

  /**
   * Every entry traces to one of the two allowed sources, and a test rather than a promise.
   *
   * An entry nobody can ground is a page that quietly stops being looked at, so this re-derives
   * both sources and refuses anything outside them. It is what stops the list being padded from
   * recollection later, when the reason for the short list has been forgotten.
   */
  it('grounds every entry in the rule set or the stored catalogue', () => {
    const ruleNames = new Set<string>();
    for (const rule of ruleset.rules) {
      const params = rule.params as { readonly map?: Record<string, string>; readonly applies_when_title_contains?: readonly string[] };
      for (const key of Object.keys(params.map ?? {})) ruleNames.add(tokenizePath(key).join(' '));
      for (const term of params.applies_when_title_contains ?? []) ruleNames.add(tokenizePath(term).join(' '));
    }
    // `bacteriostatic water` is named by CATG-005 as two words; the slug form is one compound.
    ruleNames.add('bacteriostatic water');

    for (const entry of section.from_ruleset) {
      expect(ruleNames.has(tokenizePath(entry).join(' ')), `${entry} is not named by any rule`).toBe(true);
    }

    const catalogue = CATALOGUE.map((path) => tokenizePath(path).join(' '));
    for (const entry of section.from_catalogue) {
      const wanted = tokenizePath(entry).join(' ');
      expect(
        catalogue.some((path) => path.includes(wanted)),
        `${entry} appears in no stored catalogue slug`,
      ).toBe(true);
    }
  });

  it('is read from the rule set, not from the engine', () => {
    expect(benignVocabulary(ruleset).length).toBe(
      section.from_ruleset.length + section.from_catalogue.length,
    );
    // Absent section: nothing is ordinary, so everything is a candidate. The safe direction.
    expect(benignVocabulary({ ...ruleset, sampling: undefined } as unknown as Ruleset)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The classifier's boundaries
 * ------------------------------------------------------------------------------------------- */

describe('what counts as recognised', () => {
  const classOfPath = (path: string): string =>
    scoreProductUrls([slug(path)], ruleset)[0]?.slugClass ?? 'missing';

  it('recognises a compound carrying a strength', () => {
    // `/shop/bpc-157-5mg/` is the same product as `/shop/bpc-157/`; a scorer that called the
    // strength unknown would elevate half of every catalogue and drown the real unknowns.
    expect(classOfPath('/shop/bpc-157-5mg/')).toBe('benign');
    expect(classOfPath('/shop/bpc-157/')).toBe('benign');
  });

  it('treats one unaccounted token as enough to render the page', () => {
    // All of it, not any of it: the unexplained token is where an invented name would be.
    expect(classOfPath('/shop/bpc-157-zzz/')).toBe('unrecognised');
  });

  it('leaves a matched slug suspicious rather than folding it into unknown', () => {
    // `blend` is a NAME-002 pattern, so the page already scores; being unrecognised on top would
    // double-count one page and reorder it against pages carrying a real signal.
    const [entry] = scoreProductUrls([slug('/shop/bpc-157-tb500-blend/')], ruleset);
    expect(entry?.slugClass).toBe('suspicious');
    expect(entry?.reasons.every((reason) => reason.ruleId !== '—' || reason.weight !== 3)).toBe(true);
  });
});
