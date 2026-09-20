/**
 * A run's findings, by their relationship to the rule each one cites (D-290, cluster 4d).
 *
 * The adult report's opening block groups findings by what the *cited source* says and what the run
 * saw — never by a rating of the merchant, which Mintro does not make (A1). Every input is data the
 * run already recorded: which source the rule cites, which way that source runs, what state the check
 * reached, and which surfaces were read.
 *
 * ## The five relationships
 *
 *   1. `consistent` — the source requires a thing and it was observed, or forbids a thing and it was
 *      not observed on pages the run actually read. Both are the same relationship from the two
 *      directions, which is why the direction has to be data: without it, "Observed" and "Not
 *      observed" cannot be told apart as outcomes.
 *   2. `restricted` — the source forbids a thing and it was observed.
 *   3. `required_not_found` — the source requires a thing and it was not found.
 *   4. `no_published_rule` — Mintro observed something no cited source speaks to. Only where it was
 *      observed: "Mintro looked for a thing no rule mentions and did not find it" is not a fact about
 *      the merchant worth a row.
 *   5. `not_reached` — the run could not read what the rule needed, plus the standing boundaries and
 *      the questions put to the merchant.
 *
 * ## Coverage decides where a "not observed" goes
 *
 * A prohibition reads as consistent only where the pages it lists were read. A run that could not
 * reach the character library has not observed minor-coded terms *there*; filing that as consistent
 * would turn a gap in the crawl into a statement about the merchant, which is the worst bug this
 * system can have (hard constraint 2). Those rows go to `not_reached`, naming the surface that was
 * missing.
 *
 * **Coverage that was never recorded is not coverage.** A finding from before surfaces were
 * snapshotted says nothing about which pages were read, and an earlier version of this read that
 * silence as "all of them": run 6571d6a9's minor-coded and real-person terms showed as consistent
 * from the homepage alone, while the run's own note said the creation, generation and library pages
 * were never reached. A prohibition that observed nothing is therefore filed as consistent only where
 * the finding *records* full coverage. Absent that, it is not reached, carrying the note's own account
 * of which pages were missing, or saying plainly that coverage was not recorded.
 */

import { adultNotChecked, findingSense, stateLabelFor } from './verticalLabels.js';
import { whereClause, whereWords } from './adultIndex.js';
import type { Direction } from '@mintro/ruleset';
import type { ReportFinding, ScreeningReport } from './report.js';
import type { RunAttestations } from './attestations.js';

export type RelationGroupId =
  | 'consistent'
  | 'restricted'
  | 'required_not_found'
  | 'no_published_rule'
  | 'not_reached';

export interface RelationRow {
  /** The findings this row is about, so a row can link to them. Empty for a boundary row. */
  readonly ruleIds: readonly string[];
  /** The thing looked for, in the rule's own words. */
  readonly title: string;
  /** Where it was looked for, in words. Empty where the row is not about a page. */
  readonly where: string;
}

export interface RelationGroup {
  readonly id: RelationGroupId;
  readonly heading: string;
  /** The short names of the sources this group's findings cite, in first-seen order. */
  readonly citations: readonly string[];
  readonly rows: readonly RelationRow[];
}

export interface AdultRelations {
  /** The referral policy as applied at intake, naming what triggered it. Absent where none was. */
  readonly headline: string | null;
  readonly groups: readonly RelationGroup[];
}

/** Headings name the relationship, and say whose rule it is to a source rather than to Mintro. */
const HEADINGS: Readonly<Record<RelationGroupId, string>> = {
  consistent: 'Consistent with the cited rule',
  restricted: 'Named as restricted by the cited rule',
  required_not_found: 'Required by the cited rule, not found',
  no_published_rule: 'Observed, with no published rule cited',
  not_reached: 'Not reached on this run',
};

/** The order the block renders them in. */
const ORDER: readonly RelationGroupId[] = [
  'consistent',
  'restricted',
  'required_not_found',
  'no_published_rule',
  'not_reached',
];

interface Placed {
  readonly finding: ReportFinding;
  readonly category: string;
}

/**
 * Which way the cited source runs, for a finding.
 *
 * Snapshotted from 0.5.0 on. A run recorded before that reads it from the sense, which the rule set
 * holds equal to it: `requires` goes with `present`, `prohibits` with `absent`.
 */
export function directionOf(finding: ReportFinding): Direction | null {
  if (finding.direction !== undefined) return finding.direction;
  if (finding.source === 'mintro') return null;
  return findingSense(finding) === 'present' ? 'requires' : 'prohibits';
}

/** What a finding records about which of its pages were read. */
type Coverage = 'covered' | 'gap' | 'unrecorded';

function coverageOf(finding: ReportFinding): Coverage {
  const surfaces = finding.surfaces;
  if (surfaces === undefined || surfaces.length === 0) return 'unrecorded';
  return surfaces.every((surface) => surface.status === 'read') ? 'covered' : 'gap';
}

/**
 * The pages a finding's own note says were not published, where it says so.
 *
 * The multi-surface runners write it: "Not published: the character creation page (…); the generation
 * page (…)". On a finding that records no surfaces this is the only account of the gap there is, and
 * it is the run's own words. The parenthesised reasons are left out here and stay in the note below,
 * which is rendered whole.
 */
function pageGapFromNote(note: string | undefined): string | null {
  const clause = /Not published:\s*([^.]+)\./.exec(note ?? '')?.[1];
  if (clause === undefined) return null;

  const pages = clause
    .split(';')
    .map((part) => part.replace(/\s*\([^)]*\)/g, '').trim())
    .filter((part) => part !== '');
  if (pages.length === 0) return null;

  return `${sentenceList(pages)} not published`;
}

/** Where a not-reached row says it looked, from the surfaces it records or from its own note. */
function notReachedWhere(finding: ReportFinding): string {
  if (coverageOf(finding) !== 'unrecorded') return whereClause(finding);

  const fromNote = pageGapFromNote(finding.note);
  if (fromNote !== null) return fromNote;

  // A prohibition that observed nothing and recorded neither surfaces nor a gap says exactly that.
  return finding.state === 'not_evaluable' ? whereClause(finding) : 'coverage not recorded on this run';
}

/** The group a finding belongs to, or null where it belongs in none. */
function relationOf(finding: ReportFinding): RelationGroupId | null {
  if (finding.state === 'not_evaluable') return 'not_reached';

  const observed = stateLabelFor('adult_ai', finding) === 'Observed';
  const direction = directionOf(finding);

  /*
    A rule Mintro wrote that observed nothing, on pages it actually read, is in no group.

    There is no cited rule for it to be consistent with, and nothing was observed to report. A row
    saying Mintro looked for something no source mentions and did not find it is a fact about Mintro's
    rule set, not about the merchant, and this block is about the merchant's site.

    **Only where the pages were read.** Run 6571d6a9's upload-control rule observed nothing and never
    reached the creation, generation or pricing pages, and it fell out of the block entirely: "nothing
    to report" and "nothing was looked at" rendered the same, which is the shape hard constraint 2
    forbids. Where coverage is short or unrecorded, the row is not reached, and says which pages.
  */
  if (direction === null) {
    if (observed) return 'no_published_rule';
    return coverageOf(finding) === 'covered' ? null : 'not_reached';
  }

  if (direction === 'requires') return observed ? 'consistent' : 'required_not_found';
  if (observed) return 'restricted';
  return coverageOf(finding) === 'covered' ? 'consistent' : 'not_reached';
}

/** "a, b and c" — a list a sentence can take. */
function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
}

/**
 * The thing a policy rule names, from its title.
 *
 * Titles are noun phrases (0.4.1): "Prohibition of depicting minors". Runs screened before that pass
 * carry the titles they were screened under and are not rewritten (D-002), so both shapes are read.
 */
function policyObject(title: string): string {
  const stripped = title
    .replace(/^Prohibition of\s+/i, '')
    .replace(/\s+named in the terms$/i, '')
    .trim();
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

function headlineFor(report: ScreeningReport, placed: readonly Placed[]): string | null {
  const referral = report.referral;
  if (referral === undefined) return null;

  const version = `Referral policy v${referral.version}`;
  if (referral.status === 'proceeds') return `${version}: proceeds.`;

  const triggers = referral.reasons.map((reason) => {
    const line = /^(P-\d+)/.exec(reason)?.[1];
    const ruleId = /\b([A-Z]{2,}-\d{3})\b/.exec(reason)?.[1];
    const finding = placed.find((p) => p.finding.ruleId === ruleId)?.finding;
    if (finding === undefined) return line === undefined ? reason : `${reason.replace(/^P-\d+:\s*/, '')} (${line})`;

    const label = stateLabelFor('adult_ai', finding).toLowerCase();
    const where = whereWords(finding);
    const on = where === '—' ? '' : ` on the ${where}`;
    return `${finding.title} ${label}${on}${line === undefined ? '' : ` (${line})`}`;
  });

  return `${version}: not referred — ${sentenceList(triggers)}.`;
}

/** The rows for what the run could not read, and the boundaries it states whatever it read. */
function notReachedRows(
  placed: readonly Placed[],
  report: ScreeningReport,
  attestations: RunAttestations | undefined,
): readonly RelationRow[] {
  const rows: RelationRow[] = [];

  for (const { finding } of placed) {
    if (finding.checkType === 'manual') continue;
    if (relationOf(finding) !== 'not_reached') continue;
    rows.push({ ruleIds: [finding.ruleId], title: finding.title, where: notReachedWhere(finding) });
  }

  for (const item of adultNotChecked(report.notChecked)) {
    rows.push({ ruleIds: [], title: item.subject, where: '' });
  }

  const questions = attestations?.questions ?? [];
  if (questions.length > 0) {
    const answered = questions.filter((q) => q.outcome === 'answered').length;
    rows.push({
      ruleIds: [],
      title: `${questions.length} question${questions.length === 1 ? '' : 's'} asked of the merchant`,
      where: answered === 0 ? 'no answers yet' : `${answered} answered`,
    });
  }

  return rows;
}

/**
 * The block's groups, in order, with empty ones left out.
 *
 * `citations` maps a rule id to the short name of the source it quotes, which the corpus's own
 * provenance entries give (`citationsByRule`). Passed in rather than read here: the engine holds no
 * file paths, and a report of an old run must be able to name the sources that run cited.
 */
export function adultRelations(
  report: ScreeningReport,
  options: { readonly citations?: Readonly<Record<string, string>>; readonly attestations?: RunAttestations } = {},
): AdultRelations {
  const placed: Placed[] = report.categories.flatMap((category) =>
    category.findings.map((finding) => ({ finding, category: category.id })),
  );
  const citations = options.citations ?? {};

  const groups: RelationGroup[] = [];
  for (const id of ORDER) {
    const rows: RelationRow[] =
      id === 'not_reached'
        ? [...notReachedRows(placed, report, options.attestations)]
        : [];

    if (id !== 'not_reached') {
      const members = placed.filter(
        (p) => p.finding.checkType !== 'manual' && relationOf(p.finding) === id,
      );

      /*
        The content-policy rules as one row, in whichever group they share (cluster 4d).

        Five rows each saying the terms name one more prohibited thing is a list pretending to be five
        findings. Where they do not share a group — one prohibition named and another not — they split
        along the grouping, because that difference is the whole point of the row.
      */
      const policy = members.filter((p) => p.category === 'content_policy');
      if (policy.length > 0) {
        rows.push({
          ruleIds: policy.map((p) => p.finding.ruleId),
          title: `Prohibits ${sentenceList(policy.map((p) => policyObject(p.finding.title)))}`,
          where: whereWords(policy[0]!.finding),
        });
      }
      for (const p of members.filter((m) => m.category !== 'content_policy')) {
        rows.push({
          ruleIds: [p.finding.ruleId],
          title: p.finding.title,
          /*
            A thing that was not found says where it was looked for, and where it could not be: "not in
            the footer; removal page not published". Everything else names the page it rests on.
          */
          where: id === 'required_not_found' ? `not ${whereClause(p.finding)}` : whereWords(p.finding),
        });
      }
    }

    if (rows.length === 0) continue;

    const cited: string[] = [];
    for (const row of rows) {
      for (const ruleId of row.ruleIds) {
        const citation = citations[ruleId];
        if (citation !== undefined && !cited.includes(citation)) cited.push(citation);
      }
    }

    groups.push({ id, heading: HEADINGS[id], citations: cited, rows });
  }

  return { headline: headlineFor(report, placed), groups };
}
