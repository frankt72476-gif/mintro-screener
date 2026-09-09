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

/* ── the lean and spectrum scale ──────────────────────────────────────────────────────────────── */

/*
  Green, yellow, red — one ramp for the lean dots and the spectrum strip.

  Read out of the stylesheet and measured, because a colour is a value and no rendered assertion can
  see one. The two things worth asserting are that the three are distinguishable from each other,
  and that the consumer red is distinguishable from `--rose`: the failure state appears in the same
  view as a lean dot, so an 8px dot in the fail red would be two meanings in one swatch.

  L* rather than hue. Hue tells red from green and says nothing about two reds, which is the pair
  that actually had to be told apart — and lightness is the channel that survives an 8px circle.
*/
describe('the lean and spectrum scale', () => {
  const CSS = readFileSync('apps/web/src/styles.css', 'utf8');

  /** The five positions, consumer end first — the order the strip is drawn in. */
  const SPECTRUM = [
    'consumer_retail',
    'consumer_leaning',
    'mixed',
    'research_leaning',
    'research_supplier',
  ] as const;

  /**
   * A custom property's value, following `var()` aliases to the hex they end at.
   *
   * Following them matters: `--scale-neutral` *is* `var(--amber)`, and a lookup that only matched a
   * literal hex would return nothing for two of the three stops. It would also miss the failure this
   * whole scale exists to avoid — pointing `--scale-consumer` at `--rose` is a one-line change that
   * a hex-only matcher reads as "no token" and crashes on, rather than as "these are the same red".
   */
  const token = (name: string, seen = new Set<string>()): string | null => {
    if (seen.has(name)) return null;
    seen.add(name);
    const found = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
    if (found === null) return null;
    const value = found[1]!.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value.toUpperCase();
    const alias = value.match(/^var\(--([\w-]+)\)$/);
    return alias === null ? null : token(alias[1]!, seen);
  };

  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];

  const luminance = (hex: string): number => {
    const channel = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = rgb(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const lstar = (hex: string): number => {
    const y = luminance(hex);
    const f = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
    return 116 * f - 16;
  };

  /** Degrees from pure red, whichever way round the wheel. 359 is one degree of red, not 359. */
  const hue = (hex: string): number => {
    const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const span = max - min;
    if (span === 0) return 0;
    const degrees =
      max === r
        ? (((g - b) / span) % 6) * 60
        : max === g
          ? ((b - r) / span + 2) * 60
          : ((r - g) / span + 4) * 60;
    const from = ((degrees % 360) + 360) % 360;
    return Math.min(from, 360 - from);
  };

  const saturation = (hex: string): number => {
    const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    return max === 0 ? 0 : ((max - Math.min(r, g, b)) / max) * 100;
  };

  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  /** `color-mix(in srgb, A p%, B)` as the browser computes it. */
  const blend = (a: string, b: string, share: number): string => {
    const [ra, ga, ba] = rgb(a);
    const [rb, gb, bb] = rgb(b);
    const at = (x: number, y: number): string =>
      Math.round(x * share + y * (1 - share))
        .toString(16)
        .padStart(2, '0');
    return `#${at(ra, rb)}${at(ga, gb)}${at(ba, bb)}`.toUpperCase();
  };

  /** The colour a `background` declaration computes to: one token, or a mix of two. */
  const fillOf = (body: string): string | null => {
    const mixed = body.match(
      /color-mix\(in srgb,\s*var\(--([\w-]+)\)\s*([\d.]+)%,\s*var\(--([\w-]+)\)\s*\)/,
    );
    if (mixed !== null) {
      const a = token(mixed[1]!);
      const b = token(mixed[3]!);
      return a === null || b === null ? null : blend(a, b, Number(mixed[2]) / 100);
    }
    const plain = body.match(/background:\s*var\(--([\w-]+)\)/);
    return plain === null ? null : token(plain[1]!);
  };

  // Green and yellow are aliases, so they resolve through to the palette's own values.
  const RED = token('scale-consumer');
  const YELLOW = token('amber');
  const GREEN = token('jade');
  const ROSE = token('rose');

  it('resolves every colour it is about, so nothing below passes over a missing token', () => {
    for (const [name, value] of [
      ['scale-consumer', RED],
      ['amber', YELLOW],
      ['jade', GREEN],
      ['rose', ROSE],
    ] as const) {
      expect(value, `--${name} did not resolve to a hex`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('defines the scale, and the ends it replaced are gone', () => {
    expect(CSS).toContain('--scale-consumer:');
    expect(CSS).toContain('--scale-neutral:var(--amber)');
    expect(CSS).toContain('--scale-research:var(--jade)');
    // clay and harbour went with the recolour — a token nothing reads is a colour nobody chose.
    expect(CSS).not.toMatch(/--clay\s*:/);
    expect(CSS).not.toMatch(/--harbour\s*:/);
    expect(CSS).not.toContain('var(--clay)');
    expect(CSS).not.toContain('var(--harbour)');
  });

  it('draws its green, yellow and red far enough apart to tell at dot size', () => {
    const pairs: [string, string, string][] = [
      ['red/yellow', RED!, YELLOW!],
      ['yellow/green', YELLOW!, GREEN!],
      ['red/green', RED!, GREEN!],
    ];
    for (const [label, a, b] of pairs) {
      expect(Math.abs(lstar(a) - lstar(b)), `${label} ${a} vs ${b}`).toBeGreaterThan(10);
    }
  });

  /*
    The red reads as red, which is the only thing it is held to.

    An earlier version asserted it sat fifteen L* points clear of `--rose`, on the reasoning that a
    lean dot and a failure marker appear on the same screen. That was the D-201 bar applied to the
    wrong thing: D-201 is about **section identity colours**, which a reader meets as a list and
    reads down. A dot and a failure marker are never in a list together — different shapes,
    different rows, different labels, and nothing puts them side by side. "Both are on screen" is
    not "a reader has to tell these apart".

    The separation it bought was real and useless; what it cost was the red. At 10px the dark brick
    it forced read as maroon, and a scale whose red end is not namable as red has failed before any
    confusion with the failure state could arise. So the constraint is gone and this is what
    replaces it: hue at the red point, saturated, and light enough to be a colour rather than a
    shadow.
  */
  it('draws a red a reader would name without comparing it to anything', () => {
    expect(hue(RED!), `scale-consumer ${RED} is not at the red point`).toBeLessThanOrEqual(10);
    expect(saturation(RED!), `scale-consumer ${RED} is washed out`).toBeGreaterThan(70);
    expect(lstar(RED!), `scale-consumer ${RED} is too dark to read as red`).toBeGreaterThan(40);
    expect(lstar(RED!)).toBeLessThan(55);
  });

  /*
    It is still its own value and not `--rose` itself — a dot and a failure marker mean different
    things, and one token for both would make them one thing whatever the lightness.
  */
  it('is a value of its own, not the failure state reused', () => {
    expect(RED).not.toBe(ROSE);
  });

  /*
    Ten pixels, as a floor.

    A hue is what this shape carries, and the smaller the patch the more a colour reads as a smudge
    of its neighbours. Asserted as a minimum rather than an equality: the number may grow, and a
    test that pinned it would be the same number written twice.
  */
  it('draws the dot large enough to carry a hue', () => {
    const rule = CSS.match(/\.eval-lean-dot\{([^}]*)\}/);
    expect(rule, 'no .eval-lean-dot rule').not.toBeNull();
    const size = rule![1]!.match(/width:\s*(\d+)px/);
    expect(size, 'the dot declares no width').not.toBeNull();
    expect(Number(size![1]), 'the lean dot has shrunk').toBeGreaterThanOrEqual(10);
  });

  it('gives every lean its own colour from the scale', () => {
    expect(CSS).toContain('.eval-lean-dot.is-consumer{background:var(--scale-consumer)}');
    expect(CSS).toContain('.eval-lean-dot.is-neutral{background:var(--scale-neutral)}');
    expect(CSS).toContain('.eval-lean-dot.is-research{background:var(--scale-research)}');
  });

  /*
    The strip runs the same scale, in order.

    Asserted as *which stops each position draws from* rather than as five hex values: the two
    intermediates are mixed from their neighbours, so the ordering is the thing to hold and the
    values follow from the tokens.
  */
  it('runs red at the consumer end through yellow at Mixed to green at the research end', () => {
    expect(SPECTRUM).toHaveLength(5);
    const ruleFor = (position: string): string => {
      const found = CSS.match(
        new RegExp(`\\.eval-position\\[data-position="${position}"\\]\\{([^}]*)\\}`),
      );
      expect(found, position).not.toBeNull();
      return found![1]!;
    };

    expect(ruleFor('consumer_retail')).toContain('--scale-consumer');
    expect(ruleFor('consumer_retail')).not.toContain('--scale-research');

    expect(ruleFor('consumer_leaning')).toContain('--scale-consumer');
    expect(ruleFor('consumer_leaning')).toContain('--scale-neutral');

    expect(ruleFor('mixed')).toContain('--scale-neutral');
    expect(ruleFor('mixed')).not.toContain('--scale-consumer');
    expect(ruleFor('mixed')).not.toContain('--scale-research');

    expect(ruleFor('research_leaning')).toContain('--scale-neutral');
    expect(ruleFor('research_leaning')).toContain('--scale-research');

    expect(ruleFor('research_supplier')).toContain('--scale-research');
    expect(ruleFor('research_supplier')).not.toContain('--scale-consumer');
  });

  /*
    The marked position's label is readable on every one of the five fills.

    This is the assertion the ramp was built around. An even blend of red and yellow measures
    4.31:1 against white and 4.12:1 against ink — clearing neither — so `consumer_leaning` carries
    60% red, and the yellow-to-green stops take ink where white would fail at 2.13:1 and 3.39:1.
    Computing the blends here rather than trusting them is the whole point: the values that failed
    were the mixed ones.
  */
  it('clears 4.5:1 on every filled segment', () => {
    const WHITE = '#FFFFFF';
    const INK = token('ink');

    for (const position of SPECTRUM) {
      const rule = CSS.match(
        new RegExp(`\\.eval-position\\.is-here\\[data-position="${position}"\\]\\{([^}]*)\\}`),
      );
      expect(rule, `${position} has no filled rule`).not.toBeNull();

      const body = rule![1]!;
      /*
        The fill is resolved out of this rule, blend percentage and all.

        The first version computed the blends here from the weights I had chosen, so it measured the
        ramp I meant rather than the one declared — changing 60% to 50% in the stylesheet left it
        green on a stop that clears neither text colour. The expected value has to come from where
        the actual value comes from (D-026).
      */
      const fill = fillOf(body);
      expect(fill, `${position} declares no resolvable fill`).toMatch(/^#[0-9A-F]{6}$/);

      // Explicit on every stop: one rule guessing for all five is what produced the failures above.
      expect(body, position).toMatch(/color:\s*(#fff|var\(--ink\))/);

      const text = body.includes('#fff') ? WHITE : INK!;
      expect(contrast(text, fill!), `${position}: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
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
