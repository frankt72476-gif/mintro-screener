/**
 * The three answers a Layer 3 surface can give, as they reach a finding (D-265).
 *
 * `establishDocument` decides which party fell short; this is the other half — that the decision
 * survives into the `NotEvaluableKind` a reader sees. A flag nothing renders is a screen nobody
 * gets (D-246), and the version of this that only asserted the boolean would have passed while
 * `unreachedSurface` mapped every value onto `not_exposed`.
 *
 * Driven through `runLayer3` rather than through `unreachedSurface` directly, because the finding
 * is what the report carries and the mapping is what was wrong.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import {
  located,
  runLayer3,
  unreachable,
  NO_SIGNUP_FORM,
  type Finding,
  type Layer3Input,
  type PageContext,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const ATTEMPTS = [
  { url: 'https://phoenixpeptide.com/terms', status: 403 },
  { url: 'https://phoenixpeptide.com/terms-of-service', status: 403 },
];

/** Nothing reached, whatever the reason — the shape every surface below is in. */
const nothing = () => unreachable<PageContext>('nothing was reached', ATTEMPTS);

function run(terms: Layer3Input['terms']): readonly Finding[] {
  const input: Layer3Input = {
    signup: NO_SIGNUP_FORM,
    terms,
    shipping: nothing(),
    faq: nothing(),
    payment: nothing(),
  };
  // The terms rules are the ones that read `input.terms`; the rest of the layer is held constant.
  return runLayer3(input, ruleset).findings.filter(
    (finding) => finding.notEvaluableReason === (terms.located ? undefined : terms.reason),
  );
}

/** The kinds every terms-surface finding carried. One value, or the test is reading two surfaces. */
function kindsFor(terms: Layer3Input['terms']): Set<string | undefined> {
  const findings = run(terms);
  expect(findings.length, 'no terms finding was produced').toBeGreaterThan(0);
  return new Set(findings.map((finding) => finding.notEvaluableKind));
}

describe('which party a Layer 3 shortfall belongs to, as the reader sees it', () => {
  /*
    The default, and it must stay the default: the surface was read and did not carry what
    identifies it. That is a real observation about the merchant and the layer would be poorer
    without it.
  */
  it('reads a surface that was looked for and not found as the merchant’s', () => {
    expect(kindsFor(unreachable<PageContext>('no terms document was reached', ATTEMPTS))).toEqual(
      new Set(['not_exposed']),
    );
  });

  /*
    The eighteen findings in the corpus are this case, filed as the line above. A run that could
    not fetch the document says so, and a re-run may resolve it.
  */
  it('reads a shortfall of ours as not_retrieved', () => {
    expect(
      kindsFor(unreachable<PageContext>('no terms document was reached', ATTEMPTS, true)),
    ).toEqual(new Set(['not_retrieved']));
  });

  /*
    And the third answer, which had nowhere to land before this. Without it a challenged terms page
    reads as `not_retrieved` and tells an operator to re-scan — against bot protection, the one
    move that cannot work (D-264).
  */
  it('reads bot protection as challenged, not as either of the other two', () => {
    expect(
      kindsFor(
        unreachable<PageContext>(
          'no terms document was reached',
          ATTEMPTS,
          false,
          'cf-mitigated: challenge',
        ),
      ),
    ).toEqual(new Set(['challenged']));
  });

  /*
    The control. A surface that *was* established still produces real findings, so none of the
    above is passing because the layer refuses everything it is handed.
  */
  it('still evaluates a surface that was established', () => {
    const page: PageContext = {
      requestedUrl: 'https://shop.example/terms',
      finalUrl: 'https://shop.example/terms',
      httpStatus: 200,
      title: 'Terms',
      text: 'All products are sold for research use only and not for human consumption. '.repeat(8),
      html: '<html><body>terms</body></html>',
      htmlSha256: 'f'.repeat(64),
      footer: { found: false, text: '', styledText: [] },
      links: [],
      styledText: [],
      shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
      footerPaymentTerms: [],
      gate: { found: false, locatedBy: '', text: '', blocksEntry: false },
      selectorMatches: {},
      productTitle: '',
      capturedAt: '2026-09-09T20:18:41.000Z',
      domKey: 'run/layer3/terms.html',
      screenshotKey: 'run/layer3/terms.png',
    };

    const findings = runLayer3(
      {
        signup: NO_SIGNUP_FORM,
        terms: located(page, page.finalUrl, 'its path names the surface'),
        shipping: nothing(),
        faq: nothing(),
        payment: nothing(),
      },
      ruleset,
    ).findings;

    expect(findings.some((finding) => finding.state !== 'not_evaluable')).toBe(true);
  });
});
