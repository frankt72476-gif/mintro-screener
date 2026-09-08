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
};

const SPECTRUM = ['consumer_retail', 'mixed', 'research_supplier'];
const PLACEMENTS = ['referred_out', 'international', 'domestic'];

const schema = draftSchema(RUN, SPECTRUM, PLACEMENTS) as Record<string, any>;
const props = schema['properties'] as Record<string, any>;

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
    const branches = props['angles'].items.properties.citations.items.oneOf as Record<string, any>[];
    const finding = branches.find((b) => b.properties.kind.const === 'finding')!;
    expect(finding.properties.ref.enum).toEqual(['f-001', 'f-002']);
  });

  it('constrains evidence and eye-test citations too', () => {
    const branches = props['angles'].items.properties.citations.items.oneOf as Record<string, any>[];
    expect(branches.find((b) => b.properties.kind.const === 'evidence')!.properties.ref.enum).toEqual([
      'run-1/layer1/abc.png',
    ]);
    expect(branches.find((b) => b.properties.kind.const === 'eye_test')!.properties.ref.enum).toEqual([
      'EYE-01',
      'EYE-03',
    ]);
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

  it('constrains a legality item to an evidence key this run holds', () => {
    expect(props['legality'].properties.items.items.properties.evidenceKey.enum).toEqual([
      'run-1/layer1/abc.png',
    ]);
  });
});

describe('the angle citation is placement-only, in the schema as well as the validator', () => {
  it('offers an angle branch on the placement', () => {
    const branches = props['placement'].properties.citations.items.oneOf as Record<string, any>[];
    const angle = branches.find((b) => b.properties.kind.const === 'angle')!;
    expect(angle.properties.ref.enum).toEqual(RUN.angleIds);
  });

  it('offers none anywhere else', () => {
    for (const path of ['angles', 'routing']) {
      const branches = props[path].items.properties.citations.items.oneOf as Record<string, any>[];
      expect(branches.map((b) => b.properties.kind.const), path).not.toContain('angle');
    }
    const shoreUp = props['shoreUps'].items.properties.citation.oneOf as Record<string, any>[];
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
    const branches = blind['properties'].angles.items.properties.citations.items.oneOf as Record<string, any>[];
    expect(branches.map((b) => b.properties.kind.const)).toEqual(['finding', 'evidence']);
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
  it('caps shore-ups', () => {
    expect(props['shoreUps'].maxItems).toBe(MAX_SHORE_UPS);
    expect(MAX_SHORE_UPS).toBe(6);
  });

  it('fixes the angle and routing arrays at the run’s own counts', () => {
    expect(props['angles'].minItems).toBe(3);
    expect(props['angles'].maxItems).toBe(3);
    expect(props['routing'].minItems).toBe(2);
    expect(props['routing'].maxItems).toBe(2);
  });

  it('asks for at least two placement citations', () => {
    expect(props['placement'].properties.citations.minItems).toBe(2);
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
    const text = JSON.stringify(schema);
    expect(text).not.toContain('uniqueItems');
    expect(props['shoreUps'].minItems).toBeUndefined();
  });
});
