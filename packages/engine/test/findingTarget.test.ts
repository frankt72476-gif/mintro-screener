/**
 * A finding states what it was comparing against (D-076).
 *
 * An agent reading a real report asked three times what the scanner expects. Twice for the footer
 * disclaimer — *"what's the full verbiage?"* — and once for `NAME-002`: *"why is 'blend'
 * prohibited?"* Both findings named a requirement without stating it, so a reader could see that
 * something did not match and not what it was supposed to match.
 *
 * D-217 fixed what these checks **measured**. This is the other half: the target they measured
 * against.
 *
 * ## Read from the rule, never from its id
 *
 * The whole risk here is a per-rule string. `DISC-003` takes its wording from the rule named in
 * `target_phrases_from` (D-015), and `NAME-002`'s reason is its own `subject` — so both read from
 * data, and a rule added later carries a correct sentence with no engine change (hard constraint
 * 1). The last block asserts that against rules this engine has never seen.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '@mintro/ruleset';
import { FINDING_TERMS, auditCopy } from '../src/copy.js';
import { checkDomAssert } from '../src/checks/domAssert.js';
import { checkUrlPattern } from '../src/checks/urlPattern.js';
import { leadSentence } from '../src/report.js';
import { createStubFetcher, discoverLayer0 } from '../src/index.js';
import { RULESET_PATH } from './paths.js';
import type { PageContext } from '../src/page.js';

const ruleset = loadRulesetFile(RULESET_PATH);

const ruleOf = <T extends Rule['type']>(id: string, type: T): RuleOfType<T> => {
  const rule = ruleset.rules.find((candidate) => candidate.id === id);
  if (rule === undefined || rule.type !== type) throw new Error(`${id} is not a ${type}`);
  return rule as RuleOfType<T>;
};

const REQUIRED = 'For research and laboratory use only. Not for human or animal consumption.';

/** A footer carrying most of the words and failing density — the CoMo shape (D-217). */
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
    footer: {
      found: true,
      text: footerText,
      styledText: [{ text: footerText, fontSizePx: 12, color: '#666', opacity: 1 }],
    },
    links: [],
    headings: [],
  }) as unknown as PageContext;

/* ---------------------------------------------------------------------------------------------
 * The exact-match half — what wording is wanted
 * ------------------------------------------------------------------------------------------- */

describe('an exact-match finding states the wording it compared against', () => {
  it('DISC-003 quotes the required disclaimer in full', () => {
    const finding = checkDomAssert(ruleOf('DISC-003', 'dom_assert'), page(FOOTER_TEXT), [REQUIRED]);

    // The agent's question, answered in the finding rather than in another rule's finding
    // elsewhere in the report.
    expect(finding.note).toContain('The required wording is:');
    expect(finding.note).toContain(REQUIRED);
    expect(auditCopy(finding.note, FINDING_TERMS).clean).toBe(true);
  });

  it('states it even when the footer held nothing to compare', () => {
    const finding = checkDomAssert(ruleOf('DISC-003', 'dom_assert'), page('   '), [REQUIRED]);

    expect(finding.note).toContain('no text to compare against');
    expect(finding.note).toContain(REQUIRED);
  });

  /**
   * The target comes from the rule that declares it, not from this file and not from a rule id.
   *
   * Fed a different required wording, the finding must quote *that*. A hardcoded disclaimer passes
   * the two tests above and fails this one.
   */
  it('quotes whatever wording the declaring rule carries', () => {
    const invented = 'Sold strictly for calibration of laboratory instruments.';
    const finding = checkDomAssert(ruleOf('DISC-003', 'dom_assert'), page(FOOTER_TEXT), [invented]);

    expect(finding.note).toContain(invented);
    expect(finding.note).not.toContain(REQUIRED);
  });

  it('DISC-001 already stated its target, and still does', () => {
    // Shipped in the correctness pass; pinned so this stage's changes did not disturb it.
    const disc001 = ruleset.rules.find((r) => r.id === 'DISC-001');
    expect((disc001?.params as { exact?: string }).exact).toBe(REQUIRED);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The pattern half — why the matched token is the rule's business
 * ------------------------------------------------------------------------------------------- */

/** A crawl carrying one product URL, classified the way a live run classifies it. */
const crawlOf = async (paths: readonly string[]) => {
  const origin = 'https://shop.example';
  const locs = paths.map((path) => `${origin}${path}`);
  return discoverLayer0(
    origin,
    createStubFetcher({
      [`${origin}/robots.txt`]: { body: `Sitemap: ${origin}/sitemap.xml`, contentType: 'text/plain' },
      [`${origin}/sitemap.xml`]: {
        body: `<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`,
      },
    }),
  );
};

/**
 * The reason a match matters moved from the note to the lead (D-225).
 *
 * This block asserted `looksFor`, which appended the rule's `subject` to every `url_pattern`
 * violation. `boundarySentence` now opens the same finding with the same field, and every one of
 * the ten `url_pattern` rules declares `expect: absent` — so the subject printed twice in one
 * finding. `looksFor` is gone and these assert the property it carried, in its new place.
 *
 * The property is unchanged and is the one that matters: the reason is read from the rule, never
 * from its id.
 */
describe('a pattern finding names what the rule is looking for', () => {
  it('NAME-002 leads with what the standards do not permit, and says it once', async () => {
    const crawl = await crawlOf(['/products/bpc-157-tb500-blend/', '/products/selank/']);
    const rule = ruleOf('NAME-002', 'url_pattern');
    const finding = { ...checkUrlPattern(rule, crawl), subject: rule.subject, expect: 'absent' as const };

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain("matched 'blend'");

    // The agent's question — "why is 'blend' prohibited?" — answered on the lead.
    expect(leadSentence(finding as never)).toBe(
      'What the standards do not permit: product names use marketing terms.',
    );

    // And once. The note no longer repeats the subject.
    expect(finding.note).not.toContain(rule.subject);
    expect(auditCopy(finding.note, FINDING_TERMS).clean).toBe(true);
  });

  /**
   * The assertion that stops this becoming a lookup table.
   *
   * A rule id this engine has never seen, with a subject nothing hardcoded could know, must read
   * correctly. If the sentence came from a rule-id branch, this returns NAME-002's subject or
   * nothing at all.
   */
  it('reads the reason from the rule, so a rule added later needs no engine change', () => {
    const invented = {
      ruleId: 'ZZZZ-999',
      state: 'fail' as const,
      subject: 'listings carry names this programme has not seen before',
      expect: 'absent' as const,
    };

    expect(leadSentence(invented as never)).toBe(
      'What the standards do not permit: listings carry names this programme has not seen before.',
    );
    expect(leadSentence(invented as never)).not.toContain('marketing terms');
  });

  it('leads with nothing when a rule carries no subject', () => {
    // Runs and rules recorded before `subject` existed must read as they did (D-002).
    expect(leadSentence({ ruleId: 'X', state: 'fail', expect: 'absent' } as never)).toBeNull();
  });

  it('leads with nothing on a satisfied finding', async () => {
    // A rule that matched nothing has no match to explain, and D-041 keeps a clean finding quiet.
    const crawl = await crawlOf(['/products/selank/', '/products/semax/']);
    const rule = ruleOf('NAME-002', 'url_pattern');
    const finding = { ...checkUrlPattern(rule, crawl), subject: rule.subject, expect: 'absent' as const };

    expect(finding.state).toBe('pass');
    expect(leadSentence(finding as never)).toBeNull();
  });
});
