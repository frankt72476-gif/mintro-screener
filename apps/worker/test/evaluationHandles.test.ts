/**
 * Run-scoped handles, and the round trip (D-260, amended).
 *
 * The model reads and writes `F12`, `E7`, `Y3`, `A5`; the real ids never reach it. Two properties
 * carry the whole design, and both are tested against the committed rows of a real run rather than
 * against ids invented to suit the code:
 *
 * **Lossless.** Every id the run holds survives encode and decode unchanged. A mapping that dropped
 * or transposed one would re-point a citation at the wrong evidence, and the draft would still read
 * as valid — the worst failure available here, and quieter than the fabrication it replaced.
 *
 * **Closed.** A handle the run did not issue decodes to nothing, and is reported. That is the
 * fabrication guard, moved from the enum into the decode where it can name what went wrong.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RunContext } from '@mintro/engine';
import {
  buildHandles,
  decodeDraft,
  handleContext,
  storeHandles,
  toHandle,
  toId,
  unknownHandleMessage,
} from '../src/evaluationHandles.js';

/** Real rows from run 9011b2d7 — 59 findings, 38 evidence rows, exported unedited. */
const ROWS = JSON.parse(readFileSync('fixtures/evaluation/run-9011b2d7-rows.json', 'utf8')) as {
  findings: { ruleId: string; evidenceKey: string | null }[];
  evidence: { key: string; kind: string; url: string }[];
};

const ANGLE_IDS = [
  'who_it_talks_to',
  'products_for',
  'how_it_sells',
  'who_it_lets_buy',
  'operates_like_supplier',
  'off_site',
  'consistency',
];

/**
 * The run, in the shape the generator assembles.
 *
 * Finding ids are synthesised because the export carries rule ids rather than row ids — but the
 * *counts* and the evidence keys are the real ones, which is what the size and collision questions
 * turn on.
 */
const RUN: RunContext = {
  findingIds: new Set(ROWS.findings.map((_, i) => `f-${String(i).padStart(4, '0')}-uuid`)),
  evidenceKeys: new Set(ROWS.evidence.map((e) => e.key)),
  eyeTestItemIds: new Set(Array.from({ length: 14 }, (_, i) => `EYE-${String(i + 1).padStart(2, '0')}`)),
  angleIds: ANGLE_IDS,
  routingConditionIds: ['registration_gate', 'no_water_or_syringes'],
  consumerSideSpectrum: new Set(['consumer_retail']),
  legality: { clean: true, items: [] },
  observableConditionIds: [],
  knownHandles: new Set<string>(),
  heavyFailingFindingIds: new Set<string>(),
  angleFindingIds: new Map<string, ReadonlySet<string>>(),
  conditionFindingIds: new Map<string, ReadonlySet<string>>(),
};

const map = buildHandles(RUN);

describe('assignment', () => {
  it('numbers each namespace from one, in sorted order', () => {
    const sortedFindings = [...RUN.findingIds].sort();
    expect(toHandle(map, 'finding', sortedFindings[0]!)).toBe('F1');
    expect(toHandle(map, 'finding', sortedFindings[58]!)).toBe('F59');

    const sortedEvidence = [...RUN.evidenceKeys].sort();
    expect(toHandle(map, 'evidence', sortedEvidence[0]!)).toBe('E1');
    expect(toHandle(map, 'eye_test', 'EYE-01')).toBe('Y1');
    expect(toHandle(map, 'angle', [...ANGLE_IDS].sort()[0]!)).toBe('A1');
  });

  it('covers the whole run, one handle per id', () => {
    expect(map.finding.toId.size).toBe(59);
    expect(map.evidence.toId.size).toBe(38);
    expect(map.eyeTest.toId.size).toBe(14);
    expect(map.angle.toId.size).toBe(7);
  });

  /*
    Sorted assignment is what makes two drafts over one run comparable — `input_sha256` already
    promises the inputs matched, and this promises the handles did too.
  */
  it('is reproducible from the same run', () => {
    const again = buildHandles(RUN);
    expect(storeHandles(again)).toEqual(storeHandles(map));
  });

  it('keeps namespaces separate, so F1 and E1 are different things', () => {
    expect(toId(map, 'finding', 'E1')).toBeNull();
    expect(toId(map, 'evidence', 'F1')).toBeNull();
    expect(toId(map, 'angle', 'Y1')).toBeNull();
  });
});

describe('lossless over the real run', () => {
  it('round-trips every id in every namespace', () => {
    const namespaces: [string, readonly string[]][] = [
      ['finding', [...RUN.findingIds]],
      ['evidence', [...RUN.evidenceKeys]],
      ['eye_test', [...RUN.eyeTestItemIds]],
      ['angle', RUN.angleIds],
    ];

    for (const [kind, ids] of namespaces) {
      for (const id of ids) {
        const handle = toHandle(map, kind, id);
        expect(handle, `${kind} ${id} got no handle`).not.toBe(id);
        expect(toId(map, kind, handle), `${kind} ${handle} did not return ${id}`).toBe(id);
      }
    }
  });

  it('issues no duplicate handle within a namespace', () => {
    for (const space of [map.finding, map.evidence, map.eyeTest, map.angle]) {
      expect(new Set(space.toHandle.values()).size).toBe(space.toHandle.size);
      expect(new Set(space.toId.keys()).size).toBe(space.toId.size);
    }
  });

  it('survives the full 112-character evidence keys unchanged', () => {
    const longest = [...RUN.evidenceKeys].sort((a, b) => b.length - a.length)[0]!;
    expect(longest.length).toBeGreaterThan(100);
    expect(toId(map, 'evidence', toHandle(map, 'evidence', longest))).toBe(longest);
  });
});

/** A draft in handle space, of the shape the model returns. */
function handleDraft(): Record<string, any> {
  const f = (n: number) => ({ kind: 'finding', ref: `F${n}` });
  return {
    placement: {
      spectrum: 'mixed',
      recommended: 'international',
      paragraph: 'A paragraph.',
      citations: [
        { kind: 'angle', ref: 'A1' },
        { kind: 'angle', ref: 'A2' },
      ],
    },
    legality: { clean: false, items: [{ ruleId: 'CATG-003', evidenceKey: 'E5' }] },
    routing: [
      { conditionId: 'registration_gate', status: 'not_met', citations: [f(3)] },
      { conditionId: 'no_water_or_syringes', status: 'met', citations: [] },
    ],
    angles: ANGLE_IDS.map((_, i) => ({
      angleId: `A${i + 1}`,
      lean: 'neutral',
      paragraph: 'Something observed.',
      citations: [f(i + 1), { kind: 'eye_test', ref: 'Y2' }],
    })),
    shoreUps: [{ text: 'A change worth making.', citation: { kind: 'evidence', ref: 'E9' } }],
  };
}

describe('decoding a draft', () => {
  it('rewrites every citation to a real id', () => {
    const result = decodeDraft(handleDraft(), map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const draft = result.value as Record<string, any>;
    expect(draft['placement'].citations[0].ref).toBe(toId(map, 'angle', 'A1'));
    expect(draft['angles'][0].angleId).toBe(toId(map, 'angle', 'A1'));
    expect(draft['angles'][0].citations[0].ref).toBe(toId(map, 'finding', 'F1'));
    expect(draft['angles'][0].citations[1].ref).toBe(toId(map, 'eye_test', 'Y2'));
    expect(draft['routing'][0].citations[0].ref).toBe(toId(map, 'finding', 'F3'));
    expect(draft['shoreUps'][0].citation.ref).toBe(toId(map, 'evidence', 'E9'));
    expect(draft['legality'].items[0].evidenceKey).toBe(toId(map, 'evidence', 'E5'));
  });

  it('leaves everything that is not an id alone', () => {
    const result = decodeDraft(handleDraft(), map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const draft = result.value as Record<string, any>;
    expect(draft['placement'].spectrum).toBe('mixed');
    expect(draft['placement'].paragraph).toBe('A paragraph.');
    expect(draft['routing'][0].conditionId).toBe('registration_gate');
    expect(draft['legality'].items[0].ruleId).toBe('CATG-003');
    expect(draft['shoreUps'][0].text).toBe('A change worth making.');
  });

  /*
    The fabrication guard, moved into the decode. An invented handle resolves to nothing and is
    named — never passed through, which would hand the validator a string that looks like a real id.
  */
  it('refuses a handle this run did not issue, and says which', () => {
    const draft = handleDraft();
    draft['angles'][0].citations[0] = { kind: 'finding', ref: 'F999' };

    const result = decodeDraft(draft, map);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]).toMatchObject({ kind: 'finding', handle: 'F999' });
    expect(result.unknown[0]?.at).toContain('angles[0].citations[0]');
  });

  it('refuses a handle borrowed from the wrong namespace', () => {
    const draft = handleDraft();
    draft['angles'][0].citations[0] = { kind: 'finding', ref: 'E5' };
    const result = decodeDraft(draft, map);
    expect(result.ok).toBe(false);
  });

  it('refuses an invented legality key and an invented angle id', () => {
    const draft = handleDraft();
    draft['legality'].items[0].evidenceKey = 'E999';
    draft['angles'][1].angleId = 'A99';

    const result = decodeDraft(draft, map);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknown.map((u) => u.handle).sort()).toEqual(['A99', 'E999']);
  });

  it('reports every unresolved handle at once, not the first', () => {
    const draft = handleDraft();
    draft['angles'][0].citations[0] = { kind: 'finding', ref: 'F900' };
    draft['angles'][1].citations[0] = { kind: 'finding', ref: 'F901' };

    const result = decodeDraft(draft, map);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknown).toHaveLength(2);

    const message = unknownHandleMessage(result.unknown);
    expect(message).toContain('2 handle(s)');
    expect(message).toContain('F900');
    expect(message).toContain('F901');
    expect(message).toContain('return the whole document again');
  });

  /*
    The kind goes at the end of the sentence, so no article has to agree with it.

    The wording was `is not a ${kind} handle in this run`, and two of the four kinds begin with a
    vowel: *"'E999' is not a evidence handle"*. This is the message a model is asked to read
    carefully before trying again, and the retry costs a whole call.
  */
  it('names the kind without an article that has to agree with it', () => {
    const draft = handleDraft();
    draft['legality'].items[0].evidenceKey = 'E999';
    draft['angles'][0].citations[0] = { kind: 'eye_test', ref: 'Y99' };

    const result = decodeDraft(draft, map);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = unknownHandleMessage(result.unknown);
    // The two kinds that begin with a vowel, which are the two the old wording got wrong.
    expect(message).toContain('evidence');
    expect(message).toContain('eye_test');
    expect(message).not.toMatch(/\ba [aeiou]/);
    expect(message).toContain("is not a handle this run issued for evidence");
  });
});

describe('the handle-space run context, for the schema', () => {
  const handleRun = handleContext(RUN, map);

  it('carries handles where the real context carries ids', () => {
    expect([...handleRun.findingIds].every((id) => /^F\d+$/.test(id))).toBe(true);
    expect([...handleRun.evidenceKeys].every((id) => /^E\d+$/.test(id))).toBe(true);
    expect(handleRun.angleIds.every((id) => /^A\d+$/.test(id))).toBe(true);
  });

  /*
    Condition ids and spectrum positions pass through. They are already short readable words, and
    `R1` would cost clarity to save nothing.
  */
  it('leaves routing conditions and the spectrum in plain words', () => {
    expect(handleRun.routingConditionIds).toEqual(RUN.routingConditionIds);
    expect(handleRun.consumerSideSpectrum).toEqual(RUN.consumerSideSpectrum);
  });
});

describe('the stored mapping', () => {
  it('is handle to real id, per kind', () => {
    const stored = storeHandles(map);
    expect(Object.keys(stored).sort()).toEqual(['angle', 'evidence', 'eye_test', 'finding']);
    expect(stored.finding['F1']).toBe(toId(map, 'finding', 'F1'));
    expect(Object.keys(stored.evidence)).toHaveLength(38);
  });

  /*
    A draft citing `F12` is unreadable without this, and the run it came from may be superseded by
    a re-scan with entirely different ids (D-002). Stored, never recomputed.
  */
  it('resolves every citation a draft could carry', () => {
    const stored = storeHandles(map);
    const result = decodeDraft(handleDraft(), map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const draft = result.value as Record<string, any>;
    expect(stored.angle['A1']).toBe(draft['placement'].citations[0].ref);
    expect(stored.evidence['E5']).toBe(draft['legality'].items[0].evidenceKey);
  });
});
