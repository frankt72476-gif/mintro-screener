/**
 * What the evaluation renders, against the draft a real run actually produced (D-256).
 *
 * The fixture is `fixtures/evaluation/draft-9011b2d7.json` — a stored row exported unedited, with
 * the run's findings, captures and handle mapping beside it. A fixture written alongside this
 * component would agree with it by construction and prove nothing about the shape the generator
 * makes (D-106); this one was produced by the generator and copied.
 *
 * `renderToStaticMarkup` rather than a DOM: vitest runs `environment: 'node'` here, and every
 * assertion below is about markup the first render produces. What that cannot reach — the evidence
 * chip's click, which mints a signed URL — is not asserted here and is not pretended to be.
 *
 * Four of these tests are constraints rather than structure, and they are the ones that matter:
 * **no rule count anywhere**, **no pricing vocabulary**, **every prose handle resolved**, and
 * **shore-ups absent on the consumer side**. Each is a way the document could quietly become
 * something it must not be.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import anglesJson from '../../../rules/angles.json';
import rulesetJson from '../../../rules/ruleset.json';
import eyeTestJson from '../../../rules/eyetest.json';
import { EvaluationReport } from '../src/components/EvaluationReport.js';
import { findingAnchor } from '../src/lib/grouping.js';
import {
  PROSE_HANDLE,
  angleAnchor,
  angleCitations,
  citesHeavy,
  hostAndPath,
  proseSpans,
  resolveId,
  showsShoreUps,
  summaryLine,
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
  readonly validatorStatus: string;
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

const ACCESS = { description: 'test', urlFor: async () => null };

const render = (draft: StoredDraft, run: EvaluationRunContext = RUN): string =>
  renderToStaticMarkup(
    createElement(EvaluationReport, { draft, run, access: ACCESS, labels: LABELS }),
  );

/** Markup with the tags removed, which is what a reader actually sees. */
const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const HTML = render(FIXTURE.draft);

/**
 * Just the angles section.
 *
 * The placement cites angles by title and the routing table cites findings by rule id, so an
 * assertion about *what the angles show* has to be scoped to them. Searching the whole document
 * found the placement's chips first and reported them as the angles' own.
 */
const ANGLES = HTML.slice(HTML.indexOf('id="evaluation-angles"'), HTML.indexOf('eval-shoreups'));

/**
 * The citation lists inside the angles, without the paragraphs.
 *
 * The collapse is the citation list's rule and not prose's. An angle's paragraph says *"a
 * bacteriostatic-water product exists but did not render, so CATG-005 is unresolved (F42)"* — the
 * handle in that sentence resolves to a `not_evaluable` finding and must render, because collapsing
 * it would break the sentence around it. What the collapse governs is the list underneath, where
 * seventeen unevaluated rule ids read as support the angle does not have.
 */
const ANGLE_CITATION_LISTS = [...ANGLES.matchAll(/<ul class="eval-chip-list">(.*?)<\/ul>/gs)]
  .map((match) => match[1] ?? '')
  .join('');

/**
 * Section 3's table, without the summary block's row 2.
 *
 * Both name every routing condition, so an assertion written against the whole document passes on
 * either. That is not academic: a mutation dropping the unobservable rows *from the table* left
 * every test green, because row 2 still carried the labels.
 */
const ROUTING_TABLE = HTML.slice(
  HTML.indexOf('class="panel eval-routing"'),
  HTML.indexOf('id="evaluation-angles"'),
);

/**
 * The summary block's routing cells, each with its own markup.
 *
 * Per cell rather than counted across the block: an assertion that the document contains five icons
 * says nothing about *which* icon sits under which condition, and drawing a check under a Not met
 * row is the only way this row can lie.
 */
const CONDITION_CELLS = [
  ...HTML.matchAll(/<li class="eval-condition is-([a-z_]+)">(.*?)<\/li>/gs),
].map((match) => ({ status: match[1] ?? '', markup: match[2] ?? '' }));

describe('the fixture is the draft a real run produced', () => {
  it('is the accepted draft for 9011b2d7, not one written for this test', () => {
    expect(FIXTURE.runId).toBe('9011b2d7-c17e-4d62-96c7-01a1a2471b1d');
    expect(FIXTURE.validatorStatus).toBe('ok');
    expect(FIXTURE.draft.angles).toHaveLength(7);
    expect(FIXTURE.findings.length).toBeGreaterThan(50);
  });
});

describe('the whole document renders', () => {
  it('draws every section the layout memo specifies', () => {
    expect(HTML).toContain('eval-summary');
    expect(HTML).toContain('eval-legality');
    expect(HTML).toContain('eval-routing');
    expect(HTML).toContain('eval-angles');
  });

  it('leads with the placement and the spectrum, in words', () => {
    const body = text(HTML);
    expect(body).toContain('Placement today');
    expect(body).toContain('International');
    // All five positions, so the one it sits at means something against a scale.
    for (const label of ['Consumer retail', 'Consumer-leaning', 'Mixed', 'Research-leaning', 'Research supplier']) {
      expect(body, label).toContain(label);
    }
    expect(HTML).toContain('data-position="mixed"');
    expect(HTML).toMatch(/class="eval-position is-here"[^>]*data-position="mixed"/);
  });

  it('carries the standing sentence about who decides', () => {
    expect(text(HTML)).toContain('The underwriting decision belongs to the team reviewing the account');
  });

  /*
    The masthead says this is a draft.

    A draft is never sendable and only a published version has a link (layout memo), so the one
    thing a reader must not be able to mistake is which of the two they are holding. The label sits
    beside the domain, at the top, before any of it.
  */
  it('stamps the masthead Draft', () => {
    const masthead = HTML.slice(0, HTML.indexOf('eval-standing'));
    expect(masthead).toContain('eval-stamp');
    expect(text(masthead)).toContain('Draft');
  });

  it('renders the seven angles in the angle set order, each with a lean', () => {
    const positions = LABELS.angleOrder.map((id) => ANGLES.indexOf(LABELS.angleTitle[id]!));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    for (const angle of FIXTURE.draft.angles) {
      expect(HTML, angle.angleId).toContain(`is-${angle.lean}`);
    }
  });

  it('renders every routing condition in the table, including the ones a crawl cannot answer', () => {
    const table = text(ROUTING_TABLE);
    for (const condition of anglesJson.routingConditions) {
      expect(table, condition.id).toContain(condition.label);
    }
    // One row per condition, so none is dropped and none is drawn twice.
    expect([...ROUTING_TABLE.matchAll(/<tr class="is-[a-z_]+">/g)]).toHaveLength(
      anglesJson.routingConditions.length,
    );
    expect(table).toContain('Not observable');
    // The row that can cite nothing says where the answer comes from instead.
    expect(table).toContain('Not observable from the public site');
  });
});

describe('prose handles become chips', () => {
  /*
    The paragraph is the part a reader actually reads, and its handles are the only references in
    the document that nothing decodes. A bare `F16` on the page is a reference the reader cannot
    follow — which is the failure `unresolved_prose_handle` refuses at generation time, and this is
    the rendering half of the same guarantee.
  */
  it('resolves every handle in every paragraph', () => {
    const paragraphs = [
      FIXTURE.draft.placement.paragraph,
      ...FIXTURE.draft.angles.map((a) => a.paragraph),
      ...FIXTURE.draft.shoreUps.map((s) => s.text),
      ...FIXTURE.draft.legality.items.map((i) => i.note ?? ''),
    ];

    let handles = 0;
    for (const paragraph of paragraphs) {
      for (const span of proseSpans(RUN, LABELS, paragraph)) {
        if (!('handle' in span)) continue;
        handles += 1;
        expect(span.resolved, `${span.handle} did not resolve`).not.toBeNull();
      }
    }
    // The draft genuinely uses them — a fixture with none would pass this vacuously.
    expect(handles).toBeGreaterThan(50);
  });

  it('leaves no handle token in the rendered text', () => {
    const body = text(HTML);
    const leftover = [...body.matchAll(PROSE_HANDLE)].map((m) => m[0]);
    expect(leftover).toEqual([]);
  });

  it('puts the thing the handle points at in its place', () => {
    // Every angle paragraph resolves to at least one rule id the reader can see.
    const chips = [...HTML.matchAll(/class="eval-chip is-(finding|evidence|eye_test|angle)"/g)];
    expect(chips.length).toBeGreaterThan(50);
    expect(HTML).not.toContain('is-unresolved');
  });
});

describe('an angle citation list shows what was observed', () => {
  /*
    One angle on this run cited twenty-two findings, seventeen of them `not_evaluable` because a
    sampled page timed out. Listed in full they read as a wall of support the angle does not have.
    The count stays — seventeen unevaluated rules is a fact about the crawl — but as one line that
    says what it is counting.
  */
  it('collapses not_evaluable citations to a count', () => {
    const heavy = FIXTURE.draft.angles
      .map((angle) => angleCitations(RUN, LABELS, angle.citations))
      .filter((cited) => cited.unevaluated > 0);

    expect(heavy.length).toBeGreaterThan(0);
    for (const cited of heavy) {
      expect(cited.observed.every((r) => r.state !== 'not_evaluable')).toBe(true);
    }
    expect(text(HTML)).toContain('could not be evaluated on this run');
  });

  it('lists no not_evaluable finding individually', () => {
    /*
      Matched on the title, because that is what a chip says now. The addendum replaced the rule id
      with the rule's title: `CATG-005` names a rule to somebody holding the rule set, and
      "Reconstitution solution labelling" names it to the reader.
    */
    const unevaluatedTitles = new Set(
      FIXTURE.findings
        .filter((f) => f.state === 'not_evaluable')
        .map((f) => LABELS.ruleTitle[f.ruleId] ?? f.ruleId),
    );
    const listed = [
      ...ANGLE_CITATION_LISTS.matchAll(/class="eval-chip[^"]*"[^>]*>([^<]+)</g),
    ].map((m) => (m[1] ?? '').trim());

    expect(unevaluatedTitles.size).toBeGreaterThan(0);
    for (const title of listed) {
      const rules = FIXTURE.findings.filter((f) => (LABELS.ruleTitle[f.ruleId] ?? f.ruleId) === title);
      if (rules.length === 0) continue; // an eye-test question or a capture, which never collapse
      expect(
        rules.every((f) => f.state === 'not_evaluable'),
        `"${title}" was listed individually`,
      ).toBe(false);
    }
  });

  /*
    The collapse is the angle list's rule and not the table's.

    A routing row cites the rules that observe its condition, and a `not_evaluable` among them is
    the reason the status is what it is. Collapsing it there would remove the basis for the row.
  */
  it('leaves the routing table showing every citation it carries', () => {
    const table = HTML.slice(HTML.indexOf('eval-routing'), HTML.indexOf('id="evaluation-angles"'));
    const cited = FIXTURE.draft.routing.flatMap((row) => row.citations);
    expect(cited.length).toBeGreaterThan(0);
    expect(table).not.toContain('could not be evaluated on this run');
  });

  /*
    The paragraph keeps every chip, whatever the state behind it.

    This is the half the collapse must not reach. `products_for` writes "so CATG-005 is unresolved"
    about a rule the run could not evaluate; the chip is what makes that sentence followable, and a
    collapse applied to prose would leave a sentence naming a rule the reader cannot look up.
  */
  it('renders an unevaluated rule in prose, where the sentence names it', () => {
    const unevaluatedInProse = FIXTURE.draft.angles
      .flatMap((angle) => proseSpans(RUN, LABELS, angle.paragraph))
      .filter((span) => 'handle' in span && span.resolved?.state === 'not_evaluable');

    expect(unevaluatedInProse.length).toBeGreaterThan(0);
    for (const span of unevaluatedInProse) {
      if (!('handle' in span)) continue;
      expect(ANGLES, span.resolved!.label).toContain(span.resolved!.label);
    }
  });

  it('counts citations, never rules in the rule set', () => {
    const counted = angleCitations(
      RUN,
      LABELS,
      FIXTURE.draft.angles.flatMap((a) => a.citations),
    );
    expect(counted.unevaluated).toBeLessThanOrEqual(
      FIXTURE.draft.angles.flatMap((a) => a.citations).length,
    );
  });
});

describe('shore-ups are gated by the spectrum', () => {
  const consumerDraft = (spectrum: string): StoredDraft => ({
    ...FIXTURE.draft,
    placement: { ...FIXTURE.draft.placement, spectrum },
  });

  /*
    Absent entirely, not rendered as "None". The memo is explicit, and a section frame with nothing
    in it reads as a list that failed to load.
  */
  it('does not render for a consumer_leaning merchant', () => {
    expect(showsShoreUps('consumer_leaning')).toBe(false);
    const markup = render(consumerDraft('consumer_leaning'));
    expect(markup).not.toContain('eval-shoreups');
    expect(markup).not.toContain('What would close the open conditions');
    // Not "None", and not an empty frame.
    expect(text(markup)).not.toContain('None');
  });

  it('does not render for consumer_retail either', () => {
    expect(showsShoreUps('consumer_retail')).toBe(false);
    expect(render(consumerDraft('consumer_retail'))).not.toContain('eval-shoreups');
  });

  /*
    Mixed gets them. The memo first said Research-leaning and Research supplier only, which put
    Mixed on the wrong side of the line guardrail 5 draws at the consumer side.
  */
  it('renders for mixed, which is not the consumer side', () => {
    expect(FIXTURE.draft.placement.spectrum).toBe('mixed');
    expect(HTML).toContain('eval-shoreups');
    expect(FIXTURE.draft.shoreUps.length).toBeGreaterThan(0);
    for (const shoreUp of FIXTURE.draft.shoreUps) {
      expect(text(HTML)).toContain(text(shoreUp.text).trim());
    }
  });

  it('renders for both research positions', () => {
    for (const spectrum of ['research_leaning', 'research_supplier']) {
      expect(render(consumerDraft(spectrum)), spectrum).toContain('eval-shoreups');
    }
  });
});

describe('what the document must never say', () => {
  /*
    No count of rules, anywhere.

    The layout memo removes the masthead's "4 of 16" and the tally lines with it. A rule count is a
    checklist score, and a research supplier missing a registration gate can score the same as a
    consumer retailer with tidy disclaimers — which is the whole reason this document exists.
  */
  it('states no count of rules or findings', () => {
    const body = text(HTML);
    const counts = [
      // `\brules?\b` rather than `rules?\b`: "Rule set 3.7.0" is a version label, not a count, and
      // the word boundary in front is what tells them apart.
      /\b\d+\s+rules?\b(?!\s+could not be evaluated)/i,
      /\b\d+\s+findings?\b/i,
      /\b\d+\s+of\s+\d+\b/i,
      /\b\d+\s+checks?\b/i,
      /\b\d+\s+(?:passed|failed|observed)\b/i,
      /\b(?:passed|failed):\s*\d+/i,
    ];
    for (const pattern of counts) {
      expect(body, `${pattern} matched: ${body.match(pattern)?.[0]}`).not.toMatch(pattern);
    }
  });

  /*
    The one number the document does state, and it says what it counts.

    "17 cited rules could not be evaluated on this run" is a count of this angle's own citations,
    not of the rule set. The exemption above is narrow for that reason: any other "N rules" phrasing
    still fails.
  */
  it('permits the collapsed-citation line, which names what it counts', () => {
    expect(text(HTML)).toMatch(/\d+ cited rules? could not be evaluated on this run/);
  });

  /*
    No pricing vocabulary. D-256 forbids the cost of one Mintro solution against another travelling
    in a site evaluation, and the validator scopes those words out of the placement and routing.
    This asserts it of the rendered document, including every string this component contributes.
  */
  it('uses no pricing vocabulary of its own', () => {
    const body = text(HTML).toLowerCase();
    for (const word of ['price', 'pricing', 'cost', 'fee', 'basis point', 'bps', 'cheaper']) {
      expect(body, `"${word}" appears`).not.toContain(word);
    }
  });

  /*
    Findings describe, they never instruct (hard constraint 7). The shore-ups are the one section
    that names changes, and they are the merchant's own to make — but no part of this document tells
    the reader what to do about the merchant.
  */
  it('gives the reader no instruction', () => {
    const body = text(HTML).toLowerCase();
    for (const phrase of ['do not forward', 'we recommend', 'you should', 'must be declined']) {
      expect(body, phrase).not.toContain(phrase);
    }
  });

  it('makes no compliance determination', () => {
    const body = text(HTML).toLowerCase();
    for (const phrase of ['non-compliant', 'is compliant', 'violates', 'in violation']) {
      expect(body, phrase).not.toContain(phrase);
    }
  });
});

describe('legality renders the gap rather than hiding it', () => {
  it('lists an unobserved rule with its state and says what that means', () => {
    const body = text(HTML);
    expect(FIXTURE.draft.legality.items.length).toBeGreaterThan(0);
    // The title, since that is what the section shows now (addendum).
    for (const item of FIXTURE.draft.legality.items) {
      expect(body, item.ruleId).toContain(LABELS.ruleTitle[item.ruleId]!);
    }
    expect(body).toContain('Not evaluable');
    expect(body).toContain('says nothing about this merchant either way');
  });

  it('says no capture where none was recorded, rather than drawing an empty one', () => {
    expect(FIXTURE.draft.legality.items.some((i) => i.evidenceKey === '')).toBe(true);
    expect(text(HTML)).toContain('No capture recorded');
  });
});

describe('the summary block, row by row (addendum)', () => {
  const SUMMARY = HTML.slice(0, HTML.indexOf('class="panel eval-legality"'));

  /* Row 1 — the strip and the badge. */
  it('draws the five-position strip with the merchant marked', () => {
    for (const position of ['consumer_retail', 'consumer_leaning', 'mixed', 'research_leaning', 'research_supplier']) {
      expect(SUMMARY, position).toContain(`data-position="${position}"`);
    }
    expect(SUMMARY).toMatch(
      new RegExp(`class="eval-position is-here"[^>]*data-position="${FIXTURE.draft.placement.spectrum}"`),
    );
    // Exactly one marker: a strip with two would say the merchant sits in two places.
    expect([...SUMMARY.matchAll(/eval-position is-here/g)]).toHaveLength(1);
  });

  it('states the placement as a single badge', () => {
    expect(SUMMARY).toContain(`eval-badge is-${FIXTURE.draft.placement.recommended}`);
    expect([...SUMMARY.matchAll(/class="eval-badge /g)]).toHaveLength(1);
  });

  /*
    Referred out is the consequence of one observation, so the observation appears beneath the badge
    it produced. This fixture is not referred out, so the branch is exercised on a shaped draft.
  */
  it('puts the legality item that fixed a referral beneath the badge', () => {
    const referred = render({
      ...FIXTURE.draft,
      placement: { ...FIXTURE.draft.placement, recommended: 'referred_out' },
      legality: {
        clean: false,
        items: [{ ruleId: 'CATG-003', state: 'fail', evidenceKey: FIXTURE.evidence[0]!.key }],
      },
    });
    expect(referred).toContain('eval-fixed-by');
    expect(text(referred)).toContain(LABELS.ruleTitle['CATG-003']!);
  });

  /* Row 2 — legality badge and five routing cells. */
  it('shows one legality badge and the count of rules not observed', () => {
    expect(text(SUMMARY)).toContain('No legality items observed');
    const notObserved = FIXTURE.draft.legality.items.filter((i) => i.state === 'not_evaluable').length;
    expect(notObserved).toBeGreaterThan(0);
    expect(text(SUMMARY)).toContain(`${notObserved} not observed`);
  });

  it('draws one cell per routing condition, in the data order, each with an icon', () => {
    expect(CONDITION_CELLS.map((cell) => cell.status)).toHaveLength(
      anglesJson.routingConditions.length,
    );

    const expected = anglesJson.routingConditions.map(
      (condition) => FIXTURE.draft.routing.find((r) => r.conditionId === condition.id)!.status,
    );
    expect(CONDITION_CELLS.map((cell) => cell.status)).toEqual(expected);

    for (const cell of CONDITION_CELLS) {
      // Drawn, not typed. A character is whatever the reader's installed fonts make of it.
      expect(cell.markup, cell.status).toContain('<svg');
      // Decorative: the status word travels beside it, so both readers get the same fact.
      expect(cell.markup, cell.status).toContain('class="eval-glyph" aria-hidden="true"');
    }
    expect(text(SUMMARY)).toContain('Not met');
  });

  /*
    One shape per status, and three shapes across the three statuses.

    Asserted by comparing the cells to each other rather than against path data written here. A test
    that spelled out the `d` attribute would agree with the component by construction and would go
    on passing if every cell were quietly given the same drawing — which is the failure that
    matters, because three identical icons under three different words read as a set that means
    nothing.
  */
  it('draws one shape per status, and a different shape for each', () => {
    const byStatus = new Map<string, Set<string>>();
    for (const cell of CONDITION_CELLS) {
      const icon = cell.markup.slice(cell.markup.indexOf('<svg'), cell.markup.indexOf('</svg>'));
      expect(icon.length).toBeGreaterThan(0);
      byStatus.set(cell.status, (byStatus.get(cell.status) ?? new Set()).add(icon));
    }
    // The fixture exercises all three, so this is not passing over statuses nobody drew.
    expect([...byStatus.keys()].sort()).toEqual(['met', 'not_met', 'not_observable']);

    for (const [status, icons] of byStatus) expect(icons.size, status).toBe(1);
    const distinct = new Set([...byStatus.values()].map((icons) => [...icons][0]!));
    expect(distinct.size).toBe(3);
  });

  /* Filled check for Met, hollow cross for Not met, dash in a circle for Not observable. */
  it('fills the check and leaves the other two hollow, in a 16px box', () => {
    const iconFor = (status: string): string =>
      CONDITION_CELLS.find((cell) => cell.status === status)!.markup;

    expect(iconFor('met')).toContain('fill="currentColor"');
    expect(iconFor('not_met')).not.toContain('fill="currentColor"');
    expect(iconFor('not_observable')).not.toContain('fill="currentColor"');

    // The report's own iconography: a 16px box, round caps, and colour taken from the cell.
    for (const cell of CONDITION_CELLS) {
      expect(cell.markup, cell.status).toContain('viewBox="0 0 16 16"');
      expect(cell.markup, cell.status).toContain('stroke-linecap="round"');
      expect(cell.markup, cell.status).toContain('currentColor');
    }
    // The two hollow icons are drawn entirely in the cell's colour. The check's one exception is
    // the tick knocked out of the filled disc, which is the card behind it and not a state.
    expect(iconFor('not_met')).toContain('stroke="currentColor"');
    expect(iconFor('not_observable')).toContain('stroke="currentColor"');
    expect(iconFor('met')).toContain('stroke="var(--card)"');
  });

  /*
    The legality badge sits beside the Met cells in the same row. Two checks drawn two ways in one
    row is the thing switching to SVG was meant to stop.
  */
  it('draws the legality check with the same icon a Met cell uses', () => {
    const badge = SUMMARY.slice(
      SUMMARY.indexOf('eval-badge-line is-clean'),
      SUMMARY.indexOf('eval-condition-cells'),
    );
    const iconIn = (markup: string): string =>
      markup.slice(markup.indexOf('<svg'), markup.indexOf('</svg>'));

    expect(iconIn(badge)).toBe(
      iconIn(CONDITION_CELLS.find((cell) => cell.status === 'met')!.markup),
    );
  });

  /* Row 3 — seven angle chips. */
  it('draws seven angle chips, in order, each with a lean dot and a line', () => {
    const chips = [...SUMMARY.matchAll(/class="eval-angle-chip lean-([a-z]+)"/g)].map((m) => m[1]);
    expect(chips).toHaveLength(7);

    const expected = LABELS.angleOrder.map(
      (id) => FIXTURE.draft.angles.find((a) => a.angleId === id)!.lean,
    );
    expect(chips).toEqual(expected);
    expect([...SUMMARY.matchAll(/class="eval-lean-dot is-[a-z]+"/g)]).toHaveLength(7);
  });

  /*
    The chips carry first sentences, not new text. A second summary in different words is a second
    wording to check, and the addendum forbids it in as many words.
  */
  /*
    Asserted against the rendered line, not against `summaryLine` run twice.

    The first version of this test computed `summaryLine(...)` itself and checked the *paragraph*
    started with it — which is true of `summaryLine`'s output whatever the component renders. A
    mutation replacing every chip line with fixed copy left it green.
  */
  it('draws each chip line from the angle paragraph itself', () => {
    const rendered = [...SUMMARY.matchAll(/class="eval-angle-chip-line">([^<]*)</g)].map((m) =>
      text(m[1]!).trim(),
    );
    expect(rendered).toHaveLength(7);

    const expected = LABELS.angleOrder.map((id) => {
      const angle = FIXTURE.draft.angles.find((a) => a.angleId === id)!;
      return text(summaryLine(RUN, LABELS, angle.paragraph)).trim();
    });
    expect(rendered).toEqual(expected);

    // And each is genuinely the head of its own paragraph, with handles resolved.
    for (const [index, id] of LABELS.angleOrder.entries()) {
      const angle = FIXTURE.draft.angles.find((a) => a.angleId === id)!;
      const resolvedParagraph = text(
        proseSpans(RUN, LABELS, angle.paragraph)
          .map((span) => ('text' in span ? span.text : (span.resolved?.label ?? span.handle)))
          .join(''),
      ).trim();
      const line = rendered[index]!.replace(/…$/, '');
      expect(resolvedParagraph.startsWith(line), id).toBe(true);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('marks a chip whose angle cites heavy evidence', () => {
    const heavy = FIXTURE.draft.angles.filter((a) => citesHeavy(RUN, LABELS, a.citations));
    expect(heavy.length).toBeGreaterThan(0);
    expect([...SUMMARY.matchAll(/class="eval-weight"/g)]).toHaveLength(heavy.length);
  });

  /* Row 4 — the placement paragraph, and the only prose in the block. */
  it('carries the placement paragraph with its citation chips inline', () => {
    expect(SUMMARY).toContain('eval-lede');
    const inLede = SUMMARY.slice(SUMMARY.indexOf('eval-lede'));
    expect(inLede).toContain('eval-chip is-angle');
  });

  /*
    No score, percentage or count of passing rules — *of Mintro's own making*.

    Asserted against a draft whose prose has been emptied, which leaves only the strings this
    component contributes. The distinction is not pedantry: this run's `how_it_sells` paragraph
    reads "quantity discount tiers from 10% to 40%", and a flat ban on the percent sign would
    refuse the merchant's own discount structure — an observation about the site, and one of the
    more telling ones on the run. What the addendum forbids is Mintro scoring the merchant.
  */
  it('contributes no score, percentage or count of passing rules of its own', () => {
    const silent = render({
      ...FIXTURE.draft,
      placement: { ...FIXTURE.draft.placement, paragraph: '' },
      angles: FIXTURE.draft.angles.map((angle) => ({ ...angle, paragraph: '' })),
      legality: {
        ...FIXTURE.draft.legality,
        items: FIXTURE.draft.legality.items.map((item) => ({ ...item, note: '' })),
      },
      shoreUps: [],
    });
    const own = text(silent.slice(0, silent.indexOf('class="panel eval-legality"')));

    expect(own).not.toMatch(/%/);
    expect(own).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(own).not.toMatch(/\b\d+\s+(?:passed|passing|clean)\b/i);
    expect(own).not.toMatch(/\bscore\b/i);
    // The one count it does make survives, and says what it counts.
    expect(own).toMatch(/\d+ not observed/);
  });

  /*
    And the merchant's own numbers reach the page, which is the other half of the same rule.
  */
  it('carries a number the merchant’s own site states', () => {
    const withPercent = FIXTURE.draft.angles.find((a) => a.paragraph.includes('%'));
    expect(withPercent, 'the fixture no longer quotes a merchant percentage').toBeDefined();
    expect(text(SUMMARY)).toContain('%');
  });

  /* The one count the block does make, and the addendum asks for it. */
  it('permits the not-observed count, which counts what was never seen', () => {
    expect(text(SUMMARY)).toMatch(/\d+ not observed/);
  });
});

/*
  Not met is the alert colour wherever it is drawn.

  It read rose in the summary cell and violet in the routing table, so one condition was two
  different-looking facts depending on which half of the document a reader met it in. The colour is
  in the stylesheet, which is why this test reads the stylesheet: the markup is identical either
  way and no rendered assertion can see the difference.

  Parsed into rules rather than grepped. `border-color` contains the string `color`, and a scan that
  did not respect declaration boundaries would read `.eval-condition.is-not_met`'s border rule as a
  text colour and pass on it.
*/
describe('a Not met condition is the alert colour on both surfaces', () => {
  const CSS = readFileSync('apps/web/src/styles.css', 'utf8');

  const RULES = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' }))
    .filter((rule) => !rule.selector.startsWith('@'));

  /** Rules that set a text colour on a Not met element. `border-color` is not one. */
  const NOT_MET = RULES.filter(
    (rule) => rule.selector.includes('is-not_met') && /(^|[;{\s])color\s*:/.test(rule.body),
  );

  it('found the rules, so this is not passing over an empty list', () => {
    expect(RULES.length).toBeGreaterThan(400);
    expect(NOT_MET.length).toBeGreaterThan(1);
  });

  it('colours the summary cell and the table status from the same token', () => {
    // Both surfaces are covered, so a rule going missing fails here rather than going quiet.
    expect(NOT_MET.some((rule) => rule.selector.includes('eval-condition'))).toBe(true);
    expect(NOT_MET.some((rule) => rule.selector.includes('eval-status'))).toBe(true);

    for (const rule of NOT_MET) {
      expect(rule.body, rule.selector).toMatch(/(^|[;{\s])color\s*:\s*var\(--rose\)/);
    }
  });
});

describe('a chip says what it points at, not its identifier', () => {
  it('gives a finding its rule title', () => {
    const finding = FIXTURE.findings.find((f) => f.state !== 'not_evaluable')!;
    const resolved = resolveId(RUN, LABELS, 'finding', finding.id)!;
    expect(resolved.label).toBe(LABELS.ruleTitle[finding.ruleId]);
    expect(resolved.label).not.toBe(finding.ruleId);
  });

  it('gives a capture its host and path, without the scheme or the query', () => {
    const row = FIXTURE.evidence.find((e) => e.url.includes('/shop'))! ?? FIXTURE.evidence[0]!;
    const resolved = resolveId(RUN, LABELS, 'evidence', row.key)!;
    expect(resolved.label).not.toContain('https://');
    expect(resolved.label).toBe(hostAndPath(row.url));
  });

  it('gives an eye-test item its rubric question, and an angle its title', () => {
    expect(resolveId(RUN, LABELS, 'eye_test', 'EYE-01')!.label).toBe(
      LABELS.eyeTestQuestion['EYE-01'],
    );
    const angle = resolveId(RUN, LABELS, 'angle', 'how_it_sells')!;
    expect(angle.label).toBe(LABELS.angleTitle['how_it_sells']);
    // An angle chip scrolls rather than opening a capture, so it carries an anchor.
    expect(angle.anchor).toBe(angleAnchor('how_it_sells'));
  });

  it('anchors every angle detail block the chips point at', () => {
    for (const angle of FIXTURE.draft.angles) {
      expect(HTML, angle.angleId).toContain(`id="${angleAnchor(angle.angleId)}"`);
    }
  });
});

/*
  A finding chip scrolls to its rule's row in section 6.

  Before this the chip was an inert span wherever the finding carried no capture — a reference the
  reader could read and not follow, which is the shape `unresolved_prose_handle` refuses at
  generation time and the rendering half of the same guarantee.

  A link **only where the anchor exists**. `anchoredRuleIds` says which rules section 6 renders a
  row for, and a met stopping condition on a run where another failed is not one of them: the panel
  counts those rather than naming them (D-195). A link to an id nothing carries does nothing at all
  when clicked, which is worse than plain text because it looks followable.
*/
describe('a finding chip scrolls to its row in the evidence section', () => {
  const uncaptured = FIXTURE.findings.filter((f) => f.evidenceKey === null);

  it('the fixture has findings with no capture, so this is not asserted over an empty set', () => {
    expect(uncaptured.length).toBeGreaterThan(0);
  });

  it('links to the rule’s anchor when the section renders a row for it', () => {
    const finding = uncaptured[0]!;
    const anchored = { ...RUN, anchoredRuleIds: new Set([finding.ruleId]) };
    const resolved = resolveId(anchored, LABELS, 'finding', finding.id)!;
    expect(resolved.anchor).toBe(findingAnchor(finding.ruleId));
    expect(resolved.evidenceKey).toBeUndefined();
  });

  it('offers no link where the section renders no row', () => {
    const finding = uncaptured[0]!;
    const resolved = resolveId(
      { ...RUN, anchoredRuleIds: new Set<string>() },
      LABELS,
      'finding',
      finding.id,
    )!;
    expect(resolved.anchor).toBeUndefined();
  });

  /*
    And the chip is drawn as a link rather than described as one.

    Asserted against the markup: `Resolved.anchor` being set says nothing about what `Chip` does
    with it, and the whole point is the thing the reader can click.
  */
  it('draws it as an anchor in the document', () => {
    const anchored = { ...RUN, anchoredRuleIds: new Set(RUN.findings.map((f) => f.ruleId)) };
    const markup = renderToStaticMarkup(
      createElement(EvaluationReport, {
        draft: FIXTURE.draft,
        run: anchored,
        access: ACCESS,
        labels: LABELS,
      }),
    );
    /*
      Cited, uncaptured, and not collapsed.

      A `not_evaluable` citation does not render as a chip at all — the list folds those into a
      count — so it has no link to assert and asserting one would fail for the wrong reason.
    */
    const cited = FIXTURE.draft.angles
      .flatMap((angle) => angle.citations)
      .filter((citation) => citation.kind === 'finding')
      .map((citation) => RUN.findings.find((f) => f.id === citation.ref))
      .filter(
        (f): f is (typeof RUN.findings)[number] =>
          f !== undefined && f.evidenceKey === null && f.state !== 'not_evaluable',
      );

    expect(cited.length).toBeGreaterThan(0);
    for (const finding of cited) {
      expect(markup, finding.ruleId).toContain(`href="#${findingAnchor(finding.ruleId)}"`);
    }
  });

  /*
    And a handle inside a sentence, which is the other place a finding is named.

    A paragraph reads *"…outcome-branded blends (F16)"*. The chip that replaces the handle was an
    inert span, so a reader following the sentence was given the rule's title and left to find the
    row themselves.
  */
  it('links a finding handle inside a paragraph', () => {
    const anchored = { ...RUN, anchoredRuleIds: new Set(RUN.findings.map((f) => f.ruleId)) };
    const markup = renderToStaticMarkup(
      createElement(EvaluationReport, {
        draft: FIXTURE.draft,
        run: anchored,
        access: ACCESS,
        labels: LABELS,
      }),
    );

    const inProse = FIXTURE.draft.angles
      .flatMap((angle) => angle.paragraph.match(PROSE_HANDLE) ?? [])
      .filter((handle) => handle.startsWith('F'))
      .map((handle) => FIXTURE.handles.finding[handle])
      .map((id) => RUN.findings.find((f) => f.id === id))
      .filter((f): f is (typeof RUN.findings)[number] => f !== undefined);

    expect(inProse.length).toBeGreaterThan(0);
    for (const finding of inProse) {
      expect(markup, finding.ruleId).toContain(`href="#${findingAnchor(finding.ruleId)}"`);
    }
  });

  /* A capture is the better destination, and the chip still prefers it. */
  it('still opens the capture where the finding has one', () => {
    const withCapture = FIXTURE.findings.find((f) => f.evidenceKey !== null)!;
    const anchored = { ...RUN, anchoredRuleIds: new Set([withCapture.ruleId]) };
    const resolved = resolveId(anchored, LABELS, 'finding', withCapture.id)!;
    expect(resolved.evidenceKey).toBe(withCapture.evidenceKey);
    expect(resolved.anchor).toBe(findingAnchor(withCapture.ruleId));
  });
});

