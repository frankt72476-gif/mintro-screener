/**
 * The categories an adult AI scan can be declared under (design memo 3.1, D-287).
 *
 * Read from the referral policy's own file, through the same parser the worker applies it with, so
 * the form offers exactly the ids the database accepts (0090) and the policy reads. The labels are
 * the categories' names and nothing else: which way the policy goes on each is not shown on the form.
 */

import { parseReferralPolicy } from '@mintro/ruleset';
import policyJson from '../../../../rules/referral-policy-adult-ai.json';

const policy = parseReferralPolicy(policyJson);

export interface SegmentOption {
  readonly id: string;
  readonly label: string;
}

export const SEGMENT_OPTIONS: readonly SegmentOption[] = policy.segments;

/** The "I don't know" option, which stands alone. */
export const UNKNOWN_SEGMENT = 'unknown';

/**
 * The selection after toggling one option.
 *
 * "I don't know" and a declared category contradict each other, so choosing one clears the other: a
 * request is either a declaration or an absence of one, never both.
 */
export function toggleSegment(selected: readonly string[], id: string): readonly string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  if (id === UNKNOWN_SEGMENT) return [UNKNOWN_SEGMENT];
  return [...selected.filter((s) => s !== UNKNOWN_SEGMENT), id].sort((a, b) => order(a) - order(b));
}

function order(id: string): number {
  return id === UNKNOWN_SEGMENT ? Infinity : Number(id);
}
