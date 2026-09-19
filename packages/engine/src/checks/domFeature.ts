/**
 * The `dom_feature` check handler (cluster 2 commit 3).
 *
 * Reads the retained rendered DOM and text of every page established for each surface a rule lists,
 * and reports whether a feature is there. The detector is chosen by the rule (`detector`); what it
 * looks for beyond its structural signals is the rule's `terms`, so a new lexicon or a new wording
 * signal is a data change and never an edit here (hard constraint 1).
 *
 * ## Detectors
 *
 *   - **`upload_control`** — a control that takes a file. Structural signals on every listed page: an
 *     `<input type="file">`, or an element whose role, aria or class attributes name a drop zone.
 *     Wording signals: the rule's `terms`, read only on the surfaces its `terms_on` names.
 *   - **`lexicon`** — the rule's `terms` as whole-token phrases in the page text, by the tokeniser and
 *     comparison NAME-002 uses on slugs (`tokenizePath`, `containsTokenSequence`, D-159): `loli` does
 *     not match *lollipop*, and `look-alike` matches *look alike*. Regular plurals fold, but `-as`,
 *     `-us`, `-is`, `-os` and `-ss` endings do not, so `lora` does not reach *LoRAs*; a rule that
 *     wants the plural lists it.
 *
 * **Context is not disambiguated.** "We do not allow loli content" matches `loli`. The finding names
 * the phrase and carries the page capture, and a reader sees the sentence it sits in; a detector that
 * tried to read negation would be deciding what the merchant meant.
 *
 * ## How pages combine
 *
 * As an absent-sense rule does across surfaces (D-284): observed on any page read is the finding,
 * with that page's capture; a listed surface that could not be read makes it `not_evaluable`, because
 * an unread page is not a clean page (hard constraint 2); nothing read at all is `not_evaluable`; only
 * when every listed surface was read or not published, and nothing was observed, does it pass.
 */

import type { RuleOfType, Surface } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import type { Located } from '../surface.js';
import { notEvaluable, satisfied, violation, type Evidence, type Finding, type NotEvaluableKind } from '../findings.js';
import { containsTokenSequence, tokenizePath } from '../slug.js';
import { pageEvidence, renderFailure, RENDERED } from './pageEvidence.js';
import { surfaceLabel } from './textMatchAcross.js';

/** One listed surface: what the crawl located for it, and every page it established. */
export interface FeatureReading {
  readonly surface: Surface;
  readonly found: Located<PageContext>;
  /** Every page established for this surface. Empty unless `found` is located. */
  readonly pages: readonly PageContext[];
}

/** An `<input type="file">`, quoted or not. */
const FILE_INPUT = /<input\b[^>]*\btype\s*=\s*["']?file\b/i;

/** An element whose role, aria or class attributes name a drop zone. */
const DROP_ZONE =
  /\b(?:role|aria-label|aria-roledescription|aria-describedby|class|id|data-testid)\s*=\s*["'][^"']*\bdrop[\s_-]?zone/i;

/** What one page showed: the signals observed on it, if any. */
interface PageObservation {
  readonly page: PageContext;
  readonly signals: readonly string[];
}

const KIND_PRIORITY: readonly NotEvaluableKind[] = ['gated', 'challenged', 'not_retrieved', 'not_exposed'];

export function checkDomFeature(rule: RuleOfType<'dom_feature'>, readings: readonly FeatureReading[]): Finding {
  const observed: { surface: Surface; observation: PageObservation }[] = [];
  const read: { surface: Surface; page: PageContext }[] = [];
  const unreadable: { surface: Surface; reason: string; kind: NotEvaluableKind; evidence: readonly Evidence[] }[] = [];
  const notPublished: { surface: Surface; reason: string; evidence: readonly Evidence[] }[] = [];

  for (const reading of readings) {
    if (!reading.found.located) {
      const found = reading.found;
      const evidence = attemptsEvidence(found.attempts);
      const kind: NotEvaluableKind | null =
        found.gated !== undefined
          ? 'gated'
          : found.challenged !== undefined
            ? 'challenged'
            : found.obstructed === true
              ? 'not_retrieved'
              : null;
      if (kind === null) notPublished.push({ surface: reading.surface, reason: found.reason, evidence });
      else unreadable.push({ surface: reading.surface, reason: found.reason, kind, evidence });
      continue;
    }

    for (const page of reading.pages) {
      // A page that did not render, or that bot protection or a gate answered, was not read (D-181).
      const shortfall = renderFailure(rule, page);
      if (shortfall !== null) {
        unreadable.push({
          surface: reading.surface,
          reason: shortfall.notEvaluableReason ?? shortfall.note,
          kind: shortfall.notEvaluableKind ?? 'not_retrieved',
          evidence: shortfall.evidence,
        });
        continue;
      }
      read.push({ surface: reading.surface, page });
      const signals = detect(rule, reading.surface, page);
      if (signals.length > 0) observed.push({ surface: reading.surface, observation: { page, signals } });
    }
  }

  const onWhat = (surface: Surface, page: PageContext): string => `${surfaceLabel(surface)} (${page.finalUrl})`;
  const expect = rule.params.expect;

  if (observed.length > 0) {
    const first = observed[0]!;
    const where = observed.map((o) => `${onWhat(o.surface, o.observation.page)}: ${quote(o.observation.signals)}`);
    const note =
      `Observed on ${observed.length === 1 ? where[0] : `${observed.length} pages — ${where.join('; ')}`}.` +
      (rule.params.detector === 'lexicon' ? ' The sentence each phrase sits in is in the capture; it was not read for meaning.' : '');
    const evidence = observed.flatMap((o) =>
      pageEvidence(o.observation.page).map((e) => ({ ...e, matchedValue: o.observation.signals.join(', ') })),
    );
    return expect === 'present' ? satisfied(rule, note, RENDERED, evidence) : violation(rule, note, RENDERED, evidence);
  }

  if (read.length === 0 || unreadable.length > 0) {
    const gaps = [...unreadable, ...notPublished.map((n) => ({ ...n, kind: 'not_exposed' as NotEvaluableKind }))];
    const kind = KIND_PRIORITY.find((k) => gaps.some((g) => g.kind === k)) ?? 'not_exposed';
    const reason =
      (read.length === 0
        ? 'none of the listed pages was read'
        : `not observed on the ${read.length} page(s) read, and not every listed page was read`) +
      ': ' +
      gaps.map((g) => `${surfaceLabel(g.surface)}: ${g.reason}`).join('; ');
    return notEvaluable(rule, reason, RENDERED, kind, [
      ...read.flatMap((r) => pageEvidence(r.page)),
      ...gaps.flatMap((g) => g.evidence),
    ]);
  }

  const readList = read.map((r) => onWhat(r.surface, r.page)).join(', ');
  const notPublishedClause =
    notPublished.length === 0
      ? ''
      : ` Not published: ${notPublished.map((n) => `${surfaceLabel(n.surface)} (${n.reason})`).join('; ')}.`;
  const note = `Not observed on ${read.length} page(s) read: ${readList}.${notPublishedClause}`;
  const evidence = read.flatMap((r) => pageEvidence(r.page));
  return expect === 'present' ? violation(rule, note, RENDERED, evidence) : satisfied(rule, note, RENDERED, evidence);
}

/** The signals one page carries for this rule's detector. */
export function detect(rule: RuleOfType<'dom_feature'>, surface: Surface, page: PageContext): readonly string[] {
  const text = surface === 'footer' ? (page.footer.found ? page.footer.text : '') : page.text;
  const termsCount = rule.params.terms_on === undefined || rule.params.terms_on.includes(surface);
  const phrases = termsCount ? matchedPhrases(text, rule.params.terms ?? []) : [];

  if (rule.params.detector === 'lexicon') return phrases;

  const structural: string[] = [];
  if (FILE_INPUT.test(page.html)) structural.push('a file input (input[type=file])');
  if (DROP_ZONE.test(page.html)) structural.push('an element named as a drop zone');
  return [...structural, ...phrases];
}

/** The phrases the text carries as whole tokens, in the order the rule lists them. */
export function matchedPhrases(text: string, phrases: readonly string[]): readonly string[] {
  const tokens = tokenizePath(text);
  return phrases.filter((phrase) => containsTokenSequence(tokens, tokenizePath(phrase)));
}

function attemptsEvidence(attempts: Extract<Located<PageContext>, { located: false }>['attempts']): Evidence[] {
  return [
    {
      kind: RENDERED,
      sourceUrl: attempts[0]?.url ?? '',
      sourceSha256: '',
      evidenceKey: '',
      capturedAt: new Date().toISOString(),
      attempts,
    },
  ];
}

function quote(values: readonly string[]): string {
  return values.map((v) => (v.startsWith('a ') || v.startsWith('an ') ? v : `'${v}'`)).join(', ');
}
