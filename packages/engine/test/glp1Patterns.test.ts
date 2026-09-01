/**
 * CATG-008's patterns, run against every catalogue this project has stored (D-220).
 *
 * The rule carries two two-letter patterns — `tz` and `rt`, how comopeptides spells tirzepatide and
 * retatrutide. A two-letter token on a matching rule is the false-positive hazard in its purest
 * form, and the argument for putting one there has to be **made against real catalogues**, not
 * asserted. This file is that argument.
 *
 * ## What makes it safe, stated so it can be checked
 *
 * `url_pattern` does not do substring matching. `findMatches` tokenises through `tokenizePath` —
 * which splits on every non-alphanumeric *and* at letter/digit boundaries — and compares with
 * `containsTokenSequence` on `inflectionKey`. So `rt` is a token or it is nothing: it reaches
 * `/shop/rt/` and `/shop/rt-10mg/`, and it does not reach `cartalax`, `cortagen`, `cartilage`,
 * `l-carnitine`, `telmisartan` or `/cart/`.
 *
 * That claim is worthless unasserted, so the first block below runs the **naive substring** matcher
 * these patterns would have needed elsewhere and pins the sixteen innocent slugs it hits across
 * three merchants who sell no GLP-1 at all. The control is made to fail the way it exists to catch
 * before the real matcher is trusted with it (D-026).
 *
 * ## Why the terms are what they are
 *
 * `klow` and `cagrilintide` were both proposed for this rule and both are **excluded**, which the
 * last block pins. `klow` is spelled out by the catalogues themselves as a BPC-157 / KPV / TB-500 /
 * GHK-Cu blend — no GLP-1 in it — and it is published by three of these five merchants, so carrying
 * it would name each of them as listing something they do not list. `cagrilintide` is an amylin
 * analogue. Naming either under a rule titled for GLP-1 receptor agonists would be a false
 * observation about a real merchant, which is the failure this project treats as its worst.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { loadRulesetFile, type RuleOfType, type Ruleset } from '@mintro/ruleset';
import { containsTokenSequence, tokenizePath } from '../src/slug.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const CATALOGUES = resolve(REPO_ROOT, 'fixtures/catalogues');

/**
 * One catalogue file, as paths.
 *
 * **Trims every line, and that is the load-bearing part.** These files are checked out CRLF on
 * Windows — `.gitattributes` says `* text=auto` and `core.autocrlf` is true, which is settled repo
 * policy (D-152) — so a naive `split('\n')` yields `/shop/rt/\r`. Every assertion here compares
 * path strings, and a trailing carriage return breaks all of them while the matcher it is meant to
 * be testing is working perfectly. That is the invisible-character class of defect this project has
 * paid for before: the failure names the wrong culprit, and the byte that caused it does not appear
 * in the diff, the error message, or the file when you open it.
 *
 * `.gitattributes` now also pins these files to `eol=lf`, so the checkout should be LF. This trim
 * is the half that does not depend on that being true — a fixture arriving with CRLF through any
 * other path (an editor, a patch, a future `.gitattributes` edit) must not be able to turn a green
 * suite red or, worse, a red one green. A path never legitimately carries surrounding whitespace,
 * so there is nothing for the trim to destroy.
 */
export function readCatalogue(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Every stored catalogue, as `host -> paths`. Read from the repository, never from `evidence/`. */
const catalogues: ReadonlyMap<string, readonly string[]> = new Map(
  readdirSync(CATALOGUES)
    .filter((file) => file.endsWith('.txt'))
    .sort()
    .map((file) => [
      file.replace(/\.txt$/, ''),
      readCatalogue(readFileSync(join(CATALOGUES, file), 'utf8')),
    ]),
);

const glp1 = ((): RuleOfType<'url_pattern'> => {
  const rule = ruleset.rules.find((candidate) => candidate.id === 'CATG-008');
  if (rule === undefined || rule.type !== 'url_pattern') {
    throw new Error('CATG-008 is not a url_pattern rule');
  }
  return rule as RuleOfType<'url_pattern'>;
})();

/** The shipped matcher, exactly as `findMatches` applies it. */
const matchesWholeToken = (path: string, pattern: string): boolean =>
  containsTokenSequence(tokenizePath(path), tokenizePath(pattern));

/** What these patterns would do on a matcher that did not tokenise. The thing being ruled out. */
const matchesSubstring = (path: string, pattern: string): boolean =>
  path.toLowerCase().includes(pattern.toLowerCase());

/** `host -> path -> pattern`, for whichever matcher is passed. */
function sweep(match: (path: string, pattern: string) => boolean): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const [host, paths] of catalogues) {
    const found = paths.filter((path) =>
      glp1.params.patterns.some((pattern) => match(path, pattern)),
    );
    if (found.length > 0) hits.set(host, found);
  }
  return hits;
}

/**
 * The reader, fed the bytes that actually broke it.
 *
 * This suite went green on the machine that wrote the fixtures and red on the next checkout of the
 * same commit, because the files are stored LF and were checked out CRLF. Nothing about the rule,
 * the patterns or the matcher was involved — three assertions failed comparing `/shop/rt/\r` to
 * `/shop/rt/`, and the reported failure pointed at the rule.
 *
 * Made to fail the way it exists to catch (D-026): drop the `.trim()` in `readCatalogue` and the
 * first assertion below returns `/shop/rt/\r`.
 */
describe('the catalogue reader survives whatever the checkout does to line endings', () => {
  it('reads CRLF exactly as it reads LF', () => {
    const paths = ['/shop/rt/', '/shop/tz/', '/shop/bpc-157/'];

    expect(readCatalogue(paths.join('\r\n') + '\r\n')).toEqual(paths);
    expect(readCatalogue(paths.join('\n') + '\n')).toEqual(paths);
    // A file saved without a final newline is still a catalogue.
    expect(readCatalogue(paths.join('\r\n'))).toEqual(paths);
  });

  it('leaves no carriage return anywhere in what the assertions compare', () => {
    // The specific byte, named. `\r` in a path is what made the matcher look broken.
    for (const paths of catalogues.values()) {
      for (const path of paths) {
        expect(path, `${JSON.stringify(path)} carries whitespace`).toBe(path.trim());
        expect(path).not.toContain('\r');
      }
    }
  });

  it('drops blank and whitespace-only lines rather than reading them as paths', () => {
    expect(readCatalogue('/shop/rt/\r\n\r\n   \r\n/shop/tz/\r\n')).toEqual(['/shop/rt/', '/shop/tz/']);
  });
});

describe('the fixture the proof rests on', () => {
  it('holds the five stored catalogues', () => {
    expect([...catalogues.keys()]).toEqual([
      'biotechpeptides.com',
      'sportstechnologylabs.com',
      'swisschems.is',
      'www.comopeptides.com',
      'www.corepeptides.com',
    ]);
  });

  it('is large enough for an absence to mean something', () => {
    // 854 paths. A pattern matching nothing across a set this size is evidence; across a handful
    // it would be an accident.
    const total = [...catalogues.values()].reduce((sum, paths) => sum + paths.length, 0);
    expect(total).toBe(854);
  });
});

/**
 * The control, failing the way it exists to catch.
 *
 * Run first and read first. If `rt` were matched as a substring — which is what it would be on any
 * rule that did not tokenise, and what a reader assumes a "pattern" does — this rule would name
 * three merchants who sell no GLP-1 as listing GLP-1 products.
 */
describe('a naive substring matcher, which is what this must not be', () => {
  it('hits sixteen innocent slugs across three merchants who list no GLP-1', () => {
    const naive = sweep(matchesSubstring);

    const innocent = [...naive.entries()]
      .filter(([host]) => host !== 'www.comopeptides.com')
      .flatMap(([, paths]) => paths);

    expect(innocent).toHaveLength(16);

    // Named, so the diff shows what a regression would be letting through.
    expect(innocent).toEqual(
      expect.arrayContaining([
        '/peptides/cartalax-20mg/',
        '/peptides/cortagen/',
        '/product/cartalax-20mg/',
        '/product/cortagen-20mg/',
        '/product/telmisartan-2400mg-40mg-capsule/',
        '/cart/',
      ]),
    );
  });

  it('would even hit the cart page', () => {
    // `/cart/` is not a product and is not a peptide. It is where a two-letter substring lands.
    expect(matchesSubstring('/cart/', 'rt')).toBe(true);
    expect(matchesWholeToken('/cart/', 'rt')).toBe(false);
  });
});

/**
 * The rule as shipped, over the same 854 paths.
 *
 * This is the assertion the rule does not ship without.
 */
describe('CATG-008 against every stored catalogue', () => {
  it('matches comopeptides and nothing else, anywhere', () => {
    const hits = sweep(matchesWholeToken);

    expect([...hits.keys()]).toEqual(['www.comopeptides.com']);
    expect(hits.get('www.comopeptides.com')).toEqual(['/shop/rt/', '/shop/tz/']);
  });

  it('fires on no path of the four merchants who list no GLP-1', () => {
    for (const [host, paths] of catalogues) {
      if (host === 'www.comopeptides.com') continue;
      for (const path of paths) {
        for (const pattern of glp1.params.patterns) {
          expect(
            matchesWholeToken(path, pattern),
            `${host}${path} matched CATG-008 pattern '${pattern}'`,
          ).toBe(false);
        }
      }
    }
  });
});

/**
 * The token boundary, at the level a reader can check without running anything.
 *
 * Constructed rather than drawn from the fixture: these are the spellings a merchant might publish
 * next, and the fixture can only speak for what five of them published once.
 */
describe('what a two-letter pattern does and does not reach', () => {
  const hit = ['/shop/rt/', '/shop/rt-10mg/', '/shop/rt5mg/', '/products/rt-vial/', '/shop/tz/'];
  const miss = [
    '/shop/cartridge/',
    '/shop/l-carnitine/',
    '/peptides/cartalax-20mg/',
    '/peptides/cortagen/',
    '/product/telmisartan-2400mg-40mg-capsule/',
    '/cart/',
    '/shop/quartz/',
  ];

  it.each(hit)('reaches %s', (path) => {
    expect(glp1.params.patterns.some((pattern) => matchesWholeToken(path, pattern))).toBe(true);
  });

  it.each(miss)('does not reach %s', (path) => {
    expect(glp1.params.patterns.some((pattern) => matchesWholeToken(path, pattern))).toBe(false);
  });

  /**
   * `rt-10mg` is a hit and that is the intended reading, not an oversight.
   *
   * A path segment is not the unit — a token is, which is the discipline `slug.ts` applies to every
   * other rule in the set. Narrowing to whole segments would miss the same coded product the moment
   * a merchant appends a strength to it, and that is constraint 9's blindness in the `expect:
   * absent` direction: a subject located by one particular spelling, silent about every other.
   */
  it('reaches a coded slug carrying a strength, which a segment matcher would miss', () => {
    expect(matchesWholeToken('/shop/rt-10mg/', 'rt')).toBe(true);
    expect(matchesWholeToken('/shop/tz-5mg-vial/', 'tz')).toBe(true);
  });
});

/**
 * The terms that were proposed and left out, pinned with the reason.
 *
 * A denylist is as much what it omits as what it carries, and neither omission here is obvious
 * from reading the rule.
 */
describe('the terms CATG-008 deliberately does not carry', () => {
  it('does not carry klow, which is a BPC-157 / KPV / TB-500 / GHK-Cu blend', () => {
    expect(glp1.params.patterns).not.toContain('klow');

    // And it is real, on three of the five. Carrying it would name each of them as listing a GLP-1.
    const klow = [...catalogues.entries()].filter(([, paths]) =>
      paths.some((path) => matchesWholeToken(path, 'klow')),
    );
    expect(klow.map(([host]) => host)).toEqual([
      'biotechpeptides.com',
      'www.comopeptides.com',
      'www.corepeptides.com',
    ]);
  });

  it('does not carry cagrilintide, which is an amylin analogue', () => {
    expect(glp1.params.patterns).not.toContain('cagrilintide');
    // Comopeptides lists it under its correct chemical name, which is what PROD-010 asks for.
    expect(catalogues.get('www.comopeptides.com')).toContain('/shop/cagrilintide/');
  });

  it('leaves sema and tirz to PROD-010, in page text', () => {
    // D-178 ruled these stay `text_match` at `review_only`. Pinned so moving them is deliberate.
    expect(glp1.params.patterns).not.toContain('sema');
    expect(glp1.params.patterns).not.toContain('tirz');
  });
});

/**
 * The move out of CATG-003, and the evidence that it changes nothing observed.
 */
describe('the GLP-1 vocabulary lives in exactly one rule', () => {
  const catg003 = ruleset.rules.find((rule) => rule.id === 'CATG-003') as RuleOfType<'url_pattern'>;

  it('leaves CATG-003 with prescription hormones only', () => {
    expect(catg003.params.patterns).toEqual([
      'hcg',
      'hgh',
      'chorionic-gonadotropin',
      'somatropin',
      'growth-hormone',
    ]);
    // Untouched by this change, and the thing that must stay untouched.
    expect(catg003.tier).toBe('auto_fail');
    expect(catg003.sev).toBe('critical');
    expect(catg003.blocking).toBe(true);
  });

  it('shares no pattern between the two rules, so nothing is matched twice', () => {
    const shared = catg003.params.patterns.filter((pattern) =>
      glp1.params.patterns.includes(pattern),
    );
    expect(shared).toEqual([]);
  });

  it('moved two patterns that matched nothing in any stored catalogue', () => {
    // So no stored run's CATG-003 result would read differently for the move. What does change is
    // where a future match is attributed, and at which tier.
    for (const [host, paths] of catalogues) {
      for (const path of paths) {
        for (const pattern of ['semaglutide', 'tirzepatide']) {
          expect(matchesWholeToken(path, pattern), `${host}${path}`).toBe(false);
        }
      }
    }
  });
});
