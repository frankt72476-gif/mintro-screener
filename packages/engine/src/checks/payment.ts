/**
 * The payment-surface checks — PAY-001 and PAY-002 (D-049).
 *
 * Pure: a rule plus the surfaces in, a finding out.
 *
 * **PAY-001 expects `absent` and is `auto_fail` and `critical`.** Failing to reach a surface reads
 * as absence, which would be a false `pass` on the most consequential rule in the payment
 * category — so a `pass` requires that at least one surface was read, and names every one that
 * was. Its surface was rescoped in D-049: `checkout_and_footer` made the rule resolvable only for
 * merchants who fail GATE-002 and GATE-003, which is inverted.
 *
 * PAY-002 used to live here too. It became `manual` in D-052: identifying a processor requires
 * reaching checkout, which a merchant who correctly gates it never shows an anonymous visitor, so
 * the rule could only ever speak about merchants non-compliant in some other way. Its detector was
 * removed rather than left dead — code implying a capability that is gone is what D-047 removed
 * `resolveRunSelection` for.
 */

import type { RuleOfType } from '@mintro/ruleset';
import { notEvaluable, satisfied, violation, type Evidence, type Finding } from '../findings.js';

/**
 * A public surface PAY-001 reads: the footer, or a policy page reachable without an account.
 */
export interface PublicSurface {
  readonly label: string;
  readonly text: string;
  readonly url: string;
  /**
   * Whether this surface is one of the two the rule requires (D-158).
   *
   * The footer and the terms document. Discovered surfaces — FAQ, shipping, refund policy — widen
   * what was read and never count toward the floor.
   */
  readonly required?: 'footer' | 'terms';
}

/**
 * The surfaces PAY-001 must have read before it may return a verdict (D-158).
 *
 * **A named minimum, not a count of what happened to be found.** `checkPaymentTerms` required at
 * least one surface, which let a run that reached the footer and failed at everything else return
 * `pass` — a verdict on data it did not fully obtain, which D-156 forbids.
 *
 * Counting *discovered* surfaces toward the floor would reintroduce the problem it fixes: a
 * merchant with no FAQ and a merchant whose FAQ we failed to fetch are indistinguishable from the
 * candidate list, so "we read four of five" is not a statement anyone can check. These two exist on
 * any real storefront, so failing to read either is a fact about the run.
 */
const REQUIRED_SURFACES = ['footer', 'terms'] as const;

/**
 * PAY-001 — peer-to-peer payment rails, on the surfaces where they are advertised (D-049).
 *
 * The rule used to declare `checkout_and_footer`, and that made it **inverted**: a merchant who
 * gates checkout — which is exactly what GATE-002 and GATE-003 require — has no checkout an
 * anonymous crawl can read, so the rule resolved only for merchants who failed those two. All
 * five storefronts returned `not_evaluable`.
 *
 * The surface is now the footer plus any payment or policy page a visitor reaches without an
 * account, because **peer-to-peer rails are advertised, not hidden**: a merchant taking Zelle
 * says so where customers can see it.
 *
 * A term observed anywhere is a positive observation and fails the rule; a `pass` requires that
 * at least one surface was actually read, and names every one that was — along with the fact
 * that a gated checkout was not among them (D-018).
 */
export function checkPaymentTerms(
  rule: RuleOfType<'text_match'>,
  surfaces: readonly PublicSurface[],
): Finding {
  const terms = rule.params.terms ?? [];

  /*
    The floor is checked **before** anything is matched (D-156, D-158).

    Not after. A violation found on half the declared surface is still a verdict on data not fully
    obtained, and D-156 forbids it in both directions for the same reason: the finding has to be
    the same on a second run, and one that depends on which surface happened to load is not. This
    is the same discipline `checkHttpProbe` applies when one probed path did not answer.
  */
  const missing = REQUIRED_SURFACES.filter(
    (needed) => !surfaces.some((surface) => surface.required === needed),
  );

  if (missing.length > 0) {
    const names = { footer: 'the homepage footer', terms: 'the terms document' };
    return notEvaluable(
      rule,
      `this rule reports on ${names.footer} and ${names.terms} together, and ` +
        `${missing.map((m) => names[m]).join(' and ')} ${missing.length === 1 ? 'was' : 'were'} not read` +
        `${surfaces.length === 0 ? '' : `; ${surfaces.length} other surface(s) were: ${surfaces.map((surface) => surface.label).join(', ')}`}. ` +
        `A term absent from part of the public surface is not a term absent from it`,
      'rendered_page',
      // Both surfaces exist on any real storefront, so not reaching one is a fact about this run.
      'not_retrieved',
    );
  }

  const hits: string[] = [];
  const where: string[] = [];

  for (const surface of surfaces) {
    const lower = surface.text.toLowerCase();
    const found = terms.filter((term) => lower.includes(term.toLowerCase()));
    if (found.length > 0) {
      hits.push(...found);
      where.push(`${surface.label} (${found.join(', ')})`);
    }
  }

  const read = surfaces.map((surface) => surface.label);
  const evidence: readonly Evidence[] =
    surfaces.length === 0
      ? []
      : [
          {
            kind: 'rendered_page',
            sourceUrl: surfaces[0]?.url ?? '',
            sourceSha256: '',
            evidenceKey: '',
            capturedAt: new Date().toISOString(),
            ...(hits.length === 0 ? {} : { matchedValue: [...new Set(hits)].join(', ') }),
          },
        ];

  if (hits.length > 0) {
    return violation(
      rule,
      `Observed on ${where.join('; ')}: ${[...new Set(hits)].join(', ')}. ` +
        `${read.length} public surface(s) were read: ${read.join(', ')}.`,
      'rendered_page',
      evidence,
    );
  }

  return satisfied(
    rule,
    `None of ${quote(terms)} was observed in the rendered text of ${read.length} public ` +
      `surface(s): ${read.join(', ')}. ` +
      `A checkout page behind a sign-in was not among the surfaces examined, and text not rendered ` +
      `on these pages was not examined.`,
    'rendered_page',
    evidence,
  );
}

const quote = (terms: readonly string[]): string => terms.map((term) => `'${term}'`).join(', ');
