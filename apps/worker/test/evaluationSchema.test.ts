/**
 * The answer schema, built from the run (D-260, amended).
 *
 * The property that matters: **a fabricated id is unrepresentable**, not merely refused. The first
 * real generation cited finding `fdd0000-0000` — a made-up string in the shape of an id — and did
 * it again on the retry after being told. `validateDraft` caught it twice, which cost two full
 * generations and produced no draft.
 *
 * These tests are about what the schema forbids the model from saying at all. They do not replace
 * `evaluation.test.ts`, which is about what the validator refuses once it has been said.
 */

import { describe, expect, it } from 'vitest';
import type { RunContext } from '@mintro/engine';
import { MAX_SHORE_UPS, PARAGRAPH_WORDS, draftSchema } from '../src/evaluationSchema.js';

const RUN: RunContext = {
  findingIds: new Set(['f-001', 'f-002']),
  evidenceKeys: new Set(['run-1/layer1/abc.png']),
  eyeTestItemIds: new Set(['EYE-01', 'EYE-03']),
  angleIds: ['who_it_talks_to', 'products_for', 'consistency'],
  routingConditionIds: ['registration_gate', 'order_minimum_150'],
  consumerSideSpectrum: new Set(['consumer_retail']),
  legality: { clean: true, items: [] },
  observableConditionIds: [],
  knownHandles: new Set<string>(),
};

const SPECTRUM = ['consumer_retail', 'mixed', 'research_supplier'];
const PLACEMENTS = ['referred_out', 'international', 'domestic'];

const schema = draftSchema(RUN, SPECTRUM, PLACEMENTS) as Record<string, any>;
const props = schema['properties'] as Record<string, any>;
const defs = schema['$defs'] as Record<string, any>;

/** The branch definitions a citation site points at, resolved through `$defs`. */
function branchesAt(node: any): Record<string, any>[] {
  return node.anyOf.map((entry: any) => defs[String(entry.$ref).replace('#/$defs/', '')]);
}

/** Every `enum` in the schema, by the path it sits at. */
function enumsIn(node: unknown, path = ''): { path: string; values: readonly unknown[] }[] {
  if (node === null || typeof node !== 'object') return [];
  const out: { path: string; values: readonly unknown[] }[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (key === 'enum' && Array.isArray(value)) out.push({ path: here, values: value });
    else out.push(...enumsIn(value, here));
  }
  return out;
}

describe('ids are enums of what the run holds', () => {
  it('constrains finding citations to this run', () => {
    const branches = branchesAt(props['angles'].items.properties.citations.items);
    const finding = branches.find((b) => b.properties.kind.const === 'finding')!;
    expect(finding.properties.ref.$ref).toBe('#/$defs/findingId');
    expect(defs['findingId'].enum).toEqual(['f-001', 'f-002']);
  });

  it('constrains evidence and eye-test citations too', () => {
    const branches = branchesAt(props['angles'].items.properties.citations.items);
    expect(defs['evidenceKey'].enum).toEqual(['run-1/layer1/abc.png']);
    expect(defs['eyeTestItemId'].enum).toEqual(['EYE-01', 'EYE-03']);
  });

  /*
    The exact defect. `fdd0000-0000` is not in any enum, so a schema-valid answer cannot contain it.
  */
  it('leaves no enum that would admit the fabricated id from the first real run', () => {
    for (const { path, values } of enumsIn(schema)) {
      expect(values, path).not.toContain('fdd0000-0000');
    }
  });

  it('constrains the spectrum, the placement and the routing conditions', () => {
    expect(props['placement'].properties.spectrum.enum).toEqual(SPECTRUM);
    expect(props['placement'].properties.recommended.enum).toEqual(PLACEMENTS);
    expect(props['routing'].items.properties.conditionId.enum).toEqual(RUN.routingConditionIds);
  });

  /*
    The legality block is computed, so its rule ids are an enum of the computed ones and its
    evidence key is a plain string — an unobserved rule recorded no capture and carries an empty
    key, which no enum of real keys would admit.
  */
  it('constrains a legality item to the computed rule ids', () => {
    const withItems = draftSchema(
      {
        ...RUN,
        legality: {
          clean: false,
          items: [{ ruleId: 'CATG-003', state: 'fail', evidenceKey: 'run-1/layer1/abc.png' }],
        },
      },
      SPECTRUM,
      PLACEMENTS,
    ) as Record<string, any>;

    const item = withItems['properties'].legality.properties.items.items.properties;
    expect(item.ruleId.enum).toEqual(['CATG-003']);
    expect(item.state.enum).toEqual(['fail', 'not_evaluable']);
    expect(item.evidenceKey.type).toBe('string');
    expect(item.note.type).toBe('string');
  });
});

describe('the angle citation is placement-only, in the schema as well as the validator', () => {
  it('offers an angle branch on the placement', () => {
    const branches = branchesAt(props['placement'].properties.citations.items);
    const angle = branches.find((b) => b.properties.kind.const === 'angle')!;
    expect(angle.properties.ref.$ref).toBe('#/$defs/angleId');
    expect(defs['angleId'].enum).toEqual(RUN.angleIds);
  });

  it('offers none anywhere else', () => {
    for (const path of ['angles', 'routing']) {
      const kinds = branchesAt(props[path].items.properties.citations.items).map(
        (b) => b.properties.kind.const,
      );
      expect(kinds, path).not.toContain('angle');
    }
    const shoreUp = branchesAt(props['shoreUps'].items.properties.citation);
    expect(shoreUp.map((b) => b.properties.kind.const)).not.toContain('angle');
  });
});

describe('an empty list is omitted, not emitted as an empty enum', () => {
  /*
    `enum: []` matches nothing. A run with no eye test would make every citation impossible to
    express and impossible to explain — so the branch is dropped and the model is offered exactly
    the kinds this run can support.
  */
  it('drops the eye-test branch when the run has no verdicts', () => {
    const blind = draftSchema({ ...RUN, eyeTestItemIds: new Set() }, SPECTRUM, PLACEMENTS) as Record<string, any>;
    expect(Object.keys(blind['$defs'])).not.toContain('eyeTestRef');
    expect(Object.keys(blind['$defs'])).not.toContain('eyeTestItemId');
    const refs = blind['properties'].angles.items.properties.citations.items.anyOf.map(
      (e: any) => e.$ref,
    );
    expect(refs).toEqual(['#/$defs/findingRef', '#/$defs/evidenceRef']);
  });

  it('falls back to a plain string where an enum would be empty', () => {
    const bare = draftSchema({ ...RUN, evidenceKeys: new Set() }, SPECTRUM, PLACEMENTS) as Record<string, any>;
    const key = bare['properties'].legality.properties.items.items.properties.evidenceKey;
    expect(key.enum).toBeUndefined();
    expect(key.type).toBe('string');
  });

  it('emits no empty enum anywhere, for any run shape', () => {
    const sparse = draftSchema(
      { ...RUN, evidenceKeys: new Set(), eyeTestItemIds: new Set() },
      SPECTRUM,
      PLACEMENTS,
    );
    for (const { path, values } of enumsIn(sparse)) {
      expect(values.length, `${path} is an empty enum`).toBeGreaterThan(0);
    }
  });
});

describe('the shape rules the schema can carry', () => {
  /*
    Every count is the validator's, because the supported subset has no `maxItems` at all and
    `minItems` only up to 1. Two of these limits were learned by sending schemas the API refused;
    the third was read from the docs before it could cost a third call. This asserts the whole
    subset boundary in one place so none of them can come back.
  */
  it('uses only keywords the structured-output subset accepts', () => {
    const banned = ['maxItems', 'oneOf', 'minLength', 'maxLength', 'minimum', 'maximum', 'uniqueItems'];
    const walk = (node: unknown, path = ''): void => {
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const here = path === '' ? key : `${path}.${key}`;
        expect(banned, `${here} is outside the supported subset`).not.toContain(key);
        walk(value, here);
      }
    };
    walk(schema);
  });

  it('unions with anyOf, which is supported, not oneOf, which is not', () => {
    expect(props['angles'].items.properties.citations.items.anyOf).toBeDefined();
    expect(props['placement'].properties.citations.items.anyOf).toBeDefined();
  });

  /*
    Every enum written once. Spelling the branches out at each of the six citation sites copied a
    59-value finding enum and a 38-value evidence enum - the latter over four kilobytes per copy -
    and the API answered "Schema is too complex for compilation".
  */
  it('writes each id enum exactly once and points at it', () => {
    const text = JSON.stringify(schema);
    for (const id of ['f-001', 'run-1/layer1/abc.png', 'EYE-01']) {
      const occurrences = text.split(JSON.stringify(id)).length - 1;
      expect(occurrences, `${id} appears ${occurrences} times`).toBe(1);
    }
    expect(text).toContain('#/$defs/');
  });

  it('references only definitions it actually emitted', () => {
    const text = JSON.stringify(schema);
    const pattern = new RegExp('#/[$]defs/[a-zA-Z]+', 'g');
    for (const ref of text.match(pattern) ?? []) {
      expect(Object.keys(defs), ref).toContain(ref.replace('#/$defs/', ''));
    }
  });

  it('leaves the shore-up cap to the validator', () => {
    expect(props['shoreUps'].maxItems).toBeUndefined();
    expect(MAX_SHORE_UPS).toBe(6);
  });

  /*
    Structured outputs accept `minItems` of 0 or 1 only — anything else is a 400 before a token is
    spent. The floors are therefore the validator's, and this asserts the schema does not try to
    carry one, because sending a schema the API refuses costs a whole call.
  */
  it('never asks for a minItems the API will refuse', () => {
    const mins: { path: string; value: number }[] = [];
    const walk = (node: unknown, path = ''): void => {
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const here = path === '' ? key : `${path}.${key}`;
        if (key === 'minItems' && typeof value === 'number') mins.push({ path: here, value });
        else walk(value, here);
      }
    };
    walk(schema);
    for (const { path, value } of mins) {
      expect(value, `${path} asks for minItems ${value}`).toBeLessThanOrEqual(1);
    }
  });

  it('asks for the two placement angles in words, since it cannot in schema', () => {
    expect(props['placement'].properties.citations.description).toContain('at least two different angles');
  });

  it('states the paragraph length as guidance', () => {
    expect(props['placement'].properties.paragraph.description).toContain(`${PARAGRAPH_WORDS} words`);
    expect(props['angles'].items.properties.paragraph.description).toContain(`${PARAGRAPH_WORDS} words`);
    expect(PARAGRAPH_WORDS).toBe(120);
  });

  it('closes every object, so an invented field is not silently accepted', () => {
    const closed = (node: unknown, path = ''): void => {
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record['type'] === 'object') {
        expect(record['additionalProperties'], `${path} is open`).toBe(false);
        expect(record['required'], `${path} has no required list`).toBeDefined();
      }
      for (const [key, value] of Object.entries(record)) closed(value, path === '' ? key : `${path}.${key}`);
    };
    closed(schema);
  });

  /*
    The schema constrains shape; the validator enforces meaning. Distinctness of the two placement
    angles, shore-ups on a consumer placement, legality fixing the recommendation — none of those
    are expressible here, which is why `validateDraft` stays.
  */
  it('does not attempt the rules only the validator can state', () => {
    expect(props['shoreUps'].minItems).toBeUndefined();
  });
});
