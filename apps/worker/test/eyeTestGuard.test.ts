/**
 * The eye test's model-authored copy is audited before it becomes report copy (D-224, D-001).
 *
 * Every other sentence in the report comes from a Mintro template. Two do not: the free-text
 * `read` paragraph and each verdict's `saw` line are written by a vision model, and they routed
 * through no guard at all — `auditCopy` and `FINDING_TERMS` appeared nowhere in the eye-test path.
 *
 * A model asked to describe a storefront can drift into judging one. *"This merchant is clearly
 * operating as a consumer storefront and should not be approved"* is a determination in Mintro's
 * document, forwarded to an underwriter under Mintro's name, and D-001 is that Mintro does not make
 * one. Nothing was in the way of it.
 *
 * ## The two things this must do at once
 *
 * Catch a determination, and **not** catch an impression. The eye test's whole job is impression —
 * *"reads as a consumer storefront"*, *"the palette suggests a clinic"* — and a guard that ate that
 * language would push the layer toward vaguer copy to stay clean, which is worse than no guard.
 *
 * Both directions are asserted, because only having the first would produce a guard that passes its
 * tests by flagging everything.
 */

import { describe, expect, it } from 'vitest';
import {
  DIRECTIVE_TERMS,
  DETERMINATION_TERMS,
  EYE_TEST_TERMS,
  FINDING_TERMS,
  IMPRESSION_VERBS,
  REMEDY_TERMS,
  VERDICT_TERMS,
  auditCopy,
  type EvidenceArtifact,
} from '@mintro/engine';
import { runEyeTest, type CaptureRequest } from '../src/eyetest.js';

/* ---------------------------------------------------------------------------------------------
 * What the eye test is audited against
 * ------------------------------------------------------------------------------------------- */

/** Sentences a vision model could plausibly write when it stops describing and starts judging. */
const DETERMINATIONS = [
  'This merchant is clearly operating as a consumer storefront and should not be approved.',
  'The storefront should be declined.',
  'We recommend declining this application.',
  'This merchant fails.',
  'The site fails the standard.',
  'This site is not legitimate.',
  'The merchant is high risk.',
  'This would be rejected by any underwriter.',
  'The site passes underwriting.',
  'Remove the lifestyle photography from the homepage.',
  'You should update the entry gate.',
];

/** Impression copy — what the layer exists to produce, and must keep producing. */
const IMPRESSIONS = [
  'The homepage reads as a consumer storefront rather than a research supplier.',
  'The design leans promotional; lifestyle photography dominates the hero.',
  'The palette and typography suggest a clinic rather than a laboratory supplier.',
  'The layout suggests a retail catalogue.',
  'The product page recommends a dosing protocol in its own copy.',
  'Nothing on the sampled pages advises the reader on administration.',
  'A discount badge and a bundle offer appear above the fold.',
  'The entry gate is present but can be dismissed by clicking away.',
  'The gate fails to stop a visitor who clicks outside it.',
  'Product photography shows vials and boxes, not people.',
  'The site presents itself as a supplier of research materials.',
];

describe('the guard catches a verdict', () => {
  it.each(DETERMINATIONS)('flags %s', (line) => {
    expect(auditCopy(line, EYE_TEST_TERMS).clean).toBe(false);
  });
});

describe('the guard does not eat an impression', () => {
  it.each(IMPRESSIONS)('passes %s', (line) => {
    const audit = auditCopy(line, EYE_TEST_TERMS);
    expect(audit.clean, `flagged ${audit.flagged.join(', ')}`).toBe(true);
  });

  /**
   * The measurement that decided the scoping, kept as an assertion.
   *
   * Three of these flag under `FINDING_TERMS`, and the third is the one that settles it: *"the
   * product page recommends a dosing protocol"* is an observation **about the merchant**, not
   * Mintro recommending anything. The eye test is audited against a narrowed set for that reason
   * and no other.
   */
  it('would have over-flagged under the unnarrowed finding terms', () => {
    const overFlagged = IMPRESSIONS.filter((line) => !auditCopy(line, FINDING_TERMS).clean);

    expect(overFlagged.length).toBeGreaterThan(0);
    expect(overFlagged).toContain('The product page recommends a dosing protocol in its own copy.');
  });
});

describe('narrowed, not weakened', () => {
  it('excludes only verbs that are also impression vocabulary', () => {
    // Every exclusion is a directive term, so nothing new was invented to drop.
    for (const verb of IMPRESSION_VERBS) expect(DIRECTIVE_TERMS).toContain(verb);
    // And they are excluded from the eye test alone: every Mintro-authored surface still has them.
    for (const verb of IMPRESSION_VERBS) expect(FINDING_TERMS).toContain(verb);
    for (const verb of IMPRESSION_VERBS) expect(EYE_TEST_TERMS).not.toContain(verb);
  });

  it('keeps every determination and remedy term', () => {
    // The narrowing touches the directive half only. A conclusion is a conclusion whoever wrote it.
    for (const term of DETERMINATION_TERMS) expect(EYE_TEST_TERMS).toContain(term);
    for (const term of REMEDY_TERMS) expect(EYE_TEST_TERMS).toContain(term);
  });

  /**
   * What the exclusions cost, bought back as phrases rather than words.
   *
   * Dropping bare `should` and `recommend` would let *"the storefront should be declined"* and
   * *"we recommend declining this application"* through. Each addition is checked to be doing work
   * no other term does — an addition that changes nothing is a term nobody can justify later.
   */
  it.each(VERDICT_TERMS)('%s catches something no other term does', (term) => {
    const without = EYE_TEST_TERMS.filter((candidate) => candidate !== term);
    expect(auditCopy(term, without).clean, `${term} is already covered`).toBe(true);
    expect(auditCopy(term, EYE_TEST_TERMS).clean).toBe(false);
  });

  it('names a merchant verdict without banning an honest one', () => {
    // `merchant fails` and `site fails`, never bare `fails`: the gate failing to stop a visitor is
    // an observation this layer exists to make.
    expect(EYE_TEST_TERMS).not.toContain('fails');
    expect(auditCopy('The gate fails to stop a visitor.', EYE_TEST_TERMS).clean).toBe(true);
    expect(auditCopy('This merchant fails.', EYE_TEST_TERMS).clean).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Through the eye test, which is where the copy becomes a report
 * ------------------------------------------------------------------------------------------- */

const capture = (): CaptureRequest => ({
  surface: 'homepage',
  sourceUrl: 'https://shop.example/',
  evidenceKey: 'run-1/layer1/home.png',
  text: 'A storefront.',
});

const artifact = (): EvidenceArtifact =>
  ({ key: 'run-1/layer1/home.png', kind: 'screenshot', gzip: Buffer.from('x'), contentType: 'image/png' }) as never;

/** Replies with the given read and verdicts, so the guard is exercised on real model output. */
function answering(read: string, verdicts: readonly unknown[]): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ read, verdicts }) }] }),
  })) as unknown as typeof fetch;
}

const run = (read: string, verdicts: readonly unknown[] = []) =>
  runEyeTest([capture()], [artifact()], { apiKey: 'k', fetchImpl: answering(read, verdicts) });

describe('a read that judges is withheld, and says so', () => {
  it('does not reach the report, and names what did it', async () => {
    const outcome = await run(
      'This merchant is clearly operating as a consumer storefront and should not be approved.',
    );

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    expect(outcome.test.read).toBe('');
    expect(outcome.test.readWithheld).toBeDefined();
    // `approved` is what catches it — the phrase form was redundant and was removed.
    expect(outcome.test.readWithheld).toContain('approved');
  });

  it('lets an impression through untouched', async () => {
    const impression =
      'The homepage reads as a consumer storefront. The palette suggests a clinic, and a discount badge sits above the fold.';
    const outcome = await run(impression);

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    expect(outcome.test.read).toBe(impression);
    expect(outcome.test.readWithheld).toBeUndefined();
  });

  /**
   * Per line, so one judged sentence does not cost the rest of the read.
   *
   * The verdict itself stands either way: it is a closed enum the rubric validates, and only the
   * model's prose is in question.
   */
  it('withholds one saw line and keeps the others', async () => {
    const outcome = await run('The homepage reads as a research supplier.', [
      { id: 'EYE-01', verdict: 'concern', saw: 'This merchant should be declined.' },
      { id: 'EYE-02', verdict: 'concern', saw: 'Benefit language occupies the top of the page.' },
    ]);

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    const first = outcome.test.verdicts.find((entry) => entry.id === 'EYE-01')!;
    const second = outcome.test.verdicts.find((entry) => entry.id === 'EYE-02')!;

    expect(first.saw).toBeUndefined();
    expect(first.sawWithheld).toContain('should be declined');
    expect(first.verdict).toBe('concern');

    expect(second.saw).toBe('Benefit language occupies the top of the page.');
    expect(second.sawWithheld).toBeUndefined();

    // And the read, which did not judge, is untouched.
    expect(outcome.test.read).toBe('The homepage reads as a research supplier.');
  });

  it('never carries both the line and the withholding', async () => {
    // A line that was withheld is not a line that was shown, and a renderer holding both would
    // have to choose.
    const outcome = await run('This site is not legitimate.', [
      { id: 'EYE-01', verdict: 'concern', saw: 'Remove the hero image.' },
    ]);

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    expect(outcome.test.read === '' && outcome.test.readWithheld !== undefined).toBe(true);
    for (const verdict of outcome.test.verdicts) {
      expect(verdict.saw !== undefined && verdict.sawWithheld !== undefined).toBe(false);
    }
  });

  it('covers every model-authored surface', async () => {
    /*
      Two, and only two. `id`, `question` and `looked_at` come from the rubric; `verdict` is a
      closed enum `isEyeVerdict` refuses outside the set. If a third model-authored field is ever
      added, this is what should fail.
    */
    const outcome = await run('This merchant fails.', [
      { id: 'EYE-01', verdict: 'concern', saw: 'The merchant is high risk.' },
    ]);

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    const modelAuthored = [
      outcome.test.read,
      ...outcome.test.verdicts.map((verdict) => verdict.saw ?? ''),
    ].filter((value) => value !== '');

    for (const value of modelAuthored) {
      expect(auditCopy(value, EYE_TEST_TERMS).clean, `unaudited copy reached the report: ${value}`).toBe(
        true,
      );
    }
    expect(outcome.test.readWithheld).toBeDefined();
    expect(outcome.test.verdicts[0]?.sawWithheld).toBeDefined();
  });
});
