/**
 * The findings index an adult AI report opens with (cluster 4b commit 1; A1, A7).
 *
 * One row per finding, in the rule set's own order: the area, what Mintro looked for, what was seen,
 * and where. It is a table of contents, not a summary — there is no count, no total, no ranking and
 * nothing that reads as a judgment. A reader who wants the whole of a row follows it to the finding.
 *
 * ## Everything here comes from the stored report
 *
 * A run's report is what was assembled at the time (D-002), so the index is built from it rather than
 * from today's rule set: a rule retitled or rescoped next month must not change what a screening from
 * September says it looked for.
 *
 * **Where** is what the run read, from the surfaces the finding records (cluster 4b commit 5): the
 * footer for a footer rule, and the pages it could not read named as what they were — not published,
 * or there and unreadable.
 *
 * A finding recorded before those were snapshotted carries none, and falls back to the page its
 * capture is of, classified by the vertical's page-type table. That reads a footer rule as the page
 * holding the footer, which is what the capture shows; it is the honest answer available from an old
 * run, and no old run is rewritten to improve it (D-002). A manual rule has no page either way.
 */

import { pageTypeOfUrl } from './pageTypeOf.js';
import { ADULT_AI_PAGE_TYPES } from '@mintro/ruleset';
import { stateLabelFor } from './verticalLabels.js';
import type { FindingSurface } from './findings.js';
import type { ReportFinding, ScreeningReport } from './report.js';
import type { RunAttestations } from './attestations.js';

/** A page type, in the words a reader uses (memo §9). Never a URL: the finding below carries that. */
const PAGE_WORDS: Readonly<Record<string, string>> = {
  homepage: 'homepage',
  footer: 'footer',
  terms: 'terms document',
  guidelines: 'guidelines page',
  removal: 'removal page',
  pricing: 'pricing page',
  create: 'creation page',
  generate: 'generation page',
  library: 'character library',
  docs: 'docs site',
};

/** The words for one surface, or the surface's own name where it has none. */
function surfaceWords(surface: string): string {
  return PAGE_WORDS[surface] ?? surface.replace(/_/g, ' ');
}

/** "the footer", "the terms document and the guidelines page" — a list a sentence can take. */
function listOf(surfaces: readonly FindingSurface[]): string {
  const words = surfaces.map((s) => surfaceWords(s.surface));
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`;
}

/** A footer is a region of a page; everything else is a page. */
function preposition(surface: string | undefined): string {
  return surface === 'footer' ? 'in' : 'on';
}

/** The surfaces the run actually read, or all of them where it read none. */
function readOrListed(surfaces: readonly FindingSurface[]): readonly FindingSurface[] {
  const read = surfaces.filter((s) => s.status === 'read');
  return read.length > 0 ? read : surfaces;
}

/** What a manual rule's row carries where the others carry a page. */
export const NO_PAGE = '—';

/** How a manual rule's row reads before any question has been put (memo §8). */
export const ASKED_OF_MERCHANT = 'Asked of the merchant';

export interface AdultIndexRow {
  readonly ruleId: string;
  /** The category, as the rule set names it. */
  readonly area: string;
  /** The rule's title, which already reads as the thing looked for. */
  readonly lookedFor: string;
  /** The sense label, or what became of the question, for a manual rule. */
  readonly seen: string;
  /** The page type in words, or `NO_PAGE`. */
  readonly where: string;
}

/**
 * The page a finding's capture is of, in words.
 *
 * The docs host is recognised by its host rather than its path: its pages are `index.md`,
 * `character-creation.md` and the like, which name no page type, and they are a second origin (D-284).
 */
export function whereWords(finding: ReportFinding): string {
  /*
    What the run read, where the finding records it (cluster 4b commit 5). A rule that read nothing
    names what it looked for, which is what "where" means for a row that could not be checked.
  */
  if (finding.surfaces !== undefined && finding.surfaces.length > 0) return listOf(readOrListed(finding.surfaces));

  const url = finding.evidence[0]?.sourceUrl;
  if (url === undefined || url === '') return NO_PAGE;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NO_PAGE;
  }

  if (parsed.host.startsWith('docs.')) return PAGE_WORDS['docs']!;
  if (parsed.pathname === '/' || parsed.pathname === '') return PAGE_WORDS['homepage']!;

  const type = pageTypeOfUrl(url, ADULT_AI_PAGE_TYPES);
  return type === null ? 'another page of the site' : (PAGE_WORDS[type] ?? 'another page of the site');
}

/**
 * What a manual rule's row says: what the merchant said, where anything was asked.
 *
 * The rule names its question in its own words — `params.reason` quotes it verbatim, and that reason
 * is the finding's note — so the question is matched by that quotation rather than by a link the
 * schema does not carry (11.8, open). An exact match on a quoted string: a question reworded without
 * its rule leaves the row saying only that it was asked, which is the safe direction.
 */
export function attestedSeen(finding: ReportFinding, attestations: RunAttestations | undefined): string {
  if (attestations === undefined || attestations.questions.length === 0) return ASKED_OF_MERCHANT;

  const quoted = /“([^”]+)”/.exec(finding.note ?? '')?.[1];
  const question = attestations.questions.find((q) => q.question === quoted);
  if (question === undefined) return ASKED_OF_MERCHANT;

  return question.outcome === 'answered' ? 'Answered by the merchant' : 'Not answered';
}

/** Every finding, in the order the report carries it. */
export function adultIndexRows(
  report: ScreeningReport,
  attestations?: RunAttestations,
): readonly AdultIndexRow[] {
  return report.categories.flatMap((category) =>
    category.findings.map((finding) => ({
      ruleId: finding.ruleId,
      area: category.name,
      lookedFor: finding.title,
      seen:
        finding.checkType === 'manual'
          ? attestedSeen(finding, attestations)
          : stateLabelFor('adult_ai', finding),
      where: finding.checkType === 'manual' ? NO_PAGE : whereWords(finding),
    })),
  );
}

/**
 * The plain sentence a finding opens with (cluster 4b commit 2).
 *
 * Written from data, never by a model: the rule's title, the sense label its state gives it, and the
 * page the capture is of. Titles read as the thing looked for and name no surface (0.4.1) —
 * "Prohibition of bestiality", "Video generation language" — so the label and the page complete it.
 *
 * One template per state, which is where the sense has already been resolved: `stateLabelFor` reads
 * the rule's sense, so "Observed" on an `absent` rule and on a `present` rule reach here as the same
 * word, and the sentence says the same thing in both directions. A rule that could not be checked
 * names no page, because the page is what was missing; the line beneath it says what was attempted.
 */
export function adultLeadSentence(finding: ReportFinding): string {
  const label = stateLabelFor('adult_ai', finding).toLowerCase();
  if (finding.checkType === 'manual') return `${finding.title} — ${label}.`;

  const surfaces = finding.surfaces;
  if (surfaces !== undefined && surfaces.length > 0) {
    const read = surfaces.filter((s) => s.status === 'read');
    const where = read.length > 0 ? ` ${preposition(read[0]?.surface)} the ${listOf(read)}` : '';

    /*
      And the surfaces it did not read, named as what they were (cluster 4b commit 5).

      "Not observed" over a site whose removal page does not exist says something different from "not
      observed" over one that has a removal page nobody could read, and a reader deciding what to ask
      the merchant needs the difference. Both stay in one sentence; the capture and the note beneath
      carry the rest.
    */
    const gapClause = (status: FindingSurface['status'], tail: string): string => {
      const gaps = surfaces.filter((s) => s.status === status);
      return gaps.length === 0 ? '' : `; ${listOf(gaps)} ${tail}`;
    };

    return (
      `${finding.title} — ${label}${where}` +
      gapClause('not_published', 'not published') +
      gapClause('unreadable', 'could not be read') +
      '.'
    );
  }

  // A run recorded before surfaces were snapshotted: the page its capture is of.
  const where = whereWords(finding);
  if (finding.state === 'not_evaluable' || where === NO_PAGE) return `${finding.title} — ${label}.`;
  return `${finding.title} — ${label} on the ${where}.`;
}
