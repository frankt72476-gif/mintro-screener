/**
 * Five questions added to the eye test, and the nine that were there are untouched (rubric 2.2.0).
 *
 * IQwallet reviewed a real screen and named judgment-level risks the rubric did not reach. They are
 * not rule-shaped — no pattern matches *"the copy addresses the reader as someone who will take
 * this"* — which is what the eye test is for. So the set grew from nine to fourteen.
 *
 * ## Add-only, and asserted rather than intended
 *
 * The nine are working and stored reads depend on them, so the first block pins every one of them
 * by id **and by text**. A reworded question is a different question answered under the same id,
 * and a calibration log comparing reads across versions could not tell that from a model changing
 * its mind. Pinning the ids alone would not catch it.
 *
 * ## What these cannot prove
 *
 * Not whether the model answers them *well*. That needs a live vision call against real captures,
 * an API key this environment does not have, and CoMo's screenshots, which are not in this
 * repository. What is proved here is mechanical and worth separating from calibration: the five
 * reach the model, they come back as verdict lines like any other, and the nine did not move.
 */

import { describe, expect, it } from 'vitest';
import { loadEyeTestRubric, runEyeTest, type CaptureRequest } from '../src/eyetest.js';
import type { EvidenceArtifact } from '@mintro/engine';

const rubric = loadEyeTestRubric();

/** The nine as they stood at rubric 2.1.0, transcribed from that version of the file. */
const NINE_AT_2_1_0: readonly (readonly [string, string])[] = [
  ['EYE-01', 'Does the homepage read as a research supplier or a consumer storefront?'],
  ['EYE-02', 'Do product pages lead with chemical data or with benefit language?'],
  ['EYE-03', 'Do photographs show the product, or people and bodies?'],
  ['EYE-04', 'Do any images show needles, syringes, measurement or dosing?'],
  ['EYE-05', 'Are there badges or marks implying medical endorsement?'],
  ['EYE-06', 'Does the design imitate a pharmacy or telehealth service?'],
  ['EYE-07', 'Does anything undercut the research framing?'],
  ['EYE-08', 'Does checkout read consumer — discounts, bundles, subscriptions?'],
  ['EYE-09', 'Does the entry gate read as a control or a formality?'],
];

const ADDED = ['EYE-10', 'EYE-11', 'EYE-12', 'EYE-13', 'EYE-14'] as const;

describe('the nine that were already there are untouched', () => {
  it.each(NINE_AT_2_1_0)('%s asks exactly what it asked at 2.1.0', (id, question) => {
    const item = rubric.items.find((candidate) => candidate.id === id);

    expect(item, `${id} left the rubric`).toBeDefined();
    // By text, not just by id: a reworded question under an old id is a different question that a
    // calibration log could not distinguish from the model changing its mind.
    expect(item!.question).toBe(question);
  });

  it('keeps them in their original order, ahead of the additions', () => {
    // Order is not load-bearing for the answer, but a reordered rubric reads as a rewritten one in
    // a diff, and the point of an add-only change is that the diff shows only what was added.
    expect(rubric.items.slice(0, 9).map((item) => item.id)).toEqual(
      NINE_AT_2_1_0.map(([id]) => id),
    );
  });

  it('recalibrates nothing about them', () => {
    // Every field, not only the question. `look_for` is what the model is actually steered by.
    const original = rubric.items.find((item) => item.id === 'EYE-07')!;
    expect(original.why_no_rule).toBe('the composition, which nothing can match on');
    expect(original.look_for).toContain('Not any single element — the composition.');
    expect(original.surfaces).toEqual(['homepage', 'product', 'signup']);
  });
});

describe('the five that were added', () => {
  it('carries all five, and nothing else new', () => {
    expect(rubric.items).toHaveLength(14);
    expect(rubric.items.slice(9).map((item) => item.id)).toEqual([...ADDED]);
  });

  it('moved the rubric version, which is what a stored read is traced by', () => {
    // D-002: stored reads keep 2.1.0 and the nine questions they were answered under. Only a fresh
    // run gets 2.2.0 and fourteen.
    expect(rubric.version).toBe('2.2.0');
  });

  it.each([
    ['EYE-10', 'addressed', /address|reader|researcher/i],
    ['EYE-11', 'editorial', /article|blog|topic/i],
    ['EYE-12', 'competitors', /seller|compar/i],
    ['EYE-13', 'register', /how-to|guidance|lay reader/i],
    ['EYE-14', 'catalogue framing', /grouping|categor|outcome/i],
  ])('%s asks about %s', (id, _label, pattern) => {
    const item = rubric.items.find((candidate) => candidate.id === id)!;
    expect(item.question).toMatch(pattern);
  });

  /**
   * The register the whole layer is written in (D-076).
   *
   * A question is a question. One phrased as a finding — *"the site hosts application editorial"* —
   * would put a determination in the rubric and the model would answer it as one.
   */
  it('asks questions rather than asserting findings', () => {
    for (const id of ADDED) {
      const item = rubric.items.find((candidate) => candidate.id === id)!;
      expect(item.question.endsWith('?'), `${id} is not phrased as a question`).toBe(true);
    }
  });

  /**
   * Only three surfaces are ever captured — homepage, product, sign-up.
   *
   * Two of the five ask about things that often live on a page the crawl never photographs: a blog,
   * a comparison page. Naming a surface the manifest does not produce would send nothing for the
   * question and guarantee a `cannot_tell`, so they are scoped to what is actually captured and the
   * rubric's note says the limit out loud.
   */
  it('names only surfaces the manifest actually captures', () => {
    const captured = new Set(['homepage', 'product', 'signup']);
    for (const item of rubric.items) {
      for (const surface of item.surfaces) {
        expect(captured.has(surface), `${item.id} names an uncaptured surface: ${surface}`).toBe(true);
      }
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * They reach the model, and they come back as lines
 * ------------------------------------------------------------------------------------------- */

const capture = (): CaptureRequest => ({
  surface: 'homepage',
  sourceUrl: 'https://shop.example/',
  evidenceKey: 'run-1/layer1/home.png',
  text: 'Train harder. Read our guides. Compare us to other sellers. Shop by goal: bulking.',
});

const artifact = (key: string): EvidenceArtifact =>
  ({ key, kind: 'screenshot', gzip: Buffer.from('x'), contentType: 'image/png' }) as never;

/** Captures the request body so the prompt can be inspected, and replies with `answers`. */
function stubbed(answers: readonly unknown[], seen: { body?: string }): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    seen.body = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ read: 'A storefront.', verdicts: answers }) }],
      }),
    };
  }) as unknown as typeof fetch;
}

describe('the five reach the model and return as verdict lines', () => {
  it('sends every added question in the prompt', async () => {
    const seen: { body?: string } = {};
    await runEyeTest([capture()], [artifact('run-1/layer1/home.png')], {
      apiKey: 'k',
      fetchImpl: stubbed([], seen),
    });

    expect(seen.body, 'no request was sent').toBeDefined();
    for (const id of ADDED) {
      expect(seen.body!.includes(id), `${id} never reached the model`).toBe(true);
    }
    // And the question text itself, not merely the id.
    expect(seen.body).toContain('Does the site name, compare itself to, or link other sellers?');
  });

  it('renders a concern and a clear from the added questions', async () => {
    const outcome = await runEyeTest([capture()], [artifact('run-1/layer1/home.png')], {
      apiKey: 'k',
      fetchImpl: stubbed(
        [
          { id: 'EYE-10', verdict: 'concern', saw: 'The homepage copy addresses the reader as someone who trains.' },
          { id: 'EYE-11', verdict: 'concern', saw: 'The navigation links a guides section naming compounds.' },
          { id: 'EYE-12', verdict: 'concern', saw: 'A comparison block names two other sellers.' },
          { id: 'EYE-13', verdict: 'concern', saw: 'A storage explainer is written as consumer how-to.' },
          { id: 'EYE-14', verdict: 'concern', saw: 'Collections are named for outcomes rather than compounds.' },
          { id: 'EYE-01', verdict: 'clear', saw: '' },
        ],
        {},
      ),
    });

    if (outcome.kind !== 'ran') throw new Error(`expected a read, got ${outcome.kind}`);

    for (const id of ADDED) {
      const line = outcome.test.verdicts.find((verdict) => verdict.id === id);
      if (line === undefined) throw new Error(`${id} produced no line`);
      expect(line.verdict).toBe('concern');
      expect((line.saw ?? '').length, `${id} carried no observed rationale`).toBeGreaterThan(0);
    }

    // A clear still answers, so the added questions cannot only produce concerns.
    expect(outcome.test.verdicts.find((verdict) => verdict.id === 'EYE-01')?.verdict).toBe('clear');
    expect(outcome.test.rubricVersion).toBe('2.2.0');
  });

  it('fills an added question the model skipped rather than dropping it', async () => {
    // The existing fill-in behaviour, asserted over the new ids: a question nobody answered is
    // `cannot_tell`, never absent and never `clear`.
    const outcome = await runEyeTest([capture()], [artifact('run-1/layer1/home.png')], {
      apiKey: 'k',
      fetchImpl: stubbed([{ id: 'EYE-10', verdict: 'concern', saw: 'Addressed as a user.' }], {}),
    });

    if (outcome.kind !== 'ran') throw new Error('expected a read');
    expect(outcome.test.verdicts).toHaveLength(14);
    for (const id of ['EYE-11', 'EYE-12', 'EYE-13', 'EYE-14']) {
      expect(outcome.test.verdicts.find((verdict) => verdict.id === id)?.verdict).toBe('cannot_tell');
    }
  });
});
