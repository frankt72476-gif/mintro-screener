/**
 * The draft generator: the prompt it builds, and the three ways a generation ends (D-260).
 *
 * **No test here reaches the network.** Every case drives `generateDraft` with a fake `fetch`, and
 * the one that would have called the real API — the missing-key case — asserts that it does not.
 *
 * The prompt tests are the half that will still be true in a year. The guardrails and the angle
 * questions reach the model verbatim from `rules/angles.json`, and a paraphrase introduced here
 * would make the ratified wording and the sent wording two things that happen to agree — the defect
 * this repository has hit in four separate places.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadRulesetFile,
  loadAngleSetFile,
  ANGLES_PATH,
  LEGALITY_RULE_IDS,
  PLACEMENT_BY_SPECTRUM,
  SPECTRUM_IDS,
  PLACEMENT_IDS,
  type AngleSet,
} from '@mintro/ruleset';
import { PRICE_WORDS, type EvaluationDraft } from '@mintro/engine';
import {
  MAX_ATTEMPTS,
  MIN_DISTINCT_TEXTS,
  generateDraft,
  storeDraft,
  storefrontNotSeen,
  inputHash,
  parseDraft,
  promptFor,
  requestParts,
  runContextFor,
  type EvaluateResult,
  type EvaluationInputs,
} from '../src/evaluateJob.js';
import type { WorkerSupabase } from '../src/store/supabase.js';
import { estimateTokens } from '../src/evaluationPrompt.js';
import { sectionWords } from '../src/evaluationSchema.js';
import { buildHandles, toHandle, toId } from '../src/evaluationHandles.js';
import type { EvaluationPage } from '../src/evaluationPages.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const angles = loadAngleSetFile(ruleset, ANGLES_PATH);

const page = (surface: string, text: string, source: EvaluationPage['source'] = 'dom'): EvaluationPage => ({
  surface,
  sourceUrl: `https://shop.example/${surface}`,
  domKey: `run-1/layer1/${surface}.html`,
  text,
  source,
  truncated: false,
  originalLength: text.length,
});

/** A fixture run: two findings, one eye-test verdict, three pages. */
/** What state each rule reached in `INPUTS`, so the routing rows can agree with it (D-273). */
const INPUT_FINDING_RULES = new Map<string, string>([
  ['NAME-001', 'fail'],
  ['GATE-002', 'fail'],
]);

const INPUTS: EvaluationInputs = {
  report: {
    runId: '11111111-2222-4333-8444-555555555555',
    merchantDomain: 'shop.example',
    rulesetVersion: '3.9.0',
    eyeTestCaptures: [],
  } as unknown as EvaluationInputs['report'],
  findings: [
    {
      id: 'f-001',
      ruleId: 'NAME-001',
      title: 'No therapeutic categories',
      state: 'fail',
      note: 'The catalogue files products under a Weight Loss collection.',
      evidenceKey: 'run-1/layer0/aaa',
    },
    {
      id: 'f-002',
      ruleId: 'GATE-002',
      title: 'Products hidden until an account exists',
      state: 'fail',
      note: 'Product pages were served without an account.',
      evidenceKey: 'run-1/layer1/bbb.png',
    },
    /*
      A legality-tier finding, so the "citable from every angle" exemption is exercised rather than
      asserted over an empty list. `pass`, so the computed legality block stays clean and every
      fixture below keeps its free choice of recommendation.
    */
    {
      id: 'f-003',
      ruleId: 'PAY-001',
      title: 'No peer-to-peer payment methods named on public pages',
      state: 'pass',
      note: 'No CashApp, Venmo or Zelle wording was found.',
      evidenceKey: 'run-1/layer1/bbb.png',
    },
    /*
      A heavy rule that did **not** fail.

      Without one, "the context holds the heavy failures and only those" is only half a test: every
      heavy finding in the fixture would be a failure, so a context that ignored `state` entirely
      would produce the same set and pass. Confirmed by mutation — widening the filter to every
      heavy rule left the whole suite green until this row existed.
    */
    {
      id: 'f-004',
      ruleId: 'OFFS-002',
      title: 'No testimonials or outcome stories',
      state: 'not_evaluable',
      note: 'No page carrying testimonials was reached on this run.',
      evidenceKey: null,
    },
  ],
  evidence: [
    { key: 'run-1/layer0/aaa', kind: 'sitemap', url: 'https://shop.example/sitemap.xml' },
    { key: 'run-1/layer1/bbb.png', kind: 'screenshot', url: 'https://shop.example/' },
  ],
  eyeTest: [{ id: 'EYE-01', question: 'Does the homepage read as a research supplier?', verdict: 'concern', saw: 'A bundle banner.' }],
  pages: [page('homepage', 'Peptides for research use only.'), page('terms', 'Terms and conditions.')],
  pageTruncations: ['product https://shop.example/p/1: 9000 characters cut to 3000'],
  // A run that saw the storefront: several distinct texts, nothing dominating.
  pageStats: { selectedCount: 6, distinctTexts: 6, dominantTextCount: 1, dominantTextSample: '' },
};

/**
 * The handles this run issues, derived the same way the job derives them.
 *
 * The model answers in handle space and the job decodes before validating, so a fixture written
 * in real ids would be testing a path that no longer exists.
 */
const HANDLES = buildHandles(runContextFor(angles, ruleset, INPUTS));
const H = (kind: string, id: string): string => toHandle(HANDLES, kind, id);

/** A draft that passes the validator against `INPUTS`, in handle space. */
/**
 * A citation the given angle may carry.
 *
 * Derived from the angle set rather than listed, so the fixture keeps working when a rule moves
 * between angles — the thing being tested is the validator, not this file's memory of the data.
 */
function citableBy(angleId: string): { kind: 'finding' | 'eye_test'; ref: string } {
  const declared = angles.angles.find((a) => a.id === angleId)?.ruleIds ?? [];
  const finding = INPUTS.findings.find((f) => declared.includes(f.ruleId));
  return finding === undefined
    ? { kind: 'eye_test', ref: H('eye_test', 'EYE-01') }
    : { kind: 'finding', ref: H('finding', finding.id) };
}

function validDraft(): EvaluationDraft {
  return {
    placement: {
      spectrum: 'consumer_leaning',
      recommended: 'referred_out',
      paragraph: 'The catalogue is organised by outcome and there is no gate.',
      citations: [
        { kind: 'angle', ref: H('angle', 'products_for') },
        { kind: 'angle', ref: H('angle', 'who_it_lets_buy') },
      ],
    },
    legality: { clean: true, items: [] },
    /*
      Each row says what this fixture's findings support (D-273).

      It used to write `not_observable` on every condition, and that is now a refusal rather than a
      neutral default: `f-002` is GATE-002 at `fail`, which feeds `registration_gate`, so this
      fixture was asserting a draft is valid while a row reported a condition unobserved over a rule
      that observed a violation. The other conditions have no findings here, and unobserved is what
      no feeders means.
    */
    routing: angles.routingConditions.map((c) => ({
      conditionId: c.id,
      status: (c.ruleIds.some((id) => INPUT_FINDING_RULES.get(id) === 'fail')
        ? 'not_met'
        : 'not_observable') as 'not_met' | 'not_observable',
      citations: [],
    })),
    /*
      Each angle cites what it is allowed to cite.

      `f-001` is NAME-001 and `f-002` is GATE-002, and the angle set gives each to exactly one
      angle; the rest cite the eye-test verdict, which no angle is scoped out of. A fixture that
      gave every angle `f-001` — as this one used to — is refused now, correctly: six of the seven
      do not read that rule.
    */
    angles: angles.angles.map((a) => ({
      angleId: H('angle', a.id),
      lean: 'consumer' as const,
      paragraph: 'The catalogue is organised by outcome.',
      citations: [citableBy(a.id)],
    })),
    shoreUps: [],
  };
}

/** A fake Messages API returning the given bodies in order. */
function fakeFetch(bodies: readonly unknown[]): {
  impl: typeof fetch;
  calls: string[];
  requests: Record<string, any>[];
} {
  const calls: string[] = [];
  const requests: Record<string, any>[] = [];
  let index = 0;
  const impl = (async (_url: string, init?: { body?: string }) => {
    const sent = JSON.parse(init?.body ?? '{}');
    requests.push(sent);
    calls.push(sent.messages?.[0]?.content?.[0]?.text ?? '');
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(body) }],
      }),
      text: async () => '',
    };
  }) as unknown as typeof fetch;
  return { impl, calls, requests };
}

describe('the prompt', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);

  it('carries every guardrail verbatim from the file', () => {
    for (const guardrail of angles.guardrails) {
      expect(prompt, `missing guardrail: ${guardrail}`).toContain(guardrail);
    }
  });

  it('carries every angle, with its question and reasoning verbatim', () => {
    for (const angle of angles.angles) {
      // Headed by handle, not by id: handles are sorted, so `A1` is not "Angle 1", and printing
      // both would put a mismatch in front of the model at every citation site.
      expect(prompt, `missing the handle for ${angle.id}`).toContain(`### ${H('angle', angle.id)} —`);
      expect(prompt, `missing the title for ${angle.id}`).toContain(angle.title);
      expect(prompt, `missing the question for ${angle.id}`).toContain(angle.question);
      expect(prompt, `missing the reasoning for ${angle.id}`).toContain(angle.reasoning);
    }
  });

  it('carries every routing condition, with its label', () => {
    for (const condition of angles.routingConditions) {
      expect(prompt).toContain(condition.id);
      expect(prompt).toContain(condition.label);
    }
    expect(angles.routingConditions).toHaveLength(5);
  });

  it('carries the spectrum and the placements', () => {
    for (const entry of angles.spectrum) expect(prompt).toContain(entry.id);
    for (const placement of PLACEMENT_IDS) expect(prompt).toContain(placement);
  });

  it('files each finding under the angle that reads it, with its id and heavy marker', () => {
    // NAME-001 feeds products_for and is heavy; the model needs both facts to weigh it.
    const productsFor = prompt.slice(prompt.indexOf(`### ${H('angle', 'products_for')} —`));
    expect(productsFor).toContain(H('finding', 'f-001'));
    expect(productsFor).toContain('[HEAVY]');
  });

  it('carries the page text and says where each page came from', () => {
    expect(prompt).toContain('Peptides for research use only.');
    expect(prompt).toContain('homepage — https://shop.example/homepage');
    expect(prompt).toContain('terms — https://shop.example/terms');
  });

  it('declares what it was not shown', () => {
    expect(prompt).toContain('What you were not shown');
    expect(prompt).toContain('9000 characters cut to 3000');
    expect(prompt).toContain('An absence of observation is not an observation of absence');
  });

  /*
    The fixed text of the prompt carries no price word. The angle *notes* legitimately do — angle 3
    is about the merchant's own pricing posture — so the assertion is on what this module writes,
    not on what the data says.
  */
  /*
    The one place the prompt says a price word is the sentence telling the model not to use them in
    the placement. That sentence has to name them to forbid them, so it is excluded by locating it
    structurally rather than by relaxing the rule — and asserted to exist, so the exclusion cannot
    quietly become a hole.
  */
  it('introduces no price word of its own, outside the sentence that forbids them', () => {
    const fromData = [
      ...angles.angles.map((a) => `${a.notes} ${a.reasoning} ${a.question}`),
      ...angles.guardrails,
      ...angles.routingConditions.map((c) => c.label),
    ].join(' ');

    const written = promptFor(angles, ruleset, { ...INPUTS, pages: [], findings: [], eyeTest: [] });
    const guidance = '**In this paragraph, do not use the words price, pricing, cost, fee, discount or rate.**';
    expect(written, 'the guidance sentence is missing').toContain(guidance);

    const rest = written.split(guidance).join(' ');
    for (const word of PRICE_WORDS) {
      const inData = new RegExp(`\\b${word}\\b`, 'i').test(fromData);
      if (inData) continue;
      expect(new RegExp(`\\b${word}\\b`, 'i').test(rest), `prompt introduces '${word}'`).toBe(false);
    }
  });

  it('states the eye-test absence rather than leaving it silent', () => {
    const absent = promptFor(angles, ruleset, {
      ...INPUTS,
      eyeTest: [],
      eyeTestAbsence: 'the worker holds no API key',
    });
    expect(absent).toContain('The eye test did not run on this run');
    expect(absent).toContain('the worker holds no API key');
    expect(absent).toContain('Do not infer from its absence');
  });

  it('appends the validator message on a retry, and not otherwise', () => {
    expect(prompt).not.toContain('Your previous answer was refused');
    const retried = promptFor(angles, ruleset, INPUTS, 'cites finding f-999');
    expect(retried).toContain('Your previous answer was refused');
    expect(retried).toContain('f-999');
  });

  it('estimates a token count without calling anything', () => {
    expect(estimateTokens(prompt)).toBe(Math.ceil(prompt.length / 4));
    expect(estimateTokens(prompt)).toBeGreaterThan(0);
  });
});

describe('the run context the validator is given', () => {
  it('is the ids this run actually holds', () => {
    const run = runContextFor(angles, ruleset, INPUTS);
    expect([...run.findingIds]).toEqual(INPUTS.findings.map((f) => f.id));
    expect(run.eyeTestItemIds.has('EYE-01')).toBe(true);
    expect(run.angleIds).toHaveLength(7);
    expect(run.routingConditionIds).toHaveLength(5);
    expect(run.consumerSideSpectrum.has('consumer_retail')).toBe(true);
  });
});

describe('the input hash', () => {
  it('is stable over the same inputs', () => {
    expect(inputHash(angles, INPUTS)).toBe(inputHash(angles, INPUTS));
  });

  /*
    The hash is what makes two drafts comparable. If page text moved without it moving, an operator
    would compare two drafts built over different sites and read the difference as the model
    changing its mind.
  */
  it('moves when the page text moves', () => {
    const changed = { ...INPUTS, pages: [page('homepage', 'Different text entirely.')] };
    expect(inputHash(angles, changed)).not.toBe(inputHash(angles, INPUTS));
  });

  it('moves when a finding moves', () => {
    const changed = {
      ...INPUTS,
      findings: [{ ...INPUTS.findings[0]!, note: 'A different observation.' }],
    };
    expect(inputHash(angles, changed)).not.toBe(inputHash(angles, INPUTS));
  });
});

describe('generateDraft', () => {
  it('stores a valid draft on the first answer', async () => {
    const { impl, calls } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(result.draft?.angles).toHaveLength(7);
    // Decoded: the stored draft carries real ids, whatever the model wrote.
    const products = result.draft?.angles.find((a) => a.angleId === 'products_for');
    expect(products?.citations[0]?.ref).toBe('f-001');
    expect(angles.angles.map((a) => a.id)).toContain(result.draft?.angles[0]?.angleId);
    expect(result.handles?.finding[H('finding', 'f-001')]).toBe('f-001');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('Your previous answer was refused');
  });

  /*
    The retry path. The first answer cites a finding the run does not hold; the validator's own
    words go back to the model, and the second answer is accepted. The message is an input to the
    retry, not an error to log.
  */
  it('retries once with the rejection appended, and accepts the second answer', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      angles: bad.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'F999' }] } : a,
      ),
    };
    const { impl, calls } = fakeFetch([invalid, validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('Your previous answer was refused');
    // The handle it invented, in the words it used — not a real id it never wrote.
    expect(calls[1]).toContain('F999');
  });

  it('stores a rejected draft after two refusals, with the reason', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      // One valid handle, so it decodes cleanly and fails on the two-distinct-angles rule rather
      // than on the handle check — this test is about the validator, not the decode.
      placement: {
        ...bad.placement,
        citations: [{ kind: 'angle' as const, ref: H('angle', 'products_for') }],
      },
    };
    const { impl, calls } = fakeFetch([invalid, invalid]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.attempts).toBe(MAX_ATTEMPTS);
    expect(result.message).toContain('distinct angle');
    // The refused document is kept, so an operator can repair it rather than regenerate.
    expect(result.draft).toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it('does not try a third time', async () => {
    const bad = validDraft();
    const invalid = { ...bad, placement: { ...bad.placement, citations: [] } };
    const { impl, calls } = fakeFetch([invalid, invalid, validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(calls).toHaveLength(2);
  });

  it('fails without calling anything when no key is configured', async () => {
    const { impl, calls } = fakeFetch([validDraft()]);
    const key = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const result = await generateDraft(angles, ruleset, INPUTS, { fetchImpl: impl });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('ANTHROPIC_API_KEY');
      expect(calls).toHaveLength(0);
    } finally {
      if (key !== undefined) process.env['ANTHROPIC_API_KEY'] = key;
    }
  });

  it('records a vendor refusal as failed, with the status', async () => {
    const impl = (async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('429');
  });

  /*
    A cut-off answer is its own cause. Without this it falls through to the parse failure, and the
    row would say the model answered in a disallowed shape — true of the bytes and false about what
    happened. Only one of the two is fixed by raising `max_tokens`.
  */
  it('records a cut-off answer as cut off, not as malformed', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"placement"' }] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('cut off');
  });

  it('carries the input hash and the truncations onto every result', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.truncations).toEqual(INPUTS.pageTruncations);
  });
});

describe('parseDraft', () => {
  it('reads the document out of a fenced answer', () => {
    const payload = {
      content: [{ type: 'text', text: 'Here it is:\n```json\n' + JSON.stringify(validDraft()) + '\n```' }],
    };
    expect(parseDraft(payload)?.angles).toHaveLength(7);
  });

  it('refuses prose with no document', () => {
    expect(parseDraft({ content: [{ type: 'text', text: 'I cannot do that.' }] })).toBeNull();
  });

  it('refuses a document missing a whole section', () => {
    const { shoreUps: _dropped, ...partial } = validDraft();
    const payload = { content: [{ type: 'text', text: JSON.stringify(partial) }] };
    expect(parseDraft(payload)).toBeNull();
  });
});

describe('the cross-cutting angle is not an empty one', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);
  const block = prompt.slice(
    prompt.indexOf(`### ${H('angle', 'consistency')} —`),
    prompt.indexOf('## Routing conditions'),
  );

  /*
    Angle 7 declares no rules by design — it sets what the other six found against the site's own
    research-only statements. It used to render the same "(nothing observed)" line an angle with a
    genuinely blank run would get, which is false about this angle and points the model straight at
    `nothingObserved: true`. Two different facts; they must not share a sentence.
  */
  it('does not tell the model nothing was observed', () => {
    expect(block).not.toContain('nothing observed feeds this angle');
  });

  it('tells the model to draw on the other angles', () => {
    expect(block).toContain('Draw on the angles above');
    expect(block).toContain('declares no evidence of its own');
    expect(block).toContain('not the same as nothing having been observed');
  });

  it('points at the research-only statements through the angle notes, not a hardcoded list', () => {
    // The rule ids live in the data. The prompt builder names none of them.
    const notes = angles.angles.find((a) => a.id === 'consistency')?.notes ?? '';
    expect(notes).toContain('DISC-001');
    expect(notes).toContain('DISC-002');
    expect(notes).toContain('DISC-003');
    expect(block).toContain(notes);
    expect(block).toContain("named in this angle's Notes");
  });

  it('still allows nothingObserved, but only for the right reason', () => {
    expect(block).toContain('only if the angles above produced nothing');
  });

  it('leaves an ordinary angle rendering its evidence list', () => {
    const other = prompt.slice(
      prompt.indexOf(`### ${H('angle', 'products_for')} —`),
      prompt.indexOf(`### ${H('angle', 'how_it_sells')} —`),
    );
    expect(other).toContain('- finding ');
    expect(other).not.toContain('Draw on the angles above');
  });
});

describe('the storefront-not-seen guard', () => {
  const stats = (over: Partial<EvaluationInputs['pageStats']>): EvaluationInputs['pageStats'] => ({
    selectedCount: 20,
    distinctTexts: 18,
    dominantTextCount: 2,
    dominantTextSample: '',
    ...over,
  });

  it('passes a run that saw a storefront', () => {
    expect(storefrontNotSeen(stats({}))).toBeNull();
  });

  it('refuses a run with fewer than three distinct texts', () => {
    const message = storefrontNotSeen(stats({ selectedCount: 2, distinctTexts: 2, dominantTextCount: 1 }));
    expect(message).toContain('did not see the storefront');
    expect(message).toContain('only 2 distinct page text(s)');
  });

  it('accepts exactly three, which is the floor', () => {
    expect(
      storefrontNotSeen(stats({ selectedCount: 6, distinctTexts: MIN_DISTINCT_TEXTS, dominantTextCount: 2 })),
    ).toBeNull();
  });

  /*
    Run 97bf366a in numbers: thirty pages selected, three distinct texts, twenty-eight of them the
    same age-gate interstitial. The distinct-text floor alone would have let it through — three is
    three — which is why the dominance condition exists.
  */
  it('refuses the shape run 97bf366a actually had', () => {
    const message = storefrontNotSeen(
      stats({
        selectedCount: 30,
        distinctTexts: 3,
        dominantTextCount: 28,
        dominantTextSample: 'CoMo Peptides Site entry Laboratory research materials supplier',
      }),
    );
    expect(message).toContain('one text accounted for 28 of the 30 pages');
    expect(message).toContain('CoMo Peptides Site entry');
    expect(message).toContain('Re-scan the merchant');
  });

  it('draws the dominance line at exactly half', () => {
    expect(storefrontNotSeen(stats({ selectedCount: 10, distinctTexts: 6, dominantTextCount: 5 }))).toBeNull();
    expect(storefrontNotSeen(stats({ selectedCount: 10, distinctTexts: 6, dominantTextCount: 6 }))).not.toBeNull();
  });

  it('says so when no text was read at all', () => {
    const message = storefrontNotSeen(stats({ selectedCount: 4, distinctTexts: 0, dominantTextCount: 1 }));
    expect(message).toContain('(no text was read)');
  });
});

describe('generateDraft refuses a run that did not see the storefront', () => {
  const blind: EvaluationInputs = {
    ...INPUTS,
    pageStats: {
      selectedCount: 30,
      distinctTexts: 3,
      dominantTextCount: 28,
      dominantTextSample: 'CoMo Peptides Site entry Laboratory research materials supplier',
    },
  };

  it('calls nothing and returns the dedicated status', async () => {
    const { impl, calls } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, blind, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('run_did_not_see_storefront');
    expect(result.attempts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.draft).toBeUndefined();
    expect(result.message).toContain('28 of the 30 pages');
  });

  /*
    The guard runs before the key is looked for. A run that did not see the storefront is not a
    configuration problem, and reporting it as one would send an operator to check an env var.
  */
  it('reports the run, not a missing key, when both are true', async () => {
    const key = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const result = await generateDraft(angles, ruleset, blind, {});
      expect(result.status).toBe('run_did_not_see_storefront');
      expect(result.message).not.toContain('ANTHROPIC_API_KEY');
    } finally {
      if (key !== undefined) process.env['ANTHROPIC_API_KEY'] = key;
    }
  });

  it('still carries the input hash, so the refusal is attributable to these inputs', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, blind, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('token usage is carried off the response', () => {
  it('reports what the vendor said', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 20_400, output_tokens: 1_850 },
        content: [{ type: 'text', text: JSON.stringify(validDraft()) }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.usage).toEqual({ inputTokens: 20_400, outputTokens: 1_850 });
  });

  it('omits usage rather than inventing zeros when the response carries none', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.usage).toBeUndefined();
  });
});

describe('a rejected draft reports what it cost', () => {
  /*
    The first real generation against run 9011b2d7 was rejected twice and the row recorded no
    spend, so "what did this run cost" had no answer. Two full generations is not free, and a
    refusal that hides the bill is the same shape as an outcome that hides its reason.
  */
  it('carries the usage from the last answer', async () => {
    const bad = validDraft();
    const invalid = { ...bad, placement: { ...bad.placement, citations: [] } };
    let call = 0;
    const impl = (async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'end_turn',
          usage: { input_tokens: 21_000, output_tokens: 1_000 * call },
          content: [{ type: 'text', text: JSON.stringify(invalid) }],
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.status).toBe('rejected');
    // The second attempt's usage, not the first: what it cost last is what the row should say.
    expect(result.usage).toEqual({ inputTokens: 21_000, outputTokens: 2_000 });
  });

  it('carries usage onto a cut-off too, with the effort that produced it', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stop_reason: 'max_tokens',
        usage: { input_tokens: 20_000, output_tokens: 32_000 },
        content: [{ type: 'text', text: '{"placement"' }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result.status).toBe('failed');
    expect(result.usage).toEqual({ inputTokens: 20_000, outputTokens: 32_000 });
    expect(result.message).toContain('output tokens spent');
    expect(result.message).toContain('effort');
  });
});

describe('the request carries the run-scoped schema', () => {
  it('sends effort and a json_schema format together', async () => {
    const { impl, requests } = fakeFetch([validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const config = requests[0]!['output_config'];
    expect(config.effort).toBe('medium');
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema.type).toBe('object');
  });

  /*
    The point of the whole change. The first real generation invented finding `fdd0000-0000` twice;
    an enum of the run's own ids makes that unrepresentable rather than merely refused.
  */
  it('constrains citations to the ids this run holds', async () => {
    const { impl, requests } = fakeFetch([validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const schema = requests[0]!['output_config'].format.schema;
    // Handles, not uuids: the real ids never reach the model or the schema.
    expect(schema.$defs.findingId.enum).toEqual(INPUTS.findings.map((f) => H('finding', f.id)));
    expect(JSON.stringify(schema)).not.toContain('f-001');
    expect(JSON.stringify(schema)).not.toContain('fdd0000-0000');
  });

  it('offers the angle citation on the placement and nowhere else', async () => {
    const { impl, requests } = fakeFetch([validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const schema = requests[0]!['output_config'].format.schema;
    const refs = (node: any) => node.anyOf.map((e: any) => e.$ref);
    expect(refs(schema.properties.placement.properties.citations.items)).toContain('#/$defs/angleRef');
    expect(refs(schema.properties.angles.items.properties.citations.items)).not.toContain(
      '#/$defs/angleRef',
    );
  });

  it('sends no keyword outside the supported subset', async () => {
    const { impl, requests } = fakeFetch([validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    // Two 400s were spent learning this. The assertion is on the request actually sent.
    const sent = JSON.stringify(requests[0]!['output_config'].format.schema);
    for (const banned of ['"maxItems"', '"oneOf"', '"minLength"', '"minimum"']) {
      expect(sent, `sends ${banned}`).not.toContain(banned);
    }
  });

  it('sends the same schema on the retry, so a rejection cannot widen it', async () => {
    const bad = validDraft();
    const invalid = { ...bad, placement: { ...bad.placement, citations: [] } };
    const { impl, requests } = fakeFetch([invalid, validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!['output_config'])).toBe(
      JSON.stringify(requests[0]!['output_config']),
    );
  });

  /*
    The schema is the cheap guard, not the only one. A model that returned a shape the schema
    somehow admitted still meets the validator — here, shore-ups on a consumer placement.
  */
  it('still runs validateDraft over whatever comes back', async () => {
    const bad = validDraft();
    const consumerSide = {
      ...bad,
      placement: { ...bad.placement, spectrum: 'consumer_retail' },
      shoreUps: [{ text: 'Add a gate.', citation: { kind: 'finding', ref: H('finding', 'f-001') } }],
    };
    const { impl } = fakeFetch([consumerSide, consumerSide]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.message).toContain('consumer side');
  });
});

describe('handles bound the citation space end to end', () => {
  it('sends handles in the prompt and never a real id', () => {
    const prompt = promptFor(angles, ruleset, INPUTS);
    expect(prompt).toContain(H('finding', 'f-001'));
    expect(prompt).not.toContain('f-001');
    expect(prompt).not.toContain('run-1/layer0/aaa');
  });

  /*
    An invented handle is refused before the validator sees it, and reported in the words the model
    used. Handing the validator a string the model never wrote would produce a complaint nobody
    could act on.
  */
  it('refuses an invented handle without reaching validateDraft', async () => {
    const bad = validDraft();
    const invented = {
      ...bad,
      angles: bad.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'F404' }] } : a,
      ),
    };
    const { impl, calls } = fakeFetch([invented, invented]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.message).toContain('F404');
    expect(result.message).toContain('did not issue');
    expect(calls[1]).toContain('F404');
  });

  it('stores the mapping alongside the draft', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.handles).toBeDefined();
    expect(Object.keys(result.handles!.finding)).toEqual(INPUTS.findings.map((f) => H('finding', f.id)));
    expect(result.handles!.finding['F1']).toBe('f-001');
    expect(result.handles!.angle[H('angle', 'consistency')]).toBe('consistency');
  });

  it('stores it on a rejected draft too, so the citations stay readable', async () => {
    const bad = validDraft();
    const invalid = { ...bad, placement: { ...bad.placement, citations: [] } };
    const { impl } = fakeFetch([invalid, invalid]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.handles).toBeDefined();
  });

  it('round-trips: what the run holds is what the decoded draft cites', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const cited = (result.draft?.angles ?? []).flatMap((a) => a.citations);
    expect(cited.length).toBeGreaterThan(0);
    for (const citation of cited) {
      const held =
        citation.kind === 'finding'
          ? INPUTS.findings.map((f) => f.id)
          : INPUTS.eyeTest.map((v) => v.id);
      expect(held, `${citation.kind} ${citation.ref}`).toContain(citation.ref);
    }
    for (const citation of result.draft?.placement.citations ?? []) {
      expect(toId(HANDLES, 'angle', H('angle', citation.ref))).toBe(citation.ref);
    }
  });
});

describe('a rejected draft keeps what was written', () => {
  /*
    Run 9011b2d7 produced a complete, well-formed document and had it refused over a single word.
    Storing `content: null` discarded all of it, so an operator could read why and not what.
  */
  it('carries the refused document back', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      placement: { ...bad.placement, paragraph: 'The pricing decides this.' },
    };
    const { impl } = fakeFetch([invalid, invalid]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.draft).toBeDefined();
    expect(result.draft?.placement.paragraph).toBe('The pricing decides this.');
    expect(result.message).toContain('pricing');
  });

  it('carries it decoded, so the operator edits real ids', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      placement: { ...bad.placement, paragraph: 'The pricing decides this.' },
    };
    const { impl } = fakeFetch([invalid, invalid]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const products = result.draft?.angles.find((a) => a.angleId === 'products_for');
    expect(products?.citations[0]?.ref).toBe('f-001');
  });

  /*
    An invented handle is refused before a document exists, so there is nothing to keep. The row
    still records the attempt and the reason.
  */
  it('keeps nothing when the answer never decoded', async () => {
    const bad = validDraft();
    const invented = {
      ...bad,
      angles: bad.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'F404' }] } : a,
      ),
    };
    const { impl } = fakeFetch([invented, invented]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.draft).toBeUndefined();
    expect(result.message).toContain('F404');
  });
});

describe('what the dry run prices', () => {
  /*
    The schema travels in `output_config` and is billed as input. An estimate over the prompt alone
    is quietly low, which is the wrong direction for a number somebody uses to decide whether to
    spend.
  */
  it('reports the prompt, the schema and the absent system prompt separately', () => {
    const parts = requestParts(angles, ruleset, INPUTS);
    expect(parts.prompt.length).toBeGreaterThan(0);
    expect(parts.schema.length).toBeGreaterThan(0);
    expect(parts.system).toBe('');
  });

  it('prices the schema as well as the prompt', () => {
    const parts = requestParts(angles, ruleset, INPUTS);
    const whole = estimateTokens(parts.system + parts.prompt + parts.schema);
    const promptOnly = estimateTokens(parts.prompt);
    expect(whole).toBeGreaterThan(promptOnly);
  });

  it('prices the schema the request actually sends', async () => {
    const { impl, requests } = fakeFetch([validDraft()]);
    await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    const sent = JSON.stringify(requests[0]!['output_config'].format.schema);
    expect(requestParts(angles, ruleset, INPUTS).schema).toBe(sent);
  });
});

describe('the placement vocabulary guidance', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);

  /*
    Guidance, not a relaxation. The rule still refuses the words; the model is given ones that mean
    the same thing and cannot be read as a statement about what Mintro charges.
  */
  it('names the words to avoid and the words to use', () => {
    expect(prompt).toContain('do not use the words price, pricing, cost, fee, discount or rate');
    expect(prompt).toContain('commercial posture');
    expect(prompt).toContain('how it sells');
    expect(prompt).toContain('order structure');
  });

  it('scopes it to the placement and says the angles are unrestricted', () => {
    expect(prompt).toContain('this applies to the placement only');
  });
});

/*
  What `storeDraft` actually puts on the row.

  The schema tier proves the columns accept these values; nothing there proves the job supplies
  them. `attempts` and `usage` had been on `EvaluateResult` since the generator was written and were
  dropped on the floor by this function for its whole life — a field computed, carried, printed and
  never persisted, which is the orphan CLAUDE.md names one granularity finer than an unused import.
  This test is the consumer.
*/
/**
 * Captures the insert payload `storeDraft` writes. The delete runs first and returns nothing worth
 * asserting.
 *
 * Module scope, because two describes now need it — what a generation cost, and why an earlier
 * attempt was refused.
 */
function capturingSupabase(): { supabase: WorkerSupabase; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      delete: () => ({ eq: async () => ({ error: null }) }),
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { supabase: { client, bucket: 'evidence' }, rows };
}

describe('storeDraft records what the generation cost', () => {
  const angleSet = { version: '1.0.0' } as AngleSet;

  /** `reported: false` omits `usage` entirely, which is what a generation with no call returns. */
  const result = (over: Partial<EvaluateResult>, reported = true): EvaluateResult => ({
    runId: '9011b2d7-c17e-4d62-96c7-01a1a2471b1d',
    status: 'ok',
    attempts: 2,
    inputSha256: 'a'.repeat(64),
    truncations: [],
    ...(reported ? { usage: { inputTokens: 33_514, outputTokens: 5_162 } } : {}),
    ...over,
  });

  it('writes the attempts and both token counts', async () => {
    const { supabase, rows } = capturingSupabase();
    await storeDraft(supabase, angleSet, '3.9.0', 'claude-opus-5', result({}));

    expect(rows[0]).toMatchObject({ attempts: 2, input_tokens: 33_514, output_tokens: 5_162 });
  });

  /*
    Null, never zero. A vendor that reported no usage did not report zero usage, and a refusal made
    before any call spent nothing rather than spending a measurable nothing.
  */
  it('writes null tokens when no call was made, and keeps the real attempt count', async () => {
    const { supabase, rows } = capturingSupabase();
    await storeDraft(
      supabase,
      angleSet,
      '3.9.0',
      'claude-opus-5',
      result({ status: 'run_did_not_see_storefront', attempts: 0 }, false),
    );

    expect(rows[0]).toMatchObject({ attempts: 0, input_tokens: null, output_tokens: null });
  });

  it('records the cost of a rejected draft too, which is the one worth reading', async () => {
    const { supabase, rows } = capturingSupabase();
    await storeDraft(
      supabase,
      angleSet,
      '3.9.0',
      'claude-opus-5',
      result({ status: 'rejected', attempts: 2, message: 'cites a finding this run does not hold' }),
    );

    expect(rows[0]).toMatchObject({ validator_status: 'rejected', attempts: 2, output_tokens: 5_162 });
  });
});

/*
  Concision, in the prompt (angle set 1.1.0).

  The tests that matter here are the verbatim ones. Every number and every rule below is asserted
  against `rules/angles.json` rather than against a figure written in this file — the same standard
  the guardrail tests already hold, because a prompt test that declares its own expected wording
  proves the test agrees with itself.
*/
describe('the length guidance reaches the model from the file', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);

  it('renders every limit the file declares, with its number', () => {
    expect(angles.limits).toHaveLength(4);
    for (const limit of angles.limits) {
      expect(prompt, `${limit.section} count`).toContain(`at most ${limit.maxWords} words`);
    }
  });

  /*
    The rule travels verbatim beside the number. A count alone bounds the length and permits the
    failure it was drawn against: seven 80-word angles that each open by re-summarising the business
    are shorter than seven 150-word ones and just as repetitive.
  */
  it('carries each rule verbatim, not paraphrased', () => {
    for (const limit of angles.limits) {
      expect(prompt, `${limit.section} rule`).toContain(limit.rule);
    }
  });

  it('names the section each limit applies to', () => {
    expect(prompt).toContain('The placement paragraph');
    expect(prompt).toContain('Each angle paragraph');
    expect(prompt).toContain('Each shore-up');
    expect(prompt).toContain('Each legality note');
  });

  it('says the limits are ceilings rather than targets', () => {
    expect(prompt).toContain('These are limits, not targets');
  });

  /*
    The placement gets more room than an angle, and that asymmetry is the whole change. One number
    for both is what produced a draft whose seven observations were each as long as its conclusion.
  */
  it('gives the placement a longer limit than an angle', () => {
    const words = sectionWords(angles.limits);
    expect(words.placement).toBeGreaterThan(words.angle);
    expect(words.angle).toBeGreaterThan(words.shoreUp);
    expect(words.shoreUp).toBeGreaterThan(words.legalityNote);
  });

  it('carries the two concision guardrails verbatim, like every other guardrail', () => {
    for (const guardrail of angles.guardrails) expect(prompt).toContain(guardrail);
    expect(angles.guardrails.join(' ')).toContain('Say each thing once');
  });

  /*
    No number in the prompt that the file does not know about. The old `Around 120 words` lived in
    the schema builder and would have kept shipping beside the new guidance, telling the model two
    lengths for one field.
  */
  it('states no length the angle set has not ratified', () => {
    const declared = new Set(angles.limits.map((l) => String(l.maxWords)));
    const stated = [...prompt.matchAll(/at most (\d+) words/g)].map((m) => m[1]!);
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.filter((n) => !declared.has(n))).toEqual([]);
    expect(prompt).not.toContain('Around 120 words');
  });

  it('puts the limits after the guardrails they serve and before the angles', () => {
    expect(prompt.indexOf('## Rules you must follow')).toBeLessThan(prompt.indexOf('## Length'));
    expect(prompt.indexOf('## Length')).toBeLessThan(prompt.indexOf('## The seven angles'));
  });
});

/*
  Scope and the lean anchor, as `runContextFor` assembles them from the committed files.

  The engine tests state what the validator does with these maps; these state that the maps say what
  `rules/angles.json` and `rules/ruleset.json` say. Both halves are needed: a correct rule fed a map
  built from the wrong rule ids refuses honest citations and admits the ones it was written for.
*/
describe('the scope the run context carries', () => {
  const run = runContextFor(angles, ruleset, INPUTS);

  it('gives each angle the findings on the rules that angle declares', () => {
    for (const angle of angles.angles.filter((a) => a.ruleIds.length > 0)) {
      const allowed = run.angleFindingIds.get(angle.id);
      expect(allowed, angle.id).toBeDefined();

      const declared = new Set(angle.ruleIds);
      const legality = new Set<string>(LEGALITY_RULE_IDS);
      for (const finding of INPUTS.findings) {
        const inScope = declared.has(finding.ruleId) || legality.has(finding.ruleId);
        expect(allowed!.has(finding.id), `${angle.id} / ${finding.ruleId}`).toBe(inScope);
      }
    }
  });

  /*
    The consistency angle declares no rules, so it is left out of the map entirely and the validator
    reads that absence as unrestricted. Expressed by what the data says, never by the id.
  */
  it('leaves an angle with no declared rules out of the map', () => {
    const undeclared = angles.angles.filter((a) => a.ruleIds.length === 0).map((a) => a.id);
    expect(undeclared).toEqual(['consistency']);
    for (const id of undeclared) expect(run.angleFindingIds.has(id)).toBe(false);
  });

  /*
    A legality item ends the evaluation on its own and belongs to no angle in particular. Scoping it
    out of all seven would forbid the one finding any angle might legitimately have to account for.
  */
  it('lets every angle cite a legality finding', () => {
    const legalityFindings = INPUTS.findings.filter((f) =>
      (LEGALITY_RULE_IDS as readonly string[]).includes(f.ruleId),
    );
    expect(legalityFindings.length).toBeGreaterThan(0);

    for (const [angleId, allowed] of run.angleFindingIds) {
      for (const finding of legalityFindings) {
        expect(allowed.has(finding.id), `${angleId} / ${finding.ruleId}`).toBe(true);
      }
    }
  });

  it('gives each routing condition the findings on its own observing rules', () => {
    for (const condition of angles.routingConditions.filter((c) => c.ruleIds.length > 0)) {
      const allowed = run.conditionFindingIds.get(condition.id);
      expect(allowed, condition.id).toBeDefined();

      const declared = new Set(condition.ruleIds);
      for (const finding of INPUTS.findings) {
        expect(allowed!.has(finding.id), `${condition.id} / ${finding.ruleId}`).toBe(
          declared.has(finding.ruleId),
        );
      }
    }
  });

  it('leaves an unobservable condition out, since it can cite nothing at all', () => {
    for (const condition of angles.routingConditions.filter((c) => c.ruleIds.length === 0)) {
      expect(run.conditionFindingIds.has(condition.id), condition.id).toBe(false);
    }
  });

  /*
    `fail` only, and read off the rule set's own `weight`. A `review` is D-009's human queue and a
    `not_evaluable` is an absence of observation; a lean answering to either would be answering to
    something nobody observed.
  */
  it('holds the heavy rules observed to fail, and only those', () => {
    const heavy = new Set(ruleset.rules.filter((r) => r.weight === 'heavy').map((r) => r.id));
    expect(heavy.size).toBeGreaterThan(0);

    for (const finding of INPUTS.findings) {
      const shouldBind = heavy.has(finding.ruleId) && finding.state === 'fail';
      expect(run.heavyFailingFindingIds.has(finding.id), `${finding.ruleId} ${finding.state}`).toBe(
        shouldBind,
      );
    }
  });
});

describe('the prompt states the citation scope and the lean anchor', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);

  it('tells the model to cite a finding only where it is listed', () => {
    expect(prompt).toContain('Cite a finding only where it is listed');
    expect(prompt).toContain('Legality findings are the exception');
  });

  /*
    The routing block names each condition's own observing rules, from the file. A condition that
    cannot be observed says to cite nothing, which is the same instruction
    `not_observable_row_cites` enforces after the fact.
  */
  it('names the rules each routing condition may cite, from the angle set', () => {
    for (const condition of angles.routingConditions) {
      if (condition.ruleIds.length === 0) continue;
      expect(prompt, condition.id).toContain(`cite only findings on ${condition.ruleIds.join(', ')}`);
    }
    const unobservable = angles.routingConditions.filter((c) => c.ruleIds.length === 0);
    expect(unobservable.length).toBeGreaterThan(0);
    expect(prompt).toContain('cite nothing');
  });

  it('states the lean anchor, and that only a failure binds it', () => {
    expect(prompt).toContain('cannot lean research');
    expect(prompt).toContain('[HEAVY]');
    expect(prompt).toContain('does not bind the lean');
  });
});

/*
  The prompt states the rule the validator will refuse on.

  `placement_outside_spectrum` and the tightened domestic gate are both refusals, and a refusal the
  prompt only implies is one that costs a retry to teach. Printed from `PLACEMENT_BY_SPECTRUM` and
  from the angle set's own `observable` flag rather than written out, so the words the model reads
  and the rule it is held to are one thing (hard constraint 1).
*/
describe('the prompt states how far the spectrum lets a placement go', () => {
  const prompt = promptFor(angles, ruleset, INPUTS);

  it('prints a line for every spectrum position, with what it permits', () => {
    for (const spectrum of SPECTRUM_IDS) {
      const permitted = PLACEMENT_BY_SPECTRUM[spectrum].map((p) => `\`${p}\``).join(' or ');
      expect(prompt, spectrum).toContain(`\`${spectrum}\` — ${permitted}`);
    }
  });

  /*
    The three the rule turns on, read out of the rendered prompt rather than out of the table —
    a test that only compared the table to itself would pass over a section that never rendered.
  */
  it('says a consumer retailer may only be referred out', () => {
    expect(prompt).toContain('`consumer_retail` — `referred_out`');
    expect(prompt).not.toContain('`consumer_retail` — `referred_out` or');
  });

  /*
    The three positions with one placement between them (D-272 amendment). The prompt renders the
    table rather than restating it, so this reads the lines the model is actually shown.
  */
  it('says the consumer side and mixed are referred out, and nothing else', () => {
    for (const spectrum of ['consumer_retail', 'consumer_leaning', 'mixed'] as const) {
      expect(prompt, spectrum).toContain(`\`${spectrum}\` — \`referred_out\``);
      expect(prompt, spectrum).not.toContain(`\`${spectrum}\` — \`referred_out\` or`);
    }
  });

  it('says the research side may be international or domestic', () => {
    for (const spectrum of ['research_leaning', 'research_supplier'] as const) {
      expect(prompt, spectrum).toContain(`\`${spectrum}\` — \`international\` or \`domestic\``);
    }
  });

  /*
    And that mixed is referred out (D-272). The prompt renders the table rather than restating it,
    so this reads the line the model is actually shown.
  */
  it('says mixed is referred out and nothing else', () => {
    expect(prompt).toContain('`mixed` — `referred_out`');
    expect(prompt).not.toContain('`mixed` — `international`');
  });

  it('says an unobservable condition is not a met one', () => {
    expect(prompt).toContain('`not_observable` is not `met`');
    expect(prompt).toContain('nobody has established the condition');
  });

  /*
    And names the two, from the angle set. Which conditions the application answers is data; a
    prompt that spelled them out would be a second copy to diff against the file.
  */
  it('names the conditions that may stand unobserved under a domestic recommendation', () => {
    const application = angles.routingConditions.filter((c) => !c.observable);
    expect(application.length).toBe(2);
    for (const condition of application) {
      expect(prompt, condition.id).toContain(`\`${condition.id}\``);
    }
    for (const condition of angles.routingConditions.filter((c) => c.observable)) {
      const at = prompt.indexOf('How far the spectrum lets you place it');
      const section = prompt.slice(at, prompt.indexOf('\n## ', at + 1));
      expect(section, condition.id).not.toContain(`\`${condition.id}\``);
    }
  });

  it('tells the model what to recommend instead when a condition is open', () => {
    expect(prompt).toContain('recommend `international` and name the open conditions as the path');
  });
});

/*
  What a legality item with no capture carries.

  `evidenceKey` is required on every item, and the row for an unobserved rule prints as "(no
  capture recorded)" — which named the gap and left the model to guess what to echo in the field.
  The empty string was the answer, written down in a comment in `evaluationSchema.ts` and nowhere
  the model could read it. A guess there becomes an invented handle, `decodeDraft` refuses it, and
  a whole retry goes on a convention nobody stated.
*/
describe('the prompt states the empty-key convention for an unobserved legality rule', () => {
  /*
    A legality rule the crawl could not reach, added here rather than to `INPUTS`.

    The block is computed from the findings, so this row is what produces the "(no capture
    recorded)" line — and adding it to the shared fixture would change the legality block under
    every other test in this file.
  */
  const GAP_RULE = 'PROD-006';
  const withGap = promptFor(angles, ruleset, {
    ...INPUTS,
    findings: [
      ...INPUTS.findings,
      {
        id: 'f-900',
        ruleId: GAP_RULE,
        title: 'A legality rule the crawl could not reach',
        state: 'not_evaluable',
        note: 'The page that would carry it timed out.',
        evidenceKey: null,
      },
    ],
  });

  it('has a legality rule with no capture, so this is not asserted over an empty block', () => {
    expect(LEGALITY_RULE_IDS).toContain(GAP_RULE);
    expect(withGap).toContain(GAP_RULE);
  });

  it('shows the row as having no capture, which is the case the convention covers', () => {
    expect(withGap).toContain('(no capture recorded)');
  });

  it('says the field carries the empty string, not a handle and not an omission', () => {
    expect(withGap).toContain('"evidenceKey": ""');
    expect(withGap).toContain('the empty string');
    expect(withGap).toContain('never observed');
  });

  /*
    And in the answer shape as well as the prose. The shape is what a model copies, and a convention
    stated only in a paragraph above it is one the copying does not carry down.
  */
  it('shows the same convention in the shape the model copies', () => {
    expect(withGap).toContain('"state": "not_evaluable", "evidenceKey": ""');
  });
});

/*
  Every field the generator produces reaches the person running it.

  ## The defect this exists for

  `retryMessage` was designed, typed, documented, stored in its own migration and asserted by three
  tests — and `bin/evaluate.ts` printed every other field of the result and not that one. So the one
  record of the validator doing its job was written to a column nobody was reading yet and shown to
  nobody at all, on a run that looked completely successful.

  That is D-246's shape one layer along: not a flag no component renders, but a result field no
  caller prints. Neither typechecking nor a unit test on `generateDraft` can see it, because the
  field exists and is correct — what is missing is a consumer.

  ## Why the interface is read from source

  So the list cannot fall out of step by being written twice. A field added to `EvaluateResult`
  fails here until the CLI says something about it, which is the property that was violated, rather
  than "the fields somebody remembered when writing this test".
*/
describe('the CLI surfaces every field of the result', () => {
  const JOB = readFileSync('apps/worker/src/evaluateJob.ts', 'utf8');
  const CLI = readFileSync('apps/worker/bin/evaluate.ts', 'utf8');

  const body = JOB.slice(
    JOB.indexOf('export interface EvaluateResult {'),
    JOB.indexOf('export interface EvaluateOptions {'),
  );
  const FIELDS = [...body.matchAll(/^\s*readonly (\w+)\??:/gm)].map((match) => match[1]!);

  it('found the interface, so this is not passing over an empty list', () => {
    expect(FIELDS).toContain('retryMessage');
    expect(FIELDS.length).toBeGreaterThan(8);
  });

  it.each(FIELDS)('says something about %s', (field) => {
    expect(CLI).toContain(`result.${field}`);
  });
});

/*
  The refusal that produced a retry, on a draft that then succeeded (0080).

  `attempts: 2` says a refusal happened and withholds the only useful part. Every rule this
  generator has gained came from reading one of these, and until now they existed on stdout — which
  is to say, until the terminal scrolled.
*/
describe('a successful draft records why the first attempt failed', () => {
  it('carries the refusal that produced the retry', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      angles: bad.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'F999' }] } : a,
      ),
    };
    const { impl } = fakeFetch([invalid, validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(result.retryMessage).toContain('F999');
    // The draft itself is good, so nothing says otherwise.
    expect(result.message).toBeUndefined();
  });

  it('carries none when the first answer was accepted', async () => {
    const { impl } = fakeFetch([validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.attempts).toBe(1);
    expect(result.retryMessage).toBeUndefined();
  });

  it('stores it, and stores null when there was none', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      angles: bad.angles.map((a, i) =>
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'F999' }] } : a,
      ),
    };

    const retried = capturingSupabase();
    const first = await generateDraft(angles, ruleset, INPUTS, {
      apiKey: 'sk-test',
      fetchImpl: fakeFetch([invalid, validDraft()]).impl,
    });
    await storeDraft(retried.supabase, angles, '3.9.0', 'claude-opus-5', first);
    expect(retried.rows[0]?.['retry_message']).toContain('F999');

    const clean = capturingSupabase();
    const second = await generateDraft(angles, ruleset, INPUTS, {
      apiKey: 'sk-test',
      fetchImpl: fakeFetch([validDraft()]).impl,
    });
    await storeDraft(clean.supabase, angles, '3.9.0', 'claude-opus-5', second);
    expect(clean.rows[0]?.['retry_message']).toBeNull();
  });

  /*
    Distinct from `validator_message`, which says why THIS row is unusable. A row can carry a good
    draft and a retry message about the answer that was thrown away; merging them would make a
    stored draft ambiguous about whether its own content was refused.
  */
  it('is a different column from the one that refuses the row', async () => {
    const bad = validDraft();
    const invalid = { ...bad, placement: { ...bad.placement, paragraph: 'The pricing decides this.' } };
    const { supabase, rows } = capturingSupabase();
    const result = await generateDraft(angles, ruleset, INPUTS, {
      apiKey: 'sk-test',
      fetchImpl: fakeFetch([invalid, invalid]).impl,
    });
    await storeDraft(supabase, angles, '3.9.0', 'claude-opus-5', result);

    expect(rows[0]?.['validator_status']).toBe('rejected');
    expect(rows[0]?.['validator_message']).toContain("mentions 'pricing'");
  });
});

