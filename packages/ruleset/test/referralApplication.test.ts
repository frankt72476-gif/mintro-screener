/**
 * Applying the Mintro Referral Policy, Adult AI v1.0 at intake (D-287, cluster 2 commit 4).
 *
 * Each trigger on its own; the conflict and the cases that are not one; the one sentence the report
 * carries; and the three places the policy's data has to agree with something else — the version the
 * run is stamped with, the rule set whose ids it names, and the segment ids the database accepts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VERTICAL_FILES,
  applyReferralPolicy,
  loadReferralPolicy,
  loadRulesetForVertical,
  referralPolicyLine,
  referralPolicyRuleIds,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const policy = loadReferralPolicy('adult_ai', REPO_ROOT)!;
const observed = (...ids: string[]) => ids.map((ruleId) => ({ ruleId, state: 'fail' }));
const apply = (segments: string[], findings: { ruleId: string; state: string }[]) =>
  applyReferralPolicy(policy, segments, findings);

describe('each trigger', () => {
  it('proceeds when nothing triggers', () => {
    expect(apply(['1'], [{ ruleId: 'AIFEAT-001', state: 'pass' }])).toEqual({ status: 'proceeds', reasons: [] });
  });

  it('P-1 on an upload control observed', () => {
    expect(apply(['2'], observed('AIFEAT-001'))).toEqual({ status: 'not_referred', reasons: ['P-1: AIFEAT-001 observed'] });
  });

  it('P-1 on face-swap language observed', () => {
    expect(apply(['2'], observed('AIFEAT-002'))).toEqual({ status: 'not_referred', reasons: ['P-1: AIFEAT-002 observed'] });
  });

  it('P-2 on minor-coded terms observed', () => {
    expect(apply(['2'], observed('AICAT-001'))).toEqual({ status: 'not_referred', reasons: ['P-2: AICAT-001 observed'] });
  });

  it('category 7 and category 11, as declarations', () => {
    expect(apply(['7'], [])).toEqual({ status: 'not_referred', reasons: ['P-1: category 7 declared'] });
    expect(apply(['11'], [])).toEqual({ status: 'not_referred', reasons: ['P-2: category 11 declared'] });
  });

  it('counts a review finding as observed, and never a not_evaluable one', () => {
    expect(apply(['2'], [{ ruleId: 'AICAT-001', state: 'review' }]).status).toBe('not_referred');
    expect(apply(['2'], [{ ruleId: 'AICAT-001', state: 'not_evaluable' }]).status).toBe('proceeds');
  });

  it('does not apply P-2\'s other legs, and says so in the data', () => {
    const p2 = policy.lines.find((line) => line.id === 'P-2')!;
    expect(p2.legs_not_applied).toEqual([
      'age constrained at character creation',
      'output-side moderation, CSAM hash-matching and NCMEC reporting in place',
    ]);
  });
});

describe('segmentation conflict', () => {
  it('is recorded when a product declared only as 1 or 4 shows an upload control', () => {
    expect(apply(['1'], observed('AIFEAT-001')).reasons).toEqual([
      'P-1: AIFEAT-001 observed',
      'segmentation_conflict: declared 1; AIFEAT-001 observed',
    ]);
    expect(apply(['1', '4'], observed('AIFEAT-001')).reasons).toContain(
      'segmentation_conflict: declared 1, 4; AIFEAT-001 observed',
    );
  });

  it('is not recorded when the declaration already includes a category outside 1 and 4, or is "I don\'t know"', () => {
    expect(apply(['1', '2'], observed('AIFEAT-001')).reasons).not.toContainEqual(expect.stringMatching(/^segmentation_conflict/));
    expect(apply(['unknown'], observed('AIFEAT-001')).reasons).not.toContainEqual(expect.stringMatching(/^segmentation_conflict/));
  });
});

describe('the sentence the report carries', () => {
  it('reads as the policy being applied, with the lines that applied', () => {
    expect(referralPolicyLine('1.0', apply(['2'], []))).toBe("Mintro's referral policy v1.0 was applied at intake: proceeds.");
    expect(referralPolicyLine('1.0', apply(['2'], observed('AIFEAT-001')))).toBe(
      "Mintro's referral policy v1.0 was applied at intake: not referred (P-1).",
    );
    expect(referralPolicyLine('1.0', apply(['2'], observed('AIFEAT-001', 'AIFEAT-002', 'AICAT-001')))).toBe(
      "Mintro's referral policy v1.0 was applied at intake: not referred (P-1; P-2).",
    );
    expect(referralPolicyLine('1.0', apply(['1'], observed('AIFEAT-001')))).toBe(
      "Mintro's referral policy v1.0 was applied at intake: not referred (P-1; segmentation conflict).",
    );
  });

  it('carries no rule id and no verdict word', () => {
    const line = referralPolicyLine('1.0', apply(['1'], observed('AIFEAT-001', 'AICAT-001')));
    expect(line).not.toMatch(/AI[A-Z]+-\d{3}/);
    expect(line).not.toMatch(/\b(fail|pass|blocker|clean|compliant|recommend)\w*/i);
  });
});

describe('the policy data agrees with what it depends on', () => {
  it('is the version adult_ai runs are stamped with, and the document it applies', () => {
    expect(policy.version).toBe(VERTICAL_FILES.adult_ai.referralPolicy!.version);
    expect(policy.document).toBe(VERTICAL_FILES.adult_ai.referralPolicy!.document);
  });

  it('names only rules the adult rule set has', () => {
    const known = new Set(loadRulesetForVertical('adult_ai', REPO_ROOT).rules.map((rule) => rule.id));
    expect(referralPolicyRuleIds(policy).filter((id) => !known.has(id))).toEqual([]);
  });

  it('offers exactly the segment ids migration 0090 accepts, on both tables', () => {
    const sql = readFileSync(resolve(REPO_ROOT, 'supabase/migrations/0090_segments_and_referral.sql'), 'utf8');
    const arrays = [...sql.matchAll(/segments <@ array\[([^\]]*)\]::text\[\]/g)].map((m) =>
      m[1]!.split(',').map((v) => v.trim().replace(/'/g, '')),
    );
    expect(arrays).toHaveLength(2);
    for (const ids of arrays) expect(ids).toEqual(policy.segments.map((s) => s.id));
  });

  it('has none for peptides', () => {
    expect(loadReferralPolicy('peptides', REPO_ROOT)).toBeNull();
  });
});
