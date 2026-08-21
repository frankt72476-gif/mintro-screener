/**
 * Every fixture in `fixtures/ruleset/malformed/` must fail to load, and must fail for the
 * stated reason at the stated rule.
 *
 * "Must fail" alone is a weak assertion — a loader that rejected everything would pass it.
 * Each case therefore pins the rule the defect is attributed to and a fragment of the
 * message, so a defect being reported against the wrong rule, or with a message that does not
 * explain the problem, fails the test.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { loadRulesetFile, RulesetValidationError } from '../src/index.js';
import { MALFORMED_DIR, malformed } from './paths.js';

/** Loads a fixture expected to be invalid and returns the error it threw. */
function expectRejected(name: string): RulesetValidationError {
  try {
    loadRulesetFile(malformed(name));
  } catch (error) {
    if (error instanceof RulesetValidationError) return error;
    throw error;
  }
  throw new Error(`fixture '${name}' was expected to be rejected, but it loaded successfully`);
}

interface Case {
  /** Fixture basename, without `.json`. */
  readonly fixture: string;
  /** Rule the defect must be attributed to, or `null` for a document-level defect. */
  readonly ruleId: string | null;
  /** Fragment the message must contain, lowercased before comparison. */
  readonly message: string;
  /** What this fixture is protecting against. */
  readonly why: string;
}

const CASES: readonly Case[] = [
  // --- params: the shapes that would otherwise produce a false pass ---------------------
  {
    fixture: 'unknown-param-key',
    ruleId: 'PROD-001',
    message: 'pattrens',
    why: 'a misspelt param would match nothing and the runner would report pass',
  },
  {
    fixture: 'missing-required-param',
    ruleId: 'PROD-003',
    message: 'required',
    why: 'co-occurrence with no window cannot co-occur anything',
  },
  {
    fixture: 'empty-term-list',
    ruleId: 'PROD-001',
    message: 'at least 1',
    why: 'an empty pattern list checks nothing and always passes',
  },
  {
    fixture: 'no-matcher',
    ruleId: 'PROD-002',
    message: 'at least one matcher',
    why: 'a text_match with nothing to match examines the page and concludes nothing',
  },
  {
    fixture: 'no-assertion',
    ruleId: 'GATE-002',
    message: 'at least one assertion',
    why: 'a dom_assert with no expect, collect or detect does nothing',
  },
  {
    fixture: 'extract-without-assertion',
    ruleId: 'PROD-004',
    message: 'asserts nothing about it',
    why: 'extracting purity and comparing it to nothing always passes',
  },
  {
    fixture: 'uncompilable-regex',
    ruleId: 'PROD-002',
    message: 'not a valid regular expression',
    why: 'the regex must be rejected at load, not at first use mid-crawl',
  },
  {
    fixture: 'unknown-surface',
    ruleId: 'PROD-002',
    message: 'invalid enum value',
    why: 'the crawler cannot reach a surface it has no definition for',
  },
  {
    fixture: 'empty-manual-reason',
    ruleId: 'GATE-001',
    message: 'at least 1 character',
    why: 'a manual rule with no reason leaves an unexplained gap in the report',
  },

  // --- structure -----------------------------------------------------------------------
  {
    fixture: 'unknown-check-type',
    ruleId: 'PROD-001',
    message: 'screenshot_compare',
    why: 'a check type with no handler cannot be executed',
  },
  {
    fixture: 'unknown-rule-field',
    ruleId: 'PROD-001',
    message: 'owner',
    why: 'a stray field is usually a misspelling of a real one',
  },

  // --- identity ------------------------------------------------------------------------
  {
    fixture: 'bad-rule-id-format',
    ruleId: 'PROD1',
    message: 'prefix-001',
    why: 'rule IDs are stable identifiers and appear in every finding',
  },
  {
    fixture: 'duplicate-rule-id',
    ruleId: 'PROD-001',
    message: 'duplicate rule id',
    why: 'two rules sharing an ID means two findings claiming one identity',
  },
  {
    fixture: 'missing-rule-id',
    ruleId: null,
    message: 'required',
    why: 'a rule with no ID must still be locatable, by index',
  },
  {
    fixture: 'unknown-category',
    ruleId: 'PROD-001',
    message: 'unknown category',
    why: 'an unfiled finding has nowhere to appear in the report',
  },
  {
    fixture: 'prefix-mismatch',
    ruleId: 'PROD-001',
    message: 'does not match category',
    why: 'D-008 — the prefix/category mapping is declared data and must hold',
  },
  {
    fixture: 'duplicate-category-prefix',
    ruleId: null,
    message: 'duplicate category prefix',
    why: 'a shared prefix makes prefix-matches-category undecidable',
  },

  // --- declared subjects (D-015) --------------------------------------------------------
  {
    fixture: 'dangling-target-rule',
    ruleId: 'GATE-003',
    message: 'is not in the rule set',
    why: 'a dangling reference would leave a critical rule with no subject, silently disabling it',
  },
  {
    fixture: 'self-referencing-target',
    ruleId: 'GATE-003',
    message: 'references itself',
    why: 'a rule cannot define its own subject',
  },
  {
    fixture: 'computed-style-no-target',
    ruleId: 'GATE-003',
    message: 'target_phrases_from',
    why: 'a computed_style rule that does not say what it measures leaves the engine to infer it',
  },

  // --- cross-field invariants ----------------------------------------------------------
  {
    fixture: 'cooccurrence-auto-fail',
    ruleId: 'PROD-003',
    message: "must be tier 'review_only'",
    why: 'hard constraint 4 — ambiguous checks never auto-fail',
  },
  {
    fixture: 'manual-auto-fail',
    ruleId: 'GATE-001',
    message: "must be tier 'review_only'",
    why: 'a manual check never runs, so it can never observe a violation',
  },
  {
    fixture: 'manual-with-layer',
    ruleId: 'GATE-001',
    message: 'must have layer null',
    why: 'a manual rule queued for a crawl layer would be crawled and still not evaluable',
  },
  {
    fixture: 'non-manual-null-layer',
    ruleId: 'PROD-002',
    message: 'needs a crawl layer',
    why: 'the runner has no point at which to run a layerless crawlable rule',
  },

  // --- document header -----------------------------------------------------------------
  {
    fixture: 'three-states',
    ruleId: null,
    message: 'exactly the four states',
    why: 'hard constraint 2 — dropping not_evaluable is how unobservable becomes pass',
  },
  {
    fixture: 'bad-version',
    ruleId: null,
    message: 'semantic version',
    why: 'runs.ruleset_version is not optional and must be meaningful',
  },
  {
    fixture: 'missing-version',
    ruleId: null,
    message: 'required',
    why: 'a finding without a rule set version cannot be interpreted later',
  },
];

describe('malformed fixtures', () => {
  it.each(CASES)('rejects $fixture — $why', ({ fixture, ruleId, message }) => {
    const error = expectRejected(fixture);

    const matching = error.defects.filter((defect) =>
      defect.message.toLowerCase().includes(message.toLowerCase()),
    );

    expect(
      matching,
      `no defect mentioned '${message}'. Reported:\n${error.message}`,
    ).not.toHaveLength(0);

    if (ruleId !== null) {
      expect(
        matching.map((defect) => defect.ruleId),
        `defect was not attributed to ${ruleId}. Reported:\n${error.message}`,
      ).toContain(ruleId);
    }
  });

  it('reports every defect in one pass rather than stopping at the first', () => {
    const error = expectRejected('multiple-defects');

    // The fixture breaks four unrelated things. A loader that bailed on the first would
    // report one, and the rule set would take four edit-run cycles to fix.
    expect(error.defects.length).toBeGreaterThanOrEqual(4);
    expect(error.affectedRuleIds).toEqual(
      expect.arrayContaining(['PROD-001', 'PROD-002', 'PROD-003', 'GATE-001']),
    );
  });

  it('names the source file and every defect in the thrown message', () => {
    const error = expectRejected('cooccurrence-auto-fail');
    expect(error.message).toContain('cooccurrence-auto-fail.json');
    expect(error.message).toContain('PROD-003');
    expect(error.message).toContain('1 defect');
  });

  it('locates a defect by path when the rule id itself is missing', () => {
    const error = expectRejected('missing-rule-id');
    const defect = error.defects.find((d) => d.path.startsWith('rules[1]'));
    expect(defect, `expected a defect at rules[1]. Reported:\n${error.message}`).toBeDefined();
    // No id to name it by, so it must not claim one.
    expect(defect?.ruleId).toBeUndefined();
  });

  it('covers every fixture in the malformed directory', () => {
    // Guards against a fixture being added and quietly never asserted on.
    const onDisk = readdirSync(MALFORMED_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();

    const covered = [...CASES.map((c) => c.fixture), 'multiple-defects'].sort();

    expect(covered).toEqual(onDisk);
  });

  it('rejects every fixture in the malformed directory', () => {
    const onDisk = readdirSync(MALFORMED_DIR).filter((name) => name.endsWith('.json'));
    expect(onDisk.length).toBeGreaterThan(0);

    for (const name of onDisk) {
      expect(() => loadRulesetFile(malformed(name.replace(/\.json$/, '')))).toThrow(
        RulesetValidationError,
      );
    }
  });
});
