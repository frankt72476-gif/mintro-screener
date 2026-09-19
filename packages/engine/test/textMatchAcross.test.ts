/**
 * `text_match` across several surfaces (D-284), against the adult AI rules that use it.
 *
 * The combination is where the two directions differ, so each is driven through its cases: observed
 * on either page; read and not observed with the rest unpublished; a listed page we could not read;
 * nothing read at all.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import {
  checkTextMatchAcross,
  located,
  unreachable,
  NO_GATE,
  runLayer3,
  type PageContext,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const adult = loadRulesetFile(resolve(REPO_ROOT, 'rules/ruleset-adult-ai.json'));
const rule = (id: string) => adult.rules.find((r) => r.id === id) as RuleOfType<'text_match'>;

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
    capturedAt: '2026-09-18T00:00:00.000Z',
  };
}

const at = (url: string, text: string, footer?: string) => located(page(url, text, footer), url, 'test');
const notPublished = unreachable<PageContext>('no guidelines page was reached', []);
const couldNotRead = unreachable<PageContext>('the guidelines page timed out', [], true);

const TERMS_WITHOUT = 'These terms govern your use of the service. Payment is due monthly.';
const GUIDELINES_WITH = 'Do not create underage characters. Content depicting minors is prohibited.';

describe('a present rule across the terms and the guidelines (AIPOL-001)', () => {
  const minors = rule('AIPOL-001');

  it('reports it observed when only the guidelines page says it, with that page as the evidence', () => {
    const finding = checkTextMatchAcross(minors, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: at('https://x.example/guidelines', GUIDELINES_WITH) },
    ]);
    expect(finding.state).toBe('pass');
    expect(finding.note).toMatch(/^On the guidelines page \(https:\/\/x\.example\/guidelines\)/);
    expect(finding.evidence[0]!.sourceUrl).toBe('https://x.example/guidelines');
  });

  it('reports it not observed when the pages read do not say it and the rest were not published', () => {
    const finding = checkTextMatchAcross(minors, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: notPublished },
    ]);
    expect(finding.state).toBe('fail');
    expect(finding.note).toMatch(/Read the terms document/);
    expect(finding.note).toMatch(/Not published: the guidelines page/);
  });

  it('does not report it missing when a listed page could not be read', () => {
    const finding = checkTextMatchAcross(minors, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: couldNotRead },
    ]);
    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('is not evaluable when neither page was read', () => {
    const finding = checkTextMatchAcross(minors, [
      { surface: 'terms', page: notPublished },
      { surface: 'guidelines', page: notPublished },
    ]);
    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_exposed');
  });
});

describe('an absent rule across two pages', () => {
  // A synthetic absent rule on the same machinery: the combination runs the other way.
  const absent: RuleOfType<'text_match'> = {
    ...rule('AIPOL-004'),
    id: 'AITST-001',
    sense: 'absent',
    params: { surfaces: ['terms', 'guidelines'], terms: ['no filter'], word_boundary: true, expect: 'absent' },
  };

  it('reports it observed on the page that carries it', () => {
    const finding = checkTextMatchAcross(absent, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: at('https://x.example/guidelines', 'Chat with no filter at all.') },
    ]);
    expect(finding.state).toBe('fail');
    expect(finding.note).toMatch(/^On the guidelines page/);
  });

  it('never passes over a page it could not read', () => {
    const finding = checkTextMatchAcross(absent, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: couldNotRead },
    ]);
    expect(finding.state).toBe('not_evaluable');
  });

  it('passes when every listed page was read or not published, and none carried it', () => {
    const finding = checkTextMatchAcross(absent, [
      { surface: 'terms', page: at('https://x.example/terms', TERMS_WITHOUT) },
      { surface: 'guidelines', page: notPublished },
    ]);
    expect(finding.state).toBe('pass');
  });
});

describe('the Layer 3 runner resolves surfaces', () => {
  it('reads the removal page from the located page types and the footer from the homepage', () => {
    const run = runLayer3(
      {
        signup: { found: false, reason: 'not looked for', attempts: [] } as never,
        homepage: page('https://x.example/', 'Welcome', 'Terms · Privacy'),
        terms: at('https://x.example/terms', TERMS_WITHOUT),
        shipping: notPublished,
        faq: notPublished,
        payment: notPublished,
        pages: new Map([['removal', at('https://x.example/content-removal', 'Submit a removal request here.')]]),
      },
      adult,
    );
    const removal = run.findings.find((f) => f.ruleId === 'AITD-001')!;
    expect(removal.state).toBe('pass');
    expect(removal.note).toMatch(/^On the content removal page/);
  });
});
