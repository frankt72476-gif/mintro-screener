/**
 * Directive-language detection.
 *
 * Hard constraint 7 and D-001: findings describe what was observed, never what should happen
 * next. Everything the system generates is audited against this list by
 * `apps/worker/test/copy.test.ts`.
 *
 * The one string the system does *not* generate is the analyst's covering note, and D-029 makes
 * it the reason this module exists rather than a constant in a test file: the note is composed in
 * the browser, audited in the browser, and recorded by the worker. One list, three consumers. A
 * second copy of it would drift, and the surface it guards is the one that matters most.
 */

/**
 * Words that tell the reader what to do, or characterise the merchant.
 *
 * Matched on word boundaries, so "should" does not fire on "shoulder".
 *
 * Deliberately *not* including bare "must". Rule clauses quote the program document — "Guest
 * checkout must be disabled" — and are source material rather than Mintro's characterisation.
 * Rewriting them to avoid imperatives would misquote the standard the merchant is screened
 * against.
 */
export const DIRECTIVE_TERMS: readonly string[] = [
  'should',
  'recommend',
  'recommends',
  'recommended',
  'recommending',
  'advise',
  'advised',
  'advising',
  'suggest',
  'suggests',
  'suggested',
  'do not forward',
  'must not forward',
  'do not approve',
  'do not accept',
  'decline this',
  'reject this',
  'non-compliant',
  'noncompliant',
  'violation of law',
  'illegal',
  'we suggest',
  'please review',
  'action required',
  'take action',
];

export interface CopyAudit {
  /** Terms found, in the order they appear in the list. Empty when the text is clean. */
  readonly flagged: readonly string[];
  readonly clean: boolean;
}

/** Finds directive language in a piece of text. */
export function auditCopy(text: string, terms: readonly string[] = DIRECTIVE_TERMS): CopyAudit {
  const lower = text.toLowerCase();
  const flagged = terms.filter((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`).test(lower),
  );
  return { flagged, clean: flagged.length === 0 };
}

/**
 * Audits an analyst's covering note (D-029).
 *
 * **Warns; never blocks.** An analyst writing "recommend declining" would put a Mintro
 * determination in the most-read part of the email, undoing the posture every other surface
 * maintains — so it is worth flagging. But D-001 says we surface rather than gate, and a screener
 * that refused to send would be making the determination it is trying not to make.
 *
 * The analyst may proceed. What the warning buys is that the send record shows a directive note
 * was flagged and sent anyway, which is a fact somebody can act on later.
 */
export function auditAnalystNote(note: string): CopyAudit {
  return auditCopy(note);
}

/** One line for the analyst, naming what tripped the check. */
export function describeNoteWarning(audit: CopyAudit): string {
  if (audit.clean) return '';
  const quoted = audit.flagged.map((term) => `"${term}"`).join(', ');
  return `This note contains language that reads as a recommendation: ${quoted}. Findings describe what was observed; the determination is IQwallet's. You can send it as written — the send record will note that this was flagged.`;
}
