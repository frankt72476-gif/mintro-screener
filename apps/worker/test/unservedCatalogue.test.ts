/**
 * A catalogue nobody was served is a storefront nobody saw (D-276).
 *
 * ## Run 7c7600e1
 *
 * www.legendarypeptides.com, 2026-09-10. The crawl sampled eighteen product pages and **was served
 * none of them** — every product URL redirected to `/my-account/?redirect_to=…`, so eighteen
 * requests produced eighteen captures of one login form. The run's own record says so in the two
 * numbers this guard now reads:
 *
 *     productsInScope: 34
 *     productsSampled:  0
 *
 * A draft was generated anyway, and `evaluation_drafts` holds it. Six of the seven angles are about
 * the catalogue.
 *
 * ## Why the existing conditions could not have caught it
 *
 * They ask whether the pages *read* collapse to one document. The pages read here were the
 * homepage, the sign-up form, the terms and the shipping policy — the run names them itself — so
 * four distinct texts, no dominant one, a spread that looks healthy by every measure the text
 * conditions take.
 *
 * The eighteen identical product captures never reached those statistics: `selectPages` collapses
 * byte-identical texts into a single entry before counting. **The collapse that was the whole story
 * is the thing the statistics removed.** So this is asserted against healthy text stats rather than
 * against a reconstruction of the run's own — the claim is that the text conditions are irrelevant
 * here, and pairing the real record with the healthiest possible stats is what states it.
 *
 * The fixture is the run's record verbatim, as read from `runs.report` (D-106).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storefrontNotSeen, type EvaluationInputs } from '../src/evaluateJob.js';

interface RunRecord {
  readonly runId: string;
  readonly merchantDomain: string;
  readonly sample: { readonly productsInScope: number; readonly productsSampled: number };
  readonly access: { readonly wall: boolean; readonly note: string };
}

const RUN = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/evaluation/legendarypeptides-7c7600e1.json'), 'utf8'),
) as RunRecord;

/** Texts that pass both existing conditions comfortably. Nothing here can refuse a run. */
const HEALTHY_TEXTS = {
  selectedCount: 40,
  distinctTexts: 12,
  dominantTextCount: 3,
  dominantTextSample: 'Research peptides for laboratory use',
};

const inputs = (report: unknown): EvaluationInputs =>
  ({ report, pageStats: HEALTHY_TEXTS }) as unknown as EvaluationInputs;

describe('the run that started this', () => {
  it('is the record as stored, not a reconstruction', () => {
    expect(RUN.merchantDomain).toBe('www.legendarypeptides.com');
    expect(RUN.sample.productsInScope).toBe(34);
    expect(RUN.sample.productsSampled).toBe(0);
    // The crawl's own sentence about it, which is what makes the numbers legible.
    expect(RUN.access.note).toContain('were served to an anonymous request');
    expect(RUN.access.wall).toBe(true);
  });

  it('is refused, on its own record and healthy-looking texts', () => {
    const message = storefrontNotSeen(inputs(RUN)) ?? '';

    expect(message).toContain('did not see the storefront');
    expect(message).toContain('none of the 34 product page(s) in scope were served');
    expect(message).toContain('No prompt was sent');
  });

  /*
    And it does not read like a fault of the merchant's. A login wall is a control a business is
    entitled to have; what this reports is the limit of what Mintro saw (hard constraint 7).
  */
  it('describes the limit of the crawl, not a shortfall', () => {
    const message = storefrontNotSeen(inputs(RUN)) ?? '';

    expect(message).toContain('Nothing here is an observation about the merchant');
    expect(message).not.toMatch(/should|must|recommend|failed to/i);
  });
});

describe('what it does not refuse', () => {
  it('passes a run where one product page came back', () => {
    expect(
      storefrontNotSeen(inputs({ sample: { productsInScope: 34, productsSampled: 1 } })),
    ).toBeNull();
  });

  /*
    Zero of zero is a catalogue we never found, which is a different problem with a different
    answer — `assessWall` says so in those words, and naming it here would send an operator looking
    for a credential to fix a missing sitemap.
  */
  it('says nothing about a run whose catalogue was never found', () => {
    expect(
      storefrontNotSeen(inputs({ sample: { productsInScope: 0, productsSampled: 0 } })),
    ).toBeNull();
  });

  /*
    A run recorded before `sample` existed carries neither number. Absent means *the count was never
    taken*, never *nothing was served* — those runs are immutable and behave exactly as they did
    (D-002).
  */
  it('passes a run with no sample record at all', () => {
    expect(storefrontNotSeen(inputs({}))).toBeNull();
  });
});

describe('the record is read off the report, so both builders see it', () => {
  /*
    `challenged` and `gated` were optional fields on `pageStats`, copied there by whoever assembled
    the inputs — and only `evaluationRun` did the copying. The dry run in `bin/evaluate.ts` built
    the same inputs without them, so `--dry-run` over a challenged run printed a clean prompt and
    called the run readable. That is the one output its own comment says it must never produce.

    Reading all three off `inputs.report` is what makes the two paths agree, and these assert the
    guard now sees them there rather than on the stats.
  */
  it('refuses a challenged run from the report alone', () => {
    const message = storefrontNotSeen(inputs({ challenge: { challenged: 9 } })) ?? '';

    expect(message).toContain('bot protection');
  });

  it('refuses a gated run from the report alone', () => {
    const message = storefrontNotSeen(inputs({ consentGate: { gated: 16 } })) ?? '';

    expect(message).toContain('consent gate');
  });

  /*
    Ordering, stated because all three can be true at once. The unserved-catalogue sentence is the
    least specific of the three: a challenge and a gate each name who did what, and this one only
    says the pages did not arrive.
  */
  it('names the gate ahead of the unserved catalogue', () => {
    const message =
      storefrontNotSeen(
        inputs({
          consentGate: { gated: 16 },
          sample: { productsInScope: 34, productsSampled: 0 },
        }),
      ) ?? '';

    expect(message).toContain('consent gate');
    expect(message).not.toContain('in scope were served');
  });
});
