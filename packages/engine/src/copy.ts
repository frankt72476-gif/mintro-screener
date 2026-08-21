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

/* -------------------------------------------------------------------------------------------
 * The requirement column (D-041)
 * ----------------------------------------------------------------------------------------- */

/**
 * What a finding presents beside its observation.
 *
 * The report states what was seen and quotes the standard it was screened against. It does not
 * say what to change — that would be remediation advice, which makes Mintro a party to the
 * compliance determination and creates reliance. Quoting the clause gives the merchant everything
 * they need to act while Mintro states a fact and cites a source.
 */
export interface RequirementAudit {
  /** True when the displayed requirement is byte-identical to the rule's clause. */
  readonly verbatim: boolean;
  /** Directive terms found in the *observation*, which is Mintro's own words. */
  readonly flaggedInObservation: readonly string[];
  readonly problems: readonly string[];
  readonly clean: boolean;
}

/**
 * Audits one finding's Observed / Program requirement pair.
 *
 * Two different standards, deliberately:
 *
 *   - **The requirement is checked for being verbatim, not for being polite.** It is the program
 *     document's wording, and it says "must". Rewriting it to avoid imperatives would misquote
 *     the standard the merchant is screened against — which is why `DIRECTIVE_TERMS` excludes
 *     bare "must" in the first place. The only thing that can go wrong here is drift, so drift is
 *     what is checked: byte-identical, or it fails.
 *   - **The observation is checked for directive language**, because that half is Mintro's own
 *     words about what it saw.
 *
 * The distinction is the whole design. A paraphrased requirement is Mintro characterising the
 * standard; an exact quotation is Mintro citing it.
 */
export function auditRequirement(observation: string, requirement: string, clause: string): RequirementAudit {
  const problems: string[] = [];

  const verbatim = requirement === clause;
  if (!verbatim) {
    problems.push(
      requirement.trim() === clause.trim()
        ? 'the requirement differs from the rule clause only in surrounding whitespace, which is still not verbatim'
        : 'the requirement is not byte-identical to the rule clause — it has been paraphrased or edited',
    );
  }

  const observed = auditCopy(observation);
  if (!observed.clean) {
    problems.push(
      `the observation uses directive language: ${observed.flagged.join(', ')}. It states what was seen; ` +
        'what the program requires is the other column.',
    );
  }

  return {
    verbatim,
    flaggedInObservation: observed.flagged,
    problems,
    clean: problems.length === 0,
  };
}

/**
 * The column headers, defined once.
 *
 * The framing is the headers: "Observed" and "Program requirement" are both nouns, and neither
 * addresses the reader. A header like "Required action" or "How to fix" would turn the same two
 * pieces of text into instructions without a word of the content changing, which is why these are
 * a constant rather than a string typed into a component.
 */
export const REQUIREMENT_HEADINGS = {
  observed: 'Observed',
  required: 'Program requirement',
  /** For not_evaluable: the requirement stands, and why it could not be assessed is stated. */
  notAssessed: 'Not assessed',
} as const;
