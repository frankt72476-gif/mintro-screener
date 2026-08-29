/**
 * A Layer 3 surface that was not reached says what was tried, and whose failure it was (D-182).
 *
 * Two defects, one shape. Both come from `documentFinding` having received a bare
 * `PageContext | undefined` — a producer handing back "nothing" with no room to say anything about
 * it:
 *
 *   1. **No evidence at all.** Seventeen `not_exposed` findings across the seven reference runs
 *      asserted the merchant did not publish a page and carried zero attempts. The attempts
 *      existed — they went into the run-level obstruction summary — but never reached the finding,
 *      so a reader auditing one row could not see which paths were tried or what they returned.
 *      Hard constraint 3 requires the requests attempted.
 *
 *   2. **An unconditional `not_exposed`.** D-181's sweep listed `layer3.ts:249` as one of three
 *      sites that structurally could not decide. `Located.obstructed` is the signal it was
 *      missing.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  located,
  runLayer3,
  unreachable,
  type FetchAttempt,
  type Located,
  type PageContext,
  type SignupForm,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

/** The six candidates a real terms lookup makes: four conventional paths and two homepage links. */
const SIX: readonly FetchAttempt[] = [
  { url: 'https://shop.example/terms', status: 404, error: 'the origin answered HTTP 404' },
  { url: 'https://shop.example/terms-of-service', status: 404, error: 'the origin answered HTTP 404' },
  { url: 'https://shop.example/terms-and-conditions', status: 404, error: 'the origin answered HTTP 404' },
  { url: 'https://shop.example/policies/terms-of-service', status: 404, error: 'the origin answered HTTP 404' },
  { url: 'https://shop.example/legal', status: 200, error: 'the page does not name the terms document in its path' },
  { url: 'https://shop.example/info', status: 200, error: 'the page does not name the terms document in its path' },
];

const NO_SURFACE: Located<PageContext> = unreachable('nothing was looked for', []);

const NO_FORM: SignupForm = {
  found: false,
  url: '',
  locatedBy: '',
  fields: [],
  candidateForms: 0,
  capturedAt: '2026-08-29T00:00:00.000Z',
} as unknown as SignupForm;

/**
 * The same outcome on every document surface, so one call covers all three document rules.
 *
 * `GATE-007` reads the terms document, `FULF-001` the shipping policy and `COMM-001` the FAQ —
 * three of the five rule ids among the seventeen corpus findings. Driving them together is
 * deliberate: fixing whichever one a test happened to name would have left the others exactly as
 * they were.
 */
const run = (surface: Located<PageContext>) =>
  runLayer3(
    { signup: NO_FORM, terms: surface, shipping: surface, faq: surface, payment: NO_SURFACE },
    ruleset,
  );

const DOCUMENT_RULES = ['GATE-007', 'FULF-001', 'COMM-001'] as const;

/** One representative document finding, for assertions about a single row. */
const termsFindings = (surface: Located<PageContext>) =>
  run(surface).findings.filter((f) => f.ruleId === 'GATE-007');

describe('a surface that was not reached', () => {
  it('carries every request attempted, with the status each returned', () => {
    const [finding] = termsFindings(unreachable('no terms document was reached', SIX));

    expect(finding?.state).toBe('not_evaluable');
    // The whole point: this was zero on all seventeen corpus findings.
    expect(finding?.evidence[0]?.attempts).toHaveLength(6);
    expect(finding?.evidence[0]?.attempts?.map((a) => a.status)).toEqual([404, 404, 404, 404, 200, 200]);
  });

  it('names the URLs, so a reader can check the paths rather than trust the sentence', () => {
    const [finding] = termsFindings(unreachable('no terms document was reached', SIX));
    const urls = finding?.evidence[0]?.attempts?.map((a) => a.url) ?? [];

    expect(urls).toContain('https://shop.example/terms-of-service');
    expect(urls).toContain('https://shop.example/policies/terms-of-service');
  });

  it('claims no capture it does not have', () => {
    // D-012: a `rendered_page` finding must not cite a screenshot that was never taken. Nothing
    // was rendered here, so the requests are the evidence and the keys stay empty.
    const [finding] = termsFindings(unreachable('no terms document was reached', SIX));

    expect(finding?.evidence[0]?.evidenceKey).toBe('');
    expect(finding?.evidence[0]?.sourceSha256).toBe('');
  });

  it('is never a pass', () => {
    // The absence of a document is not the absence of what the document should have said.
    const [finding] = termsFindings(unreachable('no terms document was reached', SIX));

    expect(finding?.state).not.toBe('pass');
    expect(finding?.state).not.toBe('fail');
  });
});

/**
 * The kind, read from the producer's flag rather than assumed (D-181, D-182).
 *
 * These two differ in exactly one field, and that field is set by the worker at the point the
 * failure happened — never derived from the wording of the reason.
 */
describe('which party failed', () => {
  it('is not_exposed when every candidate was requested and none was the document', () => {
    const [finding] = termsFindings(unreachable('no terms document was reached', SIX));

    expect(finding?.notEvaluableKind).toBe('not_exposed');
  });

  it('is not_retrieved when a candidate answered and the render then failed', () => {
    /*
      The case the probe made visible. Holding a 200 for a URL while reporting that the merchant
      did not carry the page is a report contradicting its own evidence (D-156).
    */
    const obstructedAttempts: readonly FetchAttempt[] = [
      ...SIX.slice(0, 4),
      { url: 'https://shop.example/legal', status: 200, error: 'page.goto: Timeout 30000ms exceeded' },
    ];
    const [finding] = termsFindings(
      unreachable('the terms document answered but could not be read', obstructedAttempts, true),
    );

    expect(finding?.notEvaluableKind).toBe('not_retrieved');
    // And it still carries what was tried — the kind changed, the obligation did not.
    expect(finding?.evidence[0]?.attempts).toHaveLength(5);
  });

  it('does not read the kind from the reason text', () => {
    // Hard constraint 9 in miniature: a reason mentioning a timeout must not by itself produce
    // `not_retrieved`, or every finding whose phrasing changed would be silently reclassified.
    const [finding] = termsFindings(
      unreachable('page.goto: Timeout 30000ms exceeded on every candidate', SIX),
    );

    expect(finding?.notEvaluableKind).toBe('not_exposed');
  });
});

describe('a surface that was reached is unaffected', () => {
  const page: PageContext = {
    requestedUrl: 'https://shop.example/terms',
    finalUrl: 'https://shop.example/terms',
    httpStatus: 200,
    title: 'Terms',
    text: 'Orders ship within 2 business days. Returns are accepted within 30 days.',
    html: '<html><body>Orders ship within 2 business days.</body></html>',
    htmlSha256: 'c'.repeat(64),
    footer: { found: false, text: '', styledText: [], locatedBy: '' },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: { found: false, locatedBy: '', text: '', blocksEntry: false },
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-08-29T00:00:00.000Z',
    screenshotKey: 'run-1/layer3/terms.png',
    domKey: 'run-1/layer3/terms.html',
  };

  it('still evaluates against the page, with its own capture', () => {
    // The change is to how an *unreached* surface reports. A reached one must resolve exactly as
    // it did — same finding, same evidence — since acquisition is unchanged.
    const [finding] = termsFindings(located(page, page.finalUrl, 'its path names the terms document'));

    expect(finding?.state).not.toBe('not_evaluable');
    expect(finding?.evidence[0]?.evidenceKey).toBe('run-1/layer3/terms.png');
  });
});

describe('every rule reading an unreached surface gets the evidence, not just one', () => {
  it.each(DOCUMENT_RULES)('attaches attempts to %s', (ruleId) => {
    const finding = run(unreachable('no document was reached', SIX)).findings.find(
      (f) => f.ruleId === ruleId,
    );

    expect(finding?.state, ruleId).toBe('not_evaluable');
    expect(finding?.evidence[0]?.attempts ?? [], ruleId).toHaveLength(6);
  });
});

/** Kept honest: the rule ids above must still exist and still read these surfaces. */
describe('the fixture tracks the rule set', () => {
  it.each([
    ['GATE-007', 'terms'],
    ['FULF-001', 'shipping_policy'],
    ['COMM-001', 'faq'],
  ])('%s is a layer 3 rule reading %s', (id, surface) => {
    // These assertions rest on which surface each rule declares. If the data moves, the fixture
    // above stops testing what it claims to and this says so rather than going quietly green.
    const rule = ruleset.rules.find((r: Rule) => r.id === id) as RuleOfType<'text_match'>;
    expect(rule.layer).toBe(3);
    expect(rule.params.surface).toBe(surface);
  });
});
