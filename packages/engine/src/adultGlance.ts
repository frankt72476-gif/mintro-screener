/**
 * "At a glance" — the adult AI report's opening block (cluster 4c; A1, A7; memo §9).
 *
 * Four groups of one-line rows, composed from what the findings already record: the rule's title, the
 * label its sense and state give it, and the surfaces the run read. No model writes a word of it, and
 * nothing here is free prose — every row is a template over data, so a reader comparing the block with
 * the findings below can only ever find the same facts twice.
 *
 * ## What it is not
 *
 * Not a summary judgment and not a score (A1). There is no count of findings, no ranking, no "areas of
 * concern", and no sentence that weighs one group against another. A group with no members is left out
 * rather than shown empty, because "nothing observed on the site" is a claim about the site and this
 * block makes none — the findings below say what was looked for and what each one showed.
 *
 * The one number allowed is how many questions the merchant answered, which is a fact about the
 * merchant's replies and not a tally of observations.
 *
 * ## Grouping is by category and sense, never by rule id
 *
 * A branch on a rule id would put the rule set in the code (hard constraint 1). What decides a row's
 * group is the category the rule set puts it in and the direction its sense points:
 *
 *   - **Observed on the site** — a label of *Observed* in a category describing the site: access,
 *     features, catalogue, marketing. The access rule reads `present`, the others `absent`, and both
 *     reach here as "Observed", which is the point of the sense labels.
 *   - **Stated in the merchant's policies** — a label of *Observed* in a policy category: content
 *     policy, takedown. The content-policy rules collapse into one row, because five rows each saying
 *     the terms prohibit one more thing is a list pretending to be five findings.
 *   - **Not found** — a `present` rule that did not find what it looked for, with the surfaces it read
 *     and the ones it could not, from the snapshot.
 *   - **Not checked** — everything `not_evaluable`, gathered by the reason they share, then the rule
 *     set's own boundary items, then the questions put to the merchant.
 */

import { adultNotChecked, findingSense, stateLabelFor } from './verticalLabels.js';
import { whereClause, whereWords } from './adultIndex.js';
import type { ReportFinding, ScreeningReport } from './report.js';
import type { RunAttestations } from './attestations.js';

/** Categories whose rules describe the site itself, as the rule set orders them. */
const SITE_CATEGORIES = new Set(['access', 'features', 'catalog', 'marketing']);
/** Categories whose rules describe what the merchant published about itself. */
const POLICY_CATEGORIES = new Set(['content_policy', 'takedown']);

export type GlanceGroupId = 'site' | 'policies' | 'missing' | 'unchecked';

export interface GlanceRow {
  /** The findings this row is about, so the row can link to them. Empty for a boundary row. */
  readonly ruleIds: readonly string[];
  readonly text: string;
}

export interface GlanceGroup {
  readonly id: GlanceGroupId;
  readonly heading: string;
  readonly rows: readonly GlanceRow[];
}

export interface AdultGlance {
  /** The referral policy as applied at intake, naming what triggered it. Absent where none was. */
  readonly headline: string | null;
  readonly groups: readonly GlanceGroup[];
}

const HEADINGS: Readonly<Record<GlanceGroupId, string>> = {
  site: 'Observed on the site',
  policies: "Stated in the merchant's policies",
  missing: 'Not found',
  unchecked: 'Not checked',
};

/** A finding and the category it was reported under. */
interface Placed {
  readonly finding: ReportFinding;
  readonly category: string;
}

function place(report: ScreeningReport): readonly Placed[] {
  return report.categories.flatMap((category) =>
    category.findings.map((finding) => ({ finding, category: category.id })),
  );
}

/**
 * The thing a policy rule prohibits, from its title.
 *
 * Titles are noun phrases naming the thing looked for (0.4.1): "Prohibition of depicting minors". Runs
 * screened before that pass carry the titles they were screened under — "Minors named in the terms" —
 * and are not rewritten (D-002), so both shapes are read here. A title of neither shape is used whole,
 * which reads as a longer list rather than as a wrong one.
 */
function prohibitedObject(title: string): string {
  const stripped = title
    .replace(/^Prohibition of\s+/i, '')
    .replace(/\s+named in the terms$/i, '')
    .trim();
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

/** "a, b and c" — a list a sentence can take. */
function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
}

/**
 * The referral policy as applied, naming the finding that triggered it (D-287).
 *
 * The reasons are recorded as "P-1: AIFEAT-002 observed" — the policy line and the rule. A reader
 * should not have to hold a rule id in their head to know what that was, so the rule's own title and
 * the page it rests on are read back from the findings.
 */
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

/** The rows for the two "observed" groups, which differ only in which categories feed them. */
function observedRows(placed: readonly Placed[], categories: ReadonlySet<string>): readonly Placed[] {
  return placed.filter(
    (p) => categories.has(p.category) && stateLabelFor('adult_ai', p.finding) === 'Observed',
  );
}

/** What was `not_evaluable`, by the reason those findings share. */
function uncheckedRows(placed: readonly Placed[]): readonly GlanceRow[] {
  const unevaluated = placed.filter(
    (p) => p.finding.state === 'not_evaluable' && p.finding.checkType !== 'manual',
  );

  const buckets: { readonly reason: string; readonly kinds: readonly string[] }[] = [
    { reason: 'Pages not reached', kinds: ['not_exposed', 'not_applicable'] },
    { reason: 'Pages could not be read', kinds: ['not_retrieved', 'gated', 'challenged'] },
    { reason: 'No check built for this yet', kinds: ['no_check_built'] },
    { reason: 'The run reached its time limit', kinds: ['time_limit'] },
  ];

  const rows: GlanceRow[] = [];
  for (const bucket of buckets) {
    const members = unevaluated.filter((p) => bucket.kinds.includes(p.finding.notEvaluableKind ?? ''));
    if (members.length === 0) continue;
    rows.push({
      ruleIds: members.map((p) => p.finding.ruleId),
      text: `${bucket.reason} — ${sentenceList(members.map((p) => p.finding.title))}`,
    });
  }

  // A kind this does not know about is still reported, named by what it says of itself.
  const known = new Set(buckets.flatMap((b) => b.kinds));
  const rest = unevaluated.filter((p) => !known.has(p.finding.notEvaluableKind ?? ''));
  if (rest.length > 0) {
    rows.push({
      ruleIds: rest.map((p) => p.finding.ruleId),
      text: `Could not be checked — ${sentenceList(rest.map((p) => p.finding.title))}`,
    });
  }
  return rows;
}

export function adultGlance(report: ScreeningReport, attestations?: RunAttestations): AdultGlance {
  const placed = place(report);
  const groups: GlanceGroup[] = [];

  // 1. What the site itself showed.
  const site = observedRows(placed, SITE_CATEGORIES);
  if (site.length > 0) {
    groups.push({
      id: 'site',
      heading: HEADINGS.site,
      rows: site.map((p) => ({
        ruleIds: [p.finding.ruleId],
        text: `${p.finding.title} — ${whereWords(p.finding)}`,
      })),
    });
  }

  // 2. What the merchant's own documents say, with the content-policy rules as one line.
  const policies = observedRows(placed, POLICY_CATEGORIES);
  if (policies.length > 0) {
    const prohibitions = policies.filter((p) => p.category === 'content_policy');
    const rows: GlanceRow[] = [];
    if (prohibitions.length > 0) {
      rows.push({
        ruleIds: prohibitions.map((p) => p.finding.ruleId),
        text:
          `Prohibits ${sentenceList(prohibitions.map((p) => prohibitedObject(p.finding.title)))} — ` +
          whereWords(prohibitions[0]!.finding),
      });
    }
    for (const p of policies.filter((x) => x.category !== 'content_policy')) {
      rows.push({ ruleIds: [p.finding.ruleId], text: `${p.finding.title} — ${whereWords(p.finding)}` });
    }
    groups.push({ id: 'policies', heading: HEADINGS.policies, rows });
  }

  // 3. What was looked for and not found, with the surfaces read and the ones that were not.
  const missing = placed.filter(
    (p) => p.finding.state === 'fail' && findingSense(p.finding) === 'present',
  );
  if (missing.length > 0) {
    groups.push({
      id: 'missing',
      heading: HEADINGS.missing,
      rows: missing.map((p) => ({
        ruleIds: [p.finding.ruleId],
        text: `${p.finding.title} — not ${whereClause(p.finding)}`,
      })),
    });
  }

  // 4. What this run does not speak to: the rules it could not read, the standing boundaries, the
  //    questions. The questions' count is of answers given, never of findings.
  const unchecked: GlanceRow[] = [...uncheckedRows(placed)];
  for (const item of adultNotChecked(report.notChecked)) {
    unchecked.push({ ruleIds: [], text: item.subject });
  }
  const questions = attestations?.questions ?? [];
  if (questions.length > 0) {
    const answered = questions.filter((q) => q.outcome === 'answered').length;
    unchecked.push({
      ruleIds: [],
      text:
        `${questions.length} question${questions.length === 1 ? '' : 's'} asked of the merchant — ` +
        (answered === 0 ? 'no answers yet' : `${answered} answered`),
    });
  }
  if (unchecked.length > 0) groups.push({ id: 'unchecked', heading: HEADINGS.unchecked, rows: unchecked });

  return { headline: headlineFor(report, placed), groups };
}
