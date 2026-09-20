/**
 * "At a glance", by relationship to the cited rule (cluster 4d, D-290; A1, A7).
 *
 * The block replaces the one cluster 4c shipped. What it may say, and what it may never say, is the
 * whole of D-290, so the guards are the substance of this file:
 *
 *   - the verdict-word guard, widened with good, bad, aggressive, conservative and rating;
 *   - no tally of findings — the only number is how many questions the merchant answered;
 *   - colour keyed to the relationship and nothing else: three hues and near-grey, the group → hue map
 *     pinned, and no class or style keyed to fail, pass or not_evaluable;
 *   - the legend, verbatim, in the document.
 *
 * Driven from run 6571d6a9 as stored, and from a run of the shape findings have now.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveAttestations, type ReportFinding, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { RELATION_LEGEND } from '../src/components/AdultFindingsReport.js';

interface Fixture {
  readonly row: {
    readonly vertical: 'adult_ai';
    readonly referral_status: 'proceeds' | 'not_referred';
    readonly referral_reasons: string[];
    readonly referral_policy_version: string;
  };
  readonly report: ScreeningReport;
}

const fixture = JSON.parse(readFileSync('fixtures/adult-ai/xchar.ai-6571d6a9.json', 'utf8')) as Fixture;
const stored: ScreeningReport = {
  ...fixture.report,
  vertical: fixture.row.vertical,
  referral: {
    version: fixture.row.referral_policy_version,
    status: fixture.row.referral_status,
    reasons: fixture.row.referral_reasons,
  },
};

const access = { description: 'test', urlFor: async () => null };

const render = (report: ScreeningReport, attestations?: ReturnType<typeof resolveAttestations>): string =>
  renderToStaticMarkup(
    createElement(ReportView, { report, access, print: true, ...(attestations === undefined ? {} : { attestations }) }),
  );

const blockOf = (markup: string): string =>
  markup.slice(markup.indexOf('<section class="adult-glance"'), markup.indexOf('<section class="adult-index"'));

const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** One card's rows, as "<what> — <where>". */
const cardRows = (block: string, group: string): string[] => {
  const from = block.indexOf(`glance-${group}"`);
  if (from === -1) return [];
  const card = block.slice(from, block.indexOf('</ul>', from));
  return [...card.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => {
    const what = textOf(/<span class="glance-what">(.*?)<\/span>/.exec(m[1]!)?.[1] ?? '');
    const where = textOf(/<span class="glance-where">(.*?)<\/span>/.exec(m[1]!)?.[1] ?? '');
    return where === '' ? what : `${what} — ${where}`;
  });
};

const storedMarkup = render(stored);
const block = blockOf(storedMarkup);

describe('run 6571d6a9, by relationship', () => {
  it('opens with the referral line, naming what triggered it', () => {
    expect(textOf(/<p class="glance-headline">(.*?)<\/p>/.exec(block)?.[1] ?? '')).toBe(
      'Referral policy v1.0: not referred — Face-swap or face-consistency language observed on the docs site (P-1).',
    );
  });

  it('renders the five groups in order, and only those with members', () => {
    const headings = [...block.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => textOf(m[1]!));
    expect(headings).toEqual([
      'Consistent with the cited rule',
      'Named as restricted by the cited rule',
      'Required by the cited rule, not found',
      'Observed, with no published rule cited',
      'Not reached on this run',
    ]);
  });

  it('names, under each heading, the sources that group cites', () => {
    const cite = (group: string): string =>
      textOf(/<p class="glance-cite">(.*?)<\/p>/.exec(block.slice(block.indexOf(`glance-${group}"`)))?.[1] ?? '');

    expect(cite('consistent')).toContain('Mastercard Rules 5.12.7');
    expect(cite('consistent')).toContain('Cal. SB 243');
    expect(cite('restricted')).toBe('Mastercard Rules 5.12.7');
    expect(cite('required-not-found')).toBe('TAKE IT DOWN Act § 3(a)');
    // Nothing is cited where Mintro wrote the rule.
    expect(block.slice(block.indexOf('glance-no-published-rule"'), block.indexOf('glance-not-reached"'))).not.toContain(
      'glance-cite',
    );
  });

  it('puts each finding under the relationship its cited rule gives it', () => {
    expect(cardRows(block, 'consistent')).toEqual([
      'Prohibits minors, real-person likeness, non-consent, bestiality and mutilation — terms document',
      'Non-human disclosure statement on public pages — homepage',
      '48-hour removal commitment in the terms — terms document',
    ]);
    expect(cardRows(block, 'restricted')).toEqual(['Face-swap or face-consistency language — docs site']);
    expect(cardRows(block, 'required-not-found')).toEqual([
      'Content removal route linked in the footer — not on the homepage',
    ]);
    expect(cardRows(block, 'no-published-rule')).toEqual([
      'Video generation language — docs site',
      'Model selection or LoRA language — docs site',
      'Filter-removal language in marketing — homepage',
      'Affiliate program — homepage',
    ]);
    /*
      The catalogue prohibitions are not consistency on this run: it read the homepage and never
      reached the creation, generation or library pages, which is where character names live. The
      rows carry the run's own account of that, from the note beneath each finding.
    */
    const catalogue =
      'the character creation page, the generation page and the character library page not published';
    expect(cardRows(block, 'not-reached')).toEqual([
      'Upload control on creation, generation, pricing or documentation pages — ' +
        'the character creation page, the generation page and the pricing page not published',
      `Minor-coded terms — ${catalogue}`,
      `Real-person likeness terms — ${catalogue}`,
      'Behaviour over a long conversation',
    ]);
  });

  it('carries the legend, verbatim, in the document', () => {
    expect(textOf(block)).toContain(RELATION_LEGEND);
    expect(RELATION_LEGEND).toBe(
      "Grouping and colour follow the cited rule's own text. Mintro states what it observed; it does not rate the merchant.",
    );
  });

  it('leaves the index and the findings below it', () => {
    expect(storedMarkup.indexOf('adult-glance')).toBeLessThan(storedMarkup.indexOf('adult-index'));
    expect(storedMarkup.indexOf('adult-index')).toBeLessThan(storedMarkup.indexOf('adult-observed'));
  });
});

describe('the guards', () => {
  it('carries none of the verdict or rating vocabulary', () => {
    const banned =
      /\b(?:fail|pass|blocker|clean|compliant|recommend|placement|good|bad|aggressive|conservative|rating)\w*|\bmet\b|\bnot met\b/gi;
    expect(textOf(block).match(banned) ?? []).toEqual([]);
  });

  it('tallies no findings: the only number is the merchant\'s answers', () => {
    const text = textOf(block);
    expect(text).not.toMatch(/(?<![-\d])\d+\s+(?:observed|not observed|could not be checked|findings?|rules?|of)\b/i);
    expect(text).not.toMatch(/\btotal|summary|score|overall|risk\b/i);
  });

  it('keys no class or style to a finding\'s state', () => {
    const classes = [...block.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    for (const name of classes) {
      expect(name).not.toMatch(/fail|pass|not[_-]?evaluable|state|good|bad|warn|danger|ok\b/i);
    }
    expect(block).not.toContain(' style="');
  });

  it('colours by relationship only: each group pinned to its ramp, and no other colour at all', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const styles = css.slice(css.indexOf('.adult-glance {'));

    /*
      The palette, pinned by value rather than by hue band (the approved mock).

      A band was the wrong instrument: the approved teal 600 sits at hue 165 and the pink 600 at 340,
      either side of a band drawn to exclude green and red, while an unapproved colour inside the band
      would have passed. Pinning the stops says what is actually allowed — these ramps, for these
      groups — and refuses everything else, which is the property that matters.
    */
    const RAMPS: Record<string, { fill: string; border: string; heading: string }> = {
      consistent: { fill: '#E1F5EE', border: '#0F6E56', heading: '#0A4D3C' },
      restricted: { fill: '#EEEDFE', border: '#534AB7', heading: '#322C7A' },
      'required-not-found': { fill: '#FBEAF0', border: '#993556', heading: '#6E2440' },
    };
    /** The neutrals: the stronger line the grey cards and the links take. */
    const NEUTRAL = ['#C9C4DA'];

    for (const [group, ramp] of Object.entries(RAMPS)) {
      const card = new RegExp(`\\.glance-${group} \\{ background: (#[0-9A-Fa-f]{6}); border-color: (#[0-9A-Fa-f]{6}); \\}`).exec(
        styles,
      );
      const heading = new RegExp(`\\.glance-${group} h3 \\{ color: (#[0-9A-Fa-f]{6}); \\}`).exec(styles);
      const note = new RegExp(`\\.glance-${group} \\.glance-where \\{ color: (#[0-9A-Fa-f]{6}); \\}`).exec(styles);

      expect({ group, fill: card?.[1], border: card?.[2], heading: heading?.[1], note: note?.[1] }).toEqual({
        group,
        fill: ramp.fill,
        border: ramp.border,
        heading: ramp.heading,
        // The surface note takes the 600 stop, not a muted grey.
        note: ramp.border,
      });
    }

    // The two groups with no cited rule take the page's own surface and the stronger line.
    expect(styles).toContain('.glance-not-reached { background: var(--surface-1); border-color: #C9C4DA; }');

    // And nothing else with colour in it appears anywhere in the block.
    const allowed = new Set([...Object.values(RAMPS).flatMap((r) => Object.values(r)), ...NEUTRAL]);
    const used = [...styles.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
    expect([...new Set(used)].filter((hex) => !allowed.has(hex))).toEqual([]);
  });

  it('takes the mock\'s shape: 12px radius, tinted card, 14px rows', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const styles = css.slice(css.indexOf('.adult-glance {'));

    expect(styles).toMatch(/\.glance-card \{[^}]*border-radius: 12px;/s);
    expect(styles).toMatch(/\.glance-card \{[^}]*padding: 12px 16px;/s);
    expect(styles).toMatch(/\.glance-cards \{[^}]*gap: 10px;/s);
    expect(styles).toMatch(/\.glance-card li \{[^}]*font-size: 14px;/s);
    expect(styles).toMatch(/\.glance-card li \{[^}]*color: var\(--ink\);/s);
    // The referral line: the purple rule, at the rows' size.
    expect(styles).toMatch(/\.glance-headline \{[^}]*border-left: 3px solid #534AB7;/s);
    expect(styles).toMatch(/\.glance-headline \{[^}]*font-size: 14px;/s);
  });

});

describe('a run of the shape findings have now', () => {
  /** AITD-001 with surfaces recorded, and AICAT-001 whose library page was never reached. */
  const current: ScreeningReport = {
    ...stored,
    categories: stored.categories.map((category) => ({
      ...category,
      findings: category.findings.map((finding): ReportFinding => {
        if (finding.ruleId === 'AITD-001') {
          return {
            ...finding,
            title: 'Content removal route',
            direction: 'requires',
            surfaces: [
              { surface: 'footer', status: 'read' },
              { surface: 'removal', status: 'not_published' },
            ],
          };
        }
        if (finding.ruleId === 'AICAT-001') {
          return {
            ...finding,
            direction: 'prohibits',
            surfaces: [
              { surface: 'homepage', status: 'read' },
              { surface: 'library', status: 'not_published' },
            ],
          };
        }
        return finding;
      }),
    })),
  };

  const currentBlock = blockOf(render(current));

  it('names the surfaces read and the ones that were not', () => {
    expect(cardRows(currentBlock, 'required-not-found')).toEqual([
      'Content removal route — not in the footer; removal page not published',
    ]);
  });

  it('moves a prohibition whose pages were not all read out of consistency, into not reached', () => {
    expect(cardRows(currentBlock, 'consistent')).not.toContain('Minor-coded terms — homepage');
    expect(cardRows(currentBlock, 'not-reached')).toContain(
      'Minor-coded terms — on the homepage; character library not published',
    );
  });

  it('counts the merchant\'s answers, and nothing else', () => {
    const attestations = resolveAttestations(
      [
        { id: 'chargeback-ratio', question: 'What was your chargeback ratio in each of the last 3 months?' },
        { id: 'app-stores', question: 'Which app stores list your app?' },
      ],
      [
        {
          questionId: 'chargeback-ratio',
          outcome: 'answered',
          body: 'Under one percent.',
          identifiedAs: 'ops@companion.example',
          submittedAt: '2026-09-21T00:05:00.000Z',
        },
      ],
    );
    expect(cardRows(blockOf(render(current, attestations)), 'not-reached')).toContain(
      '2 questions asked of the merchant — 1 answered',
    );
  });
});
