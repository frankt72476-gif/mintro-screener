/**
 * Layer 1 check handlers, driven from fixture page contexts.
 *
 * DISC-002 is `critical` / `auto_fail` and fails a merchant on a computed number with no human
 * in the loop, so the contrast maths is checked against the WCAG reference values and the
 * "could not measure" paths are checked to land on `not_evaluable` rather than on either verdict.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkComputedStyle,
  checkDomAssert,
  checkTextMatch,
  contrastRatio,
  disclaimerPhrases,
  layer1Rules,
  locateDisclaimer,
  parseCssColour,
  relativeLuminance,
  runLayer1,
  type PageContext,
  type StyledText,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const DISCLAIMER = 'For research and laboratory use only. Not for human or animal consumption.';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

function styled(text: string, overrides: Partial<StyledText> = {}): StyledText {
  return {
    text,
    selector: 'footer > p',
    fontSizePx: 14,
    color: BLACK,
    backgroundColor: WHITE,
    visible: true,
    collapsedAncestor: false,
    ...overrides,
  };
}

function page(overrides: Partial<PageContext> = {}): PageContext {
  const footerText = overrides.footer?.text ?? DISCLAIMER;
  return {
    requestedUrl: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    httpStatus: 200,
    title: 'Shop',
    text: `Welcome to the shop. ${footerText}`,
    html: `<html><body><footer>${footerText}</footer></body></html>`,
    htmlSha256: 'a'.repeat(64),
    footer: { found: true, text: footerText, styledText: [styled(footerText)], locatedBy: '<footer>' },
    links: [],
    styledText: [styled(footerText)],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    capturedAt: '2026-08-20T00:00:00.000Z',
    screenshotKey: 'run-1/layer1/shot.png',
    domKey: 'run-1/layer1/dom.html',
    ...overrides,
  };
}

const rule = <T extends 'dom_assert' | 'text_match' | 'computed_style'>(id: string): RuleOfType<T> => {
  const found = layer1Rules(ruleset).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`${id} is not a layer 1 rule`);
  return found as RuleOfType<T>;
};

describe('rule selection', () => {
  it('selects exactly the layer 1 rules', () => {
    expect(layer1Rules(ruleset).map((r) => r.id)).toEqual([
      'GATE-001',
      'DISC-001',
      'DISC-002',
      'OFFS-003',
    ]);
  });

  it('does not select the payment rules, which are layer 3 in the data', () => {
    // The footer is rendered here, but `layer` is data and the runner respects it.
    const ids = layer1Rules(ruleset).map((r) => r.id);
    expect(ids).not.toContain('PAY-001');
    expect(ids).not.toContain('PAY-003');
  });

  it('reads the disclaimer wording from the rule set rather than from code', () => {
    expect(disclaimerPhrases(ruleset)).toContain(DISCLAIMER);
  });
});

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.5:1 boundary case for normal text.
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, WHITE)).toBeCloseTo(4.54, 1);
  });

  it('is order-independent', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(contrastRatio(WHITE, BLACK), 10);
  });

  it('computes relative luminance per the specification', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
  });

  it.each([
    ['rgb(1, 2, 3)', { r: 1, g: 2, b: 3 }, 1],
    ['rgba(1, 2, 3, 0.5)', { r: 1, g: 2, b: 3 }, 0.5],
    ['rgb(1 2 3 / 50%)', { r: 1, g: 2, b: 3 }, 0.5],
  ])('parses %s', (input, colour, alpha) => {
    expect(parseCssColour(input)).toEqual({ colour, alpha });
  });

  it.each(['transparent', 'red', 'var(--x)', ''])('refuses to guess at %s', (input) => {
    // DISC-002 auto-fails; inventing a colour would manufacture the number the failure rests on.
    expect(parseCssColour(input)).toBeNull();
  });
});

describe('DISC-001 — footer disclaimer wording', () => {
  const disc001 = rule<'text_match'>('DISC-001');

  it('passes on the exact wording', () => {
    expect(checkTextMatch(disc001, page()).state).toBe('pass');
  });

  it('matches regardless of wrapping and case', () => {
    const wrapped = `for research  and laboratory\n use only.  NOT for human or animal consumption.`;
    const finding = checkTextMatch(
      disc001,
      page({ footer: { found: true, text: wrapped, styledText: [styled(wrapped)] } }),
    );
    expect(finding.state).toBe('pass');
  });

  it('reviews a partial match rather than failing it', () => {
    const variant = 'For research use only. Not for human consumption.';
    const finding = checkTextMatch(
      disc001,
      page({ footer: { found: true, text: variant, styledText: [styled(variant)] } }),
    );

    // DISC-001 is review_only, so a violation is `review` — never `fail` (D-009).
    expect(finding.state).toBe('review');
    expect(finding.note).toContain('Required:');
  });

  it('reviews an absent disclaimer', () => {
    const finding = checkTextMatch(
      disc001,
      page({ footer: { found: true, text: 'Copyright 2026', styledText: [styled('Copyright 2026')] } }),
    );
    expect(finding.state).toBe('review');
  });

  it('is not_evaluable when no footer could be identified', () => {
    // Not the same as "the disclaimer is missing" — we could not find the footer to look in.
    const finding = checkTextMatch(
      disc001,
      page({ footer: { found: false, text: '', styledText: [] } }),
    );
    expect(finding.state).toBe('not_evaluable');
  });

  it('is not_evaluable when the page did not render', () => {
    const finding = checkTextMatch(disc001, page({ renderError: 'net::ERR_TIMED_OUT', httpStatus: 0 }));
    expect(finding.state).toBe('not_evaluable');
    expect(finding.evidence[0]?.attempts?.length).toBeGreaterThan(0);
  });
});

describe('DISC-002 — footer disclaimer legibility', () => {
  const disc002 = rule<'computed_style'>('DISC-002');
  const targets = (p: PageContext) => locateDisclaimer(p.footer, disclaimerPhrases(ruleset));

  it('passes a legible disclaimer', () => {
    const p = page();
    expect(checkComputedStyle(disc002, p, targets(p)).state).toBe('pass');
  });

  it('fails text below the font-size threshold', () => {
    const small = styled(DISCLAIMER, { fontSizePx: 8 });
    const p = page({ footer: { found: true, text: DISCLAIMER, styledText: [small] } });

    const finding = checkComputedStyle(disc002, p, targets(p));
    expect(finding.state).toBe('fail'); // auto_fail
    expect(finding.note).toContain('8px');
  });

  it('fails text below the contrast threshold', () => {
    const faint = styled(DISCLAIMER, { color: { r: 220, g: 220, b: 220 }, backgroundColor: WHITE });
    const p = page({ footer: { found: true, text: DISCLAIMER, styledText: [faint] } });

    const finding = checkComputedStyle(disc002, p, targets(p));
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('contrast');
  });

  it('fails a hidden disclaimer and says how it was hidden', () => {
    const hidden = styled(DISCLAIMER, { visible: false, hiddenReason: 'display:none' });
    const p = page({ footer: { found: true, text: DISCLAIMER, styledText: [hidden] } });

    const finding = checkComputedStyle(disc002, p, targets(p));
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('display:none');
  });

  it('fails a disclaimer collapsed by an ancestor', () => {
    const collapsed = styled(DISCLAIMER, { collapsedAncestor: true });
    const p = page({ footer: { found: true, text: DISCLAIMER, styledText: [collapsed] } });

    expect(checkComputedStyle(disc002, p, targets(p)).state).toBe('fail');
  });

  it('judges on the most legible copy when the disclaimer appears more than once', () => {
    // Failing on a duplicate hidden copy while a legible one is on the page would be a finding
    // the rule does not support.
    const p = page({
      footer: {
        found: true,
        text: DISCLAIMER,
        styledText: [styled(DISCLAIMER, { visible: false, hiddenReason: 'display:none' }), styled(DISCLAIMER)],
      },
    });

    expect(checkComputedStyle(disc002, p, targets(p)).state).toBe('pass');
  });

  it('is not_evaluable when no disclaimer element could be located', () => {
    // Critical: this must not auto-fail. "We could not find the disclaimer" is DISC-001's
    // observation, not a legibility failure.
    const p = page({ footer: { found: true, text: 'Copyright 2026', styledText: [styled('Copyright 2026')] } });

    const finding = checkComputedStyle(disc002, p, targets(p));
    expect(finding.state).toBe('not_evaluable');
    expect(finding.state).not.toBe('fail');
  });

  it('is not_evaluable when no footer was found', () => {
    const p = page({ footer: { found: false, text: '', styledText: [] } });
    expect(checkComputedStyle(disc002, p, targets(p)).state).toBe('not_evaluable');
  });

  it('reports the measurement it acted on', () => {
    const small = styled(DISCLAIMER, { fontSizePx: 8 });
    const p = page({ footer: { found: true, text: DISCLAIMER, styledText: [small] } });

    const matched = checkComputedStyle(disc002, p, targets(p)).evidence[0]?.matchedValue ?? '';
    expect(matched).toContain('font-size=8px');
    expect(matched).toContain('contrast=');
  });
});

describe('GATE-001 — age affirmation', () => {
  const gate001 = rule<'dom_assert'>('GATE-001');

  it('passes when an age-gate signal is present', () => {
    const p = page({ html: '<div class="age-gate">Are you 21 or older?</div>' });
    expect(checkDomAssert(gate001, p).state).toBe('pass');
  });

  it('reviews when no signal is present', () => {
    const p = page({ text: 'Welcome', html: '<html><body>Welcome</body></html>' });
    const finding = checkDomAssert(gate001, p);

    expect(finding.state).toBe('review'); // review_only, so never `fail`
  });

  it('is not_evaluable when the page did not render', () => {
    expect(checkDomAssert(gate001, page({ renderError: 'timeout', httpStatus: 0 })).state).toBe(
      'not_evaluable',
    );
  });
});

describe('OFFS-003 — social handles', () => {
  const offs003 = rule<'dom_assert'>('OFFS-003');

  it('collects social links without asserting on them', () => {
    const p = page({
      links: [
        { href: 'https://instagram.com/shop', text: 'Instagram', rel: '', inFooter: true, inNav: false },
        { href: 'https://shop.example/about', text: 'About', rel: '', inFooter: true, inNav: false },
      ],
    });

    const finding = checkDomAssert(offs003, p);
    expect(finding.state).toBe('pass');
    expect(finding.evidence[0]?.matchedUrls).toEqual(['https://instagram.com/shop']);
  });

  it('says plainly that off-site content was not examined', () => {
    const p = page({
      links: [{ href: 'https://instagram.com/shop', text: 'IG', rel: '', inFooter: true, inNav: false }],
    });
    expect(checkDomAssert(offs003, p).note).toContain('not examined');
  });

  it('passes when there are no social links at all', () => {
    expect(checkDomAssert(offs003, page()).state).toBe('pass');
  });
});

describe('DISC-001 and DISC-002 agree about the same footer', () => {
  /**
   * Regression from a live scan: DISC-002 measured swisschems.is's disclaimer and failed it on
   * contrast, while DISC-001 reported "no comparable text was observed" about the same footer.
   * Two rules contradicting each other about one page is worse than either being silent.
   */
  const REAL_DISCLAIMER =
    'FDA Disclaimer: All products are for laboratory developmental research USE ONLY. Not for human consumption.';

  const footerPage = () => {
    const node = styled(REAL_DISCLAIMER, { color: { r: 150, g: 150, b: 150 } });
    return page({
      footer: {
        found: true,
        text: `Shop About Us Contact ${REAL_DISCLAIMER} Copyright 2026`,
        styledText: [styled('Shop About Us Contact'), node],
      },
    });
  };

  it('DISC-002 locates and measures the disclaimer', () => {
    const p = footerPage();
    const finding = checkComputedStyle(
      rule<'computed_style'>('DISC-002'),
      p,
      locateDisclaimer(p.footer, disclaimerPhrases(ruleset)),
    );
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('contrast');
  });

  it('DISC-001 quotes the same disclaimer rather than reporting nothing comparable', () => {
    const finding = checkTextMatch(rule<'text_match'>('DISC-001'), footerPage());

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('closest text observed');
    expect(finding.note).toContain('laboratory developmental research');
  });
});

describe('runLayer1', () => {
  it('produces one finding per layer 1 rule', () => {
    const run = runLayer1(page(), ruleset);
    expect(run.findings).toHaveLength(layer1Rules(ruleset).length);
  });

  it('marks every finding as rendered_page evidence', () => {
    for (const finding of runLayer1(page(), ruleset).findings) {
      expect(finding.evidenceKind, finding.ruleId).toBe('rendered_page');
    }
  });

  it('produces all not_evaluable and no pass when the render failed', () => {
    const run = runLayer1(page({ renderError: 'net::ERR_CONNECTION_REFUSED', httpStatus: 0 }), ruleset);

    expect(run.counts.not_evaluable).toBe(layer1Rules(ruleset).length);
    expect(run.counts.pass).toBe(0);
    expect(run.counts.fail).toBe(0);
  });

  it('states observations without instructing the reader', () => {
    // Hard constraint 7 / D-001.
    for (const finding of runLayer1(page(), ruleset).findings) {
      const note = finding.note.toLowerCase();
      for (const word of ['should', 'recommend', 'do not forward', 'non-compliant', 'must ']) {
        expect(note, `${finding.ruleId} contained '${word}'`).not.toContain(word);
      }
    }
  });
});
