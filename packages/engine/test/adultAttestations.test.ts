/**
 * The adult AI attestation set, as a report assembled under rule set 0.4.0 carries it (cluster 4
 * commit 4; memo §5, §8, §9, §6.4; D-067, D-286).
 *
 * Assembled through `assembleReport` with no findings, so every rule takes the path an unrun rule
 * takes. That is the path a manual rule always takes: it never runs, so what is held here is what
 * every adult run will show for the AIATT- rules.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadRulesetFile } from '@mintro/ruleset';
import {
  ADULT_MULTI_TURN_BOUNDARY,
  adultNotChecked,
  assembleReport,
  notObservedSentence,
  resolveAttestations,
  stateLabelFor,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const adult = loadRulesetFile(resolve(REPO_ROOT, 'rules/ruleset-adult-ai.json'));

const report = assembleReport(
  {
    runId: 'run-adult',
    merchantDomain: 'companion.example',
    mode: 'public',
    startedAt: '2026-09-19T00:00:00.000Z',
    finishedAt: '2026-09-19T00:01:00.000Z',
    findings: [],
    politeness: 'none declared',
  },
  adult,
);
const findings = report.categories.flatMap((c) => c.findings);
const attested = findings.filter((f) => f.ruleId.startsWith('AIATT-'));

describe('the AIATT- rules on an adult report', () => {
  it('are twelve, each "Could not be checked", reached by no crawl', () => {
    expect(attested).toHaveLength(12);
    for (const finding of attested) {
      expect(finding.state, finding.ruleId).toBe('not_evaluable');
      expect(finding.notEvaluableKind, finding.ruleId).toBe('not_reachable');
      expect(stateLabelFor('adult_ai', finding), finding.ruleId).toBe('Could not be checked');
    }
  });

  it('each say, as the report renders them, which question covers them', () => {
    attested.forEach((finding, i) => {
      const question = adult.attestations[i]!;
      const sentence = notObservedSentence(finding);
      expect(sentence, finding.ruleId).toMatch(/^Cannot be verified from a website: whether .+\. The attestation question /);
      expect(sentence, finding.ruleId).toContain(`“${question.question}”`);
      expect(sentence, finding.ruleId).toMatch(/asks the merchant about this\.$/);
    });
  });

  it('sit in their own category, after the observed ones', () => {
    expect(report.categories.map((c) => c.id).at(-1)).toBe('attested');
  });
});

describe('what an adult report snapshots', () => {
  it('the twelve questions, and the three not-checked items', () => {
    expect(report.attestationQuestions).toEqual(adult.attestations);
    expect(report.notChecked).toEqual(adult.not_checked);
  });

  it('resolves every question unanswered on a run nobody answered, with no authority or severity', () => {
    const resolved = resolveAttestations(report.attestationQuestions ?? [], []);
    expect(resolved.questions).toHaveLength(12);
    for (const q of resolved.questions) {
      expect(q.outcome).toBe('unanswered');
      expect('authority' in q).toBe(false);
      expect('sev' in q).toBe(false);
    }
  });
});

describe('the multi-turn boundary (memo §6.4)', () => {
  it('is in the rule set byte for byte as the engine carries it', () => {
    expect(adult.not_checked.find((item) => item.subject === ADULT_MULTI_TURN_BOUNDARY.subject)).toEqual({
      ...ADULT_MULTI_TURN_BOUNDARY,
    });
  });

  it('renders once on a 0.4.0 run, and still renders on a run assembled before 0.4.0', () => {
    expect(adultNotChecked(report.notChecked).filter((i) => i.subject === ADULT_MULTI_TURN_BOUNDARY.subject)).toHaveLength(1);
    expect(adultNotChecked(report.notChecked)).toHaveLength(3);
    // Run 6571d6a9 snapshotted an empty list.
    expect(adultNotChecked([])).toEqual([ADULT_MULTI_TURN_BOUNDARY]);
    expect(adultNotChecked(undefined)).toEqual([ADULT_MULTI_TURN_BOUNDARY]);
  });
});
