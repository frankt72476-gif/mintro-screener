/**
 * Cloudflare challenges are not pages (D-264).
 *
 * ## Driven from the interstitial the crawler actually stored
 *
 * `fixtures/challenges/cloudflare-interstitial-phoenixpeptide.html` is the homepage capture of run
 * `0003c814`, pulled out of the evidence bucket byte for byte. It is the document that produced
 * *"0 fail · 1 pass · 61 not evaluable"* on a run that never saw a page of the merchant's site, and
 * it is committed rather than synthesised because a hand-written interstitial would be a test of
 * what I imagine one looks like (D-106).
 *
 * ## The assertion that matters
 *
 * **No rule reaches `pass` against it.** Not *"the classifier recognises it"*, which is a fact
 * about one function, but the thing hard constraint 2 actually forbids — and asserted over every
 * rule of every layer the document could reach, so a check type added later is covered by the test
 * without anyone remembering to extend it.
 *
 * The counterfactual is asserted beside it: the same bytes, with the classification withheld, are
 * run back through the same rules. That is what makes this a regression test rather than a
 * restatement — without it the suite could stay green because the fixture happens to fail
 * everything anyway, and nobody would know which.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  CHALLENGE_REASON,
  checkHttpProbe,
  classifyChallenge,
  headerLookup,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  MISSING_REGION,
  runLayer1,
  runLayer2,
  type Finding,
  type PageContext,
  type ProbeResult,
  type SampledPage,
} from '../src/index.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const INTERSTITIAL = readFileSync(
  resolve(REPO_ROOT, 'fixtures/challenges/cloudflare-interstitial-phoenixpeptide.html'),
  'utf8',
);

/** The title Playwright read off that document, and the reason the diagnosis started there. */
const INTERSTITIAL_TITLE = 'Just a moment...';

/**
 * The page as the renderer would have built it from those bytes.
 *
 * `challenged` is **not set by hand**. It is whatever `classifyChallenge` returns over the same
 * inputs the renderer passes it — status, headers, title, document — so this fixture cannot assert
 * a classification the crawl would not make (D-026). Setting the flag directly would test that
 * `renderFailure` reads a boolean, which was never in doubt.
 */
function interstitialPage(options: { readonly classify: boolean } = { classify: true }): PageContext {
  const challenge = options.classify
    ? classifyChallenge({
        status: 403,
        header: headerLookup({ 'cf-mitigated': 'challenge', server: 'cloudflare' }),
        title: INTERSTITIAL_TITLE,
        body: INTERSTITIAL,
      })
    : null;

  return {
    requestedUrl: 'https://phoenixpeptide.com/',
    finalUrl: 'https://phoenixpeptide.com/',
    /*
      **200, not the 403 the run actually got.**

      Deliberate, and it is the whole strength of the test. A 403 is already refused by
      `isRendered`, so a fixture carrying one would pass this file with the challenge handling
      deleted — it would be testing `establishesAbsence`, which was never the gap. Cloudflare
      serves the same mitigation with a 200 on other configurations, and that is the response
      nothing in this crawl could have told apart from a storefront.
    */
    httpStatus: 200,
    title: INTERSTITIAL_TITLE,
    text: 'Just a moment... phoenixpeptide.com Verifying you are human.',
    html: INTERSTITIAL,
    htmlSha256: 'c'.repeat(64),
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-09T20:18:41.000Z',
    ...(challenge === null
      ? { domKey: 'run/layer1/dom.html', screenshotKey: 'run/layer1/shot.png' }
      : { challenged: challenge.marker, challengeKey: 'run/layer1/challenge.html' }),
  };
}

const sampleOf = (page: PageContext): SampledPage[] => [
  {
    selection: {
      url: { url: page.finalUrl, path: '/', segments: [], scope: 'products' },
      score: 10,
      slugClass: 'suspicious',
      reasons: [],
    } as unknown as SampledPage['selection'],
    page,
  },
];

/** Every finding any rule produces against this document, across the layers that see a page. */
function findingsAgainst(page: PageContext): readonly Finding[] {
  return [...runLayer1(page, ruleset).findings, ...runLayer2(sampleOf(page), ruleset).findings];
}

describe('the classifier, over the document the crawler stored', () => {
  it('recognises it from the document alone, with no headers at all', () => {
    // The case that matters for a stored capture and for a 200: the header is long gone, and the
    // interstitial has to be recognisable from what was retained.
    const verdict = classifyChallenge({ status: 200, body: INTERSTITIAL });

    expect(verdict).not.toBeNull();
    expect(verdict?.marker).toContain('/cdn-cgi/challenge-platform/');
  });

  it('recognises it from the title the renderer parsed', () => {
    expect(classifyChallenge({ status: 200, title: INTERSTITIAL_TITLE })?.marker).toContain(
      'Just a moment...',
    );
  });

  it('recognises it from the header, which is what the live response carried', () => {
    const verdict = classifyChallenge({
      status: 403,
      header: headerLookup({ 'cf-mitigated': 'challenge' }),
    });

    expect(verdict?.marker).toBe('cf-mitigated: challenge');
  });

  /*
    The negatives, which are the half that keeps this honest. A classifier that said yes to
    everything would satisfy every assertion above and would turn every refusal into a challenge —
    relabelling ordinary merchant behaviour as bot protection, in a document an underwriter reads.
  */
  it('does not call a bare 403 a challenge', () => {
    expect(classifyChallenge({ status: 403, body: '<html><body>Forbidden</body></html>' })).toBeNull();
  });

  it('does not call an ordinary storefront a challenge', () => {
    const storefront =
      '<html><head><title>Buy Peptides for Scientific Research</title></head>' +
      '<body><h1>Research peptides</h1><p>For research use only.</p></body></html>';

    expect(classifyChallenge({ status: 200, title: 'Buy Peptides', body: storefront })).toBeNull();
  });

  it('does not call a page a challenge for mentioning one in its copy', () => {
    // Merchant prose about bot protection is merchant prose. The markers are the vendor's own
    // script path and header, never words a shop could write about itself (hard constraint 9).
    const body = '<html><body><p>We use Cloudflare to keep the site up. Just a moment while we load.</p></body></html>';

    expect(classifyChallenge({ status: 200, title: 'About our site', body })).toBeNull();
  });
});

describe('no rule can pass against a challenge', () => {
  it('produces not one pass across every rule of every page layer', () => {
    const findings = findingsAgainst(interstitialPage());

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.filter((finding) => finding.state === 'pass')).toEqual([]);
    // Nor a fail. The document says nothing about this merchant in either direction, and a
    // confident negative drawn from an interstitial is the same defect wearing the other sign.
    expect(findings.filter((finding) => finding.state === 'fail')).toEqual([]);
  });

  it('files every one of them as challenged, naming the reason', () => {
    const findings = findingsAgainst(interstitialPage());
    const kinds = new Set(findings.map((finding) => finding.notEvaluableKind));

    expect(kinds).toEqual(new Set(['challenged']));
    for (const finding of findings) {
      expect(finding.notEvaluableReason, finding.ruleId).toBe(CHALLENGE_REASON);
    }
  });

  /*
    A `not_evaluable` has to evidence why (hard constraint 3), and here the why is a document we
    hold. The interstitial is citable — that is what `challengeKey` is for — and it is citable only
    from this finding, never as the capture behind a verdict.
  */
  it('cites the stored interstitial, and never as a page capture', () => {
    const page = interstitialPage();
    const findings = findingsAgainst(page);
    const cited = new Set(
      findings.flatMap((finding) => finding.evidence.map((entry) => entry.evidenceKey)),
    );

    expect(cited).toContain('run/layer1/challenge.html');
    expect(page.domKey).toBeUndefined();
    expect(page.screenshotKey).toBeUndefined();
  });

  /*
    ## The counterfactual

    The same bytes with the classification withheld. This is the state the crawler was in on
    2026-09-09, and it is what says the assertions above are load-bearing rather than incidental.
  */
  it('passed thirteen rules before the classification existed', () => {
    const unclassified = findingsAgainst(interstitialPage({ classify: false }));
    const passed = unclassified.filter((finding) => finding.state === 'pass');

    /*
      Thirteen `pass` findings and four `review`, drawn from a document nobody was ever served.

      It was twelve until PROD-016 got patterns in ruleset 3.10.0 (D-270). A rule that reads pages
      for a claim is a rule that can report a page clean, so gaining detection gained a way to be
      wrong about an interstitial — which is the point of keeping this count pinned rather than
      asserting `> 0`.

      Every one of the twelve is an `expect: absent` product rule reporting that it looked and
      found nothing prohibited — on a nine-kilobyte interstitial with no catalogue in it at all.
      That is hard constraint 2's worst bug, twelve times, and hard constraint 9's mechanism
      exactly: a search that never covered the space reporting the space as clean.

      **This is not what run 0003c814 produced**, and the difference is the point. That run's
      challenge came with a 403, so `isRendered` was already false and the page rules landed on
      `not_evaluable`; its single `pass` was GATE-002, which never touches a `PageContext`. These
      twelve are what the **200-served** form of the same mitigation would have produced, and
      nothing anywhere in the crawl would have caught it.

      Pinned to the exact count rather than `> 0`: a number that drifts is a rule set change, and
      it should be read by a person rather than absorbed by an inequality.
    */
    expect(passed.map((finding) => finding.ruleId)).toEqual([
      'OFFS-007',
      'PROD-005',
      'PROD-006',
      'PROD-007',
      'PROD-008',
      'PROD-009',
      'PROD-010',
      'PROD-011',
      'PROD-012',
      'PROD-013',
      'PROD-014',
      'PROD-016',
      'PROD-017',
    ]);
    expect(
      unclassified.some((finding) => finding.notEvaluableKind === 'challenged'),
      'nothing could name the challenge',
    ).toBe(false);
  });
});

/**
 * GATE-002 on run 0003c814, reproduced from the three probes it actually made.
 *
 * This is the `pass` — `critical`, `auto_fail`, a stopping condition — and it is the one place the
 * detection alone would not have stopped it: `http_probe` never sees a `PageContext`, so
 * `renderFailure` is not on its path. The handler had to be corrected as well.
 */
describe('GATE-002 against three challenged paths', () => {
  const rule = ruleset.rules.find((entry) => entry.id === 'GATE-002') as RuleOfType<'http_probe'>;

  const probed = (results: readonly Partial<ProbeResult>[]): Finding =>
    checkHttpProbe(rule, {
      results: results.map((result) => ({
        url: 'https://phoenixpeptide.com/collections/all',
        status: 403,
        finalUrl: 'https://phoenixpeptide.com/collections/all',
        fetchedAt: '2026-09-09T20:19:05.387Z',
        ...result,
      })),
      session: { mode: 'unauthenticated', origin: 'none' },
    });

  /** The three requests as the run recorded them, statuses and all. */
  const AS_RUN: readonly Partial<ProbeResult>[] = [
    { url: 'https://phoenixpeptide.com/collections/all' },
    { url: 'https://phoenixpeptide.com/products' },
    { url: 'https://phoenixpeptide.com/shop' },
  ].map((entry) => ({ ...entry, finalUrl: entry.url, challenged: 'cf-mitigated: challenge' }));

  it('does not pass, and names the challenge', () => {
    const finding = probed(AS_RUN);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('challenged');
    expect(finding.note).toContain(CHALLENGE_REASON);
  });

  /*
    The same three refusals with nothing marking them as challenges. This is the general defect
    underneath the specific one: `served` meant *answered with any status*, so three 403s were
    counted as paths that served content and did not match `fail_if_status`. The challenge
    classification is not what saves this case — the arithmetic is.
  */
  it('does not pass on three plain refusals either', () => {
    const finding = probed([
      { url: 'https://phoenixpeptide.com/collections/all', status: 403 },
      { url: 'https://phoenixpeptide.com/products', status: 401 },
      { url: 'https://phoenixpeptide.com/shop', status: 503 },
    ]);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
    expect(finding.note).toContain('refused the request');
  });

  /*
    The control. Without it every assertion here would hold against a handler that refused
    everything, which is the failure mode of a suite made only of negatives.
  */
  it('still passes when the origin says the paths do not exist', () => {
    const finding = probed([
      { url: 'https://shop.example/collections/all', status: 404, finalUrl: 'https://shop.example/collections/all' },
      { url: 'https://shop.example/products', status: 404, finalUrl: 'https://shop.example/products' },
      { url: 'https://shop.example/shop', status: 410, finalUrl: 'https://shop.example/shop' },
    ]);

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('do not exist on this site');
  });

  it('still fails when a path serves the catalogue to an anonymous visitor', () => {
    const finding = probed([
      { url: 'https://shop.example/collections/all', status: 200, finalUrl: 'https://shop.example/collections/all' },
      { url: 'https://shop.example/products', status: 404, finalUrl: 'https://shop.example/products' },
      { url: 'https://shop.example/shop', status: 404, finalUrl: 'https://shop.example/shop' },
    ]);

    expect(finding.state).toBe('fail');
  });
});
