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
import { loadRulesetFile, loadAngleSetFile, ANGLES_PATH, PLACEMENT_IDS } from '@mintro/ruleset';
import { PRICE_WORDS, type EvaluationDraft } from '@mintro/engine';
import {
  MAX_ATTEMPTS,
  MIN_DISTINCT_TEXTS,
  generateDraft,
  storefrontNotSeen,
  inputHash,
  parseDraft,
  promptFor,
  runContextFor,
  type EvaluationInputs,
} from '../src/evaluateJob.js';
import { estimateTokens } from '../src/evaluationPrompt.js';
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

/** A draft that passes the validator against `INPUTS`. */
function validDraft(): EvaluationDraft {
  return {
    placement: {
      spectrum: 'consumer_leaning',
      recommended: 'referred_out',
      paragraph: 'The catalogue is organised by outcome and there is no gate.',
      citations: [
        { kind: 'angle', ref: 'products_for' },
        { kind: 'angle', ref: 'who_it_lets_buy' },
      ],
    },
    legality: { clean: true, items: [] },
    routing: angles.routingConditions.map((c) => ({
      conditionId: c.id,
      status: 'not_observable' as const,
      citations: [],
    })),
    angles: angles.angles.map((a) => ({
      angleId: a.id,
      lean: 'consumer' as const,
      paragraph: 'The catalogue is organised by outcome.',
      citations: [{ kind: 'finding' as const, ref: 'f-001' }],
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
      expect(prompt, `missing ${angle.id}`).toContain(angle.id);
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
    const productsFor = prompt.slice(prompt.indexOf('`products_for`'));
    expect(productsFor).toContain('f-001');
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
  it('introduces no price word of its own', () => {
    const fromData = [
      ...angles.angles.map((a) => `${a.notes} ${a.reasoning} ${a.question}`),
      ...angles.guardrails,
      ...angles.routingConditions.map((c) => c.label),
    ].join(' ');

    const written = promptFor(angles, ruleset, { ...INPUTS, pages: [], findings: [], eyeTest: [] });
    for (const word of PRICE_WORDS) {
      const inData = new RegExp(`\\b${word}\\b`, 'i').test(fromData);
      if (inData) continue;
      expect(new RegExp(`\\b${word}\\b`, 'i').test(written), `prompt introduces '${word}'`).toBe(false);
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
    const run = runContextFor(angles, INPUTS);
    expect([...run.findingIds]).toEqual(['f-001', 'f-002']);
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
        i === 0 ? { ...a, citations: [{ kind: 'finding' as const, ref: 'f-999' }] } : a,
      ),
    };
    const { impl, calls } = fakeFetch([invalid, validDraft()]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('Your previous answer was refused');
    expect(calls[1]).toContain('f-999');
  });

  it('stores a rejected draft after two refusals, with the reason', async () => {
    const bad = validDraft();
    const invalid = {
      ...bad,
      placement: { ...bad.placement, citations: [{ kind: 'angle' as const, ref: 'products_for' }] },
    };
    const { impl, calls } = fakeFetch([invalid, invalid]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.attempts).toBe(MAX_ATTEMPTS);
    expect(result.message).toContain('distinct angle');
    expect(result.draft).toBeUndefined();
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
  const block = prompt.slice(prompt.indexOf('`consistency`'), prompt.indexOf('## Routing conditions'));

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
    const other = prompt.slice(prompt.indexOf('`products_for`'), prompt.indexOf('### Angle 3'));
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
    expect(schema.$defs.findingId.enum).toEqual(['f-001', 'f-002']);
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
      shoreUps: [{ text: 'Add a gate.', citation: { kind: 'finding', ref: 'f-001' } }],
    };
    const { impl } = fakeFetch([consumerSide, consumerSide]);
    const result = await generateDraft(angles, ruleset, INPUTS, { apiKey: 'sk-test', fetchImpl: impl });

    expect(result.status).toBe('rejected');
    expect(result.message).toContain('consumer side');
  });
});

