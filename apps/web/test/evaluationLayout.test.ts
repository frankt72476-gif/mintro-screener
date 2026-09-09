/**
 * What the preview reading asked for: the focal placement, section labels, chip states, a
 * collapsible evidence section, and a way back to the top.
 *
 * Separate from `evaluationReport.test.ts` because these are about **navigation and hierarchy** —
 * what a reader meets first, what they can click, and where it takes them — rather than about what
 * the document says. The other file is the one that guards the constraints.
 *
 * Three of the five are decided in the stylesheet, and this reads the stylesheet for them. "The
 * largest element on the first screen" is a size, and no rendered assertion can see a size; the only
 * place that fact exists is the CSS.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import anglesJson from '../../../rules/angles.json';
import rulesetJson from '../../../rules/ruleset.json';
import eyeTestJson from '../../../rules/eyetest.json';
import type { ScreeningReport } from '@mintro/engine';
import { EvaluationReport } from '../src/components/EvaluationReport.js';
import { EvaluationEvidence, EvaluationNotChecked } from '../src/components/EvaluationEvidence.js';
import { EvidenceDisclosureProvider } from '../src/components/EvidenceDisclosure.js';
import { findingAnchor } from '../src/lib/grouping.js';
import {
  EVALUATION_SECTIONS,
  INERT_REASON,
  SECTION_LABEL,
  TOP_ANCHOR,
  chipAffordance,
  evaluationSectionAnchor,
  type EvaluationLabels,
  type EvaluationRunContext,
  type FindingState,
  type Resolved,
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
  anchoredRuleIds: new Set(FIXTURE.findings.map((f) => f.ruleId)),
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

const HTML = renderToStaticMarkup(
  createElement(EvaluationReport, {
    draft: FIXTURE.draft,
    run: RUN,
    access: ACCESS,
    labels: LABELS,
  }),
);

const REPORT = JSON.parse(
  readFileSync('fixtures/reports/live-comopeptides.json', 'utf8'),
) as ScreeningReport;

const evidence = (inProvider: boolean): string => {
  const section = createElement(EvaluationEvidence, { report: REPORT, access: ACCESS } as never);
  return renderToStaticMarkup(
    inProvider ? createElement(EvidenceDisclosureProvider, null, section) : section,
  );
};

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/* ── 1. the recommended placement leads ───────────────────────────────────────────────────────── */

describe('the recommended placement is what the first screen is about', () => {
  it('is labelled, and labelled as the recommendation rather than as today’s state', () => {
    expect(text(HTML)).toContain('Recommended placement');
    expect(HTML).toContain('eval-row-focal');
  });

  /*
    Before the spectrum, not beside it.

    The badge and the strip shared a row at equal weight, so a reader met two things and had to work
    out which was the answer. Order is the cheap half of fixing that and size is the other half.
  */
  it('comes before the spectrum strip', () => {
    expect(HTML.indexOf('eval-row-focal')).toBeLessThan(HTML.indexOf('eval-spectrum'));
    expect(HTML.indexOf('eval-row-focal')).toBeLessThan(HTML.indexOf('eval-row-placement'));
  });

  it('says the placement once, not twice', () => {
    expect([...HTML.matchAll(/class="eval-focal-badge /g)]).toHaveLength(1);
    // The old badge is gone rather than hidden, so there is no second copy to drift.
    expect(HTML).not.toContain('class="eval-badge ');
  });

  /*
    The largest element on the first screen, asserted where size actually lives.

    Nothing in the rendered markup carries a size, so a markup test can only check that the badge is
    *there*. The stylesheet is where "largest" is decided, and it is compared against every other
    font-size the evaluation declares — not against a number written down twice.
  */
  describe('is the largest type in the document', () => {
    const CSS = readFileSync('apps/web/src/styles.css', 'utf8');

    const RULES = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' }))
      .filter((rule) => !rule.selector.startsWith('@'));

    /** Every `font-size` in px declared on an `.eval-` selector, with the selector that set it. */
    const SIZES = RULES.filter((rule) => rule.selector.includes('.eval-'))
      .flatMap((rule) =>
        [...rule.body.matchAll(/font-size\s*:\s*([\d.]+)px/g)].map((match) => ({
          selector: rule.selector,
          px: Number(match[1]),
        })),
      );

    /*
      The badge is sized in two rules — the read-mode paragraph and the edit-mode buttons — and both
      are the badge. Compared as a group against everything that is not the badge, so the edit-mode
      twin cannot be mistaken for a competitor and cannot drift smaller unnoticed.
    */
    const isFocal = (selector: string): boolean => selector.includes('.eval-focal-badge');
    const focal = SIZES.filter((size) => isFocal(size.selector));

    it('found the sizes, so this is not passing over an empty list', () => {
      expect(SIZES.length).toBeGreaterThan(20);
      expect(focal.length).toBeGreaterThan(0);
    });

    it('is one size wherever the badge is drawn', () => {
      expect(new Set(focal.map((size) => size.px)).size).toBe(1);
    });

    it('is larger than every other sized element in the evaluation', () => {
      const others = SIZES.filter((size) => !isFocal(size.selector));
      const biggest = others.reduce((a, b) => (b.px > a.px ? b : a));
      expect(
        focal[0]!.px,
        `${biggest.selector} is ${biggest.px}px against the badge's ${focal[0]!.px}px`,
      ).toBeGreaterThan(biggest.px);
    });
  });
});

/* ── 2. section labels ────────────────────────────────────────────────────────────────────────── */

describe('a summary row and its section carry the same label', () => {
  /** The four rows that link down, in the order the block draws them. */
  const ROWS = ['placement', 'legality', 'routing', 'angles'] as const;

  it('labels every summary row with a link to its section', () => {
    for (const id of ROWS) {
      expect(HTML, id).toContain(`href="#${evaluationSectionAnchor(id)}"`);
      expect(text(HTML), id).toContain(SECTION_LABEL[id]);
    }
    expect([...HTML.matchAll(/class="eyebrow eval-rowlabel"/g)]).toHaveLength(ROWS.length);
  });

  /*
    Every label resolves. A row label pointing at an id nothing carries is the same dead fragment
    link a chip would be, one level up — and it is the one a reader tries first.
  */
  it('anchors every section a row label points at', () => {
    for (const id of ROWS) {
      expect(HTML, id).toContain(`id="${evaluationSectionAnchor(id)}"`);
    }
  });

  /*
    And the heading a reader lands on says what they clicked.

    One string from `SECTION_LABEL` in both places — a row reading *Routing* over a heading reading
    *Routing conditions* leaves the reader checking whether they arrived.
  */
  it('heads each section with the row’s own words', () => {
    for (const id of ROWS.filter((row) => row !== 'placement')) {
      expect(HTML, id).toContain(`<h2 class="eval-heading">${SECTION_LABEL[id]}</h2>`);
    }
    expect(HTML).toContain(`<h2 class="eval-heading">${SECTION_LABEL.shoreups}</h2>`);
  });

  it('heads the two appendix sections the same way', () => {
    expect(evidence(false)).toContain(`<h2 class="eval-heading">${SECTION_LABEL.evidence}</h2>`);
    expect(text(notCheckedMarkup())).toContain(SECTION_LABEL['not-checked']);
    expect(notCheckedMarkup()).toContain(`id="${evaluationSectionAnchor('not-checked')}"`);
    expect(evidence(false)).toContain(`id="${evaluationSectionAnchor('evidence')}"`);
  });

  it('names every section once, so the two lists cannot drift', () => {
    const ids = EVALUATION_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(EVALUATION_SECTIONS.map((s) => s.label)).size).toBe(ids.length);
  });
});

function notCheckedMarkup(): string {
  return renderToStaticMarkup(createElement(EvaluationNotChecked, { report: REPORT } as never));
}

/* ── 3. back to top ───────────────────────────────────────────────────────────────────────────── */

describe('back to the top, once the summary has gone', () => {
  it('renders hidden, because at the top it would cover what it returns to', () => {
    expect(HTML).toContain('class="eval-totop"');
    expect(HTML).toMatch(/class="eval-totop"[^>]*hidden/);
  });

  it('is a real destination and the document carries it', () => {
    expect(HTML).toContain(`href="#${TOP_ANCHOR}"`);
    expect(HTML).toContain(`id="${TOP_ANCHOR}"`);
  });

  /*
    Hidden has to win. `.eval-totop` is `position:fixed`, which sets `display` — without a rule for
    the attribute the control would float over the first screen from the moment the page loads.
  */
  it('is hidden by the stylesheet as well as by the attribute', () => {
    const CSS = readFileSync('apps/web/src/styles.css', 'utf8');
    expect(CSS).toMatch(/\.eval-totop\[hidden\]\s*\{\s*display\s*:\s*none/);
  });
});

/* ── 4. chip states ───────────────────────────────────────────────────────────────────────────── */

describe('a chip says whether it goes anywhere', () => {
  /*
    A run with no evidence section behind it — a draft whose report could not be read.

    The field is removed rather than set to `undefined`: `exactOptionalPropertyTypes` is on, and the
    two are different things to this codebase. Absent means nobody said; `undefined` would be
    somebody saying nothing.
  */
  const { anchoredRuleIds: _omitted, ...NO_SECTION } = RUN;

  const resolved = (over: Partial<Resolved>): Resolved => ({
    kind: 'finding',
    id: 'f-1',
    ruleId: 'CATG-005',
    label: 'A rule',
    ...over,
  });

  it('opens a capture where there is one and access to mint a URL', () => {
    const chip = resolved({ evidenceKey: 'k', anchor: findingAnchor('CATG-005') });
    expect(chipAffordance(chip, RUN, true).kind).toBe('capture');
    // Without access nothing can be minted, so it falls back to the row rather than pretending.
    expect(chipAffordance(chip, RUN, false).kind).toBe('link');
  });

  it('links to the row where the section renders one', () => {
    const chip = resolved({ anchor: findingAnchor('CATG-005') });
    expect(chipAffordance(chip, RUN, true)).toEqual({ kind: 'link' });
  });

  /* Each reason is true of the chip it is given to, and each is reachable. */
  it('says a rule the evidence section counts rather than names is counted, not named', () => {
    const counted = { ...RUN, anchoredRuleIds: new Set<string>() };
    expect(chipAffordance(resolved({}), counted, true)).toEqual({
      kind: 'inert',
      reason: INERT_REASON.countedNotNamed,
    });
  });

  it('says an unevaluated finding was not evaluable on this run', () => {
    expect(chipAffordance(resolved({ state: 'not_evaluable' }), NO_SECTION, true)).toEqual({
      kind: 'inert',
      reason: INERT_REASON.notEvaluable,
    });
  });

  it('says a finding with nothing stored has no capture recorded', () => {
    expect(chipAffordance(resolved({ state: 'fail' }), NO_SECTION, true)).toEqual({
      kind: 'inert',
      reason: INERT_REASON.noCapture,
    });
  });

  /*
    The eye test gets its own reason rather than borrowing one.

    It is not a rule and must never become one (D-196), so "no capture recorded for this rule" would
    quietly call it one in a tooltip.
  */
  it('says the eye test records a read rather than calling it a rule', () => {
    const verdict: Resolved = { kind: 'eye_test', id: 'EYE-01', label: 'A question' };
    expect(chipAffordance(verdict, RUN, true)).toEqual({
      kind: 'inert',
      reason: INERT_REASON.eyeTest,
    });
    expect(INERT_REASON.eyeTest).not.toContain('rule');
  });

  it('draws the two kinds differently, and puts the reason on the muted one', () => {
    expect(HTML).toContain('is-linked');
    expect(HTML).toContain('eval-chip-arrow');
    expect(HTML).toContain('is-inert');
    /*
      Every inert chip in the document carries a reason, bar the legend's own example.

      That one is an illustration of the shape rather than a citation of anything, and the sentence
      beside it is already the explanation a title would repeat.
    */
    const withoutLegend =
      HTML.slice(0, HTML.indexOf('class="eval-key"')) +
      HTML.slice(HTML.indexOf('</dl>', HTML.indexOf('class="eval-key"')));
    const inert = [...withoutLegend.matchAll(/<span class="[^"]*is-inert"([^>]*)>/g)].map(
      (m) => m[1] ?? '',
    );
    expect(inert.length).toBeGreaterThan(0);
    for (const attrs of inert) expect(attrs).toContain('title="');
  });

  it('gives a linked chip a colour and an underline, not the arrow alone', () => {
    const CSS = readFileSync('apps/web/src/styles.css', 'utf8');
    const rule = CSS.match(/\.eval-chip\.is-linked\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('text-decoration:underline');
    expect(rule).toContain('color:var(--violet)');
  });

  /*
    One key, at the head of the section.

    It was a paragraph under the first angle, which read as that angle's footnote: a reader who
    started at the second one never met it, and a reader who started at the first met an explanation
    before they had seen the thing it explained.
  */
  it('explains the two kinds once, at the head of the angles', () => {
    expect([...HTML.matchAll(/class="eval-key"/g)]).toHaveLength(1);
    const key = text(HTML.slice(HTML.indexOf('eval-key')));
    expect(key).toContain('Opens the capture behind it, or jumps to the rule below');
    expect(key).toContain('Goes nowhere');

    const at = HTML.indexOf('class="eval-key"');
    expect(at).toBeGreaterThan(HTML.indexOf(`id="${evaluationSectionAnchor('angles')}"`));
    expect(at).toBeLessThan(HTML.indexOf('id="evaluation-angle-'));
  });

  /* Two examples, one line each — the shape a reader recognises as a key and stops reading. */
  it('draws the key as two rows rather than a paragraph', () => {
    expect([...HTML.matchAll(/class="eval-key-row"/g)]).toHaveLength(2);
  });
});

/* ── 5. the evidence section is collapsed until it is wanted ──────────────────────────────────── */

describe('section 6 opens on request', () => {
  it('is collapsed under a count when something can open it', () => {
    const markup = evidence(true);
    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/<div id="evaluation-evidence-body"[^>]*hidden/);
  });

  it('states how many rules are inside, as a size and not a score', () => {
    /*
      Scoped to the toggle.

      The rows beneath it are the checklist report's own rendering and carry its band tallies —
      "7 of 9 checked and clear" is that document speaking, not this one, and it is behind a closed
      drawer. What this asserts is the line the reader sees while it is closed.
    */
    const markup = evidence(true);
    const toggle = text(
      markup.slice(markup.indexOf('<button'), markup.indexOf('</button>')),
    );
    const rules = new Set(
      REPORT.categories.flatMap((category) => category.findings.map((f) => f.ruleId)),
    ).size;
    expect(rules).toBeGreaterThan(1);
    expect(toggle).toContain(`${rules} rules`);
    // No denominator and no split by state, which is what would make it a score.
    expect(toggle).not.toMatch(/\d+\s+of\s+\d+/);
    expect(toggle).not.toMatch(/\d+\s+(?:passed|failed|met)/i);
  });

  /*
    Open where nothing can open it.

    The print path has no provider, and a collapsed section with no control able to open it is a
    section nobody can reach — taking every anchor in the document with it.
  */
  it('is open when no disclosure is controlling it', () => {
    const markup = evidence(false);
    expect(markup).toContain('data-open="true"');
    expect(markup).not.toContain('eval-disclose');
    expect(markup).not.toMatch(/<div id="evaluation-evidence-body"[^>]*hidden/);
  });

  /*
    The rows are in the document either way.

    `hidden` rather than an absent subtree, so every anchor a chip points at exists before the
    reader has expanded anything — the link is honest at the moment it is drawn, and the click
    handler only makes it land somewhere visible.
  */
  it('keeps every anchor present while collapsed', () => {
    const markup = evidence(true);
    const rules = [
      ...new Set(REPORT.categories.flatMap((c) => c.findings.map((f) => f.ruleId))),
    ].slice(0, 5);
    expect(rules.length).toBe(5);
    for (const ruleId of rules) {
      expect(markup, ruleId).toContain(`id="${findingAnchor(ruleId)}"`);
    }
  });

  it('names what the toggle controls, so the control and the region are joined', () => {
    const markup = evidence(true);
    expect(markup).toContain('aria-controls="evaluation-evidence-body"');
    expect(markup).toContain('id="evaluation-evidence-body"');
  });
});
