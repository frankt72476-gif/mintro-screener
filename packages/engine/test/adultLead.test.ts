/**
 * The sentence a finding opens with (cluster 4b commit 2; A1, A7).
 *
 * Every sense × state, because the sense is what decides which word a state renders as and a template
 * that read well in one direction could be nonsense in the other: an `absent` rule that failed and a
 * `present` rule that passed are both "Observed", and both sentences have to say what happened.
 *
 * Held as grammar and as vocabulary: one sentence, ending in a full stop, naming the page where there
 * is one, and carrying none of the verdict words.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adultLeadSentence, type ReportFinding, type ScreeningReport } from '../src/index.js';
import { REPO_ROOT } from './paths.js';

/** An evidence row, complete: the capture, where it came from and what it hashed to. */
const capture = (sourceUrl: string) => ({
  kind: 'rendered_page' as const,
  sourceUrl,
  capturedAt: '2026-09-20T00:00:00.000Z',
  evidenceKey: 'run/layer3/abc.png',
  sourceSha256: 'a'.repeat(64),
});

const VERDICT = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/i;

function finding(overrides: Partial<ReportFinding>): ReportFinding {
  return {
    ruleId: 'AIPOL-001',
    title: 'Prohibition of depicting minors',
    clause: 'c',
    state: 'pass',
    note: 'On the terms document: Observed.',
    evidence: [capture('https://www.x.test/terms-of-service')],
    ...overrides,
  } as ReportFinding;
}

describe('every sense and state', () => {
  const cases: { sense: 'absent' | 'present'; state: ReportFinding['state']; expected: string }[] = [
    { sense: 'absent', state: 'fail', expected: 'Prohibition of depicting minors — observed on the terms document.' },
    { sense: 'absent', state: 'pass', expected: 'Prohibition of depicting minors — not observed on the terms document.' },
    { sense: 'present', state: 'fail', expected: 'Prohibition of depicting minors — not observed on the terms document.' },
    { sense: 'present', state: 'pass', expected: 'Prohibition of depicting minors — observed on the terms document.' },
    { sense: 'absent', state: 'not_evaluable', expected: 'Prohibition of depicting minors — could not be checked.' },
    { sense: 'present', state: 'not_evaluable', expected: 'Prohibition of depicting minors — could not be checked.' },
  ];

  it.each(cases)('$sense rule, $state', ({ sense, state, expected }) => {
    const sentence = adultLeadSentence(finding({ sense, state }));

    expect(sentence).toBe(expected);
    // One sentence: a full stop at the end and none inside it.
    expect(sentence.endsWith('.')).toBe(true);
    expect(sentence.slice(0, -1)).not.toContain('.');
    expect(sentence).not.toMatch(VERDICT);
    expect(sentence).not.toMatch(/undefined|null|\[object/);
  });

  it('does not name a page a review state would have', () => {
    // `review` never arises in this rule set, and the sentence still has to be a sentence if it did.
    const sentence = adultLeadSentence(finding({ state: 'review' }));
    expect(sentence).toMatch(/^Prohibition of depicting minors — .+\.$/);
    expect(sentence).not.toMatch(VERDICT);
  });
});

describe('the page it names', () => {
  it.each([
    ['https://www.x.test/', 'homepage'],
    ['https://www.x.test/terms-of-service', 'terms document'],
    ['https://www.x.test/content-removal-policy', 'content removal page'],
    ['https://www.x.test/community-guidelines', 'guidelines page'],
    ['https://www.x.test/pricing', 'pricing page'],
    ['https://www.x.test/create-character', 'creation page'],
    ['https://docs.x.test/character-creation.md', 'docs site'],
  ])('reads %s as the %s', (url, page) => {
    const sentence = adultLeadSentence(
      finding({ state: 'fail', evidence: [capture(url)] }),
    );
    expect(sentence).toBe(`Prohibition of depicting minors — observed on the ${page}.`);
  });

  it('names no page where the finding rests on none', () => {
    expect(adultLeadSentence(finding({ state: 'fail', evidence: [] }))).toBe('Prohibition of depicting minors — observed.');
  });

  it('names no page for a manual rule, whose question the line beneath carries', () => {
    const manual = finding({ state: 'not_evaluable', checkType: 'manual', title: 'Chargeback ratio', evidence: [] });
    expect(adultLeadSentence(manual)).toBe('Chargeback ratio — could not be checked.');
  });
});

describe('over the whole of run 6571d6a9', () => {
  const stored = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'fixtures/adult-ai/xchar.ai-6571d6a9.json'), 'utf8'),
  ) as { report: ScreeningReport };

  it('writes one clean sentence for every finding', () => {
    const findings = stored.report.categories.flatMap((c) => c.findings);
    expect(findings).toHaveLength(16);
    for (const f of findings) {
      const sentence = adultLeadSentence(f);
      expect(sentence, f.ruleId).toMatch(/^.+ — (observed|not observed|could not be checked)( on the .+)?\.$/);
      expect(sentence, f.ruleId).not.toMatch(VERDICT);
      expect(sentence, f.ruleId).not.toMatch(/https?:/);
    }
  });
});
