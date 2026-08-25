/**
 * Composing a package's document set.
 *
 * The distinction under test throughout is the one D-128 left D-081 responsible for: **impossible**
 * against **not wanted**. An impossible slot is never offered and is not a removal; an unwanted one
 * is offered, declined, and recorded as declined. Collapsing the two either asks an operator to
 * confirm a mistake or loses the fact that somebody made a decision.
 */

import { describe, expect, it } from 'vitest';
import { composeSet, toRows, CompositionError } from '../src/composeSet.js';
import { loadSlotTemplate } from '../src/slotTemplate.js';
import { loadDocumentsRules } from '../src/documents/loadFile.js';

const TEMPLATE = loadSlotTemplate(loadDocumentsRules());
import type { PackageFacts } from '../src/slotTemplate.js';

const facts = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  entityType: 'llc',
  hasExistingProcessor: true,
  usDomiciled: true,
  ...over,
});

const keys = (list: readonly { slotKey: string }[]): string[] => list.map((s) => s.slotKey);

// --- the three answers ---------------------------------------------------------------------------

describe('the three answers resolve conditionals, each independently', () => {
  it('an entity that files formation documents is asked for Articles', () => {
    const set = composeSet(facts({ entityType: 'llc' }), TEMPLATE);
    expect(keys(set.offered)).toContain('articles_of_incorporation');
    expect(keys(set.impossible)).not.toContain('articles_of_incorporation');
  });

  /** A sole proprietorship has none to supply. Not offered, so nobody has to decline it. */
  it('a sole proprietorship is not asked for Articles, and is not offered them either', () => {
    const set = composeSet(facts({ entityType: 'sole_proprietor' }), TEMPLATE);
    expect(keys(set.offered)).not.toContain('articles_of_incorporation');
    expect(keys(set.impossible)).toContain('articles_of_incorporation');
    expect(set.impossible.find((s) => s.slotKey === 'articles_of_incorporation')?.because)
      .toMatch(/sole proprietorship files no formation documents/);
  });

  it('a US entity is asked for a W-9 and not a W-8BEN', () => {
    const set = composeSet(facts({ usDomiciled: true }), TEMPLATE);
    expect(keys(set.offered)).toContain('w9');
    expect(keys(set.impossible)).toContain('w8ben');
  });

  it('a non-US entity is asked for a W-8BEN and not a W-9', () => {
    const set = composeSet(facts({ usDomiciled: false }), TEMPLATE);
    expect(keys(set.offered)).toContain('w8ben');
    expect(keys(set.impossible)).toContain('w9');
  });

  /**
   * Independently: changing one answer must not move a slot that turns on another. The three are
   * separate questions and a shared code path could easily make them not be.
   */
  it('the answers do not interfere with each other', () => {
    const usSole = composeSet(facts({ entityType: 'sole_proprietor', usDomiciled: true }), TEMPLATE);
    expect(keys(usSole.offered)).toContain('w9');
    expect(keys(usSole.impossible)).toContain('articles_of_incorporation');

    const foreignLlc = composeSet(facts({ entityType: 'llc', usDomiciled: false }), TEMPLATE);
    expect(keys(foreignLlc.offered)).toContain('articles_of_incorporation');
    expect(keys(foreignLlc.impossible)).toContain('w9');
  });

  it('the existing-processor answer changes nothing structurally today', () => {
    // Recorded rather than asserted as a rule: no slot in the current template predicates on it.
    // If one ever does, this test is where the change becomes visible.
    const yes = keys(composeSet(facts({ hasExistingProcessor: true }), TEMPLATE).offered);
    const no = keys(composeSet(facts({ hasExistingProcessor: false }), TEMPLATE).offered);
    expect(no).toEqual(yes);
  });

  it('a conditional that fires says why it is in the set', () => {
    const w9 = composeSet(facts(), TEMPLATE).offered.find((s) => s.slotKey === 'w9');
    expect(w9?.origin).toBe('conditional');
    expect(w9?.because).toMatch(/US-domiciled entity files a W-9/);
  });
});

// --- precheck --------------------------------------------------------------------------------------

describe('the default set is prechecked and the catalogue is not', () => {
  it('ticks required and fired conditionals, and leaves added slots unticked', () => {
    const set = composeSet(facts(), TEMPLATE);
    const by = new Map(set.offered.map((s) => [s.slotKey, s]));
    expect(by.get('application')?.prechecked).toBe(true);
    expect(by.get('application')?.origin).toBe('required');
    expect(by.get('w9')?.prechecked).toBe(true);
    expect(by.get('business_license')?.prechecked).toBe(false);
    expect(by.get('business_license')?.origin).toBe('added');
  });

  it('offers the whole catalogue, impossible slots aside', () => {
    const set = composeSet(facts(), TEMPLATE);
    expect(set.offered.length + set.impossible.length).toBe(20);
  });
});

// --- removals ----------------------------------------------------------------------------------------

describe('a removed default is recorded as removed, not missing from the set', () => {
  it('records the removal with the origin it had', () => {
    const set = composeSet(facts(), TEMPLATE);
    const { slots, removals } = toRows(set, [{ slotKey: 'proof_of_domain', included: false }]);

    expect(slots.map((s) => s.slot_key)).not.toContain('proof_of_domain');
    expect(removals).toEqual([{ slot_key: 'proof_of_domain', origin: 'required' }]);
  });

  it('records a declined conditional as a removal too — it was in the set', () => {
    const { removals } = toRows(composeSet(facts(), TEMPLATE), [{ slotKey: 'w9', included: false }]);
    expect(removals).toEqual([{ slot_key: 'w9', origin: 'conditional' }]);
  });

  /**
   * Declining something merely offered is not a removal. Nobody asked for it, so there is no
   * decision to record — and a removals list full of unticked catalogue entries would drown the
   * one row that means something.
   */
  it('does not record an unticked catalogue slot as a removal', () => {
    const { removals } = toRows(composeSet(facts(), TEMPLATE), [{ slotKey: 'coa', included: false }]);
    expect(removals).toEqual([]);
  });

  /** An impossible slot was never offered, so it can be neither included nor removed. */
  it('never records a structurally impossible slot as a removal', () => {
    const set = composeSet(facts({ entityType: 'sole_proprietor' }), TEMPLATE);
    const { slots, removals } = toRows(set, []);
    expect(slots.map((s) => s.slot_key)).not.toContain('articles_of_incorporation');
    expect(removals.map((r) => r.slot_key)).not.toContain('articles_of_incorporation');
  });

  it('refuses a set with nothing in it', () => {
    const set = composeSet(facts(), TEMPLATE);
    const nothing = set.offered.map((s) => ({ slotKey: s.slotKey, included: false }));
    expect(() => toRows(set, nothing)).toThrow(CompositionError);
  });
});

// --- instances ------------------------------------------------------------------------------------

describe('an added instance requires a label (D-111)', () => {
  it('refuses one without', () => {
    const set = composeSet(facts(), TEMPLATE);
    expect(() => toRows(set, [{ slotKey: 'business_license', included: true }]))
      .toThrow(/no label/);
  });

  it('accepts one with, and carries it through', () => {
    const { slots } = toRows(composeSet(facts(), TEMPLATE), [
      { slotKey: 'business_license', included: true, instanceLabel: 'DE pharmacy' },
    ]);
    const licence = slots.find((s) => s.slot_key === 'business_license');
    expect(licence?.instance_label).toBe('DE pharmacy');
    expect(licence?.origin).toBe('added');
  });

  it('refuses a label on a slot that does not take instances', () => {
    expect(() => toRows(composeSet(facts(), TEMPLATE), [{ slotKey: 'w9', included: true, instanceLabel: 'x' }]))
      .toThrow(/does not take an instance label/);
  });

  it('treats whitespace as no label', () => {
    expect(() => toRows(composeSet(facts(), TEMPLATE), [{ slotKey: 'business_license', included: true, instanceLabel: '   ' }]))
      .toThrow(/no label/);
  });
});

// --- what reaches the database ----------------------------------------------------------------------

describe('origin survives for all three kinds', () => {
  it('emits required, conditional and added on one set', () => {
    const { slots } = toRows(composeSet(facts(), TEMPLATE), [
      { slotKey: 'business_license', included: true, instanceLabel: 'DE pharmacy' },
    ]);
    const origins = new Set(slots.map((s) => s.origin));
    expect(origins).toEqual(new Set(['required', 'conditional', 'added']));
  });

  it('carries the coverage rule only on monthly slots', () => {
    const { slots } = toRows(composeSet(facts(), TEMPLATE), []);
    const bank = slots.find((s) => s.slot_key === 'bank_statement');
    const ein = slots.find((s) => s.slot_key === 'ein_letter');
    // The schema's `grace_is_set_exactly_for_monthly_slots` is an iff, and this is the shape that
    // satisfies it — the mismatch that broke the first live seeding.
    expect(bank?.coverage_monthly).toBe(true);
    expect(bank?.coverage_grace_days).toBe(10);
    expect(ein?.coverage_monthly).toBe(false);
    expect(ein?.coverage_grace_days).toBeNull();
  });

  it('keeps an unknown required count unknown', () => {
    const { slots } = toRows(composeSet(facts(), TEMPLATE), []);
    // Owner Photo ID derives its count from the application's ownership section (D-107).
    expect(slots.find((s) => s.slot_key === 'owner_photo_id')?.required_count).toBeNull();
  });
});

describe('the explanations are copy an operator reads', () => {
  /** `entityType.replace(/_/g, ' ')` gave "a llc files formation documents". */
  it('gets the article and the casing right for every entity type', () => {
    const seen = (['sole_proprietor', 'partnership', 'llc', 'corporation', 'non_profit', 'government'] as const)
      .map((entityType) => composeSet(facts({ entityType }), TEMPLATE))
      .flatMap((set) => [...set.offered, ...set.impossible])
      .map((s) => s.because)
      .filter((b): b is string => b !== null);

    expect(seen.length).toBeGreaterThan(0);
    for (const line of seen) {
      expect(line, line).not.toMatch(/\ba (llc|LLC)\b/);
      expect(line, line).not.toMatch(/\b(llc|non_profit|sole_proprietor)\b/);
      // No general article rule: "a US-domiciled entity" is correct, because "US" is said
      // "you-ess" — a consonant sound. A letter-based check flags right copy as wrong, which is
      // why the article lives in ENTITY_PHRASE rather than being derived.
    }
  });
});
