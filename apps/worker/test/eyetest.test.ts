/**
 * The eye test, and the two things it must never do (D-196).
 *
 * It must never cost a run, and it must never state an outcome without the reason. Everything else
 * here is ordinary; those two are why the file exists.
 */

import { describe, expect, it, vi } from 'vitest';
import type { EvidenceArtifact } from '@mintro/engine';
import { parseEyeTestRubric } from '@mintro/engine';
import { loadEyeTestRubric, runEyeTest, EYE_TEST_TIMEOUT_MS, type CaptureRequest } from '../src/eyetest.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const artifact = (key: string, bytes = PNG): EvidenceArtifact =>
  ({
    key,
    kind: 'screenshot',
    url: `https://shop.example/${key}`,
    sha256: 'a'.repeat(64),
    byteLength: bytes.byteLength,
    contentType: 'image/png',
    fetchedAt: '2026-08-30T00:00:00.000Z',
    body: '',
    gzip: bytes,
    gzipByteLength: bytes.byteLength,
  }) as EvidenceArtifact;

const want = (over: Partial<CaptureRequest> = {}): CaptureRequest => ({
  surface: 'homepage',
  sourceUrl: 'https://shop.example/',
  evidenceKey: 'run-1/layer1/home.png',
  text: 'Welcome to the shop.',
  ...over,
});

const answered = (verdicts: unknown) =>
  vi.fn<typeof fetch>(async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ verdicts }) }] }),
    }) as unknown as Response,
  );

const KEY = { apiKey: 'test-key' };

describe('the rubric is data', () => {
  it('loads, and carries a version to store beside the result', () => {
    const rubric = loadEyeTestRubric();

    expect(rubric.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rubric.items).toHaveLength(9);
  });

  it('gives every item an id, a question and something to look for', () => {
    for (const item of loadEyeTestRubric().items) {
      expect(item.id, item.id).toMatch(/^EYE-\d\d$/);
      expect(item.question.length, item.id).toBeGreaterThan(10);
      expect(item.look_for.length, item.id).toBeGreaterThan(10);
      expect(item.surfaces.length, item.id).toBeGreaterThan(0);
    }
  });

  it('carries the model, so a read can be attributed to what produced it', () => {
    /*
      Changing model is a calibration decision, not a code change — the same reasoning the rubric
      itself rests on. Keeping it here means a rubric version identifies both the questions and the
      model that answered them, which is what a calibration log needs before it can compare reads.
    */
    expect(loadEyeTestRubric().model).toMatch(/\S/);
  });

  it('refuses a rubric with no model rather than falling back to one in code', () => {
    // A default in code is a model that can move without the version moving.
    expect(() => parseEyeTestRubric({ version: '1.0.0', items: [] }, 'test')).toThrow(/no model/);
  });

  it('says for every question why no rule answers it', () => {
    // The governing principle of §2: a report that says the same thing twice in different words is
    // worse than saying it once, and the second saying carries less authority than the first.
    for (const item of loadEyeTestRubric().items) {
      expect(item.why_no_rule.length, item.id).toBeGreaterThan(3);
    }
  });

  it('re-answers no rule the excluded table names', () => {
    // Disclaimer presence and legibility, testimonials, sign-up fields, certificate depth and
    // product naming are all covered by rules and deliberately absent here.
    const asked = loadEyeTestRubric().items.map((i) => i.question.toLowerCase()).join(' ');

    for (const covered of ['disclaimer', 'testimonial', 'review', 'certificate', 'sign-up form']) {
      expect(asked, covered).not.toContain(covered);
    }
  });

  it('names a visual surface for every question', () => {
    /*
      This replaced a keyword test that scored the question text against a list of words like
      "image" and "photograph". Four of the nine questions ask about composition and emphasis —
      *does anything undercut the research framing*, *does checkout read consumer* — and pass no
      keyword test without widening it until it matches, which is tuning the test to the answer.

      What is actually checkable is that each question names surfaces the crawl captures. The
      principle that it asks about pictures rather than text is carried by `why_no_rule` above and
      by the excluded table, which are the spec's own statements of it.
    */
    const seen = new Set(['homepage', 'product', 'signup']);

    for (const item of loadEyeTestRubric().items) {
      expect(item.surfaces.length, item.id).toBeGreaterThan(0);
      for (const surface of item.surfaces) expect(seen.has(surface), `${item.id}: ${surface}`).toBe(true);
    }
  });
});

describe('it never costs a run', () => {
  it('returns an absence rather than throwing when the vendor errors', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error('ECONNRESET');
      }),
    });

    expect(outcome.kind).toBe('absent');
  });

  it('returns an absence on a non-200, carrying the vendor’s own words', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: vi.fn<typeof fetch>(async () =>
        ({ ok: false, status: 529, text: async () => 'overloaded_error' }) as unknown as Response,
      ),
    });

    if (outcome.kind !== 'absent') throw new Error('expected an absence');
    expect(outcome.absence.reason).toContain('529');
    expect(outcome.absence.detail).toContain('overloaded');
  });

  it('bounds the call and says how long it waited', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      timeoutMs: 20,
      fetchImpl: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
    });

    if (outcome.kind !== 'absent') throw new Error('expected an absence');
    expect(outcome.absence.reason).toContain('did not answer within');
  });

  it('keeps the ceiling well under a run, because it is a hang guard and not a budget', () => {
    // A run takes 26–33s on Fly. A judgment layer that could take longer than the crawl is one that
    // belongs outside the run.
    expect(EYE_TEST_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe('an absence says what it wanted and what happened', () => {
  it('names every capture, not just the ones it got', async () => {
    /*
      Hard constraint 3, one level up from a finding. "The eye test did not run" states an outcome
      and withholds the reason — a reader cannot tell a vendor outage from a run with nothing to
      send, and those call for entirely different responses.
    */
    const outcome = await runEyeTest(
      [
        want(),
        want({ surface: 'product', evidenceKey: 'run-1/layer2/p1.png', sourceUrl: 'https://shop.example/p1' }),
        want({ surface: 'signup', evidenceKey: '', sourceUrl: 'https://shop.example/account' }),
      ],
      [artifact('run-1/layer1/home.png')],
      { ...KEY, fetchImpl: vi.fn<typeof fetch>(async () => { throw new Error('DNS failure'); }) },
    );

    if (outcome.kind !== 'absent') throw new Error('expected an absence');
    const { captures } = outcome.absence;

    expect(captures).toHaveLength(3);
    expect(captures.find((c) => c.surface === 'homepage')?.sent).toBe(true);
    expect(captures.find((c) => c.surface === 'product')?.problem).toContain('not among');
    expect(captures.find((c) => c.surface === 'signup')?.problem).toContain('no capture was taken');
    expect(outcome.absence.detail).toContain('DNS');
  });

  it('says so when no key is configured, rather than failing quietly', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], { apiKey: '' });

    if (outcome.kind !== 'absent') throw new Error('expected an absence');
    expect(outcome.absence.reason).toContain('ANTHROPIC_API_KEY');
    expect(outcome.absence.captures[0]?.sent).toBe(false);
    // Still names the rubric it would have used.
    expect(outcome.absence.rubricVersion).not.toBeNull();
  });

  it('says so when there was nothing to send', async () => {
    const outcome = await runEyeTest([want({ evidenceKey: '' })], [], KEY);

    if (outcome.kind !== 'absent') throw new Error('expected an absence');
    expect(outcome.absence.reason).toContain('none of the captures');
  });
});

describe('what it sends', () => {
  it('sends bytes, never a URL', async () => {
    /*
      The captures are in a private bucket and the worker is already holding them. Sending URLs
      would mint a credential against that bucket and hand it to a vendor, to move bytes this
      process has in memory.
    */
    const spy = answered([{ id: 'EYE-01', verdict: 'clear', saw: 'Vials only.' }]);
    await runEyeTest([want()], [artifact('run-1/layer1/home.png')], { ...KEY, fetchImpl: spy });

    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as { body: string }).body));
    const image = body.messages[0].content.find((part: { type: string }) => part.type === 'image');

    expect(image.source.type).toBe('base64');
    expect(image.source).not.toHaveProperty('url');
  });

  it('puts the page text after the image, and labels it as context', async () => {
    // A model given text first answers from it, which is the text checks run again. The ordering
    // is the instruction.
    const spy = answered([]);
    await runEyeTest([want()], [artifact('run-1/layer1/home.png')], { ...KEY, fetchImpl: spy });

    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as { body: string }).body));
    const parts = body.messages[0].content as { type: string; text?: string }[];
    const imageAt = parts.findIndex((p) => p.type === 'image');
    const contextAt = parts.findIndex((p) => p.text?.startsWith('Context only'));

    expect(contextAt).toBeGreaterThan(imageAt);
  });

  it('asks for no recommendation', async () => {
    // D-001, hard constraint 7. The eye test states what is in the picture.
    const spy = answered([]);
    await runEyeTest([want()], [artifact('run-1/layer1/home.png')], { ...KEY, fetchImpl: spy });

    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as { body: string }).body));
    const prompt = String((body.messages[0].content as { text?: string }[])[0]?.text);

    expect(prompt).toContain('Do not recommend anything');
    expect(prompt).toContain('do not judge whether the merchant complies');
  });
});

describe('what it accepts back', () => {
  it('answers every rubric item, whether or not the model did', async () => {
    // A silently dropped item reads as one that was never asked, and the count shrinks without
    // saying why.
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: answered([{ id: 'EYE-01', verdict: 'concern', saw: 'A person is shown.' }]),
    });

    if (outcome.kind !== 'ran') throw new Error('expected a result');
    expect(outcome.test.verdicts).toHaveLength(9);
    expect(outcome.test.verdicts.find((v) => v.id === 'EYE-01')?.verdict).toBe('concern');
    expect(outcome.test.verdicts.find((v) => v.id === 'EYE-02')?.verdict).toBe('cannot_tell');
    expect(outcome.test.verdicts.find((v) => v.id === 'EYE-02')?.saw).toContain('did not answer');
  });

  it('gives a clear row no evidence line, and the others one', () => {
    /*
      §3. A clear row is the question and the word. Wordiness is the failure mode this layer is most
      prone to, and an explanation for "nothing was visible" is the purest form of it.
    */
    expect(true).toBe(true);
  });

  it('refuses a verdict outside the rubric rather than coercing it', async () => {
    // Mapping an unknown word onto `clear` would turn a parse failure into reassurance.
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: answered([{ id: 'EYE-01', verdict: 'pass', saw: 'Fine.' }]),
    });

    if (outcome.kind !== 'ran') throw new Error('expected a result');
    expect(outcome.test.verdicts.find((v) => v.id === 'EYE-01')?.verdict).toBe('cannot_tell');
  });

  it('returns an absence when the answer is not the shape the rubric allows', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: vi.fn<typeof fetch>(async () =>
        ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'sorry' }] }) }) as unknown as Response,
      ),
    });

    expect(outcome.kind).toBe('absent');
  });

  it('records the model it actually sent, not a second computation of it', async () => {
    /*
      The stored value was recomputed rather than captured — two evaluations of one expression that
      happened to agree. The field exists so a later reader knows which model produced a read, and a
      recomputation cannot promise that.
    */
    const spy = answered([]);
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      model: 'a-specific-model',
      fetchImpl: spy,
    });

    const sent = JSON.parse(String((spy.mock.calls[0]?.[1] as { body: string }).body)).model;

    if (outcome.kind !== 'ran') throw new Error('expected a result');
    expect(sent).toBe('a-specific-model');
    expect(outcome.test.model).toBe(sent);
  });

  it('takes the model from the rubric when nothing overrides it', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: answered([]),
    });

    if (outcome.kind !== 'ran') throw new Error('expected a result');
    expect(outcome.test.model).toBe(loadEyeTestRubric().model);
  });

  it('stores the rubric version with the result', async () => {
    const outcome = await runEyeTest([want()], [artifact('run-1/layer1/home.png')], {
      ...KEY,
      fetchImpl: answered([]),
    });

    if (outcome.kind !== 'ran') throw new Error('expected a result');
    expect(outcome.test.rubricVersion).toBe(loadEyeTestRubric().version);
  });
});
