/**
 * A finding names its method and states what it measured (D-076, D-217).
 *
 * Six sentences in one real report claimed more than the check that produced them had established.
 * Each is pinned here against the input that produced it, because the wording is the whole of the
 * defect: the states were right, the evidence was right, and the sentence a person reads was a
 * conclusion.
 *
 * `FINDING_TERMS` is the shared guard. It ran on the Documents Check findings and on nothing the
 * Site Check produces, which is how these shipped.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import { FINDING_TERMS, auditCopy } from '../src/copy.js';
import { checkTextMatch } from '../src/checks/textMatch.js';
import { checkDomAssert } from '../src/checks/domAssert.js';
import { RESEMBLANCE, similarity } from '../src/textSimilarity.js';
import { RULESET_PATH } from './paths.js';
import type { PageContext } from '../src/page.js';

const ruleset = loadRulesetFile(RULESET_PATH);

const ruleOf = <T extends 'text_match' | 'dom_assert'>(id: string, type: T): RuleOfType<T> => {
  const rule = ruleset.rules.find((candidate) => candidate.id === id);
  if (rule === undefined || rule.type !== type) throw new Error(`${id} is not a ${type}`);
  return rule as RuleOfType<T>;
};

/**
 * The CoMo Peptides footer, near enough to reproduce the scores.
 *
 * It carries most of the required words spread through a long block, which is exactly the shape
 * that clears coverage and fails density — the case both disclosure rules called an absence.
 */
const FOOTER_TEXT =
  'Research use only Not for human consumption ' +
  'Shop All Peptides Certificates of Analysis Track Your Order About Us ' +
  'Quality Promise Terms and Conditions Privacy Policy Contact ' +
  '2026 CoMo Peptides All rights reserved Columbia Missouri';

const page = (footerText: string): PageContext =>
  ({
    requestedUrl: 'https://www.comopeptides.com/',
    finalUrl: 'https://www.comopeptides.com/',
    httpStatus: 200,
    title: 'CoMo Peptides',
    text: footerText,
    html: `<html><body><footer>${footerText}</footer></body></html>`,
    htmlSha256: 'a'.repeat(64),
    screenshotKey: 'run/layer1/shot.png',
    domKey: 'run/layer1/dom.html.gz',
    capturedAt: '2026-08-30T22:22:00.000Z',
    footer: { found: true, text: footerText, styledText: [{ text: footerText, fontSizePx: 12, color: '#666', opacity: 1 }] },
    links: [],
    headings: [],
  }) as unknown as PageContext;

describe('the footer scored below a threshold, and the finding says so', () => {
  const REQUIRED = 'For research and laboratory use only. Not for human or animal consumption.';

  it('the fixture reproduces the near miss it exists for', () => {
    /*
      Coverage over the threshold, density under it — the exact shape that made both rules report an
      absence. If this stops holding, the two tests below stop testing anything, so it is asserted
      first.
    */
    const score = similarity(FOOTER_TEXT, REQUIRED);

    expect(score.coverage).toBeGreaterThanOrEqual(RESEMBLANCE.minCoverage);
    expect(score.density).toBeLessThan(RESEMBLANCE.minDensity);
  });

  it('DISC-001 quotes the closest text and both scores', () => {
    const finding = checkTextMatch(ruleOf('DISC-001', 'text_match'), page(FOOTER_TEXT));

    expect(finding.note).not.toContain('no comparable text');
    expect(finding.note).toContain('The closest text in it is');
    expect(finding.note).toContain('% of the required wording');
    expect(auditCopy(finding.note, FINDING_TERMS).clean).toBe(true);
  });

  it('DISC-003 quotes the closest text and both scores', () => {
    const finding = checkDomAssert(ruleOf('DISC-003', 'dom_assert'), page(FOOTER_TEXT), [REQUIRED]);

    expect(finding.note).not.toContain('No text resembling the required disclaimer');
    expect(finding.note).toContain("The closest text in this page's footer is");
    expect(finding.note).toContain('% of the required wording');
    expect(auditCopy(finding.note, FINDING_TERMS).clean).toBe(true);
  });

  it('says there was nothing to compare only when the footer is empty of text', () => {
    const finding = checkDomAssert(ruleOf('DISC-003', 'dom_assert'), page('   '), [REQUIRED]);

    expect(finding.note).toContain('no text to compare against');
  });
});

describe('three rules reading one page for different things say so', () => {
  /*
    All three matched `recovery` on `/shop/semax/` and all three said `Observed: 'recovery'.` — one
    sentence, three questions, and a reader could only read it as one check disagreeing with itself.
  */
  const BODY =
    'Semax is studied in models of recovery following injury. ' +
    'Research use only. Not for human consumption.';

  const noteOf = (id: string): string => checkTextMatch(ruleOf(id, 'text_match'), page(BODY)).note;

  it('each names the question it asked', () => {
    const notes = ['PROD-008', 'PROD-012'].map(noteOf);

    for (const note of notes) expect(note).toContain('Read for whether ');
    expect(new Set(notes).size).toBe(notes.length);
  });

  it('and still says what it observed', () => {
    expect(noteOf('PROD-012')).toContain("Observed: 'recovery'");
  });

  it('none of them reads as a conclusion', () => {
    for (const id of ['PROD-008', 'PROD-012']) {
      expect(auditCopy(noteOf(id), FINDING_TERMS).clean, id).toBe(true);
    }
  });
});

describe('GATE-007 names its clauses, not its stems', () => {
  const TERMS = 'This site is for research use only. Products are not for human consumption.';

  it('renders the clause a stem stands for', () => {
    const finding = checkTextMatch(ruleOf('GATE-007', 'text_match'), page(TERMS));

    expect(finding.note).not.toContain("'indemnif'");
    expect(finding.note).not.toContain("'diagnos'");
    expect(finding.note).toContain('the buyer indemnifies the seller');
  });

  it('carries a label for every stem it lists', () => {
    const rule = ruleOf('GATE-007', 'text_match');
    const labels = rule.params.require_all_labels ?? {};

    for (const term of rule.params.require_all ?? []) {
      expect(Object.keys(labels), `no label for '${term}'`).toContain(term);
    }
  });
});

describe('the guard that would have caught these', () => {
  it('carries each phrasing that shipped', () => {
    for (const phrase of [
      'is not a certificate',
      'nothing it would state',
      'no comparable text',
      'stops the application',
    ]) {
      expect(FINDING_TERMS).toContain(phrase);
      expect(auditCopy(`The link ${phrase} here.`, FINDING_TERMS).clean).toBe(false);
    }
  });
});
