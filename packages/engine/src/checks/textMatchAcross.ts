/**
 * `text_match` across several surfaces (D-284).
 *
 * A rule with `surfaces: [terms, guidelines]` asks whether *either* page says something. Each listed
 * surface is read by `checkTextMatch` exactly as a single-surface rule would read it — one matcher,
 * no second answer to the same question — and the per-surface findings are combined here.
 *
 * ## How they combine, and why the directions differ
 *
 * **`expect: present`** — the rule is looking for wording that should be there.
 *   - Observed on any surface read: the finding is that surface's, with its capture.
 *   - Not observed on the surfaces read, and every other listed surface was **not published** (no
 *     candidate the merchant linked or listed was served): a violation, naming what was read and what
 *     was not published.
 *   - Not observed, and some listed surface **could not be read** — our request failed, bot
 *     protection answered, a consent gate stood in front of it: `not_evaluable`. The wording may be on
 *     the page we did not get, and reporting it missing would be the false `fail` hard constraint 9
 *     names for an `expect: present` rule.
 *   - Nothing read at all: `not_evaluable`, as a single-surface rule on an unreached page is.
 *
 * **`expect: absent`** — the rule is looking for something that should not be there.
 *   - Observed on any surface read: that surface's violation, with its capture.
 *   - Not observed, but some listed surface could not be read: `not_evaluable`. An unread page is not
 *     a clean page (hard constraint 2).
 *   - Not observed on every surface read, the rest not published: a pass, naming what was read.
 *
 * A per-surface `not_evaluable` from `checkTextMatch` itself (quoted material only, a rule that does
 * not apply to this page) counts as a surface that could not be read.
 *
 * Pure: the runner resolves each surface to what the crawl located, and this reads only that.
 */

import type { RuleOfType, Surface } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import type { Located } from '../surface.js';
import { notEvaluable, satisfied, violation, type Evidence, type Finding, type NotEvaluableKind } from '../findings.js';
import { checkTextMatch } from './textMatch.js';
import { RENDERED } from './pageEvidence.js';

/** One listed surface and what the crawl located for it. */
export interface SurfaceReading {
  readonly surface: Surface;
  readonly page: Located<PageContext>;
}

/** How a surface is named in a finding. */
export function surfaceLabel(surface: Surface): string {
  switch (surface) {
    case 'homepage':
      return 'the homepage';
    case 'footer':
      return 'the homepage footer';
    case 'terms':
      return 'the terms document';
    case 'guidelines':
      return 'the guidelines page';
    case 'removal':
      return 'the content removal page';
    case 'pricing':
      return 'the pricing page';
    case 'create':
      return 'the character creation page';
    case 'generate':
      return 'the generation page';
    case 'docs':
      return 'the documentation page';
    default:
      return `the ${surface.replace(/_/g, ' ')}`;
  }
}

type Outcome =
  | { readonly kind: 'read'; readonly surface: Surface; readonly url: string; readonly finding: Finding }
  | {
      readonly kind: 'unreadable';
      readonly surface: Surface;
      readonly reason: string;
      readonly notEvaluableKind: NotEvaluableKind;
      readonly evidence: readonly Evidence[];
    }
  | { readonly kind: 'not_published'; readonly surface: Surface; readonly reason: string; readonly evidence: readonly Evidence[] };

/** Most specific first: which party fell short decides what an operator does next (D-265, D-266). */
const KIND_PRIORITY: readonly NotEvaluableKind[] = ['gated', 'challenged', 'not_retrieved', 'not_applicable', 'no_check_built', 'not_exposed'];

export function checkTextMatchAcross(
  rule: RuleOfType<'text_match'>,
  readings: readonly SurfaceReading[],
): Finding {
  const outcomes = readings.map((reading) => readOne(rule, reading));
  const expect = rule.params.expect ?? 'absent';

  const read = outcomes.filter((o): o is Extract<Outcome, { kind: 'read' }> => o.kind === 'read');
  const unreadable = outcomes.filter((o): o is Extract<Outcome, { kind: 'unreadable' }> => o.kind === 'unreadable');
  const notPublished = outcomes.filter(
    (o): o is Extract<Outcome, { kind: 'not_published' }> => o.kind === 'not_published',
  );

  const onWhat = (o: { readonly surface: Surface; readonly url: string }): string =>
    `${surfaceLabel(o.surface)} (${o.url})`;
  const readList = read.map(onWhat).join(', ');
  const notPublishedClause =
    notPublished.length === 0
      ? ''
      : ` Not published: ${notPublished.map((o) => `${surfaceLabel(o.surface)} (${o.reason})`).join('; ')}.`;

  const hit =
    expect === 'present'
      ? read.find((o) => o.finding.state === 'pass')
      : read.find((o) => o.finding.state === 'fail' || o.finding.state === 'review');

  if (hit !== undefined) {
    const note = `On ${onWhat(hit)}: ${hit.finding.note}`;
    return expect === 'present'
      ? satisfied(rule, note, hit.finding.evidenceKind, hit.finding.evidence)
      : violation(rule, note, hit.finding.evidenceKind, hit.finding.evidence);
  }

  if (read.length === 0 || unreadable.length > 0) {
    const gaps = [...unreadable, ...notPublished];
    const kind = KIND_PRIORITY.find((k) =>
      [...unreadable.map((o) => o.notEvaluableKind), ...(notPublished.length > 0 ? ['not_exposed' as const] : [])].includes(k),
    ) ?? 'not_exposed';
    const reason =
      (read.length === 0 ? 'none of the listed surfaces was read' : `not observed on ${readList}, and not every listed surface was read`) +
      ': ' +
      gaps.map((o) => `${surfaceLabel(o.surface)}: ${o.reason}`).join('; ');
    return notEvaluable(rule, reason, RENDERED, kind, [
      ...read.flatMap((o) => o.finding.evidence),
      ...gaps.flatMap((o) => o.evidence),
    ]);
  }

  // Every listed surface was read or not published, and none carried what the rule looks for.
  const evidence = read.flatMap((o) => o.finding.evidence);
  const note = `Read ${readList}. ${read[0]!.finding.note}${notPublishedClause}`;
  return expect === 'present' ? violation(rule, note, RENDERED, evidence) : satisfied(rule, note, RENDERED, evidence);
}

function readOne(rule: RuleOfType<'text_match'>, reading: SurfaceReading): Outcome {
  const { surface, page } = reading;

  if (!page.located) {
    const evidence: Evidence[] = [
      {
        kind: RENDERED,
        // Nothing was captured, and nothing is claimed to have been. The requests are the evidence.
        sourceUrl: page.attempts[0]?.url ?? '',
        sourceSha256: '',
        evidenceKey: '',
        capturedAt: new Date().toISOString(),
        attempts: page.attempts,
      },
    ];
    if (page.gated !== undefined) return { kind: 'unreadable', surface, reason: page.reason, notEvaluableKind: 'gated', evidence };
    if (page.challenged !== undefined) {
      return { kind: 'unreadable', surface, reason: page.reason, notEvaluableKind: 'challenged', evidence };
    }
    if (page.obstructed === true) {
      return { kind: 'unreadable', surface, reason: page.reason, notEvaluableKind: 'not_retrieved', evidence };
    }
    return { kind: 'not_published', surface, reason: page.reason, evidence };
  }

  // The rule as a single-surface rule on this surface, read by the one matcher there is.
  const { surfaces: _surfaces, ...params } = rule.params;
  const single: RuleOfType<'text_match'> = { ...rule, params: { ...params, surface } };
  const finding = checkTextMatch(single, page.value);

  if (finding.state === 'not_evaluable') {
    return {
      kind: 'unreadable',
      surface,
      reason: finding.notEvaluableReason ?? finding.note,
      notEvaluableKind: finding.notEvaluableKind ?? 'not_retrieved',
      evidence: finding.evidence,
    };
  }
  return { kind: 'read', surface, url: page.value.finalUrl, finding };
}
