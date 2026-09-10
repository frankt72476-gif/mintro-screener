/**
 * The masthead says when the crawl met bot protection (D-264).
 *
 * ## Why this is asserted on the markup and not on the function
 *
 * `challengeLine` returning a string is a fact about a function; only markup is a fact about a
 * screen (D-246). That distinction is exactly what this repository got wrong with
 * `homeShape.showsAdministration` — computed, documented, asserted true in three tests, and read by
 * no component, so the screen nobody could reach had a green suite behind it.
 *
 * A line about bot protection that does not reach the document is worse than none, because the
 * document is the thing an underwriter reads. Run 0003c814 rendered nine pages, saw none of them,
 * and published a finding count that read like an unusually bare storefront.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import anglesJson from '../../../rules/angles.json';
import rulesetJson from '../../../rules/ruleset.json';
import eyeTestJson from '../../../rules/eyetest.json';
import { EvaluationReport } from '../src/components/EvaluationReport.js';
import {
  challengeLine,
  consentGateLine,
  enteredConsentGate,
  type EvaluationLabels,
  type EvaluationRunContext,
  type FindingState,
  type StoredDraft,
} from '../src/lib/evaluationView.js';

interface Fixture {
  readonly runId: string;
  readonly merchantDomain: string | null;
  readonly screenedAt: string | null;
  readonly rulesetVersion: string;
  readonly anglesVersion: string;
  readonly model: string;
  readonly handles: EvaluationRunContext['handles'];
  readonly findings: readonly {
    id: string;
    ruleId: string;
    state: string;
    evidenceKey: string | null;
  }[];
  readonly evidence: readonly { key: string; kind: string; url: string }[];
  readonly draft: StoredDraft;
}

const FIXTURE = JSON.parse(
  readFileSync('fixtures/evaluation/draft-9011b2d7.json', 'utf8'),
) as Fixture;

const BASE: EvaluationRunContext = {
  runId: FIXTURE.runId,
  merchantDomain: FIXTURE.merchantDomain,
  screenedAt: FIXTURE.screenedAt,
  rulesetVersion: FIXTURE.rulesetVersion,
  anglesVersion: FIXTURE.anglesVersion,
  model: FIXTURE.model,
  handles: FIXTURE.handles,
  findings: FIXTURE.findings.map((f) => ({ ...f, state: f.state as FindingState })),
  evidence: FIXTURE.evidence,
};

const LABELS: EvaluationLabels = {
  angleTitle: Object.fromEntries(anglesJson.angles.map((a) => [a.id, a.title])),
  conditionLabel: Object.fromEntries(anglesJson.routingConditions.map((c) => [c.id, c.label])),
  angleOrder: anglesJson.angles.map((a) => a.id),
  conditionOrder: anglesJson.routingConditions.map((c) => c.id),
  ruleTitle: Object.fromEntries(rulesetJson.rules.map((r) => [r.id, r.title])),
  eyeTestQuestion: Object.fromEntries(eyeTestJson.items.map((i) => [i.id, i.question])),
  heavyRuleIds: new Set(rulesetJson.rules.filter((r) => r.weight === 'heavy').map((r) => r.id)),
};

const render = (run: EvaluationRunContext): string =>
  renderToStaticMarkup(
    createElement(EvaluationReport, {
      draft: FIXTURE.draft,
      run,
      access: { description: 'test', urlFor: async () => null },
      labels: LABELS,
    }),
  );

/**
 * The text of one paragraph, by class.
 *
 * The wording assertions below are about **that line**, and running them over the whole document
 * asks a different question: the draft fixture's own prose contains the word "blocked", so a
 * document-wide check either fails for the wrong reason or, phrased as a regex, quietly passes.
 * Both happened here on the way to this.
 */
const lineOf = (markup: string, className: string): string => {
  const match = new RegExp(`<p class="${className}"[^>]*>([\\s\\S]*?)</p>`).exec(markup);
  return text(match?.[1] ?? '');
};

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the bot-challenge line', () => {
  it('reaches the rendered document, with both numbers', () => {
    const markup = render({ ...BASE, challenge: { challenged: 9, pages: 9 } });

    expect(text(markup)).toContain('Bot challenge on 9 of 9 pages');
    expect(markup).toContain('eval-challenge');
  });

  /*
    A partial reading and a total one are different runs, and the denominator is what tells them
    apart. "Bot challenge on 3 of 48" qualifies the document; "on 9 of 9" says there is no document.
  */
  it('distinguishes a partial reading from a total one', () => {
    expect(text(render({ ...BASE, challenge: { challenged: 3, pages: 48 } }))).toContain(
      'Bot challenge on 3 of 48 pages',
    );
  });

  it('says what it means, in the crawl’s own terms', () => {
    const rendered = text(render({ ...BASE, challenge: { challenged: 9, pages: 9 } }));

    expect(rendered).toContain('the pages behind it were not seen');
    /*
      Descriptive, about the crawl (hard constraint 7, D-044). It must not say the merchant blocked
      us — a merchant does not choose their edge's bot policy per visitor — and it must not tell a
      reader what to do about it.
    */
    expect(rendered).not.toMatch(/\bthe merchant blocked\b|\bshould\b|\brecommend\b/i);
  });

  /*
    The two silences, which the rendering deliberately collapses into one: a run that met no
    challenge, and a run recorded before the field existed. Neither prints anything — "Bot challenge
    on 0 of 30 pages" on every clean report is a line a reader learns to skip exactly where it
    eventually matters.
  */
  it('prints nothing on a run that met no challenge', () => {
    const markup = render({ ...BASE, challenge: { challenged: 0, pages: 30 } });

    expect(markup).not.toContain('eval-challenge');
    expect(text(markup)).not.toContain('Bot challenge');
  });

  it('prints nothing on a run recorded before the field existed', () => {
    expect(render(BASE)).not.toContain('eval-challenge');
    expect(challengeLine(BASE)).toBeNull();
  });
});

describe('the consent-gate line', () => {
  it('reaches the rendered document, with both numbers, where the gate held', () => {
    const markup = render({ ...BASE, consentGate: { gated: 16, entered: 0, pages: 30 } });

    expect(text(markup)).toContain('Consent gate on 16 of 30 pages');
    expect(markup).toContain('eval-consent-gate');
  });

  /*
    The ruling's copy (D-267). A run that went through the gate read the catalogue, so a count of
    doors is the wrong shape — what a reader needs is how this crawl got in, said once.
  */
  it('says the crawl entered, without a count, where the gate was passed', () => {
    const markup = render({ ...BASE, consentGate: { gated: 0, entered: 16, pages: 30 } });

    expect(text(markup)).toContain("Entered through the merchant's consent gate");
    expect(text(markup)).not.toContain('Consent gate on');
    expect(enteredConsentGate({ ...BASE, consentGate: { gated: 0, entered: 16, pages: 30 } })).toBe(
      true,
    );
  });

  it('says the findings describe the catalogue, not the gate', () => {
    const line = lineOf(
      render({ ...BASE, consentGate: { gated: 0, entered: 16, pages: 30 } }),
      'eval-consent-gate',
    );

    expect(line).toContain('Mintro affirmed those statements');
    expect(line).toContain('describe the catalogue rather than the gate');
    // And not the sentence for a gate that held, which says the opposite.
    expect(line).not.toContain('was not read');
  });

  /*
    Both, when a gate took on one context and not another. Entering is the more consequential fact
    and is the line that shows.
  */
  it('prefers the entered line when a run carries both', () => {
    const markup = render({ ...BASE, consentGate: { gated: 3, entered: 13, pages: 30 } });

    expect(text(markup)).toContain("Entered through the merchant's consent gate");
    expect(text(markup)).not.toContain('Consent gate on 3');
  });

  /*
    Descriptive, and about Mintro's own choice (hard constraint 7). The merchant is not blocking
    anyone; they are asking a question we decline to answer on a visitor's behalf. A line that said
    the merchant blocked the crawler would take a compliance control and report it as obstruction.
  */
  it('does not describe the merchant as blocking us', () => {
    const rendered = lineOf(
      render({ ...BASE, consentGate: { gated: 16, entered: 0, pages: 30 } }),
      'eval-consent-gate',
    );

    expect(rendered).toContain('did not get through');
    expect(rendered).toContain('was not read');
    /*
      Plain substrings rather than a word-boundary regex.

      The regex form of this assertion arrived through a shell heredoc and its four `\\b`
      escapes reached the file as literal backspace bytes, so it matched nothing and asserted
      nothing while reading correctly on screen. CLAUDE.md records that failure; this is it
      happening again. A list of forbidden phrases needs no escapes and cannot break silently.
    */
    for (const forbidden of ['blocked', 'should', 'recommend', 'bot protection']) {
      expect(rendered.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  /*
    Two lines, not one. A run can meet both, and they are facts about different parties: merging
    them into a single "coverage was limited" sentence is the conflation D-044 exists to end.
  */
  it('is a separate line from the challenge line, and both can appear', () => {
    const markup = render({
      ...BASE,
      challenge: { challenged: 3, pages: 30 },
      consentGate: { gated: 16, entered: 0, pages: 30 },
    });

    expect(markup).toContain('eval-challenge');
    expect(markup).toContain('eval-consent-gate');
    expect(text(markup)).toContain('Bot challenge on 3 of 30 pages');
    expect(text(markup)).toContain('Consent gate on 16 of 30 pages');
  });

  it('prints nothing on a run that met no gate, or one recorded before the field', () => {
    expect(
      render({ ...BASE, consentGate: { gated: 0, entered: 0, pages: 30 } }),
    ).not.toContain('eval-consent-gate');
    expect(render(BASE)).not.toContain('eval-consent-gate');
    expect(consentGateLine(BASE)).toBeNull();
  });
});
