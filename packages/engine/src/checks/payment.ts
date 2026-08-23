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
}

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

  if (surfaces.length === 0) {
    return notEvaluable(
      rule,
      'none of the surfaces this rule names was read: no footer was identified on the homepage and ' +
        'no public payment or policy page was reached',
      'rendered_page',
      'not_exposed',
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
