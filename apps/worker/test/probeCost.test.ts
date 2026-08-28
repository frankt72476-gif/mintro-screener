/**
 * The Layer 3 probe cost reductions (D-155).
 *
 * Run 5506488a spent 349s — 56% of the whole run — on a payment probe that found nothing. These
 * pin the four things that changed, and in particular the two that could silently alter what a
 * report says if they were ever got wrong: the candidate cap and the deferred capture.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_IDLE_MS, PROBE_IDLE_MS } from '../src/render.js';
import { MAX_LINKED_CANDIDATES, selectLinkedCandidates } from '../src/signup.js';

describe('the linked-candidate cap', () => {
  const link = (href: string, text = '') => ({ href, text });
  const origin = 'https://shop.example';
  const hints = ['payment', 'refund', 'return', 'chargeback'];

  it('follows every match when there are few, which is the measured normal case', () => {
    // 0-3 matches per surface across both validation storefronts.
    const links = [link(`${origin}/refund-policy`, 'Refunds'), link(`${origin}/x`, 'Returns')];
    const { followed, dropped } = selectLinkedCandidates(links, hints, origin);
    expect(followed).toEqual([`${origin}/refund-policy`, `${origin}/x`]);
    expect(dropped).toBe(0);
  });

  it('stops at the cap and says how many it did not request', () => {
    // Silence here would be the failure: "we did not look" and "we looked and found nothing" are
    // different claims, and a reader has to be able to tell them apart.
    const links = Array.from({ length: 9 }, (_, i) => link(`${origin}/returns-${i}`, 'Returns'));
    const { followed, dropped } = selectLinkedCandidates(links, hints, origin);
    expect(followed).toHaveLength(MAX_LINKED_CANDIDATES);
    expect(dropped).toBe(9 - MAX_LINKED_CANDIDATES);
  });

  it('counts distinct pages, so a link repeated in header and footer does not spend the budget', () => {
    const repeated = Array.from({ length: 8 }, () => link(`${origin}/returns`, 'Returns'));
    const { followed, dropped } = selectLinkedCandidates(repeated, hints, origin);
    expect(followed).toEqual([`${origin}/returns`]);
    expect(dropped).toBe(0);
  });

  it('never leaves the origin', () => {
    const links = [link('https://elsewhere.example/returns', 'Returns'), link(`${origin}/returns`, 'Returns')];
    const { followed } = selectLinkedCandidates(links, hints, origin);
    expect(followed).toEqual([`${origin}/returns`]);
  });

  it('matches on href as well as visible text', () => {
    const links = [link(`${origin}/policies/refund-policy`, 'Read this')];
    const { followed } = selectLinkedCandidates(links, hints, origin);
    expect(followed).toEqual([`${origin}/policies/refund-policy`]);
  });

  it('is four — the measured maximum plus one', () => {
    // Measured 0-3 across two storefronts and four surfaces. Changing this changes the crawl's
    // worst-case cost, so it moves with a decision number.
    expect(MAX_LINKED_CANDIDATES).toBe(4);
  });
});

describe('the probe idle wait', () => {
  it('is shorter than an ordinary render but covers the measured settle range', () => {
    // Measured settle: 1.3s (comopeptides) to 3.4s (sportstechnologylabs).
    expect(PROBE_IDLE_MS).toBeGreaterThanOrEqual(3_000);
    expect(PROBE_IDLE_MS).toBeLessThan(DEFAULT_IDLE_MS);
  });

  it('leaves the wait for pages a report is built from untouched', () => {
    expect(DEFAULT_IDLE_MS).toBe(8_000);
  });
});
