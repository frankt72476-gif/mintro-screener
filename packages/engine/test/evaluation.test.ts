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
  MERCHANT_COMMERCE_WORDS,
  MINTRO_COST_WORDS,
  PRICE_SCOPES,
  PRICE_WORDS,
  rejectionMessage,
  sentencesOf,
  hasInferenceMarker,
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

const RUN: RunContext = {
  findingIds: new Set(['f-001', 'f-002', 'f-003']),
  evidenceKeys: new Set(['run-1/layer1/abc.png', 'run-1/layer0/def']),
  eyeTestItemIds: new Set(['EYE-01', 'EYE-03']),
  angleIds: ANGLE_IDS,
  routingConditionIds: CONDITION_IDS,
  consumerSideSpectrum: new Set(['consumer_retail', 'consumer_leaning']),
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
      recommended: 'domestic',
      // Plain prose, no markers: the citations below are what backs it (D-260, Carried resolved).
      paragraph:
        'The catalogue and the product data read as a supplier, while the absence of a registration ' +
        'gate is the one thing pulling the other way.',
      citations: [cite('products_for', 'angle'), cite('operates_like_supplier', 'angle')],
    },
    legality: { clean: true, items: [] },
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
      legality: { clean: false, items: [{ ruleId: 'CATG-003', evidenceKey: 'run-1/layer0/def' }] },
    }));
    expect(rejectionRules(draft)).toContain('legality_not_referred_out');
  });

  it('accepts referred_out when legality is not clean, with the angles still drafted', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: false, items: [{ ruleId: 'CATG-003', evidenceKey: 'run-1/layer0/def' }] },
      placement: { ...d.placement, recommended: 'referred_out' as const },
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
    expect(draft.angles).toHaveLength(7);
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
