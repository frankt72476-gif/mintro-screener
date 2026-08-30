/**
 * A kind is chosen from a producer-set signal, never from prose or from a fabricated number
 * (D-181).
 *
 * `not_exposed` says *the merchant did not present this*. `not_retrieved` says *we did not obtain
 * it*. Filing our own timeout as the first prints our failure as a fact about the merchant, in a
 * document that reaches an underwriter under Mintro's name. D-156 settled the principle and D-136
 * gave it the `notEvaluableKind` field; what stayed wrong were the places that never read a signal
 * at all.
 *
 * **Nothing in the stored corpus exercises the render-failure branch below.** Every
 * `not_evaluable` finding from these four handlers across all seven reference runs arrives through
 * `layer2.ts`, which already discriminates. The branch has been live and untriggered on every
 * stored run, which is exactly why it went unnoticed — so the constructed cases here are the only
 * evidence it behaves, and they cover each of the three ways a page fails to render rather than
 * one representative of them.
 *
 * They are parameterised over every handler for a reason. The deciding block was byte-identical in
 * four of them; the first sweep found it in one and the other three survived unchanged. A test
 * that covered only `dom_assert` would have gone green over three live copies of the same defect.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkComputedStyle,
  checkDomAssert,
  checkFlowProbe,
  checkTextCooccurrence,
  checkTextMatch,
  NO_GATE,
  type Finding,
  type PageContext,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

function page(overrides: Partial<PageContext> = {}): PageContext {
  return {
    requestedUrl: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    httpStatus: 200,
    title: 'Shop',
    text: 'Welcome to the shop.',
    html: '<html><body></body></html>',
    htmlSha256: 'a'.repeat(64),
    footer: { found: true, text: '', styledText: [], locatedBy: '<footer>' },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

const ruleFor = <T extends Rule['type']>(id: string) =>
  ruleset.rules.find((r) => r.id === id) as RuleOfType<T>;

const gate001 = ruleFor<'dom_assert'>('GATE-001');
const gate003 = ruleFor<'flow_probe'>('GATE-003');

/**
 * Every handler that takes a `PageContext` and can meet one that did not render.
 *
 * The block deciding this was byte-identical in all four, and the first survey fixed one of them.
 * Driving every handler through the same three cases is what makes a fifth copy — or a fifth
 * handler that grows its own — fail here rather than in production.
 */
const HANDLERS: readonly (readonly [string, (p: PageContext) => Finding])[] = [
  ['dom_assert', (p) => checkDomAssert(gate001, p)],
  ['computed_style', (p) => checkComputedStyle(ruleFor<'computed_style'>('DISC-002'), p, [])],
  ['text_match', (p) => checkTextMatch(ruleFor<'text_match'>('DISC-001'), p)],
  ['text_cooccurrence', (p) => checkTextCooccurrence(ruleFor<'text_cooccurrence'>('PROD-005'), p)],
];

const SESSION = { authenticated: false, description: 'anonymous' } as const;

/**
 * Every way `isRendered` can be false, one case each.
 *
 * `isRendered` is `renderError === undefined && httpStatus >= 200 && httpStatus < 400`, so three
 * distinct things fall through it and they are not the same fact. The handler filed all three as
 * `not_exposed`.
 */
describe.each(HANDLERS)('%s on a page that did not render', (_name, check) => {
  it('is not_retrieved when the browser reported an error', () => {
    // Our request failed. The merchant published nothing about that either way, and an age gate
    // we never loaded the page to look for is not an age gate the merchant omitted.
    const finding = check(page({ renderError: 'page.goto: Timeout 20000ms exceeded', httpStatus: 0 }));

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('is not_retrieved on a 5xx, which establishes nothing about what the merchant publishes', () => {
    // The origin failed to serve a page it may well carry. Reading a 503 as absence would report
    // a merchant's bad afternoon as a missing age gate.
    const finding = check(page({ httpStatus: 503 }));

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it.each([404, 410])('stays not_exposed on %i, where the origin answered that it has no such page', (httpStatus) => {
    // The control on the pair above. These two are the origin's own statement about what it
    // carries, and widening `not_retrieved` to swallow them would lose a real observation.
    const finding = check(page({ httpStatus }));

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_exposed');
  });

  it.each([403, 401, 429])('is not_retrieved on %i, which is a refusal and not an absence', (httpStatus) => {
    /*
      D-181 wrote this row as "the whole 4xx range is the merchant's" and that was wrong (D-184).

      A 403 is *you may not read this*, which leaves entirely open whether the page exists. The
      same mistake at Layer 0 sent eight `not_exposed` findings out about a real storefront — four
      of them stopping conditions — on the strength of three 403s on sitemap paths.
    */
    const finding = check(page({ httpStatus }));

    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('reports the render error itself as the reason, whichever kind it lands on', () => {
    // The reason has always been right. It was the kind that contradicted it, which is what made
    // this survivable for so long: the sentence said one thing and the field said another.
    const finding = check(page({ renderError: 'net::ERR_CONNECTION_REFUSED', httpStatus: 0 }));

    expect(finding.notEvaluableReason).toContain('net::ERR_CONNECTION_REFUSED');
  });
});

/**
 * The flow probe's evidence carries no invented HTTP status (D-181).
 *
 * `status: observation.error === undefined ? 200 : 0` derived a number that looks like an HTTP
 * status from a prose field — the same field D-156 established carries two different kinds of
 * thing. A reader auditing kinds by that number reaches the opposite conclusion from the one the
 * finding states, which is not hypothetical: it is how the survey that opened D-181 went wrong.
 */
describe('flow probe evidence', () => {
  const observe = (extra: Record<string, unknown>) =>
    checkFlowProbe(gate003, {
      observation: {
        flow: 'add_to_cart_then_checkout',
        reached: 'not_started',
        steps: ['opened /product/one', 'clicked add to cart', 'the cart was still empty after adding'],
        finalUrl: 'https://shop.example/product/one',
        capturedAt: '2026-08-29T00:00:00.000Z',
        sha256: 'b'.repeat(64),
        ...extra,
      },
      session: SESSION,
    } as never);

  it('synthesises no fetch attempt, because a flow issues no single request', () => {
    const finding = observe({ error: 'the add-to-cart control was clicked but the cart remained empty' });

    // Not an empty list: the entry carried nothing the evidence did not already hold except the
    // invented number, so it is gone rather than blanked.
    for (const evidence of finding.evidence) {
      expect(evidence.attempts ?? []).toEqual([]);
    }
  });

  it('carries the step trace, which is the real record of what was attempted', () => {
    // Hard constraint 3: a `not_evaluable` finding evidences *why*. Removing the fabricated
    // attempt may not remove that, so the trace the flow actually recorded takes its place.
    const finding = observe({ error: 'the add-to-cart control was clicked but the cart remained empty' });

    expect(finding.notEvaluableReason).toContain('clicked add to cart');
    expect(finding.notEvaluableReason).toContain('the cart was still empty after adding');
  });

  it('still separates the two kinds on the producer flag, not on the trace', () => {
    // The trace is evidence, never a classifier. These two differ only in `obstructed`.
    const merchant = observe({ error: 'the cart remained empty' });
    const ours = observe({ error: 'the cart could not be read', obstructed: true });

    expect(merchant.notEvaluableKind).toBe('not_exposed');
    expect(ours.notEvaluableKind).toBe('not_retrieved');
  });
});
