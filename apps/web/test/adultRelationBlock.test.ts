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
      'Minor-coded terms — homepage',
      'Real-person likeness terms — homepage',
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
    expect(cardRows(block, 'not-reached')).toEqual(['Behaviour over a long conversation']);
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

  it('colours by relationship only: three hues and near-grey, each group pinned to one', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const styles = css.slice(css.indexOf('.adult-glance {'));

    /** Hue in degrees and saturation, as HSL reads them. */
    const hsl = (hex: string): { h: number; s: number } => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      if (d === 0) return { h: 0, s: 0 };
      const h = max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return { h, s: d / (1 - Math.abs(2 * l - 1)) };
    };

    /** The three hues this block may use, and nothing else with colour in it. */
    const ALLOWED = [184, 242, 290];
    const hexes = [...styles.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => m[1]!);
    expect(hexes.length).toBeGreaterThan(5);

    for (const hex of hexes) {
      const { h, s } = hsl(hex);
      if (s < 0.12) continue; // near-grey: hairlines, quiet text, the two grey groups
      expect(ALLOWED.some((allowed) => Math.abs(h - allowed) <= 2), `#${hex} at hue ${Math.round(h)}`).toBe(true);
    }

    const hueOf = (group: string): number | 'grey' => {
      const hex = new RegExp(`\\.glance-${group} h3 \\{ color: #([0-9A-Fa-f]{6})`).exec(styles)?.[1] ?? '';
      const { h, s } = hsl(hex);
      return s < 0.12 ? 'grey' : Math.round(h);
    };

    expect({
      consistent: hueOf('consistent'),
      restricted: hueOf('restricted'),
      requiredNotFound: hueOf('required-not-found'),
      noPublishedRule: hueOf('no-published-rule'),
      notReached: hueOf('not-reached'),
    }).toEqual({
      consistent: 184,
      restricted: 242,
      requiredNotFound: 290,
      noPublishedRule: 'grey',
      notReached: 'grey',
    });
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
