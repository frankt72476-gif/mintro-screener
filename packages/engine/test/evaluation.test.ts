/**
 * The draft validator, and one failing case per rejection rule (D-260).
 *
 * The draft is the only mutable object in this system, so this function is the guard on it rather
 * than the storage layer. Every rule below has a negative that is *confirmed to bite*: the passing
 * draft is mutated into exactly the defect the rule exists for, and the rule is asserted by name.
 * A validator whose rules have never been watched refuse anything is a validator that may already
 * have stopped refusing.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SHORE_UPS,
  MERCHANT_COMMERCE_WORDS,
  MINTRO_COST_WORDS,
  PRICE_SCOPES,
  PRICE_WORDS,
  rejectionMessage,
  sentencesOf,
  hasInferenceMarker,
  computeLegality,
  legalityMatches,
  publishRefusal,
  validateDraft,
  type Citation,
  type EvaluationDraft,
  type RunContext,
} from '../src/index.js';

const ANGLE_IDS = [
  'who_it_talks_to',
  'products_for',
  'how_it_sells',
  'who_it_lets_buy',
  'operates_like_supplier',
  'off_site',
  'consistency',
];

const CONDITION_IDS = [
  'registration_gate',
  'no_water_or_syringes',
  'order_minimum_150',
  'monthly_volume_70k',
  'no_affiliate_marketing',
];

/**
 * The legality block this run computes to: one observed violation, one unobserved rule.
 *
 * Both states in one fixture, because the two are the whole point — a `fail` ends the evaluation
 * and a `not_evaluable` says nothing about the merchant.
 */
const LEGALITY = {
  clean: false,
  items: [
    { ruleId: 'CATG-003', state: 'fail' as const, evidenceKey: 'run-1/layer0/def' },
    { ruleId: 'PROD-008', state: 'not_evaluable' as const, evidenceKey: '' },
  ],
};

/** Only these gate `domestic`; the other two are answered by the application. */
const OBSERVABLE = ['registration_gate', 'no_water_or_syringes', 'no_affiliate_marketing'];

const RUN: RunContext = {
  findingIds: new Set(['f-001', 'f-002', 'f-003']),
  evidenceKeys: new Set(['run-1/layer1/abc.png', 'run-1/layer0/def']),
  eyeTestItemIds: new Set(['EYE-01', 'EYE-03']),
  angleIds: ANGLE_IDS,
  routingConditionIds: CONDITION_IDS,
  consumerSideSpectrum: new Set(['consumer_retail', 'consumer_leaning']),
  legality: LEGALITY,
  observableConditionIds: OBSERVABLE,
  knownHandles: new Set(['F1', 'F2', 'E1', 'Y1', 'A1', 'A2']),
};

const cite = (ref: string, kind: Citation['kind'] = 'finding'): Citation => ({ kind, ref });

/**
 * A draft that passes every rule.
 *
 * Placed at `research_leaning` so shore-ups are legitimate, and legality clean so the
 * recommendation is free. Every negative below starts from this and changes one thing.
 */
function passing(): EvaluationDraft {
  return {
    placement: {
      spectrum: 'research_leaning',
      // Not `domestic`: registration_gate is observable and not met, which is what stands between
      // this merchant and domestic. And legality is not clean, so the recommendation is fixed.
      recommended: 'referred_out',
      // Plain prose, no markers: the citations below are what backs it (D-260, Carried resolved).
      paragraph:
        'The catalogue and the product data read as a supplier, while the absence of a registration ' +
        'gate is the one thing pulling the other way.',
      citations: [cite('products_for', 'angle'), cite('operates_like_supplier', 'angle')],
    },
    // Echoed exactly, with the one sentence the model may add.
    legality: {
      clean: LEGALITY.clean,
      items: LEGALITY.items.map((item) => ({ ...item, note: 'A sentence about this item.' })),
    },
    routing: CONDITION_IDS.map((conditionId) => ({
      conditionId,
      status: conditionId === 'registration_gate' ? ('not_met' as const) : ('not_observable' as const),
      citations: conditionId === 'registration_gate' ? [cite('f-001')] : [],
    })),
    angles: ANGLE_IDS.map((angleId) => ({
      angleId,
      lean: 'neutral' as const,
      paragraph: 'The pages carry chemical data above benefit language.',
      citations: [cite('f-002')],
    })),
    shoreUps: [{ text: 'A registration gate would close the one open condition.', citation: cite('f-001') }],
  };
}

/** Mutates a copy. Every negative is one change away from a draft that passes. */
function mutate(change: (draft: EvaluationDraft) => EvaluationDraft): EvaluationDraft {
  return change(passing());
}

function rejectionRules(draft: EvaluationDraft): string[] {
  const result = validateDraft(draft, RUN);
  return result.ok ? [] : result.rejections.map((r) => r.rule);
}

describe('a draft that satisfies every rule', () => {
  it('is accepted', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  it('is accepted with no shore-ups at all, which is the ordinary case', () => {
    expect(validateDraft(mutate((d) => ({ ...d, shoreUps: [] })), RUN)).toEqual({ ok: true });
  });

  /*
    An angle that read nothing is the third case the paragraph rule allows, and it is the one a
    crawl-limited angle takes. Without it, angle 6 on a site with no social links would be
    unwritable: no citations to give, and nothing to mark as inference either.
  */
  it('accepts an angle that observed nothing and says so', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'off_site'
          ? { ...a, citations: [], nothingObserved: true, paragraph: 'No social links were present to follow.' }
          : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });
});

describe('unknown_citation', () => {
  it('rejects a finding id the run does not hold', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('f-999')] } : a)),
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });

  it('rejects an evidence key the run does not hold', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [cite('run-9/layer1/nope.png', 'evidence')] } : a,
      ),
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });

  it('rejects an eye-test item the rubric did not ask', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('EYE-99', 'eye_test')] } : a)),
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });

  /*
    The kind is declared, never inferred. A citation whose `ref` looks like an eye-test item but is
    declared `finding` is checked against the findings — and refused. A validator that sniffed the
    shape would accept it, which is hard constraint 9 one document up.
  */
  it('checks against the declared kind, not the shape of the ref', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('EYE-01', 'finding')] } : a)),
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });

  it('rejects an unknown citation on a shore-up', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'Add a gate.', citation: cite('f-404') }],
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });
});

describe('uncited_sentence', () => {
  it('rejects an angle paragraph with neither a citation nor a marker', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [], paragraph: 'The site is clearly aimed at consumers.' } : a,
      ),
    }));
    expect(rejectionRules(draft)).toContain('uncited_sentence');
  });

  it('accepts the same paragraph once it is marked as inference', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0
          ? { ...a, citations: [], paragraph: '[inference: The site is clearly aimed at consumers.]' }
          : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  /*
    The placement carries citations now, so it follows the same rule the angles do: a paragraph that
    cites is backed, and only one citing nothing must be marked throughout. Before the angle
    citation existed, every placement sentence needed a marker — a fully bracketed paragraph that
    read badly and blunted the marker.
  */
  it('rejects a placement paragraph that cites nothing at all', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, citations: [], paragraph: 'The catalogue sells syringes.' },
    }));
    expect(rejectionRules(draft)).toContain('uncited_sentence');
  });

  it('accepts plain prose in the placement once angles are cited', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, paragraph: 'Angles 2 and 5 drove this. The product data is real.' },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  /*
    A full stop inside a marker must not split one marked sentence into an unmarked pair. Without
    the strip-before-split this passes for the wrong reason on short markers and fails on long ones.
  */
  it('does not split a sentence out of the inside of a marker', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: {
        ...d.placement,
        citations: [],
        paragraph: '[inference: Two things drove this. The catalogue, and the product data.]',
      },
    }));
    // The marker covers the whole paragraph, so the missing angle citations are the only complaint.
    expect(rejectionRules(draft)).not.toContain('uncited_sentence');
  });
});

describe('the angle citation, and where it is allowed', () => {
  it('accepts two distinct angles on the placement', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  it('accepts angle citations alongside captures', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, citations: [...d.placement.citations, cite('f-001')] },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('rejects an angle id the angle set does not define', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: {
        ...d.placement,
        citations: [cite('vibes', 'angle'), cite('products_for', 'angle')],
      },
    }));
    expect(rejectionRules(draft)).toContain('unknown_citation');
  });

  /*
    Placement only. An angle citing an angle is reasoning in a circle with nothing underneath it,
    and a routing row or shore-up citing one points at a judgment where a capture belongs.
  */
  it('rejects an angle citation inside an angle', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('products_for', 'angle')] } : a)),
    }));
    expect(rejectionRules(draft)).toContain('angle_citation_outside_placement');
  });

  it('rejects an angle citation on a routing row', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.map((r, i) =>
        i === 0 ? { ...r, citations: [cite('who_it_talks_to', 'angle')] } : r,
      ),
    }));
    expect(rejectionRules(draft)).toContain('angle_citation_outside_placement');
  });

  it('rejects an angle citation on a shore-up', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'Add a gate.', citation: cite('who_it_lets_buy', 'angle') }],
    }));
    expect(rejectionRules(draft)).toContain('angle_citation_outside_placement');
  });
});

describe('placement_needs_two_angles', () => {
  it('rejects a placement naming one angle', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, citations: [cite('products_for', 'angle')] },
    }));
    expect(rejectionRules(draft)).toContain('placement_needs_two_angles');
  });

  it('rejects a placement naming none', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, citations: [cite('f-001')] },
    }));
    expect(rejectionRules(draft)).toContain('placement_needs_two_angles');
  });

  /*
    Distinct. Two citations to one angle is one angle cited twice, and a placement resting on a
    single angle is that angle restated rather than a judgment across the set (D-256).
  */
  it('rejects the same angle cited twice', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: {
        ...d.placement,
        citations: [cite('products_for', 'angle'), cite('products_for', 'angle')],
      },
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('placement_needs_two_angles');
    expect(result.rejections.some((r) => r.message.includes('1 distinct angle'))).toBe(true);
  });

  it('accepts three, which is the top of the memo range', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: {
        ...d.placement,
        citations: [
          cite('products_for', 'angle'),
          cite('operates_like_supplier', 'angle'),
          cite('consistency', 'angle'),
        ],
      },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });
});

describe('legality_not_referred_out', () => {
  it('rejects a recommendation other than referred_out when legality is not clean', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, recommended: 'international' as const },
    }));
    expect(rejectionRules(draft)).toContain('legality_not_referred_out');
  });

  it('accepts referred_out when legality is not clean, with the angles still drafted', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
    expect(passing().angles).toHaveLength(7);
  });
});

describe('shore_ups_on_consumer_side', () => {
  it('rejects shore-ups for a consumer-retail placement', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'consumer_retail' as const },
    }));
    expect(rejectionRules(draft)).toContain('shore_ups_on_consumer_side');
  });

  it('rejects them at consumer_leaning too, which is the near case', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'consumer_leaning' as const },
    }));
    expect(rejectionRules(draft)).toContain('shore_ups_on_consumer_side');
  });

  it('leaves the routing table intact for a consumer placement with no shore-ups', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'consumer_retail' as const },
      shoreUps: [],
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
    expect(draft.routing).toHaveLength(5);
  });

  it('permits them at mixed, which is not the consumer side', () => {
    const draft = mutate((d) => ({ ...d, placement: { ...d.placement, spectrum: 'mixed' as const } }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });
});

describe('price_word', () => {
  it('rejects a price word in the placement paragraph', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, paragraph: '[inference: The domestic solution costs more.]' },
    }));
    expect(rejectionRules(draft)).toContain('price_word');
  });

  it('rejects a price word in a shore-up', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'A gate would reduce the fees charged.', citation: cite('f-001') }],
    }));
    expect(rejectionRules(draft)).toContain('price_word');
  });

  it('rejects basis points, which is the term that would actually be used', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'This would move the account 40 basis points.', citation: cite('f-001') }],
    }));
    expect(rejectionRules(draft)).toContain('price_word');
  });

  /*
    The scope is the whole point (D-256). Angle 3 is about whether the commerce is built for a lab
    or a consumer, and that reasoning discusses the merchant's own pricing posture. A global ban
    would make the angle unwritable and push the model into vaguer words, which is worse than the
    thing the ban exists for.
  */
  it('permits the same words inside an angle paragraph, where they are the subject', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'how_it_sells'
          ? {
              ...a,
              paragraph:
                'The store lists a single retail price per vial with a subscribe-and-save discount, ' +
                'and wholesale pricing is offered only on request.',
            }
          : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('matches on a word boundary, so "corporate" is not "rate"', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'A corporate entity statement would help.', citation: cite('f-001') }],
    }));
    expect(rejectionRules(draft)).not.toContain('price_word');
  });

  /*
    The correction D-260's amendment makes. A shore-up is by definition a change to the merchant's
    own commerce, so it needs that vocabulary — the first real generation drafted exactly this
    sentence and the validator refused it for the word `discount`.
  */
  it("lets a shore-up name the merchant's own commerce", () => {
    for (const text of [
      'Removing the bundle discounts would read less like a consumer storefront.',
      'A published chargeback rate would help.',
      'The tiered discount rates are the clearest consumer signal on the site.',
    ]) {
      const draft = mutate((d) => ({ ...d, shoreUps: [{ text, citation: cite('f-001') }] }));
      expect(rejectionRules(draft), text).not.toContain('price_word');
    }
  });

  it("still refuses Mintro's own costs in a shore-up", () => {
    for (const text of [
      'The domestic solution costs less than the international one.',
      'This would lower the fees on the account.',
      'Domestic is cheaper once the gate is in place.',
      'Worth about 40 basis points.',
    ]) {
      const draft = mutate((d) => ({ ...d, shoreUps: [{ text, citation: cite('f-001') }] }));
      expect(rejectionRules(draft), text).toContain('price_word');
    }
  });

  /*
    Placement and routing keep both lists. They say where Mintro will place a merchant, and there a
    stray "discount" is far more likely to be about a solution than about a storefront.
  */
  it("refuses the merchant's own commerce words in the placement", () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, paragraph: 'The bundle discount structure decides this.' },
    }));
    expect(rejectionRules(draft)).toContain('price_word');
  });

  it('says which rule refused it, so a retry can act on the difference', () => {
    const shoreUp = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'The domestic solution costs less.', citation: cite('f-001') }],
    }));
    const result = validateDraft(shoreUp, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.message).toContain('what Mintro charges is never in the report');

    const placement = mutate((d) => ({
      ...d,
      placement: { ...d.placement, paragraph: 'A discount decides this.' },
    }));
    const other = validateDraft(placement, RUN);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.rejections[0]?.message).toContain('where Mintro will place a merchant');
  });

  it('keeps the two lists disjoint and their union whole', () => {
    const overlap = MINTRO_COST_WORDS.filter((w) => (MERCHANT_COMMERCE_WORDS as readonly string[]).includes(w));
    expect(overlap).toEqual([]);
    expect(PRICE_WORDS).toHaveLength(MINTRO_COST_WORDS.length + MERCHANT_COMMERCE_WORDS.length);
    expect(PRICE_SCOPES.shoreUps).toEqual(MINTRO_COST_WORDS);
    expect(PRICE_SCOPES.placement).toEqual(PRICE_WORDS);
  });
});

describe('unknown_angle and unknown_condition', () => {
  it('rejects an angle id the angle set does not define', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: [...d.angles, { angleId: 'vibes', lean: 'neutral' as const, paragraph: 'x.', citations: [cite('f-001')] }],
    }));
    expect(rejectionRules(draft)).toContain('unknown_angle');
  });

  it('rejects a routing condition the angle set does not define', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: [...d.routing, { conditionId: 'vibes_check', status: 'met' as const, citations: [] }],
    }));
    expect(rejectionRules(draft)).toContain('unknown_condition');
  });
});

describe('incomplete_coverage', () => {
  it('rejects a draft that omits an angle rather than saying it observed nothing', () => {
    const draft = mutate((d) => ({ ...d, angles: d.angles.slice(0, 6) }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('incomplete_coverage');
    expect(result.rejections.some((r) => r.message.includes('consistency'))).toBe(true);
  });

  it('rejects a draft that omits an unobservable routing condition', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.filter((r) => r.conditionId !== 'monthly_volume_70k'),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.some((r) => r.message.includes('monthly_volume_70k'))).toBe(true);
  });
});

describe('the retry message', () => {
  it('names every rejection and asks for the whole document back', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'consumer_retail' as const },
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('f-999')] } : a)),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = rejectionMessage(result.rejections);
    expect(message).toContain('2 reason(s)');
    expect(message).toContain('f-999');
    expect(message).toContain('shoreUps');
    expect(message).toContain('return the whole document again');
  });
});

describe('the helpers the rules rest on', () => {
  it('splits sentences with inference spans removed first', () => {
    expect(sentencesOf('One. [inference: Two. Three.] Four.')).toEqual(['One.', 'Four.']);
  });

  it('reports a marker without carrying state between calls', () => {
    const text = 'A [inference: b] c.';
    expect(hasInferenceMarker(text)).toBe(true);
    // The same input twice. A shared global regex would answer false the second time.
    expect(hasInferenceMarker(text)).toBe(true);
    expect(hasInferenceMarker('no marker here.')).toBe(false);
  });
});

describe('too_many_shore_ups', () => {
  /*
    The cap lives here because structured outputs support no `maxItems` at all — every count in this
    document is the validator's for that reason.
  */
  it('accepts exactly the cap', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: Array.from({ length: MAX_SHORE_UPS }, (_, i) => ({
        text: `A change worth making, number ${i}.`,
        citation: cite('f-001'),
      })),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('refuses one more than the cap', () => {
    const draft = mutate((d) => ({
      ...d,
      shoreUps: Array.from({ length: MAX_SHORE_UPS + 1 }, (_, i) => ({
        text: `A change worth making, number ${i}.`,
        citation: cite('f-001'),
      })),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('too_many_shore_ups');
    expect(result.rejections.some((r) => r.message.includes(`at most ${MAX_SHORE_UPS}`))).toBe(true);
  });
});

describe('unbacked_legality_item', () => {
  /*
    The one id in the document that nothing checked. A legality item fixes the recommendation at
    `referred_out` — the most consequential thing a draft can say — so it was the last place an
    unbacked citation should have been able to survive.
  */
  it('refuses a legality item whose capture this run does not hold', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: {
        clean: false,
        items: [
          { ...LEGALITY.items[0]!, evidenceKey: 'run-9/layer0/nope' },
          LEGALITY.items[1]!,
        ],
      },
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('unbacked_legality_item');
  });

  it('accepts one backed by a capture the run holds', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  /*
    An unobserved legality rule recorded no capture, so it carries an empty key. Demanding one would
    refuse the honest case — which is the one run 9011b2d7 actually produced, twice over.
  */
  it('accepts an empty key on an unobserved item', () => {
    expect(passing().legality.items.some((i) => i.evidenceKey === '')).toBe(true);
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });
});

describe('publishRefusal', () => {
  /*
    A rejected draft keeps its content now, so an operator can repair one word instead of paying
    for a regeneration. That is the right trade and it is what makes this guard load-bearing:
    before it, publishing a refused draft was impossible by accident; now it has to be refused on
    purpose.
  */
  it('lets a validating draft stored as ok through', () => {
    expect(publishRefusal(passing(), 'ok', RUN)).toBeNull();
  });

  it('refuses a draft stored as rejected, however good its content looks', () => {
    const refusal = publishRefusal(passing(), 'rejected', RUN);
    expect(refusal).toContain("stored as 'rejected'");
    expect(refusal).toContain('repaired, not so it can be sent');
  });

  it('refuses the other non-ok statuses too', () => {
    for (const status of ['failed', 'run_did_not_see_storefront']) {
      expect(publishRefusal(passing(), status, RUN), status).not.toBeNull();
    }
  });

  it('refuses a draft with no content at all', () => {
    expect(publishRefusal(null, 'ok', RUN)).toContain('no content');
  });

  /*
    The case the stored verdict cannot cover: an operator edited the draft after it validated.
    Nothing else checks an edit, so publishing has to.
  */
  it('re-validates rather than trusting the stored ok', () => {
    const edited = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) => (i === 0 ? { ...a, citations: [cite('f-999')] } : a)),
    }));
    const refusal = publishRefusal(edited, 'ok', RUN);
    expect(refusal).toContain('no longer validates');
    expect(refusal).toContain('f-999');
    expect(refusal).toContain('either it was edited or the run it cites has changed');
  });

  it('names every reason, so one fix at a time is not the only route', () => {
    const edited = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'consumer_retail' as const, citations: [] },
    }));
    const result = validateDraft(edited, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const refusal = publishRefusal(edited, 'ok', RUN)!;
    // However many the validator found, the refusal names that many and lists each.
    expect(refusal).toContain(`${result.rejections.length} reason(s)`);
    expect(result.rejections.length).toBeGreaterThan(1);
    for (const rejection of result.rejections) expect(refusal).toContain(rejection.at);
  });
});

describe('computeLegality', () => {
  const LEGALITY_IDS = ['CATG-003', 'CATG-004', 'PAY-001', 'PROD-006', 'PROD-008'];

  /*
    Run 9011b2d7, exactly: three legality rules passed, and PROD-006 and PROD-008 were unobservable
    because one sampled page timed out. The model, asked to assemble this block, wrote
    `clean: true, items: []` — a clean bill over two rules nobody checked.
  */
  it('reports an unobserved legality rule rather than dropping it', () => {
    const computed = computeLegality(
      [
        { ruleId: 'CATG-003', state: 'pass', evidenceKey: 'k1' },
        { ruleId: 'CATG-004', state: 'pass', evidenceKey: 'k1' },
        { ruleId: 'PAY-001', state: 'pass', evidenceKey: null },
        { ruleId: 'PROD-006', state: 'not_evaluable', evidenceKey: null },
        { ruleId: 'PROD-008', state: 'not_evaluable', evidenceKey: null },
      ],
      LEGALITY_IDS,
    );

    expect(computed.items.map((i) => i.ruleId)).toEqual(['PROD-006', 'PROD-008']);
    expect(computed.items.every((i) => i.state === 'not_evaluable')).toBe(true);
    expect(computed.items.every((i) => i.evidenceKey === '')).toBe(true);
  });

  /*
    `clean` means no violation was *observed*, not "everything passed". Two unobserved rules must
    not refer a merchant out — that would decline a business because a page of theirs timed out.
  */
  it('stays clean when the only gaps are unobserved rules', () => {
    const computed = computeLegality(
      [
        { ruleId: 'CATG-003', state: 'pass', evidenceKey: 'k1' },
        { ruleId: 'PROD-008', state: 'not_evaluable', evidenceKey: null },
      ],
      LEGALITY_IDS,
    );
    expect(computed.clean).toBe(true);
    expect(computed.items).toHaveLength(1);
  });

  it('is not clean when a violation was observed', () => {
    const computed = computeLegality(
      [{ ruleId: 'CATG-003', state: 'fail', evidenceKey: 'k1' }],
      LEGALITY_IDS,
    );
    expect(computed.clean).toBe(false);
    expect(computed.items[0]).toMatchObject({ ruleId: 'CATG-003', state: 'fail', evidenceKey: 'k1' });
  });

  it('ignores every rule outside the legality tier', () => {
    const computed = computeLegality(
      [
        { ruleId: 'NAME-001', state: 'fail', evidenceKey: 'k1' },
        { ruleId: 'PROD-011', state: 'fail', evidenceKey: 'k2' },
      ],
      LEGALITY_IDS,
    );
    expect(computed).toEqual({ clean: true, items: [] });
  });

  it('is sorted, so two runs over the same findings compare', () => {
    const findings = [
      { ruleId: 'PROD-008', state: 'fail', evidenceKey: 'k2' },
      { ruleId: 'CATG-003', state: 'fail', evidenceKey: 'k1' },
    ];
    expect(computeLegality(findings, LEGALITY_IDS).items.map((i) => i.ruleId)).toEqual([
      'CATG-003',
      'PROD-008',
    ]);
  });
});

describe('legality_altered', () => {
  it('accepts the computed block echoed back with notes', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  it('refuses an item the model added', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: {
        ...d.legality,
        items: [...d.legality.items, { ruleId: 'PAY-001', state: 'fail' as const, evidenceKey: '' }],
      },
    }));
    expect(rejectionRules(draft)).toContain('legality_altered');
  });

  it('refuses an item the model dropped', () => {
    const draft = mutate((d) => ({ ...d, legality: { ...d.legality, items: [d.legality.items[0]!] } }));
    expect(rejectionRules(draft)).toContain('legality_altered');
  });

  it('refuses a cleared block', () => {
    const draft = mutate((d) => ({ ...d, legality: { clean: true, items: [] } }));
    expect(rejectionRules(draft)).toContain('legality_altered');
  });

  it('refuses a flipped clean flag', () => {
    const draft = mutate((d) => ({ ...d, legality: { ...d.legality, clean: true } }));
    expect(rejectionRules(draft)).toContain('legality_altered');
  });

  it('refuses a changed state', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: {
        ...d.legality,
        items: d.legality.items.map((i) => ({ ...i, state: 'fail' as const })),
      },
    }));
    expect(rejectionRules(draft)).toContain('legality_altered');
  });

  /*
    The note is the one thing the model may write, so changing it must never be refused — and
    `legalityMatches` is what draws that line.
  */
  it('accepts a different note', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: {
        ...d.legality,
        items: d.legality.items.map((i) => ({ ...i, note: 'A different sentence entirely.' })),
      },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('accepts no note at all — the block bare is the block as computed', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: LEGALITY.clean, items: LEGALITY.items },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
    expect(legalityMatches({ clean: LEGALITY.clean, items: LEGALITY.items }, RUN.legality)).toBe(true);
  });
});

describe('domestic_with_unmet_routing', () => {
  /*
    The draft this rule was written for recommended `domestic` while registration_gate and
    no_water_or_syringes were both observably not met. Those conditions are what stands between the
    merchant and domestic; recommending it anyway states the destination as though the path were
    already walked.
  */
  it('refuses domestic while an observable condition is not met', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, recommended: 'domestic' as const },
    }));
    const result = validateDraft(draft, { ...RUN, legality: { clean: true, items: [] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('domestic_with_unmet_routing');
    expect(result.rejections.some((r) => r.message.includes('registration_gate'))).toBe(true);
  });

  it('permits domestic once every observable condition is met', () => {
    const clean = { ...RUN, legality: { clean: true, items: [] } };
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, recommended: 'domestic' as const },
      routing: d.routing.map((r) => ({ ...r, status: 'met' as const })),
    }));
    expect(validateDraft(draft, clean)).toEqual({ ok: true });
  });

  /*
    An unobservable condition never gates a placement. Order minimum and monthly volume are
    answered by the application, and refusing domestic because a storefront cannot show them would
    decline a merchant for a limit of the method.
  */
  it('ignores a condition the crawl cannot observe', () => {
    const clean = { ...RUN, legality: { clean: true, items: [] } };
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, recommended: 'domestic' as const },
      routing: d.routing.map((r) => ({
        ...r,
        status: r.conditionId === 'order_minimum_150' ? ('not_met' as const) : ('met' as const),
      })),
    }));
    expect(validateDraft(draft, clean)).toEqual({ ok: true });
  });

  it('says nothing about international or referred_out', () => {
    for (const recommended of ['international', 'referred_out'] as const) {
      const draft = mutate((d) => ({
        ...d,
        legality: { clean: true, items: [] },
        placement: { ...d.placement, recommended },
      }));
      const result = validateDraft(draft, { ...RUN, legality: { clean: true, items: [] } });
      expect(result.ok, recommended).toBe(true);
    }
  });
});

describe('unresolved_prose_handle', () => {
  /*
    Nothing decodes prose. An invented `F99` in a sentence survives every other check and reaches
    the reader as a reference they cannot follow, in the part of the document they actually read.
  */
  it('refuses a handle in a paragraph that the mapping does not hold', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0 ? { ...a, paragraph: 'The catalogue is organised by outcome (F99).' } : a,
      ),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('unresolved_prose_handle');
    expect(result.rejections.some((r) => r.message.includes('F99'))).toBe(true);
  });

  it('accepts handles the run issued', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0 ? { ...a, paragraph: 'Outcome-organised (F1, E1, Y1, A2).' } : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('checks the placement, shore-ups and legality notes too', () => {
    const inPlacement = mutate((d) => ({
      ...d,
      placement: { ...d.placement, paragraph: 'Driven by E42.' },
    }));
    expect(rejectionRules(inPlacement)).toContain('unresolved_prose_handle');

    const inShoreUp = mutate((d) => ({
      ...d,
      shoreUps: [{ text: 'Close the gate (Y77).', citation: cite('f-001') }],
    }));
    expect(rejectionRules(inShoreUp)).toContain('unresolved_prose_handle');

    const inNote = mutate((d) => ({
      ...d,
      legality: {
        ...d.legality,
        items: d.legality.items.map((i, n) => (n === 0 ? { ...i, note: 'See A9.' } : i)),
      },
    }));
    expect(rejectionRules(inNote)).toContain('unresolved_prose_handle');
  });

  /*
    The pattern must not fire on compound names and rubric ids that merely start with the same
    letter — a false positive here would refuse honest prose.
  */
  it('does not mistake compound names or rubric ids for handles', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a, i) =>
        i === 0
          ? {
              ...a,
              paragraph: 'BPC-157, TB-500, GLP-1 and EYE-08 appear, alongside AOD-9604 and F1.',
            }
          : a,
      ),
    }));
    expect(rejectionRules(draft)).not.toContain('unresolved_prose_handle');
  });
});

