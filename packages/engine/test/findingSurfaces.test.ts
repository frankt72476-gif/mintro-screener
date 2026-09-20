/**
 * What a finding records about the surfaces it read (cluster 4b commit 5).
 *
 * The runners that read more than one surface already knew which pages they reached, which the site
 * does not publish, and which it publishes and they could not read. That reached the report only as
 * prose in the note. Snapshotted, it reaches the report as facts, and the sentence a reader sees is
 * composed from them rather than parsed back out of a sentence (D-216).
 *
 * Held both ways round: a finding of the new shape renders its surfaces, and one from before them —
 * run 6571d6a9, which is every adult finding recorded so far — still renders through the page its
 * capture is of. A run says what it said (D-002).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import {
  adultIndexRows,
  adultLeadSentence,
  checkTextMatchAcross,
  located,
  unreachable,
  whereWords,
  NO_GATE,
  type PageContext,
  type ReportFinding,
  type ScreeningReport,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const adult = loadRulesetFile(resolve(REPO_ROOT, 'rules/ruleset-adult-ai.json'));
const rule = (id: string): RuleOfType<'text_match'> => adult.rules.find((r) => r.id === id) as RuleOfType<'text_match'>;

function page(url: string, text: string, footer = ''): PageContext {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: 'Page',
    text,
    html: `<html><body>${text}</body></html>`,
    htmlSha256: 'a'.repeat(64),
    footer: { found: true, text: footer, styledText: [], locatedBy: '<footer>' },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-20T00:00:00.000Z',
  };
}

const at = (url: string, text: string, footer?: string) => located(page(url, text, footer), url, 'test');

/** AITD-001 reads the footer and the removal page, and looks for a removal route (`sense: present`). */
const removalRoute = rule('AITD-001');
const HOME = 'https://www.x.test/';

describe('a rule that read the footer and found no removal page', () => {
  const finding = checkTextMatchAcross(removalRoute, [
    { surface: 'footer', page: at(HOME, 'Companion', 'Terms Privacy') },
    { surface: 'removal', page: unreachable<PageContext>('no content removal page was reached', []) },
  ]);

  it('records each surface and what became of it', () => {
    expect(finding.surfaces).toEqual([
      { surface: 'footer', status: 'read' },
      { surface: 'removal', status: 'not_published' },
    ]);
  });

  it('reads as the footer, not as the page holding it', () => {
    const report = { ...finding, title: 'Content removal route', clause: 'c', sense: 'present' } as ReportFinding;
    expect(whereWords(report)).toBe('footer');
    expect(adultLeadSentence(report)).toBe('Content removal route — not observed in the footer; removal page not published.');
  });
});

describe('a rule whose second surface was there and could not be read', () => {
  const finding = checkTextMatchAcross(removalRoute, [
    { surface: 'footer', page: at(HOME, 'Companion', 'Terms Privacy') },
    { surface: 'removal', page: unreachable<PageContext>('the removal page timed out', [], true) },
  ]);

  it('says so, and does not call it missing', () => {
    expect(finding.surfaces).toEqual([
      { surface: 'footer', status: 'read' },
      { surface: 'removal', status: 'unreadable' },
    ]);

    const report = { ...finding, title: 'Content removal route', clause: 'c', sense: 'present' } as ReportFinding;
    const sentence = adultLeadSentence(report);
    expect(sentence).toContain('removal page could not be read');
    expect(sentence).not.toContain('not published');
  });
});

describe('a rule that read both of its surfaces', () => {
  const minors = rule('AIPOL-001');
  const finding = checkTextMatchAcross(minors, [
    { surface: 'terms', page: at('https://www.x.test/terms-of-service', 'No minors are depicted.') },
    { surface: 'guidelines', page: at('https://www.x.test/community-guidelines', 'House rules.') },
  ]);

  it('names both, and the sentence takes them as a list', () => {
    expect(finding.surfaces?.every((s) => s.status === 'read')).toBe(true);
    const report = { ...finding, title: 'Prohibition of depicting minors', clause: 'c', sense: 'present' } as ReportFinding;
    expect(whereWords(report)).toBe('terms document and guidelines page');
    expect(adultLeadSentence(report)).toMatch(
      /^Prohibition of depicting minors — (observed|not observed) on the terms document and guidelines page\.$/,
    );
  });
});

describe('run 6571d6a9, recorded before surfaces were snapshotted', () => {
  const stored = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'fixtures/adult-ai/xchar.ai-6571d6a9.json'), 'utf8'),
  ) as { report: ScreeningReport };
  const findings = stored.report.categories.flatMap((c) => c.findings);

  it('carries none, and still says where each finding rests', () => {
    expect(findings.every((f) => f.surfaces === undefined)).toBe(true);
    expect(new Set(findings.map((f) => whereWords(f)))).toEqual(
      new Set(['homepage', 'terms document', 'docs site']),
    );
  });

  it('still renders one sentence per finding, and one index row', () => {
    for (const finding of findings) {
      expect(adultLeadSentence(finding), finding.ruleId).toMatch(/^.+ — (observed|not observed|could not be checked)( on the .+)?\.$/);
    }
    expect(adultIndexRows(stored.report)).toHaveLength(16);
  });
});
