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
  PLACEMENT_BY_SPECTRUM,
  PLACEMENT_IDS,
  SPECTRUM_IDS,
  type PlacementId,
  type SpectrumId,
} from '@mintro/ruleset';
import {
  MAX_SHORE_UPS,
  MERCHANT_COMMERCE_WORDS,
  MINTRO_COST_WORDS,
  OPERATOR_NOTE_WORDS,
  PRICE_SCOPED_SECTIONS,
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
  /*
    Every observable condition's feeders clean, so the existing cases keep asserting what they
    always asserted (D-273). The rows they write are `met`, and `met` is what all-pass supports —
    the derivation is exercised on its own in `routingEvidence.test.ts`, where the fixture can say
    what it is about.
  */
  /*
    The feeders each row in the base draft is entitled to, so the existing cases keep asserting what
    they always asserted (D-273). The draft writes `registration_gate` not met and the other two
    unobserved, and a row now has to agree with its own evidence — so the fixture states the
    evidence that makes those rows correct rather than leaving them unbacked.
  */
  conditionFeederStates: new Map<string, readonly string[]>([
    ['registration_gate', ['fail', 'pass']],
    ['no_water_or_syringes', ['not_evaluable', 'pass']],
    ['no_affiliate_marketing', ['not_evaluable', 'pass']],
  ]),
  enteredConsentGateToCatalogue: false,
  attestationIsNotRegistrationIds: new Set(['registration_gate']),
  consumerSideSpectrum: new Set(['consumer_retail', 'consumer_leaning']),
  placementBySpectrum: PLACEMENT_BY_SPECTRUM,
  legality: LEGALITY,
  observableConditionIds: OBSERVABLE,
  knownHandles: new Set(['F1', 'F2', 'E1', 'Y1', 'A1', 'A2']),
  /*
    `f-003` is the heavy failure this run holds, and it is **in scope** for
    `operates_like_supplier`. That is deliberate: a lean test needs a citation the scope rule
    accepts, or a scope rejection would fire alongside the lean rejection and neither test could
    say which check refused the draft.

    `f-002` is in every angle's scope, so the baseline draft — which cites it from all seven —
    validates and each negative below changes exactly one thing.
  */
  heavyFailingFindingIds: new Set(['f-003']),
  /*
    Scope. `consistency` is absent from the map, which is how an unrestricted angle is expressed —
    keyed on having declared no rules, never on the id.
  */
  angleFindingIds: new Map<string, ReadonlySet<string>>([
    ['who_it_talks_to', new Set(['f-001', 'f-002'])],
    ['products_for', new Set(['f-002'])],
    ['how_it_sells', new Set(['f-002'])],
    ['who_it_lets_buy', new Set(['f-002'])],
    ['operates_like_supplier', new Set(['f-002', 'f-003'])],
    ['off_site', new Set(['f-002'])],
  ]),
  conditionFindingIds: new Map<string, ReadonlySet<string>>([
    ['registration_gate', new Set(['f-001'])],
    ['no_water_or_syringes', new Set(['f-002'])],
    ['no_affiliate_marketing', new Set(['f-002'])],
  ]),
};

/**
 * A run whose feeders support exactly what a draft's routing rows claim (D-273).
 *
 * A row now has to agree with its own evidence, so a test that rewrites every row to `met` is also
 * asserting something about the run — and the base fixture's feeders describe the base draft. This
 * builds the run those rewritten rows would be correct against, which keeps each test about the
 * rule it is named for rather than about routing arithmetic it never meant to exercise.
 *
 * Derived from the row, deliberately. Writing the states out per test would be the same fact in two
 * places, and the point of the fixture is that the two agree.
 */
/** The routing shape the domestic cases write: every observable condition met. */
const BASE_ALL_MET = {
  routing: OBSERVABLE.map((conditionId) => ({ conditionId, status: 'met' })),
};

function runFor(draft: { routing: readonly { conditionId: string; status: string }[] }): RunContext {
  const supporting: Record<string, readonly string[]> = {
    met: ['pass'],
    not_met: ['fail'],
    not_observable: ['not_evaluable'],
  };
  return {
    ...RUN,
    conditionFeederStates: new Map(
      draft.routing
        .filter((row) => OBSERVABLE.includes(row.conditionId))
        .map((row) => [row.conditionId, supporting[row.status] ?? ['not_evaluable']] as const),
    ),
  };
}


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

function rejectionRules(draft: EvaluationDraft, run: RunContext = RUN): string[] {
  const result = validateDraft(draft, run);
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

describe('routing_status_over_evidence', () => {
  /** A run whose feeders say exactly this, whatever the draft claims. */
  const feeders = (states: Record<string, readonly string[]>): RunContext => ({
    ...RUN,
    conditionFeederStates: new Map(Object.entries(states)),
  });

  const rowsOf = (statuses: Record<string, 'met' | 'not_met' | 'not_observable'>) =>
    mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        statuses[r.conditionId] === undefined
          ? r
          : { ...r, status: statuses[r.conditionId]!, citations: [] },
      ),
    }));

  /*
    Run f6008fa9, reproduced. CATG-001 and CATG-002 passed; CATG-005 established nothing; the draft
    wrote Met, and the summary table told an underwriter the merchant carries no bacteriostatic
    water.
  */
  it('refuses met over a feeder that established nothing', () => {
    const draft = rowsOf({ no_water_or_syringes: 'met' });
    const run = feeders({ no_water_or_syringes: ['pass', 'pass', 'not_evaluable'] });
    const result = validateDraft(draft, run);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const rejection = result.rejections.find((r) => r.rule === 'routing_status_over_evidence');
    expect(rejection?.at).toBe('routing[1].status');
    expect(rejection?.message).toContain("support 'not_observable'");
  });

  it('accepts the same row once it says what the feeders support', () => {
    const draft = rowsOf({ no_water_or_syringes: 'not_observable' });
    const run = feeders({ no_water_or_syringes: ['pass', 'pass', 'not_evaluable'] });

    expect(rejectionRules(draft, run)).not.toContain('routing_status_over_evidence');
  });

  /*
    Both directions. A row that under-claims drops a real finding out of the summary, which is the
    same defect facing the other way.
  */
  it('refuses not_observable over a feeder that observed a violation', () => {
    const draft = rowsOf({ no_water_or_syringes: 'not_observable' });
    const run = feeders({ no_water_or_syringes: ['fail', 'pass'] });

    expect(rejectionRules(draft, run)).toContain('routing_status_over_evidence');
  });

  it('accepts met when every feeder passed', () => {
    const draft = rowsOf({ no_water_or_syringes: 'met' });
    const run = feeders({ no_water_or_syringes: ['pass', 'pass'] });

    expect(rejectionRules(draft, run)).not.toContain('routing_status_over_evidence');
  });

  /*
    The conditions the application answers have no rules and nothing to derive from. A run that
    checked them would refuse every draft for saying `not_observable` about a question no crawl asks.
  */
  it('says nothing about a condition with no feeders', () => {
    const draft = rowsOf({ order_minimum_150: 'not_observable' });

    expect(rejectionRules(draft, feeders({}))).not.toContain('routing_status_over_evidence');
  });
});

describe('an attestation is not a registration', () => {
  const entered = (status: 'met' | 'not_met' | 'not_observable', through: boolean): RunContext => ({
    ...RUN,
    enteredConsentGateToCatalogue: through,
    conditionFeederStates: new Map([['registration_gate', ['pass', 'pass']]]),
  });

  const withRow = (status: 'met' | 'not_met' | 'not_observable') =>
    mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        r.conditionId === 'registration_gate' ? { ...r, status, citations: [] } : r,
      ),
    }));

  /*
    Run f6008fa9 affirmed CoMo's consent gate, read sixteen product pages, and created no account.
    Its feeders passed — GATE-002's own probe met the gate and read it as a working one — so without
    this the derivation would have said `met`.
  */
  it('refuses met when the crawl ticked a gate and read the catalogue', () => {
    const result = validateDraft(withRow('met'), entered('met', true));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const rejection = result.rejections.find((r) => r.rule === 'routing_status_over_evidence');
    expect(rejection?.message).toContain('An attestation is not a registration');
  });

  it('requires not met, not merely something other than met', () => {
    expect(rejectionRules(withRow('not_observable'), entered('not_observable', true))).toContain(
      'routing_status_over_evidence',
    );
    expect(rejectionRules(withRow('not_met'), entered('not_met', true))).not.toContain(
      'routing_status_over_evidence',
    );
  });

  /*
    The control. With no gate in the way, the same passing feeders earn `met` — so the override is
    about what this run did, not a blanket refusal of the row.
  */
  it('leaves the row alone on a run that met no gate', () => {
    expect(rejectionRules(withRow('met'), entered('met', false))).not.toContain(
      'routing_status_over_evidence',
    );
  });

  /*
    And it is keyed on the angle set's declaration, never on the condition's id (hard constraint 1).
  */
  it('applies only to conditions the angle set flags', () => {
    const unflagged: RunContext = {
      ...RUN,
      enteredConsentGateToCatalogue: true,
      attestationIsNotRegistrationIds: new Set<string>(),
      conditionFeederStates: new Map([['registration_gate', ['pass', 'pass']]]),
    };

    expect(rejectionRules(withRow('met'), unflagged)).not.toContain('routing_status_over_evidence');
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
    `domestic` is stricter at publish than in a draft, and that is the whole difference between a
    proposal and a statement.

    A draft may propose domestic over the two conditions the application answers, saying they must
    hold. A published evaluation is immutable — nobody comes back to add "provided the application
    answers hold" — so the answers exist before it is written, or it is not written.
  */
  describe('domestic needs every condition met, not only the observable ones', () => {
    // Feeders consistent with the all-met rows these drafts write (D-273).
  const clean = { ...runFor(BASE_ALL_MET), legality: { clean: true, items: [] } };

    const domestic = (statuses: Record<string, 'met' | 'not_met' | 'not_observable'>) =>
      mutate((d) => ({
        ...d,
        legality: { clean: true, items: [] },
        placement: {
          ...d.placement,
          spectrum: 'research_supplier' as const,
          recommended: 'domestic' as const,
        },
        routing: d.routing.map((r) => ({
          ...r,
          status: statuses[r.conditionId] ?? ('met' as const),
          citations: [],
        })),
      }));

    it('publishes when all five are met', () => {
      expect(publishRefusal(domestic({}), 'ok', clean)).toBeNull();
    });

    /*
      The case the draft rule lets through and this one does not. `validateDraft` accepts it — that
      is asserted here so the two rules are visibly different rather than accidentally the same.
    */
    it('refuses over an unobserved application condition the draft rule permits', () => {
      const draft = domestic({ order_minimum_150: 'not_observable' });
      expect(validateDraft(draft, clean)).toEqual({ ok: true });

      const refusal = publishRefusal(draft, 'ok', clean);
      expect(refusal).toContain('order_minimum_150');
      expect(refusal).toContain('not_observable');
      expect(refusal).toContain('cannot be amended afterwards');
    });

    it.each(CONDITION_IDS)('refuses over %s left unobserved', (conditionId) => {
      expect(publishRefusal(domestic({ [conditionId]: 'not_observable' }), 'ok', clean)).not.toBeNull();
    });

    it('says nothing about international or referred out', () => {
      for (const recommended of ['international'] as const) {
        const draft = mutate((d) => ({
          ...d,
          legality: { clean: true, items: [] },
          placement: { ...d.placement, recommended },
        }));
        /*
          The base draft's routing rows, so the run has to be the base fixture's feeders rather than
          the all-met ones the domestic cases in this block use. This test does not rewrite routing
          and must not be answered by a run that assumes it did (D-273).
        */
        const base = { ...RUN, legality: { clean: true, items: [] } };
        expect(publishRefusal(draft, 'ok', base), recommended).toBeNull();
      }
    });
  });

  /*
    A refusal is a value, not a write.

    `publishRefusal` is pure and takes the draft by reference; the worker writes only when it
    returns null. This is the half of "a refused publish leaves the draft untouched" that lives
    here — the other half is the worker never reaching `publish_evaluation`, which is a branch in
    `runPublish`.
  */
  it('leaves the draft exactly as it was when it refuses', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, recommended: 'domestic' as const },
    }));
    const before = JSON.stringify(draft);

    expect(publishRefusal(draft, 'ok', { ...RUN, legality: { clean: true, items: [] } })).not.toBeNull();
    expect(JSON.stringify(draft)).toBe(before);
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
    // Feeders consistent with the all-met rows these drafts write (D-273).
  const clean = { ...runFor(BASE_ALL_MET), legality: { clean: true, items: [] } };
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
    // Feeders consistent with the all-met rows these drafts write (D-273).
  const clean = { ...runFor(BASE_ALL_MET), legality: { clean: true, items: [] } };
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

  /*
    This rule is about `domestic` and nothing else.

    Asserted on the rejection codes rather than on overall validity, because a clean
    `research_leaning` draft recommending `referred_out` is now refused — by
    `placement_outside_spectrum`, which is a different rule with a different reason. Asserting
    `ok: true` here would have made this test a second, quieter statement of the spectrum rule and
    it would have had to be relaxed every time another placement check landed.
  */
  it('says nothing about international or referred_out', () => {
    for (const recommended of ['international', 'referred_out'] as const) {
      const draft = mutate((d) => ({
        ...d,
        legality: { clean: true, items: [] },
        placement: { ...d.placement, recommended },
      }));
      const result = validateDraft(draft, { ...RUN, legality: { clean: true, items: [] } });
      const rules = result.ok ? [] : result.rejections.map((r) => r.rule);
      expect(rules, recommended).not.toContain('domestic_with_unmet_routing');
      expect(rules, recommended).not.toContain('domestic_with_unobserved_routing');
    }
  });

  it('leaves international valid outright on this run', () => {
    const draft = mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, recommended: 'international' as const },
    }));
    expect(validateDraft(draft, { ...RUN, legality: { clean: true, items: [] } })).toEqual({
      ok: true,
    });
  });
});

/*
  The spectrum and the placement, joined.

  They were two fields with nothing between them, so **Consumer retail · Domestic** passed every
  check in this file — a consumer storefront recommended for the placement the programme reserves
  for research suppliers who have met every condition.

  The table is `PLACEMENT_BY_SPECTRUM` in the angle set, and it is read from there rather than
  restated here: a copy in the test would agree with a copy in the code and neither would be the
  ratified rule.
*/
describe('placement_outside_spectrum', () => {
  // Feeders consistent with the all-met rows these drafts write (D-273).
  const clean = { ...runFor(BASE_ALL_MET), legality: { clean: true, items: [] } };

  /** A clean draft at one position recommending one placement. */
  const at = (spectrum: SpectrumId, recommended: PlacementId): EvaluationDraft =>
    mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, spectrum, recommended },
      /*
        Every observable condition met, so `domestic` is refused by this rule where it is refused
        at all — the routing gate would otherwise fire alongside it and neither assertion could say
        which check spoke.
      */
      routing: d.routing.map((r) => ({ ...r, status: 'met' as const, citations: [] })),
      // Shore-ups are refused on the consumer side, and two of the six positions below are.
      shoreUps: [],
    }));

  const rulesFor = (spectrum: SpectrumId, recommended: PlacementId): readonly string[] => {
    const result = validateDraft(at(spectrum, recommended), clean);
    return result.ok ? [] : result.rejections.map((r) => r.rule);
  };

  it('reads the ratified table, so this is not asserted over an invented one', () => {
    expect(Object.keys(PLACEMENT_BY_SPECTRUM).sort()).toEqual([...SPECTRUM_IDS].sort());
    expect(PLACEMENT_BY_SPECTRUM.consumer_retail).toEqual(['referred_out']);
  });

  it.each(SPECTRUM_IDS)('permits every placement the table allows at %s', (spectrum) => {
    for (const recommended of PLACEMENT_BY_SPECTRUM[spectrum]) {
      expect(rulesFor(spectrum, recommended), `${spectrum}/${recommended}`).not.toContain(
        'placement_outside_spectrum',
      );
    }
  });

  it.each(SPECTRUM_IDS)('refuses every placement the table withholds at %s', (spectrum) => {
    const withheld = PLACEMENT_IDS.filter((id) => !PLACEMENT_BY_SPECTRUM[spectrum].includes(id));
    expect(withheld.length).toBeGreaterThan(0);
    for (const recommended of withheld) {
      expect(rulesFor(spectrum, recommended), `${spectrum}/${recommended}`).toContain(
        'placement_outside_spectrum',
      );
    }
  });

  /* The three the reading turned on, named rather than left to the loops above. */
  it('refuses a consumer retailer placed anywhere but referred out', () => {
    expect(rulesFor('consumer_retail', 'domestic')).toContain('placement_outside_spectrum');
    expect(rulesFor('consumer_retail', 'international')).toContain('placement_outside_spectrum');
    expect(rulesFor('consumer_retail', 'referred_out')).not.toContain('placement_outside_spectrum');
  });

  it('lets a consumer-leaning business be international but never domestic', () => {
    expect(rulesFor('consumer_leaning', 'international')).not.toContain('placement_outside_spectrum');
    expect(rulesFor('consumer_leaning', 'domestic')).toContain('placement_outside_spectrum');
  });

  it('refuses a research-side business referred out on the spectrum alone', () => {
    for (const spectrum of ['research_leaning', 'research_supplier'] as const) {
      expect(rulesFor(spectrum, 'referred_out'), spectrum).toContain('placement_outside_spectrum');
    }
  });

  /*
    Mixed is referred out, and only referred out (D-272).

    It used to sit with the research side and permit `international` or `domestic`, which put a
    storefront selling to both audiences on the same footing as one selling to laboratories. A mixed
    position means the consumer side is present, and the consumer side is what the programme refers
    out.
  */
  it('permits mixed nothing but referred out', () => {
    expect(rulesFor('mixed', 'referred_out')).not.toContain('placement_outside_spectrum');
    expect(rulesFor('mixed', 'international')).toContain('placement_outside_spectrum');
    expect(rulesFor('mixed', 'domestic')).toContain('placement_outside_spectrum');
  });

  it('names the position and what it permits, so a retry knows where to move', () => {
    const result = validateDraft(at('consumer_retail', 'domestic'), clean);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.rejections.find((r) => r.rule === 'placement_outside_spectrum')!.message;
    expect(message).toContain('consumer_retail');
    expect(message).toContain('domestic');
    expect(message).toContain('referred_out');
  });

  /*
    A legality item overrides the table, and only one rule speaks.

    `legality_not_referred_out` already fixes the recommendation, and running this as well would
    tell one retry to move the placement in two directions at once — down to referred_out for the
    legality item, and up off referred_out for the spectrum.
  */
  it('stands aside where legality has already fixed the recommendation', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'research_supplier' as const, recommended: 'referred_out' as const },
    }));
    const result = validateDraft(draft, RUN);
    const rules = result.ok ? [] : result.rejections.map((r) => r.rule);
    expect(rules).not.toContain('placement_outside_spectrum');
    expect(rules).not.toContain('legality_not_referred_out');
  });

  it('refuses a research supplier placed domestic while legality is not clean', () => {
    const draft = mutate((d) => ({
      ...d,
      placement: { ...d.placement, spectrum: 'research_supplier' as const, recommended: 'domestic' as const },
      routing: d.routing.map((r) => ({ ...r, status: 'met' as const, citations: [] })),
    }));
    const result = validateDraft(draft, runFor(draft));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The legality rule speaks, and the spectrum rule stays quiet — domestic is inside the table.
    expect(result.rejections.map((r) => r.rule)).toContain('legality_not_referred_out');
    expect(result.rejections.map((r) => r.rule)).not.toContain('placement_outside_spectrum');
  });
});

/*
  `not_observable` is not `met`.

  A condition the crawl could not read is a condition nobody has established, and recommending the
  programme's furthest placement over one would rest the recommendation on a surface that was never
  established — hard constraint 9, in the placement. The two the application answers are the
  exception, and the only one.
*/
describe('domestic over unobserved conditions', () => {
  // Feeders consistent with the all-met rows these drafts write (D-273).
  const clean = { ...runFor(BASE_ALL_MET), legality: { clean: true, items: [] } };

  const domestic = (statuses: Record<string, 'met' | 'not_met' | 'not_observable'>): EvaluationDraft =>
    mutate((d) => ({
      ...d,
      legality: { clean: true, items: [] },
      placement: { ...d.placement, spectrum: 'research_supplier' as const, recommended: 'domestic' as const },
      routing: d.routing.map((r) => ({
        ...r,
        status: statuses[r.conditionId] ?? ('met' as const),
        citations: [],
      })),
    }));

  const rulesFor = (statuses: Record<string, 'met' | 'not_met' | 'not_observable'>): readonly string[] => {
    const result = validateDraft(domestic(statuses), clean);
    return result.ok ? [] : result.rejections.map((r) => r.rule);
  };

  it('refuses domestic while an observable condition is unobserved', () => {
    const rules = rulesFor({ registration_gate: 'not_observable' });
    expect(rules).toContain('domestic_with_unmet_routing');
    expect(rules).toContain('domestic_with_unobserved_routing');
  });

  it.each(OBSERVABLE)('refuses domestic where %s could not be observed', (conditionId) => {
    expect(rulesFor({ [conditionId]: 'not_observable' })).toContain('domestic_with_unmet_routing');
  });

  /*
    The two the application answers may stand unobserved, and a draft reaching domestic over them
    is saying they must hold. Refusing that would decline a merchant for a limit of our method.
  */
  it('permits domestic over the two application conditions', () => {
    expect(
      rulesFor({ order_minimum_150: 'not_observable', monthly_volume_70k: 'not_observable' }),
    ).toEqual([]);
  });

  it('permits domestic with every condition met', () => {
    expect(rulesFor({})).toEqual([]);
  });

  it('says which condition it means, and which two may stand unobserved', () => {
    const result = validateDraft(domestic({ no_affiliate_marketing: 'not_observable' }), clean);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.rejections
      .find((r) => r.rule === 'domestic_with_unobserved_routing')!
      .message;
    expect(message).toContain('no_affiliate_marketing');
    expect(message).toContain('order_minimum_150');
    expect(message).toContain('monthly_volume_70k');
  });

  /* The observable set is the angle set's, and this run has three of them. */
  it('holds every observable condition to the same bar', () => {
    expect(OBSERVABLE).toHaveLength(3);
    expect(CONDITION_IDS.filter((id) => !OBSERVABLE.includes(id))).toEqual([
      'order_minimum_150',
      'monthly_volume_70k',
    ]);
  });
});

/*
  The operator's note, held to Mintro's cost vocabulary (D-261).

  It is the one part of this document a human writes freely, and it sits under the placement
  paragraph on the first screen, in Mintro's voice, in a document that goes to an underwriter.
  D-256 keeps what Mintro charges out of a site evaluation, and a field the model never sees is a
  field no prompt guardrail reaches. This check is the only guard on it.
*/
describe('the operator note and what it may not say', () => {
  const withNote = (operatorNote: string) => mutate((d) => ({ ...d, operatorNote }));

  const rulesFor = (operatorNote: string): readonly string[] => {
    const result = validateDraft(withNote(operatorNote), RUN);
    return result.ok ? [] : result.rejections.map((r) => r.rule);
  };

  it('accepts a note that says something useful about the merchant', () => {
    expect(
      rulesFor('Spoke to the merchant on 8 September; the registration gate is being built.'),
    ).toEqual([]);
  });

  it('accepts a draft with no note at all — the field is optional', () => {
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
    expect(rulesFor('')).toEqual([]);
  });

  it.each([...OPERATOR_NOTE_WORDS])('refuses a note mentioning %s', (word) => {
    const rules = rulesFor(`The merchant asked about our ${word} and we said nothing.`);
    expect(rules).toContain('price_word');
  });

  it('names the word, so an operator knows which one to change', () => {
    const result = validateDraft(withNote('Their fee structure is unusual.'), RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const rejection = result.rejections.find((r) => r.rule === 'price_word')!;
    expect(rejection.at).toBe('operatorNote');
    expect(rejection.message).toContain('fee');
  });

  /*
    The narrowest of the three lists, and the words it leaves out are the point.

    `price`, `cost` and `rate` are the words an operator reaches for when writing about the
    **merchant** — their prices, cost per unit, the chargeback rate that came up on a call. Refusing
    those would refuse the honest note far more often than the forbidden one, which is the same
    correction D-260 already made when the validator refused a shore-up for naming the merchant's
    own bundle discounts: a rule working against its own purpose.
  */
  it.each(['price', 'pricing', 'cost', 'costs', 'rate', 'rates', 'discount'])(
    'permits %s, which is how an operator describes the merchant',
    (word) => {
      expect(OPERATOR_NOTE_WORDS as readonly string[]).not.toContain(word);
      expect(rulesFor(`Their ${word} came up on the call.`)).toEqual([]);
    },
  );

  it('is narrower than the list a shore-up is held to, and much narrower than the placement’s', () => {
    expect(OPERATOR_NOTE_WORDS.length).toBeLessThan(MINTRO_COST_WORDS.length);
    expect(OPERATOR_NOTE_WORDS.length).toBeLessThan(PRICE_WORDS.length);
    // Every word it does hold is a solution-cost word the wider list already refused.
    for (const word of OPERATOR_NOTE_WORDS) {
      expect(MINTRO_COST_WORDS as readonly string[], word).toContain(word);
    }
  });

  /* What it exists for: one solution compared against another, in Mintro's voice. */
  it('refuses a comparison between what two solutions cost', () => {
    expect(rulesFor('Domestic would be cheaper for them than international.')).toContain(
      'price_word',
    );
    expect(rulesFor('Worth 40 bps either way.')).toContain('price_word');
  });

  /* The section is in the scoped list, so a reader of that list can see it is covered. */
  it('is a scoped section rather than a special case', () => {
    expect(PRICE_SCOPED_SECTIONS).toContain('operatorNote');
    expect(PRICE_SCOPES.operatorNote).toEqual(OPERATOR_NOTE_WORDS);
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

describe('not_observable_row_cites', () => {
  /*
    Run 9011b2d7 put an eye-test item about checkout discounts against `$150 minimum order`, whose
    status was `not_observable`. The item is a true observation and it says nothing about an order
    minimum — but rendered into the routing table it fills the Evidence column, and a reader has no
    way to tell it apart from a capture that bore on the condition.
  */
  it('refuses a citation on a not_observable row', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        r.status === 'not_observable' ? { ...r, citations: [cite('EYE-01', 'eye_test')] } : r,
      ),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('not_observable_row_cites');
    expect(result.rejections.some((r) => r.message.includes('order_minimum_150'))).toBe(true);
  });

  it('accepts the empty citation list the status implies', () => {
    expect(passing().routing.some((r) => r.status === 'not_observable')).toBe(true);
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  /*
    The rule is about the status, not about routing rows in general. A `met` or `not_met` row states
    something the crawl saw, and the capture is exactly what makes it readable.
  */
  it('says nothing about a cited met or not_met row', () => {
    for (const status of ['met', 'not_met'] as const) {
      const draft = mutate((d) => ({
        ...d,
        routing: d.routing.map((r) => ({ ...r, status, citations: [cite('f-001')] })),
      }));
      expect(rejectionRules(draft), status).not.toContain('not_observable_row_cites');
    }
  });

  it('names each offending row, not the first', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        r.status === 'not_observable' ? { ...r, citations: [cite('f-001')] } : r,
      ),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const offending = passing().routing.filter((r) => r.status === 'not_observable').length;
    expect(offending).toBeGreaterThan(1);
    expect(result.rejections.filter((r) => r.rule === 'not_observable_row_cites')).toHaveLength(offending);
  });
});

describe('research_lean_over_heavy_failure', () => {
  /** The one angle whose scope holds the heavy failure, so only the lean rule is in play. */
  const withHeavy = (lean: 'research' | 'neutral' | 'consumer') =>
    mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'operates_like_supplier' ? { ...a, lean, citations: [cite('f-003')] } : a,
      ),
    }));

  /*
    Heavy is D-259's weighting of the rules that decide what a business is. An angle that cites one
    of them failing and then calls the result research has read its strongest contrary evidence and
    concluded past it — and nothing in the paragraph has to admit that happened.
  */
  it('refuses a research lean over a heavy rule observed to fail', () => {
    const result = validateDraft(withHeavy('research'), RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('research_lean_over_heavy_failure');
    expect(result.rejections.some((r) => r.message.includes('f-003'))).toBe(true);
  });

  /*
    The rule refuses the lean, not the observation. Neutral is usually the honest answer: a genuine
    supplier with one heavy failure has not become a consumer retailer.
  */
  it('leaves the citation alone — neutral and consumer both stand', () => {
    expect(validateDraft(withHeavy('neutral'), RUN)).toEqual({ ok: true });
    expect(validateDraft(withHeavy('consumer'), RUN)).toEqual({ ok: true });
  });

  /*
    Only `fail` binds the lean. D-009 puts ambiguous checks in a human queue precisely so they are
    not treated as failures, and a `not_evaluable` is an absence of observation — a lean answering
    to either would be answering to something nobody observed.
  */
  it('says nothing about a heavy rule that is not failing', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'operates_like_supplier'
          ? { ...a, lean: 'research' as const, citations: [cite('f-002')] }
          : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  it('says nothing about a research lean that cites no heavy failure at all', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) => ({ ...a, lean: 'research' as const })),
    }));
    expect(rejectionRules(draft)).not.toContain('research_lean_over_heavy_failure');
  });

  /*
    The unrestricted angle is not exempt from the lean rule. Scope and lean are separate questions,
    and `consistency` may cite anything — which makes it the one angle that could reach a research
    lean over a heavy failure it was never scoped out of.
  */
  it('binds the unrestricted angle too', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'consistency'
          ? { ...a, lean: 'research' as const, citations: [cite('f-003')] }
          : a,
      ),
    }));
    expect(rejectionRules(draft)).toContain('research_lean_over_heavy_failure');
  });

  it('names every heavy failure it cited, not the first', () => {
    const wide = { ...RUN, heavyFailingFindingIds: new Set(['f-002', 'f-003']) };
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'operates_like_supplier'
          ? { ...a, lean: 'research' as const, citations: [cite('f-002'), cite('f-003')] }
          : a,
      ),
    }));
    const result = validateDraft(draft, wide);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.rejections.find((r) => r.rule === 'research_lean_over_heavy_failure')?.message;
    expect(message).toContain('f-002');
    expect(message).toContain('f-003');
    expect(message).toContain('2 heavy rule(s)');
  });
});

describe('citation_outside_angle_scope', () => {
  /*
    Run 9011b2d7 cited DISC-004 — the footer disclaimer rule — as the evidence that a research-water
    product line exists. True of the site, unrelated to the claim, and nothing refused it. A finding
    from another angle reaches the reader as support this angle does not have.
  */
  it('refuses a finding the angle does not read', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'products_for' ? { ...a, citations: [cite('f-001')] } : a,
      ),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('citation_outside_angle_scope');
    expect(result.rejections.some((r) => r.message.includes("'products_for'"))).toBe(true);
  });

  it('accepts a finding the angle does read', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'who_it_talks_to' ? { ...a, citations: [cite('f-001'), cite('f-002')] } : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  /*
    An angle absent from the map is unrestricted, and that is how the consistency angle is
    expressed. Keyed on having declared no rules of its own — never on the id, which would be rule
    knowledge in the engine.
  */
  it('lets the unrestricted angle cite anything in the run', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'consistency' ? { ...a, citations: [cite('f-001'), cite('f-002')] } : a,
      ),
    }));
    expect(validateDraft(draft, RUN)).toEqual({ ok: true });
  });

  /*
    Scope is about findings. An eye-test verdict or a stored capture is not a rule's output and has
    no angle it belongs to; refusing those would forbid the observations that carry the angles which
    have few rules of their own.
  */
  it('says nothing about evidence or eye-test citations', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'products_for'
          ? { ...a, citations: [cite('EYE-01', 'eye_test'), cite('run-1/layer0/def', 'evidence')] }
          : a,
      ),
    }));
    expect(rejectionRules(draft)).not.toContain('citation_outside_angle_scope');
  });

  /*
    A fabricated id is `unknown_citation`'s and only its. Reporting it twice would tell a retry to
    move a citation that does not exist to an angle that could hold it.
  */
  it('leaves an invented finding to unknown_citation alone', () => {
    const draft = mutate((d) => ({
      ...d,
      angles: d.angles.map((a) =>
        a.angleId === 'products_for' ? { ...a, citations: [cite('f-999')] } : a,
      ),
    }));
    const rules = rejectionRules(draft);
    expect(rules).toContain('unknown_citation');
    expect(rules).not.toContain('citation_outside_angle_scope');
  });
});

describe('citation_outside_condition_scope', () => {
  /*
    `registration_gate` is read by its own rules. A finding from elsewhere, offered as the basis for
    its status, is a capture of something adjacent standing in for one that bears on the question —
    the same failure `not_observable_row_cites` catches on rows that can cite nothing at all.
  */
  it('refuses a finding that does not observe the condition', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        r.conditionId === 'registration_gate' ? { ...r, citations: [cite('f-002')] } : r,
      ),
    }));
    const result = validateDraft(draft, RUN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.rule)).toContain('citation_outside_condition_scope');
    expect(result.rejections.some((r) => r.message.includes("'registration_gate'"))).toBe(true);
  });

  it('accepts the findings that do', () => {
    expect(passing().routing.some((r) => r.citations.length > 0)).toBe(true);
    expect(validateDraft(passing(), RUN)).toEqual({ ok: true });
  });

  it('leaves an invented finding to unknown_citation alone', () => {
    const draft = mutate((d) => ({
      ...d,
      routing: d.routing.map((r) =>
        r.conditionId === 'registration_gate' ? { ...r, citations: [cite('f-999')] } : r,
      ),
    }));
    const rules = rejectionRules(draft);
    expect(rules).toContain('unknown_citation');
    expect(rules).not.toContain('citation_outside_condition_scope');
  });
});

