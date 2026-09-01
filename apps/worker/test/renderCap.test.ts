/**
 * How many product pages one run renders, and what it says about the ones it did not (D-223).
 *
 * Making every unrecognised slug a candidate is only safe with a bound on it. On the stored
 * catalogues the candidate set is not a handful — swisschems scores 124 pages worth rendering and
 * corepeptides 104 — so an uncapped sample is unbounded Playwright work decided by a merchant's
 * catalogue size. That is the shape that has hung this worker before (D-152, D-153), and a run
 * that never returns produces no findings at all: an unbounded sample trades a thin report for no
 * report.
 *
 * **A stability bound, not a budget.** It is set where it binds on catalogue size rather than on
 * ordinary suspicion — comopeptides scores 14 and never reaches it.
 *
 * What is left over is declared. A page nobody opened is never quietly absent (D-076), and the two
 * reasons a page goes unopened are kept apart because they belong to different parties: a
 * recognised compound is a defensible omission, and running out of room is Mintro's bound.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { scoreProductUrls, selectSample, toSlugUrl, inScope, type SlugUrl } from '@mintro/engine';
import { RENDER_CAP, SAMPLE_SIZE } from '../src/screen.js';
import { createScanProgress } from '../src/scanProgress.js';

const ruleset: Ruleset = loadRulesetFile('rules/ruleset.json');

/** Product slugs from a stored catalogue, classified the way the live runs classified them. */
function productsOf(file: string): SlugUrl[] {
  const host = file.replace('.txt', '');
  return readFileSync(`fixtures/catalogues/${file}`, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((path) =>
      toSlugUrl(`https://${host}${path}`, { segments: { products: ['shop', 'peptides', 'product'] } }),
    )
    .filter((slug): slug is SlugUrl => slug !== null && inScope(slug, 'products'));
}

const CATALOGUES = readdirSync('fixtures/catalogues').filter((file) => file.endsWith('.txt'));

/** The sampler's own arithmetic, which `screenStorefront` performs and this mirrors. */
function plan(products: readonly SlugUrl[]): {
  readonly rendered: number;
  readonly recognisedLeft: number;
  readonly overCap: number;
} {
  const scored = scoreProductUrls(products, ruleset);
  const worth = scored.filter((entry) => entry.slugClass !== 'benign').length;
  const size = Math.min(RENDER_CAP, Math.max(SAMPLE_SIZE, worth));
  const selected = selectSample(scored, size);
  const left = scored.slice(selected.length);

  return {
    rendered: selected.length,
    recognisedLeft: left.filter((entry) => entry.slugClass === 'benign').length,
    overCap: left.filter((entry) => entry.slugClass !== 'benign').length,
  };
}

describe('the cap', () => {
  it('is a bound on the render path, stated as one number', () => {
    expect(RENDER_CAP).toBe(25);
    // The floor still exists: a catalogue with nothing to look at is still looked at.
    expect(SAMPLE_SIZE).toBe(5);
  });

  it.each(CATALOGUES)('%s never renders more than the cap', (file) => {
    expect(plan(productsOf(file)).rendered).toBeLessThanOrEqual(RENDER_CAP);
  });

  /**
   * The catalogue this was written for is sampled in full.
   *
   * comopeptides scores 8 suspicious and 6 unrecognised, so the cap does not bind and every page
   * worth opening is opened — including `/shop/klow/`, which nothing matches even now.
   */
  it('does not bind on comopeptides, and renders every page worth opening', () => {
    const products = productsOf('www.comopeptides.com.txt');
    const scored = scoreProductUrls(products, ruleset);
    const worth = scored.filter((entry) => entry.slugClass !== 'benign');

    const { rendered, overCap } = plan(products);
    expect(rendered).toBe(worth.length);
    expect(rendered).toBeLessThan(RENDER_CAP);
    // Nothing was left for want of room, so nothing is declared under that heading.
    expect(overCap).toBe(0);

    const opened = selectSample(scored, rendered).map((entry) => entry.url.path);
    for (const path of ['/shop/tz/', '/shop/rt/', '/shop/klow/']) {
      expect(opened, `${path} was not opened`).toContain(path);
    }
  });

  it('binds on the large catalogues, and declares what it could not reach', () => {
    // Four of the five stored catalogues exceed the cap, which is what makes it a real bound
    // rather than a theoretical one.
    const bound = CATALOGUES.map((file) => ({ file, ...plan(productsOf(file)) })).filter(
      (entry) => entry.overCap > 0,
    );

    expect(bound.length).toBeGreaterThanOrEqual(3);
    for (const entry of bound) {
      expect(entry.rendered, `${entry.file} did not fill the cap`).toBe(RENDER_CAP);
      // Left over and counted, never dropped without a number against it.
      expect(entry.overCap, `${entry.file} declared nothing`).toBeGreaterThan(0);
    }
  });

  /**
   * The floor, on a catalogue the rule set recognises entirely.
   *
   * Nothing scores, so nothing is "worth" rendering by the new measure — and five pages are still
   * opened, which is the pre-existing guarantee that a clean catalogue is still examined.
   */
  it('still opens five pages when every slug is a recognised compound', () => {
    const benign = ['bpc-157', 'tb-500', 'selank', 'epitalon', 'glutathione', 'kpv', 'nad'].map(
      (name) => toSlugUrl(`https://shop.example/product/${name}`)!,
    );
    const scored = scoreProductUrls(benign, ruleset);
    expect(scored.every((entry) => entry.slugClass === 'benign')).toBe(true);

    const { rendered, recognisedLeft, overCap } = plan(benign);
    expect(rendered).toBe(SAMPLE_SIZE);
    expect(recognisedLeft).toBe(benign.length - SAMPLE_SIZE);
    expect(overCap).toBe(0);
  });

  it('renders in priority order: nothing benign is opened while an unknown waits', () => {
    const products = productsOf('www.corepeptides.com.txt');
    const scored = scoreProductUrls(products, ruleset);
    const opened = selectSample(scored, plan(products).rendered);

    // corepeptides has 104 unrecognised pages, so the cap is filled entirely from above benign.
    expect(opened.every((entry) => entry.slugClass !== 'benign')).toBe(true);
  });
});

describe('what was not rendered is declared', () => {
  it.each(CATALOGUES)('%s accounts for every product page', (file) => {
    const products = productsOf(file);
    const { rendered, recognisedLeft, overCap } = plan(products);

    // Every page is in exactly one of three states. A page that fell out of all of them would be
    // one nobody looked at and nobody counted, which is the omission this declaration exists to
    // make impossible (D-076).
    expect(rendered + recognisedLeft + overCap).toBe(products.length);
  });

  it('separates a defensible omission from a bound of ours', () => {
    // comopeptides: pages left are all recognised compounds, none left for want of room.
    const como = plan(productsOf('www.comopeptides.com.txt'));
    expect(como.recognisedLeft).toBeGreaterThan(0);
    expect(como.overCap).toBe(0);

    // corepeptides: nothing is recognised, so everything left is left because of the cap. The
    // reader must not be told those pages were ordinary — nothing established that.
    const core = plan(productsOf('www.corepeptides.com.txt'));
    expect(core.recognisedLeft).toBe(0);
    expect(core.overCap).toBeGreaterThan(0);
  });
});

/**
 * The declaration is wired, not merely computable.
 *
 * Everything above mirrors the sampler's arithmetic, which proves the numbers are right and would
 * not notice if `screenStorefront` stopped recording them. These two assert the path the report
 * actually reads.
 */
describe('the declaration reaches the report', () => {
  it('carries what the run recorded', () => {
    const progress = createScanProgress(() => undefined);
    progress.scopeIs(37);
    progress.sampleIs(14);
    progress.notRenderedIs(23, 0);

    expect(progress.sampleBasis().notRendered).toEqual({ recognised: 23, overCap: 0 });
  });

  it('omits the field when nothing recorded it, rather than reporting zero', () => {
    // A run that never declared what it left out is not a run that left nothing out, and the
    // coverage line has to tell those apart (D-044's shape, D-002 for older runs).
    const progress = createScanProgress(() => undefined);
    progress.scopeIs(37);
    progress.sampleIs(5);

    expect(progress.sampleBasis().notRendered).toBeUndefined();
  });

  it('is called by the sampler', () => {
    // Asserted against the source, because the arithmetic tests above pass with the call removed.
    const source = readFileSync('apps/worker/src/screen.ts', 'utf8');
    expect(source).toContain('progress.notRenderedIs(');
    expect(source).toContain('RENDER_CAP');
  });
});
