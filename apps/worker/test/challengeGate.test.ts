/**
 * What a challenged run does to the two gates downstream of the crawl (D-264).
 *
 *   - **`storefrontNotSeen`** decides whether a draft is generated at all, and — more usefully —
 *     what an operator is told to do next. The text-collapse message ends *"re-scan the merchant"*.
 *     Against bot protection that is advice which cannot work: the three phoenixpeptide runs of
 *     2026-09-09 were re-scans of each other, twenty and sixty seconds apart, and returned
 *     byte-identical finding counts.
 *   - **`establishDocument`** decides whether a Layer 3 surface was published. A challenge served
 *     at 200 clears every guard it has — the redirect rule, the path rule, the character floor —
 *     and would be established as the merchant's terms page.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyChallenge,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type PageContext,
  type SurfaceSpec,
} from '@mintro/engine';
import { storefrontNotSeen, type EvaluationInputs } from '../src/evaluateJob.js';
import { establishDocument } from '../src/locate.js';

const REPO_ROOT = resolve(dirname(), '../../..');
function dirname(): string {
  return resolve(fileURLToPath(import.meta.url), '..');
}

const INTERSTITIAL = readFileSync(
  resolve(REPO_ROOT, 'fixtures/challenges/cloudflare-interstitial-phoenixpeptide.html'),
  'utf8',
);

/** A run that read plenty of distinct pages, so only the challenge count can refuse it. */
const HEALTHY = {
  selectedCount: 40,
  distinctTexts: 12,
  dominantTextCount: 3,
  dominantTextSample: 'Research peptides for laboratory use',
};

/**
 * The inputs the guard reads, assembled the way the job assembles them (D-276).
 *
 * The challenge, gate and product-sample counts come off the **report** now rather than off
 * `pageStats`. They were optional fields on the stats, copied there by whoever built the inputs,
 * and only one of the two builders did the copying — so the dry run in `bin/evaluate.ts` reported
 * a challenged run as readable.
 *
 * `sample` defaults to a catalogue that was read, so a test about challenges is about challenges.
 */
const inputs = (
  stats: Record<string, unknown>,
  record: {
    readonly challenged?: number;
    readonly gated?: number;
    readonly inScope?: number;
    readonly served?: number;
  } = {},
): EvaluationInputs =>
  ({
    report: {
      sample: {
        productsInScope: record.inScope ?? 20,
        productsSampled: record.served ?? 20,
      },
      ...(record.challenged === undefined ? {} : { challenge: { challenged: record.challenged } }),
      ...(record.gated === undefined ? {} : { consentGate: { gated: record.gated } }),
    },
    pageStats: stats,
  }) as unknown as EvaluationInputs;

describe('a challenged run has not seen the storefront', () => {
  it('refuses even a run whose texts look healthy', () => {
    const message = storefrontNotSeen(inputs(HEALTHY, { challenged: 1 }));

    expect(message).not.toBeNull();
    expect(message).toContain('bot protection');
  });

  /*
    The advice, which is the reason this returns a message rather than a boolean. An operator
    reading "re-scan" against a challenge does the one thing that is guaranteed not to help.
  */
  it('does not tell the operator to re-scan', () => {
    const message = storefrontNotSeen(inputs(HEALTHY, { challenged: 9 })) ?? '';

    expect(message).toContain('a re-scan is not the repair');
    expect(message).toContain('nothing was established about this merchant');
  });

  it('leaves the text-collapse message alone on a run that met no challenge', () => {
    const collapsed = storefrontNotSeen(
      inputs(
        {
          selectedCount: 30,
          distinctTexts: 2,
          dominantTextCount: 28,
          dominantTextSample: 'Are you 21 or older?',
        },
        { challenged: 0 },
      ),
    );

    expect(collapsed).toContain('Re-scan the merchant');
    expect(collapsed).not.toContain('bot protection');
  });

  /*
    A run recorded before D-264 carries no count. Absent means *the distinction was not made*,
    never *nothing was challenged* — those runs are immutable and must behave exactly as they did
    (D-002).
  */
  it('passes a healthy run with no challenge record at all', () => {
    expect(storefrontNotSeen(inputs(HEALTHY))).toBeNull();
  });

  /*
    A gated run has not seen the storefront either, and the message must not read like a fault
    (D-266). Run 97bf366a served the gate at sixteen of sixteen product URLs, on a merchant who had
    just deployed close to the control the programme asks for.
  */
  it('refuses a gated run, and does not describe it as a shortfall', () => {
    const message = storefrontNotSeen(inputs(HEALTHY, { gated: 16 })) ?? '';

    expect(message).toContain('consent gate');
    expect(message).toContain('does not attest through it');
    expect(message).toContain('shortfall of the merchant');
    // Not bot protection. The two say opposite things about the merchant.
    expect(message).not.toContain('bot protection');
  });

  it('tells a gated run apart from a challenged one', () => {
    expect(storefrontNotSeen(inputs(HEALTHY, { challenged: 9 }))).toContain('bot protection');
    expect(storefrontNotSeen(inputs(HEALTHY, { gated: 9 }))).not.toContain('bot protection');
  });
});

describe('a challenge is not a published document', () => {
  const spec: SurfaceSpec = { label: 'terms document', pathNames: ['terms'] };

  function page(overrides: Partial<PageContext>): PageContext {
    return {
      requestedUrl: 'https://phoenixpeptide.com/terms',
      finalUrl: 'https://phoenixpeptide.com/terms',
      httpStatus: 200,
      title: 'Just a moment...',
      // Long enough to clear the 400-character floor on its own, which is the point: every
      // structural guard `establishDocument` has is satisfied by an interstitial served at 200.
      text: 'Just a moment... '.repeat(60),
      html: INTERSTITIAL,
      htmlSha256: 'd'.repeat(64),
      footer: MISSING_REGION,
      links: [],
      styledText: [],
      shop: NO_SHOP_STRUCTURE,
      footerPaymentTerms: [],
      gate: NO_GATE,
      selectorMatches: {},
      productTitle: '',
      capturedAt: '2026-09-09T20:18:41.000Z',
      ...overrides,
    };
  }

  const marker = classifyChallenge({ status: 200, body: INTERSTITIAL })?.marker;

  it('refuses an interstitial that clears every other guard, as our shortfall', () => {
    const located = establishDocument(
      'https://phoenixpeptide.com/terms',
      page({ challenged: marker as string, challengeKey: 'run/layer1/c.html' }),
      spec,
      [],
    );

    expect(located.located).toBe(false);
    if (located.located) return;
    expect(located.reason).toContain('bot protection');
    /*
      `obstructed`, and this is not a detail. It is what the caller reads to choose between
      `not_exposed` — *the merchant does not publish a terms page* — and a shortfall of ours
      (D-181). The flag defaults to false, so the first version of this branch said the merchant
      published nothing, on a request that was never answered by the merchant at all.
    */
    expect(located.obstructed).toBe(true);
  });

  /*
    The control, and it is what makes the assertion above mean something: the identical page
    without the classification **is** established as the merchant's terms document. That is the
    defect, stated as a test.
  */
  it('would have established it as the terms document without the classification', () => {
    const located = establishDocument('https://phoenixpeptide.com/terms', page({}), spec, []);

    expect(located.located).toBe(true);
  });
});
