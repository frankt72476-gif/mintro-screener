/**
 * The accumulator that feeds both the run page and the report (D-173).
 *
 * D-162 put `productsInScope`, `productsSampled` and `surfacesRead` on the finished report and
 * noted that every number in it "was already computed and thrown away". A live progress display
 * would have thrown them away again and recomputed them — the same quantities derived twice, free
 * to drift. So they are accumulated once and read twice, and these hold that.
 */

import { describe, expect, it } from 'vitest';
import { INDETERMINATE_PHASES, type ProgressEvent } from '@mintro/engine';
import { createScanProgress } from '../src/scanProgress.js';

const record = (): { events: ProgressEvent[]; progress: ReturnType<typeof createScanProgress> } => {
  const events: ProgressEvent[] = [];
  return { events, progress: createScanProgress((e) => events.push(e)) };
};

describe('the emitter refuses a count on a phase that cannot have one', () => {
  it.each(INDETERMINATE_PHASES)('drops it for %s even when a caller passes one', (phase) => {
    const { events, progress } = record();
    progress.enter(phase, 'starting');
    progress.say('something happened', { done: 3, total: 5 });

    const last = events[events.length - 1] as ProgressEvent;
    expect(last.phase).toBe(phase);
    expect(last.done).toBeUndefined();
    expect(last.total).toBeUndefined();
  });

  it('keeps it for a phase that can', () => {
    const { events, progress } = record();
    progress.enter('sample', 'sampling');
    progress.say('product page 3 of 5', { done: 3, total: 5 });

    expect(events[events.length - 1]).toMatchObject({ phase: 'sample', done: 3, total: 5 });
  });

  it('clears the count when a phase begins, so one cannot outlive its phase', () => {
    const { events, progress } = record();
    progress.enter('sample', 'sampling');
    progress.say('product page 5 of 5', { done: 5, total: 5 });
    progress.enter('gate', 'gate rules');

    expect((events[events.length - 1] as ProgressEvent).done).toBeUndefined();
  });
});

describe('one derivation, two readers', () => {
  it('reports the scope it was told, to both', () => {
    const { progress } = record();
    progress.scopeIs(64);
    progress.sampleIs(5);
    expect(progress.sampleBasis()).toMatchObject({ productsInScope: 64, productsSampled: 5 });
  });

  /**
   * The sample is replaced wholesale when a login wall forces a re-render with a screening account.
   * An incremental counter would double-count the retry, so `served` is recomputed from the current
   * list rather than added to.
   */
  it('replaces the served count on a retry rather than adding to it', () => {
    const { progress } = record();
    progress.scopeIs(64);
    progress.sampleIs(2); // public crawl: three of five hit the wall
    progress.sampleIs(5); // signed in: all five served
    expect(progress.sampleBasis().productsSampled).toBe(5);
  });

  it('names only the surfaces actually read, in the order they were read', () => {
    const { progress } = record();
    progress.surfaceRead('the homepage');
    progress.surfaceRead('the terms document');
    // A surface not reached is absent, never reported as missing: a merchant with no FAQ and a
    // failed FAQ fetch are indistinguishable from this list (D-158).
    expect(progress.sampleBasis().surfacesRead).toEqual(['the homepage', 'the terms document']);
  });

  it('does not repeat a surface read twice', () => {
    const { progress } = record();
    progress.surfaceRead('the homepage');
    progress.surfaceRead('the homepage');
    expect(progress.sampleBasis().surfacesRead).toEqual(['the homepage']);
  });

  it('hands back a copy, so a reader cannot mutate the record', () => {
    const { progress } = record();
    progress.surfaceRead('the homepage');
    // The type is readonly; this is the runtime guarantee behind it.
    (progress.sampleBasis().surfacesRead as string[]).push('invented');
    expect(progress.sampleBasis().surfacesRead).toEqual(['the homepage']);
  });

  /**
   * The one place the two numbers genuinely differ, recorded so nobody "fixes" it into agreement.
   * The live counter is pages **attempted**; the stored field is pages that came back **served**. A
   * page not yet rendered cannot be known to have been served, and reporting attempts as successes
   * is the overstatement this model exists to avoid.
   */
  it('keeps attempts and served apart', () => {
    const { events, progress } = record();
    progress.enter('sample', 'sampling');
    progress.say('product page 5 of 5', { done: 5, total: 5 });
    progress.sampleIs(2); // five attempted, two served

    expect(events[events.length - 1]).toMatchObject({ done: 5, total: 5 });
    expect(progress.sampleBasis().productsSampled).toBe(2);
  });
});
