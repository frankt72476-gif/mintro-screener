/**
 * The angle set, against the rule set it ships with (D-260).
 *
 * The assertion that matters is **coverage**: every non-legality rule feeds at least one angle. A
 * rule the angle set does not name is a check that runs, produces a finding, and reaches no part of
 * the reasoning — and the failure is invisible in the worst direction, because the evaluation would
 * read as complete with a whole category of evidence unconsulted.
 *
 * Every rule below has a negative that is confirmed to bite. The committed file is mutated into the
 * exact defect and the defect is asserted by its message.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANGLE_IDS,
  PLACEMENT_IDS,
  ROUTING_CONDITION_COUNT,
  SPECTRUM_IDS,
  checkAngleSet,
  eyeTestItemIds,
  loadAngleSetFile,
  loadRulesetFile,
  parseAngleSet,
  type AngleSet,
} from '../src/index.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const ANGLES_FILE = resolve(REPO_ROOT, 'rules/angles.json');
const RUBRIC_FILE = resolve(REPO_ROOT, 'rules/eyetest.json');

const ruleset = loadRulesetFile(RULESET_PATH);
const items = eyeTestItemIds(RUBRIC_FILE) ?? [];
const angles = loadAngleSetFile(ruleset, ANGLES_FILE, RUBRIC_FILE);

/** A deep copy of the committed file, for mutating into one defect at a time. */
function copy(): AngleSet {
  return JSON.parse(readFileSync(ANGLES_FILE, 'utf8')) as AngleSet;
}

function messages(mutated: AngleSet): string {
  return checkAngleSet(mutated, ruleset, items)
    .map((d) => `${d.path}: ${d.message}`)
    .join(' | ');
}

describe('rules/angles.json', () => {
  it('loads and validates against the committed rule set', () => {
    expect(angles.version).toBe('1.0.0');
    expect(angles.model).toBe('claude-opus-5');
    expect(checkAngleSet(angles, ruleset, items)).toEqual([]);
  });

  it('carries the seven angles in the memo order', () => {
    expect(angles.angles.map((a) => a.id)).toEqual([...ANGLE_IDS]);
  });

  it('carries the five-position spectrum and the three placements', () => {
    expect(angles.spectrum.map((s) => s.id)).toEqual([...SPECTRUM_IDS]);
    expect(angles.placements).toEqual([...PLACEMENT_IDS]);
    for (const entry of angles.spectrum) expect(entry.label.length).toBeGreaterThan(0);
  });

  /*
    Five, not six. D-256 named four conditions and one to be added; the memo and
    docs/report-layout-design.md both said six. D-260 settles it at five and corrects the layout
    memo. Pinned here so the count cannot drift back on either reading.
  */
  it('carries exactly five routing conditions, each with a label', () => {
    expect(angles.routingConditions).toHaveLength(ROUTING_CONDITION_COUNT);
    expect(angles.routingConditions.map((c) => c.id)).toEqual([
      'registration_gate',
      'no_water_or_syringes',
      'order_minimum_150',
      'monthly_volume_70k',
      'no_affiliate_marketing',
    ]);
    for (const condition of angles.routingConditions) {
      expect(condition.label.length).toBeGreaterThan(0);
    }
  });

  it('says where an unobservable condition is answered instead', () => {
    for (const condition of angles.routingConditions) {
      if (condition.observable) expect(condition.ruleIds.length).toBeGreaterThan(0);
      else expect(condition.source).toBeDefined();
    }
  });

  it('carries the guardrails as prose the prompt builder includes verbatim', () => {
    expect(angles.guardrails).toHaveLength(5);
    expect(angles.guardrails[0]).toContain('Cite only captured evidence');
    expect(angles.guardrails.join(' ')).toContain('No pricing, no cost comparison');
    expect(angles.guardrails.join(' ')).toContain('never drafted for a business placed on the consumer side');
  });
});

describe('coverage: every non-legality rule feeds an angle', () => {
  it('holds across the committed pair', () => {
    const covered = new Set(angles.angles.flatMap((a) => a.ruleIds));
    const missed = ruleset.rules
      .filter((r) => r.evaluation_tier !== 'legality' && !covered.has(r.id))
      .map((r) => r.id);
    expect(missed).toEqual([]);
  });

  /*
    Legality rules are exempt, never forbidden. A legality item ends the evaluation on its own so it
    does not need an angle to be heard — but PAY-001 is also evidence about how the merchant sells,
    and removing it from angle 3 would lose that.
  */
  it('exempts legality rules without excluding them', () => {
    const legality = ruleset.rules.filter((r) => r.evaluation_tier === 'legality').map((r) => r.id);
    const covered = new Set(angles.angles.flatMap((a) => a.ruleIds));
    expect(legality.filter((id) => covered.has(id))).toEqual(['PAY-001']);
    expect(checkAngleSet(angles, ruleset, items)).toEqual([]);
  });

  it('rejects a non-legality rule dropped from every angle', () => {
    const mutated = copy();
    mutated.angles = mutated.angles.map((a) => ({
      ...a,
      ruleIds: a.ruleIds.filter((id) => id !== 'COA-004'),
    }));
    expect(messages(mutated)).toContain("COA-004");
    expect(messages(mutated)).toContain('appears in no angle');
  });

  it('does not reject a legality rule dropped from every angle', () => {
    const mutated = copy();
    mutated.angles = mutated.angles.map((a) => ({
      ...a,
      ruleIds: a.ruleIds.filter((id) => id !== 'PAY-001'),
    }));
    expect(checkAngleSet(mutated, ruleset, items)).toEqual([]);
  });
});

describe('references are checked in both directions', () => {
  it('rejects a rule id that is not in the rule set', () => {
    const mutated = copy();
    mutated.angles[0]!.ruleIds = [...mutated.angles[0]!.ruleIds, 'PROD-999'];
    expect(messages(mutated)).toContain("'PROD-999' is not a rule in this rule set");
  });

  it('rejects an eye-test item that is not in the rubric', () => {
    const mutated = copy();
    mutated.angles[0]!.eyeTestItemIds = [...mutated.angles[0]!.eyeTestItemIds, 'EYE-99'];
    expect(messages(mutated)).toContain("'EYE-99' is not an item in the eye-test rubric");
  });

  it('rejects a routing condition naming a rule that does not exist', () => {
    const mutated = copy();
    mutated.routingConditions[0]!.ruleIds = ['GATE-999'];
    expect(messages(mutated)).toContain("'GATE-999' is not a rule in this rule set");
  });

  it('maps every rubric item to some angle, so none is asked and never read', () => {
    const mapped = new Set(angles.angles.flatMap((a) => a.eyeTestItemIds));
    expect([...items].filter((id) => !mapped.has(id))).toEqual([]);
  });
});

describe('the shape rules', () => {
  it('rejects a missing angle', () => {
    const mutated = copy();
    mutated.angles = mutated.angles.slice(0, 6);
    expect(messages(mutated)).toContain('expected 7 angles, found 6');
  });

  it('rejects the angles in a different order', () => {
    const mutated = copy();
    [mutated.angles[0], mutated.angles[1]] = [mutated.angles[1]!, mutated.angles[0]!];
    expect(messages(mutated)).toContain("expected 'who_it_talks_to' at position 0");
  });

  it('rejects a sixth routing condition', () => {
    const mutated = copy();
    mutated.routingConditions = [
      ...mutated.routingConditions,
      { id: 'sixth', label: 'Sixth', ruleIds: [], observable: false, source: 'application' },
    ];
    expect(messages(mutated)).toContain('expected exactly 5 routing conditions');
  });

  it('rejects an observable condition that names no rule observing it', () => {
    const mutated = copy();
    mutated.routingConditions[0]!.ruleIds = [];
    expect(messages(mutated)).toContain('declared observable and names no rule');
  });

  it('rejects an unobservable condition with no source', () => {
    const mutated = copy();
    delete (mutated.routingConditions[2] as { source?: string }).source;
    expect(messages(mutated)).toContain('must say where it is answered instead');
  });

  it('rejects a reordered spectrum', () => {
    const mutated = copy();
    mutated.spectrum = [...mutated.spectrum].reverse();
    expect(messages(mutated)).toContain('the five ratified positions in order');
  });
});

describe('parseAngleSet refuses a malformed document outright', () => {
  it('names the missing field rather than loading a partial set', () => {
    const mutated = copy() as unknown as Record<string, unknown>;
    delete mutated['model'];
    expect(() => parseAngleSet(mutated, ruleset, items, 'fixture')).toThrow(/model/);
  });

  it('refuses an unknown top-level key rather than ignoring it', () => {
    const mutated = copy() as unknown as Record<string, unknown>;
    mutated['weights'] = { who_it_talks_to: 2 };
    expect(() => parseAngleSet(mutated, ruleset, items, 'fixture')).toThrow();
  });

  it('reports every defect at once, not the first', () => {
    const mutated = copy();
    mutated.angles[0]!.ruleIds = [...mutated.angles[0]!.ruleIds, 'PROD-999'];
    mutated.routingConditions[0]!.ruleIds = ['GATE-999'];
    try {
      parseAngleSet(mutated, ruleset, items, 'fixture');
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as Error).message).toContain('PROD-999');
      expect((error as Error).message).toContain('GATE-999');
      expect((error as Error).message).toContain('2 defect(s)');
    }
  });
});

describe('the rubric is read for its ids and nothing else', () => {
  it('returns every item id', () => {
    expect(eyeTestItemIds(RUBRIC_FILE)).toHaveLength(14);
  });

  /*
    A missing rubric is reported once, as a rubric problem. Reporting it as fourteen defects about
    ids that are perfectly correct would send someone editing angles.json to fix eyetest.json.
  */
  it('returns null rather than an empty list when the file is unreadable', () => {
    expect(eyeTestItemIds(resolve(REPO_ROOT, 'rules/does-not-exist.json'))).toBeNull();
  });
});
