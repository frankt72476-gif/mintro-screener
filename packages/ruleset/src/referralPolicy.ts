/**
 * How the Mintro Referral Policy is applied at intake (D-287, cluster 2 commit 4).
 *
 * The policy is a Mintro marketing document under Sponsor Agreement 1.1 — not a standard, not a
 * compliance criterion (`docs/referral-policy-adult-ai.md`). What it turns on is data here
 * (`rules/referral-policy-adult-ai.json`): which rules, observed, trigger which ratified line, and
 * which declared categories do. Adding a trigger is a data change; nothing in code names a rule id
 * (hard constraint 1).
 *
 * ## What the result is, and what it is not
 *
 * `proceeds` or `not_referred`, with the reasons naming the policy line and what triggered it. It is
 * recorded on the run and rendered once, in the report's boundary section, as the sentence
 * `referralPolicyLine` builds. It is never a finding, never a verdict about the merchant, and never
 * uses verdict vocabulary.
 *
 * ## What v1.0 applies, and what it does not
 *
 * By feature and by declaration only. P-1 on an upload control or face-swap language observed, or
 * category 7 declared. P-2's one observable leg: minor-coded terms observed, or category 11 declared.
 * P-2's other legs — age constrained at creation, and the attested controls — are cluster 4's
 * (attestations) and are listed in the data as not applied, so a run's reasons never imply they were.
 *
 * Browser-safe and pure: the web form reads the segments from the same file.
 */

import { z } from 'zod';
import { RULE_ID_PATTERN } from './vocabulary.js';

const segmentId = z.string().regex(/^(?:[1-9]|1[01]|unknown)$/, 'must be a category 1–11 or "unknown"');

export const referralPolicySchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+$/),
    document: z.string().min(1),
    note: z.string().min(1),
    segments: z.array(z.object({ id: segmentId, label: z.string().min(1) }).strict()).min(1),
    lines: z
      .array(
        z
          .object({
            id: z.string().regex(/^P-\d+$/),
            observed_any: z.array(z.string().regex(RULE_ID_PATTERN)),
            declared_any: z.array(segmentId),
            legs_not_applied: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .min(1),
    conflicts: z.array(
      z
        .object({
          id: z.literal('segmentation_conflict'),
          declared_only_within: z.array(segmentId).min(1),
          observed_any: z.array(z.string().regex(RULE_ID_PATTERN)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type ReferralPolicy = z.infer<typeof referralPolicySchema>;

export function parseReferralPolicy(value: unknown): ReferralPolicy {
  return referralPolicySchema.parse(value);
}

/** Every rule id the policy names, for checking against the rule set it applies to. */
export function referralPolicyRuleIds(policy: ReferralPolicy): readonly string[] {
  return [...new Set([...policy.lines.flatMap((l) => l.observed_any), ...policy.conflicts.flatMap((c) => c.observed_any)])];
}

export type ReferralStatus = 'proceeds' | 'not_referred';

export interface ReferralOutcome {
  readonly status: ReferralStatus;
  /** Each names the policy line (or `segmentation_conflict`) and what triggered it. */
  readonly reasons: readonly string[];
}

/**
 * Applies the policy to a finished run's declared segments and findings.
 *
 * A rule counts as observed when any finding for it is `fail` or `review` — for the absent-sense
 * feature rules the policy names, that is the feature being there. `not_evaluable` is not observed,
 * and it is not cleared either: v1.0 applies what was seen, and the report's findings say what could
 * not be.
 */
export function applyReferralPolicy(
  policy: ReferralPolicy,
  segments: readonly string[],
  findings: readonly { readonly ruleId: string; readonly state: string }[],
): ReferralOutcome {
  const observed = new Set(findings.filter((f) => f.state === 'fail' || f.state === 'review').map((f) => f.ruleId));
  const declared = new Set(segments);
  const reasons: string[] = [];

  for (const line of policy.lines) {
    for (const id of line.observed_any) if (observed.has(id)) reasons.push(`${line.id}: ${id} observed`);
    for (const id of line.declared_any) if (declared.has(id)) reasons.push(`${line.id}: category ${id} declared`);
  }

  const known = segments.filter((s) => s !== 'unknown');
  for (const conflict of policy.conflicts) {
    const within = known.length > 0 && known.every((s) => conflict.declared_only_within.includes(s));
    const hit = conflict.observed_any.filter((id) => observed.has(id));
    if (within && hit.length > 0) {
      reasons.push(`${conflict.id}: declared ${known.join(', ')}; ${hit.join(', ')} observed`);
    }
  }

  return { status: reasons.length > 0 ? 'not_referred' : 'proceeds', reasons };
}

/**
 * The one sentence the report's boundary section carries (D-287).
 *
 * `Mintro's referral policy v1.0 was applied at intake: proceeds.` or `…: not referred (P-1).` — the
 * policy lines that applied, and a segmentation conflict where there was one. No rule ids, no verdict
 * words: the reasons stay on the run for anyone who needs them.
 */
export function referralPolicyLine(version: string, outcome: ReferralOutcome): string {
  const head = `Mintro's referral policy v${version} was applied at intake`;
  if (outcome.status === 'proceeds') return `${head}: proceeds.`;
  const lines = [...new Set(outcome.reasons.map((r) => r.split(':')[0]!).filter((id) => /^P-\d+$/.test(id)))];
  const conflict = outcome.reasons.some((r) => r.startsWith('segmentation_conflict'));
  const named = [...lines, ...(conflict ? ['segmentation conflict'] : [])];
  return `${head}: not referred (${named.join('; ')}).`;
}
