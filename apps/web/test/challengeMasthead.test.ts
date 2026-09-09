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
