/**
 * The `dom_feature` detectors (cluster 2 commit 3), each on a fixture page, against the adult AI rules
 * that use them.
 *
 * Context is deliberately not disambiguated, and one case holds that: a prohibition sentence carrying
 * a listed phrase still matches, and the finding carries the capture so a reader sees the sentence.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import {
  checkDomFeature,
  detectDomFeature,
  located,
  NO_GATE,
  runLayer3,
  unreachable,
  type PageContext,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const adult = loadRulesetFile(resolve(REPO_ROOT, 'rules/ruleset-adult-ai.json'));
const rule = (id: string) => adult.rules.find((r) => r.id === id) as RuleOfType<'dom_feature'>;

function page(url: string, text: string, html = `<html><body>${text}</body></html>`, footer = ''): PageContext {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: 'Page',
    text,
    html,
    htmlSha256: 'a'.repeat(64),
    footer: { found: true, text: footer, styledText: [], locatedBy: '<footer>' },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-19T00:00:00.000Z',
  };
}

const notPublished = unreachable<PageContext>('no page of this type was reached', []);
const couldNotRead = unreachable<PageContext>('the page timed out', [], true);
const at = (p: PageContext) => ({ found: located(p, p.finalUrl, 'test'), pages: [p] });

describe('upload_control (AIFEAT-001)', () => {
  const upload = rule('AIFEAT-001');

  it('detects a file input on any listed page', () => {
    const pricing = page('https://x.example/pricing', 'Plans', '<form><input type="file" accept="image/*"></form>');
    expect(detectDomFeature(upload, 'pricing', pricing)).toEqual(['a file input (input[type=file])']);
  });

  it('detects an element named as a drop zone', () => {
    const create = page('https://x.example/create', 'Create', '<div role="button" aria-label="Image dropzone"></div>');
    expect(detectDomFeature(upload, 'create', create)).toContain('an element named as a drop zone');
  });

  it('reads the wording signals on creation and generation pages only', () => {
    const wording = 'Drag and drop a reference image to start.';
    expect(detectDomFeature(upload, 'create', page('https://x.example/create', wording))).toEqual([
      'drag and drop',
      'reference image',
    ]);
    expect(detectDomFeature(upload, 'pricing', page('https://x.example/pricing', wording))).toEqual([]);
  });

  it('reports it observed with the page as the evidence, and names where', () => {
    const create = page('https://x.example/character/new', 'Use your photo as a starting point.');
    const finding = checkDomFeature(upload, [
      { surface: 'create', ...at(create) },
      { surface: 'generate', found: notPublished, pages: [] },
      { surface: 'pricing', found: notPublished, pages: [] },
      { surface: 'docs', found: notPublished, pages: [] },
    ]);
    expect(finding.state).toBe('fail');
    expect(finding.note).toMatch(/^Observed on the character creation page \(https:\/\/x\.example\/character\/new\): 'use your photo'/);
    expect(finding.evidence[0]).toMatchObject({ sourceUrl: 'https://x.example/character/new', matchedValue: 'use your photo' });
  });
});

describe('lexicon', () => {
  it('matches whole tokens only (AICAT-001)', () => {
    const minors = rule('AICAT-001');
    expect(detectDomFeature(minors, 'library', page('https://x.example/characters', 'Mia is a petite schoolgirl'))).toEqual([
      'schoolgirl',
      'petite',
    ]);
    expect(detectDomFeature(minors, 'library', page('https://x.example/characters', 'A lollipop and a fifteen-minute chat'))).toEqual([]);
  });

  it('still matches a phrase inside a prohibition sentence, and says the sentence was not read for meaning', () => {
    const minors = rule('AICAT-001');
    const guidelines = page('https://x.example/create', 'We do not allow loli content on this platform.');
    expect(detectDomFeature(minors, 'create', guidelines)).toEqual(['loli']);
    const finding = checkDomFeature(minors, [
      { surface: 'homepage', found: notPublished, pages: [] },
      { surface: 'create', ...at(guidelines) },
      { surface: 'generate', found: notPublished, pages: [] },
      { surface: 'library', found: notPublished, pages: [] },
    ]);
    expect(finding.state).toBe('fail');
    expect(finding.note).toMatch(/it was not read for meaning/);
    expect(minors.params.note).toMatch(/Context is not disambiguated/);
  });

  it('matches inflected and separated forms the way NAME-002 does (AIFEAT-004, AICAT-002)', () => {
    // `-as` endings are not folded (D-159's guard), so `lora` does not reach "LoRAs" — which is why the
    // rule lists `loras` as well, and the plural is caught by it.
    expect(detectDomFeature(rule('AIFEAT-004'), 'docs', page('https://docs.x.example/', 'Load your LoRAs from CivitAI'))).toEqual([
      'loras',
      'civitai',
    ]);
    // `celebrities` folds to `celebrity` (-ies to -y), so both of the rule's forms name the one word.
    expect(detectDomFeature(rule('AICAT-002'), 'library', page('https://x.example/characters', 'A celebrity look alike'))).toEqual([
      'look-alike',
      'celebrity',
      'celebrities',
    ]);
  });

  it('reads the footer region for a footer surface (AIMKT-002)', () => {
    const home = page('https://x.example/', 'Welcome', undefined, 'Affiliate Program · Terms');
    expect(detectDomFeature(rule('AIMKT-002'), 'footer', home)).toEqual(['affiliate']);
  });
});

describe('how pages combine', () => {
  const filters = rule('AIMKT-001');
  const clean = page('https://x.example/', 'Chat with your companion.');

  it('passes when every listed page was read or not published and nothing was observed', () => {
    const finding = checkDomFeature(filters, [
      { surface: 'homepage', ...at(clean) },
      { surface: 'pricing', found: notPublished, pages: [] },
    ]);
    expect(finding.state).toBe('pass');
    expect(finding.note).toMatch(/Not published: the pricing page/);
  });

  it('never passes over a listed page it could not read', () => {
    const finding = checkDomFeature(filters, [
      { surface: 'homepage', ...at(clean) },
      { surface: 'pricing', found: couldNotRead, pages: [] },
    ]);
    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('is not evaluable when no listed page was read', () => {
    const finding = checkDomFeature(filters, [
      { surface: 'homepage', found: notPublished, pages: [] },
      { surface: 'pricing', found: notPublished, pages: [] },
    ]);
    expect(finding.state).toBe('not_evaluable');
  });
});

describe('the Layer 3 runner', () => {
  it('reads every page established for a surface, not only the first', () => {
    const first = page('https://x.example/characters', 'Browse our characters');
    const second = page('https://x.example/explore', 'Trending: Barely Legal Babysitter');
    const run = runLayer3(
      {
        signup: { found: false, reason: 'not looked for', attempts: [] } as never,
        homepage: page('https://x.example/', 'Welcome'),
        terms: notPublished,
        shipping: notPublished,
        faq: notPublished,
        payment: notPublished,
        pages: new Map([['library', located(first, first.finalUrl, 'test')]]),
        pagesByType: new Map([['library', [first, second]]]),
      },
      adult,
    );
    const minors = run.findings.find((f) => f.ruleId === 'AICAT-001')!;
    expect(minors.state).toBe('fail');
    expect(minors.note).toMatch(/https:\/\/x\.example\/explore\): 'barely legal'/);
  });
});
