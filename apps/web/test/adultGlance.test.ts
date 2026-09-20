/**
 * "At a glance" (cluster 4c; A1, A7; memo §9).
 *
 * Rendered from run 6571d6a9 as stored — the shape every adult finding recorded so far has — and from
 * a run of the shape they have now, whose findings record the surfaces they read. Both are held,
 * because the block reads the same fields either way and the older one is the one in the wild.
 *
 * Three guards, and they are the reason this block is allowed to exist at all:
 *
 *   - the verdict-word guard, over the block;
 *   - no tally of findings — the only number is how many questions the merchant answered;
 *   - no colour that says good or bad, and no class or style keyed to a finding's state.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveAttestations, type ReportFinding, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';

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

/** The block's own markup, so an assertion about it is about it. */
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

const rowsOf = (block: string, group: string): string[] => {
  const from = block.indexOf(`glance-${group}"`);
  if (from === -1) return [];
  const section = block.slice(from, block.indexOf('</div>', from));
  return [...section.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => textOf(m[1]!));
};

const storedMarkup = render(stored);
const storedBlock = blockOf(storedMarkup);

describe('run 6571d6a9', () => {
  it('opens with the referral line, naming what triggered it', () => {
    expect(textOf(/<p class="glance-headline">(.*?)<\/p>/.exec(storedBlock)?.[1] ?? '')).toBe(
      'Referral policy v1.0: not referred — Face-swap or face-consistency language observed on the docs site (P-1).',
    );
  });

  it('sits under the masthead and above the index, which is unchanged', () => {
    expect(storedMarkup.indexOf('adult-glance')).toBeGreaterThan(storedMarkup.indexOf('class="posture"'));
    expect(storedMarkup.indexOf('adult-glance')).toBeLessThan(storedMarkup.indexOf('adult-index'));
    expect(storedMarkup.indexOf('adult-index')).toBeLessThan(storedMarkup.indexOf('adult-observed'));
  });

  it('says what was observed on the site, each row with where it rests', () => {
    expect(rowsOf(storedBlock, 'site')).toEqual([
      'Non-human disclosure statement on public pages — homepage',
      'Face-swap or face-consistency language — docs site',
      'Video generation language — docs site',
      'Model selection or LoRA language — docs site',
      'Filter-removal language in marketing — homepage',
      'Affiliate program — homepage',
    ]);
  });

  it('collapses the content-policy rules into one line, and keeps takedown its own', () => {
    expect(rowsOf(storedBlock, 'policies')).toEqual([
      'Prohibits minors, real-person likeness, non-consent, bestiality and mutilation — terms document',
      '48-hour removal commitment in the terms — terms document',
    ]);
  });

  it('says what was looked for and not found', () => {
    expect(rowsOf(storedBlock, 'missing')).toEqual(['Content removal route linked in the footer — not on the homepage']);
  });

  it('says what it does not speak to, with no questions on this run', () => {
    expect(rowsOf(storedBlock, 'unchecked')).toEqual(['Behaviour over a long conversation']);
  });

  it('omits a group with no members rather than showing it empty', () => {
    // Nothing on this run was not_evaluable, so no "could not be read" row exists to render.
    expect(storedBlock).not.toContain('Pages could not be read');
    expect(storedBlock).not.toMatch(/<ul>\s*<\/ul>/);
  });

  it('links a row about one finding to that finding', () => {
    const anchors = [...storedBlock.matchAll(/href="#finding-([A-Z]+-\d{3})"/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const ruleId of anchors) expect(storedMarkup).toContain(`id="finding-${ruleId}"`);
  });
});

describe('the guards', () => {
  it('carries none of the verdict vocabulary', () => {
    const verdict = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/gi;
    expect(textOf(storedBlock).match(verdict) ?? []).toEqual([]);
  });

  it('tallies no findings: the only number is the merchant\'s answers', () => {
    const text = textOf(storedBlock);
    expect(text).not.toMatch(/(?<![-\d])\d+\s+(?:observed|not observed|could not be checked|findings?|rules?|of)\b/i);
    expect(text).not.toMatch(/\btotal|summary|score|overall|risk\b/i);
  });

  it('keys no class to a finding\'s state', () => {
    const classes = [...storedBlock.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    for (const name of classes) {
      expect(name).not.toMatch(/fail|pass|not[_-]?evaluable|state|good|bad|warn|danger|ok\b/i);
    }
    // And nothing is styled inline, which is where a state-keyed colour would hide.
    expect(storedBlock).not.toContain(' style="');
  });

  it('uses one muted hue per group, and no red, amber, yellow, orange or green', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const block = css.slice(css.indexOf('.adult-glance {'));
    const hexes = [...block.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => m[1]!);
    expect(hexes.length).toBeGreaterThan(4);

    /** Hue in degrees, and saturation, as HSL reads them. */
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

    for (const hex of hexes) {
      const { h, s } = hsl(hex);
      // Near-grey is allowed (hairlines); anything with colour in it sits between teal and plum.
      if (s < 0.08) continue;
      expect(h, `#${hex}`).toBeGreaterThanOrEqual(180);
      expect(h, `#${hex}`).toBeLessThanOrEqual(300);
    }

    // One hue per group, and never the same one twice.
    const groupHues = ['site', 'policies', 'missing', 'unchecked'].map((id) => {
      const rule = new RegExp(`\\.glance-${id} h3 \\{ color: #([0-9A-Fa-f]{6})`).exec(block)?.[1] ?? '';
      return Math.round(hsl(rule).h);
    });
    expect(new Set(groupHues).size).toBe(4);
    for (const hue of groupHues) expect(hue).toBeGreaterThanOrEqual(180);
  });
});

describe('a run of the shape findings have now', () => {
  /** AITD-001 as it reads with surfaces recorded: the footer read, no removal page published. */
  const withSurfaces: ScreeningReport = {
    ...stored,
    categories: stored.categories.map((category) =>
      category.id !== 'takedown'
        ? category
        : {
            ...category,
            findings: category.findings.map((finding): ReportFinding =>
              finding.ruleId !== 'AITD-001'
                ? finding
                : {
                    ...finding,
                    title: 'Content removal route',
                    surfaces: [
                      { surface: 'footer', status: 'read' },
                      { surface: 'removal', status: 'not_published' },
                    ],
                  },
            ),
          },
    ),
  };

  it('names the surfaces read and the ones that were not', () => {
    expect(rowsOf(blockOf(render(withSurfaces)), 'missing')).toEqual([
      'Content removal route — not in the footer; removal page not published',
    ]);
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
          submittedAt: '2026-09-20T00:05:00.000Z',
        },
      ],
    );
    const rows = rowsOf(blockOf(render(withSurfaces, attestations)), 'unchecked');
    expect(rows).toContain('2 questions asked of the merchant — 1 answered');

    const none = resolveAttestations(
      [{ id: 'app-stores', question: 'Which app stores list your app?' }],
      [],
    );
    expect(rowsOf(blockOf(render(withSurfaces, none)), 'unchecked')).toContain(
      '1 question asked of the merchant — no answers yet',
    );
  });
});
