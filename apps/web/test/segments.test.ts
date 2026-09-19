/**
 * The declared-categories choice on the scan form (D-287, cluster 2 commit 4).
 */

import { describe, expect, it } from 'vitest';
import { SEGMENT_OPTIONS, UNKNOWN_SEGMENT, toggleSegment } from '../src/lib/segments.js';

describe('SEGMENT_OPTIONS', () => {
  it('offers the eleven categories of memo 3.1 and "I don\'t know", from the policy file', () => {
    expect(SEGMENT_OPTIONS.map((o) => o.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'unknown']);
    expect(SEGMENT_OPTIONS.find((o) => o.id === UNKNOWN_SEGMENT)!.label).toBe("I don't know");
  });

  it('names categories and says nothing about which way the policy goes on them', () => {
    for (const option of SEGMENT_OPTIONS) {
      expect(option.label, option.id).not.toMatch(/\b(refer|referred|referral|prohibited|allowed)\b/i);
    }
  });
});

describe('toggleSegment', () => {
  it('adds and removes categories, in category order', () => {
    expect(toggleSegment([], '4')).toEqual(['4']);
    expect(toggleSegment(['4'], '1')).toEqual(['1', '4']);
    expect(toggleSegment(['1', '4'], '4')).toEqual(['1']);
  });

  it('keeps "I don\'t know" apart from any declared category', () => {
    expect(toggleSegment(['1', '4'], UNKNOWN_SEGMENT)).toEqual([UNKNOWN_SEGMENT]);
    expect(toggleSegment([UNKNOWN_SEGMENT], '2')).toEqual(['2']);
  });
});
