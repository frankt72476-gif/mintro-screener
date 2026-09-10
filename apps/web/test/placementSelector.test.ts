/**
 * The editor offers the placements the spectrum permits (D-272).
 *
 * The selector drew all three unconditionally, so an operator could put a `mixed` draft at
 * `domestic` and learn at publish that the validator refuses it — a round trip to be told something
 * the screen already knew.
 *
 * **`PLACEMENT_BY_SPECTRUM` is the single source**, read here through the ruleset's browser entry.
 * The validator, the prompt and `publishRefusal` read the same table, and a copy in the web would
 * be a second answer to *how far may this go* — the one an operator acts on.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { PLACEMENT_BY_SPECTRUM } from '@mintro/ruleset';
import anglesJson from '../../../rules/angles.json';
import rulesetJson from '../../../rules/ruleset.json';
import eyeTestJson from '../../../rules/eyetest.json';
import { EvaluationReport } from '../src/components/EvaluationReport.js';
import { placementsFor } from '../src/lib/evaluationEdit.js';
import type {
  EvaluationLabels,
  EvaluationRunContext,
  FindingState,
  StoredDraft,
} from '../src/lib/evaluationView.js';

interface Fixture {
  readonly runId: string;
  readonly merchantDomain: string | null;
  readonly screenedAt: string | null;
  readonly rulesetVersion: string;
  readonly anglesVersion: string;
  readonly model: string;
  readonly handles: EvaluationRunContext['handles'];
  readonly findings: readonly { id: string; ruleId: string; state: string; evidenceKey: string | null }[];
  readonly evidence: readonly { key: string; kind: string; url: string }[];
  readonly draft: StoredDraft;
}

const FIXTURE = JSON.parse(
  readFileSync('fixtures/evaluation/draft-9011b2d7.json', 'utf8'),
) as Fixture;

const RUN: EvaluationRunContext = {
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

/** The editor, at a given spectrum position. */
const editorAt = (spectrum: string): string =>
  renderToStaticMarkup(
    createElement(EvaluationReport, {
      draft: { ...FIXTURE.draft, placement: { ...FIXTURE.draft.placement, spectrum } },
      run: RUN,
      access: { description: 'test', urlFor: async () => null },
      labels: LABELS,
      edit: { onChange: () => undefined },
    }),
  );

const offered = (markup: string): string[] =>
  [...markup.matchAll(/class="eval-focal-badge is-([a-z_]+)/g)].map((m) => m[1]!);

describe('what the table permits', () => {
  it('gives mixed referred out and nothing else', () => {
    expect(PLACEMENT_BY_SPECTRUM.mixed).toEqual(['referred_out']);
    expect(placementsFor('mixed')).toEqual(['referred_out']);
  });

  it('leaves the research side able to be international or domestic', () => {
    for (const spectrum of ['research_leaning', 'research_supplier'] as const) {
      expect(placementsFor(spectrum), spectrum).toEqual(['international', 'domestic']);
    }
  });

  it('leaves the consumer positions as they were', () => {
    expect(placementsFor('consumer_retail')).toEqual(['referred_out']);
    expect(placementsFor('consumer_leaning')).toEqual(['referred_out', 'international']);
  });

  /*
    A draft at a position the angle set has since dropped still has to be editable. The validator
    refuses whatever is chosen; offering nothing would leave an operator with a document they cannot
    touch.
  */
  it('falls back to all three for a position the table does not carry', () => {
    expect(placementsFor('retired_position')).toEqual([
      'referred_out',
      'international',
      'domestic',
    ]);
  });
});

describe('what the screen draws', () => {
  it('offers one control for mixed', () => {
    expect(offered(editorAt('mixed'))).toEqual(['referred_out']);
  });

  it('offers two for the research side', () => {
    expect(offered(editorAt('research_supplier'))).toEqual(['international', 'domestic']);
  });

  /*
    Absent rather than disabled, which is this screen's standing rule (D-230): a control a reader
    cannot use is not drawn.
  */
  it('does not draw a domestic control on a mixed draft at all', () => {
    const markup = editorAt('mixed');

    expect(markup).not.toContain('eval-focal-badge is-domestic');
    expect(markup).not.toContain('eval-focal-badge is-international');
  });

  /*
    And the read-only render is untouched: it shows what the draft says, whatever the table permits,
    because a published document reports the decision that was made.
  */
  it('still renders the recommendation read-only, with no controls', () => {
    const readOnly = renderToStaticMarkup(
      createElement(EvaluationReport, {
        draft: { ...FIXTURE.draft, placement: { ...FIXTURE.draft.placement, spectrum: 'mixed' } },
        run: RUN,
        access: { description: 'test', urlFor: async () => null },
        labels: LABELS,
      }),
    );

    expect(readOnly).not.toContain('eval-focal-choice');
    expect(readOnly).toContain('eval-focal-badge');
  });
});
