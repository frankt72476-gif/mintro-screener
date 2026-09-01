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

/**
 * Mintro's internal vocabulary, which must not reach a reader (D-044).
 *
 * An underwriter opening a report was told *"no layer 3 runner has been built for check type
 * 'dom_assert'"*. Check-type names, layer numbers and handler vocabulary are how this codebase
 * talks to itself. In a document someone outside Mintro uses to make a decision they are noise
 * at best, and at worst they read as a defect in the merchant's site.
 *
 * **Plain does not mean vaguer.** Nothing here asks for less detail — the replacement wording
 * names exactly what was not done. It asks for the detail in the reader's terms.
 *
 * `manual` is deliberately absent: it is an ordinary English word as well as a check type, and
 * banning it would fire on honest sentences. The check types that are *only* jargon are listed.
 */
export const INTERNAL_TERMS: readonly string[] = [
  // Check-type identifiers.
  'dom_assert',
  'text_match',
  'text_cooccurrence',
  'flow_probe',
  'http_probe',
  'url_pattern',
  'computed_style',
  'doc_parse',
  // Layer vocabulary. Matched case-insensitively, so `Layer 2` is caught with `layer 2`.
  'layer 0',
  'layer 1',
  'layer 2',
  'layer 3',
  'layer0',
  'layer1',
  'layer2',
  'layer3',
  // Implementation vocabulary.
  'check type',
  'runner',
  'handler',
  'not implemented',
  'matcher shape',
];

export interface CopyAudit {
  /** Terms found, in the order they appear in the list. Empty when the text is clean. */
  readonly flagged: readonly string[];
  readonly clean: boolean;
}

/**
 * Words that claim an authority Mintro does not have.
 *
 * Distinct from `DIRECTIVE_TERMS`, which catches telling the reader what to do. These catch
 * *asserting a conclusion*: that a document is genuine, that a number was confirmed against the
 * world, that a merchant is sound. Findings report observations and the reader draws the
 * conclusion (D-001, hard constraint 7).
 *
 * D-076 is why "verified" is here. A consistency check compares three pieces of paper the merchant
 * supplied; "EIN verified" invites an underwriter to infer somebody queried the IRS, and nobody
 * did. The name states the method — "EIN consistent across application, EIN letter, W-9".
 *
 * The forgery terms are A-04's. That check confirms a document carries the markers of its declared
 * type, which catches a W-9 filed in the EIN Letter slot. It cannot detect a forgery, and no
 * finding it produces may read as though it could.
 *
 * Same file as `DIRECTIVE_TERMS` on purpose. One place, three consumers — a second copy would
 * drift, and the surface it guards is the one that matters most.
 */
export const DETERMINATION_TERMS: readonly string[] = [
  'verified',
  'verify',
  'unverified',
  'authentic',
  'authenticated',
  'genuine',
  'forged',
  'forgery',
  'fraudulent',
  'fraud',
  'falsified',
  'legitimate',
  'trustworthy',
  'creditworthy',
  'high risk',
  'low risk',
  'risky',
  'approved',
  'denied',
  'rejected',
  'passes underwriting',
  'confirms the merchant',
  'proves',
  'proven',
  /*
    Phrasings that shipped, each a conclusion from a measurement that did not reach it (D-217).

    Specific rather than general, in the same way `passes underwriting` and `confirms the merchant`
    already are. A term list cannot catch the shape of this mistake — it catches the sentences it
    was taught, and these were taught by a real report:

      - `is not a certificate` — `looksLikePdf` read four bytes. What the response *is* was never
        established, and on CoMo Peptides the certificate content is there as HTML.
      - `nothing it would state` — the same inference, carried one step further.
      - `no comparable text` — DISC-001's near miss scored 0.67 coverage against a 0.50 threshold
        and failed on density alone. Text was found. It scored low.
      - `stops the application` — Mintro does not make that determination and does not report it.
  */
  'is not a certificate',
  'nothing it would state',
  'no comparable text',
  'stops the application',
];

/**
 * Words that turn observations into a characterisation of the merchant.
 *
 * "Four issues are open for response" and "four observations are open for response" describe the
 * same four rows. The first has decided they are problems, which is IQwallet's decision to make
 * (D-001) — and it decides it in an internal message nobody thinks of as reader-facing, which is
 * exactly where this drifts back in.
 *
 * **Deliberately not merged into `DIRECTIVE_TERMS`.** `assembleReport` writes *"3 rule(s) were
 * observed to fail, and 2 other failure(s)"*, which is a count of rules whose stated condition was
 * not met — the word naming a rule's own outcome, not a judgement about the merchant. Adding
 * "failures" globally would fail the verdict line for using the vocabulary the four states are
 * literally named in.
 *
 * So this is a second, narrower list applied where the distinction holds: text about *the
 * merchant's participation*, where there are no rule outcomes to name and every one of these words
 * would be a characterisation.
 */
export const CHARACTERISATION_TERMS: readonly string[] = [
  'issue',
  'issues',
  'problem',
  'problems',
  'concern',
  'concerns',
  'violation',
  'violations',
  'failure',
  'failures',
  'deficiency',
  'deficiencies',
  'unresponsive',
  'uncooperative',
  'evasive',
  'stonewalling',
  'ignoring',
  'refused to respond',
  'failed to respond',
];

/**
 * Everything a message about the response round is audited against (D-143 … D-146).
 *
 * The operator notification is internal mail, which is the argument for not auditing it and the
 * reason it must be. Nothing else Mintro writes describes a merchant's *conduct*, and an operator
 * who reads "the merchant failed to respond" in their own inbox every week will eventually write it
 * into a covering note.
 */
export const PARTICIPATION_TERMS: readonly string[] = [
  ...DIRECTIVE_TERMS,
  ...CHARACTERISATION_TERMS,
];

/**
 * Phrasings that tell a merchant what to do about a finding.
 *
 * `DIRECTIVE_TERMS` catches the recommending register — *should*, *recommend*, *advise*. It does
 * not catch the imperative one, because nothing Mintro generated had ever been written that way.
 *
 * Collapsing a finding to a single plain line is exactly the change that invites it. A sentence
 * with room for one clause about a boundary has room for one clause about a remedy, and *"remove
 * the dosing instructions"* is shorter and more helpful-sounding than *"what the standards do not
 * permit: the page carries dosing guidance"*. That is the pressure D-001 exists against: the
 * moment a finding names the fix, Mintro is a party to the determination and has created reliance.
 *
 * Bare verbs, so they match wherever they sit in a sentence. `` bounding in `auditCopy` keeps
 * `remove` off `removed` and `change` off `unchanged` — the past tense is how an observation
 * legitimately describes what a merchant already did.
 */
export const REMEDY_TERMS: readonly string[] = [
  'remove',
  'delete',
  'add a',
  'update the',
  'correct the',
  'fix',
  'ensure',
  'you should',
  'you must',
  'you need to',
  'needs to be',
  'change x',
  /*
    Prescriptive phrasings a *lead* can take that the verbs above miss (D-225).

    Found by the control rather than by imagination: a lead reading "what this rule looks at: the
    terms must include research use only" passes every structural assertion — it has a subject, it
    is one sentence, it names the rule — and only the guard can catch it. It was not caught.

    **`must be` is deliberately absent and must stay absent.** It appears verbatim in four rule
    clauses (GATE-001, GATE-003, GATE-006, COA-003), because that is how the programme document
    writes a requirement, and a term that flags the standard's own words is unusable. That is the
    same reason bare `must` was excluded when `DIRECTIVE_TERMS` was written.

    These four were checked against every clause and subject in the rule set and against the
    eye-test rubric's prose: none appears. They catch Mintro writing an instruction, never the
    programme being quoted.
  */
  'must include',
  'must carry',
  'must state',
  'add the',
];

/**
 * Directive verbs that are also ordinary impression vocabulary.
 *
 * Excluded from what the **eye test** is audited against, and from nothing else. The eye test's
 * whole job is to say how a storefront presents itself, and these words do that work honestly:
 *
 *     the palette and typography suggest a clinic rather than a laboratory supplier
 *     the product page recommends a dosing protocol in its own copy
 *     nothing on the sampled pages advises the reader on administration
 *
 * Measured before excluding: against `FINDING_TERMS`, three of ten realistic impression sentences
 * flagged, and the third is the one that decides it — *"the product page recommends a dosing
 * protocol"* is an **observation about the merchant**, not Mintro recommending anything. A guard
 * that ate that sentence would push the eye test toward vaguer copy to stay clean, which is the
 * opposite of what it is for.
 *
 * They stay in `DIRECTIVE_TERMS` for every Mintro-authored surface, where Mintro is the speaker
 * and *"we suggest"* means what it says. The difference is who is talking.
 */
export const IMPRESSION_VERBS: readonly string[] = [
  'should',
  'suggest',
  'suggests',
  'suggested',
  'recommend',
  'recommends',
  'recommended',
  'recommending',
  'advise',
  'advised',
  'advising',
];

/**
 * Verdicts on a merchant, as whole phrases.
 *
 * What excluding `IMPRESSION_VERBS` costs, bought back without the cost. *"The storefront should
 * be declined"* and *"we recommend declining this application"* are determinations, and dropping
 * the bare verbs would let both through — so the phrases are named instead of the words.
 *
 * Multi-word for the reason `passes underwriting` and `confirms the merchant` already are (D-217):
 * a term list catches the sentences it was taught, and the general shape of a verdict cannot be
 * caught by a word that also appears in an honest sentence. `merchant fails` and `site fails`
 * rather than `fails`, because *"the gate fails to stop a visitor who clicks outside it"* is an
 * observation this layer exists to make.
 *
 * Each is a sentence a vision model could plausibly write when asked to describe a storefront and
 * drifting into judging one, which is the failure this guard exists for.
 */
export const VERDICT_TERMS: readonly string[] = [
  /*
    Three more were drafted and removed: `should be approved`, `should not be approved` and
    `should be rejected` are already caught by `approved` and `rejected` in `DETERMINATION_TERMS`.
    A test asserts each term here catches something no other term does — an addition that changes
    nothing is one nobody can justify to the next reader, and it makes the list look better tested
    than it is.
  */
  'should be declined',
  'recommend declining',
  'recommend approving',
  'recommend rejecting',
  'merchant fails',
  'merchant passes',
  'site fails',
];

/** Everything a generated finding is audited against. */
export const FINDING_TERMS: readonly string[] = [
  ...DIRECTIVE_TERMS,
  ...DETERMINATION_TERMS,
  ...REMEDY_TERMS,
];

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
 * Audits one finding's Observed / Published standard pair.
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
 * The framing is the headers: "Observed" and "Published standard" are both nouns, and neither
 * addresses the reader. A header like "Required action" or "How to fix" would turn the same two
 * pieces of text into instructions without a word of the content changing, which is why these are
 * a constant rather than a string typed into a component.
 *
 * **"Published standard", not "Program requirement".** These two headings sit beside every quoted
 * clause in every report, which made them the highest-frequency instance of a word a merchant cannot
 * resolve: *whose* programme? Under a published standard the answer is in the heading. Being
 * constants rather than component text — the reason they were made constants — is what let a
 * two-line change reach every surface at once.
 */
export const REQUIREMENT_HEADINGS = {
  observed: 'Observed',
  required: 'Published standard',
  /** For not_evaluable: the requirement stands, and why it could not be assessed is stated. */
  notAssessed: 'Not assessed',
  /**
   * For a rule Mintro wrote rather than one the standards state (D-138).
   *
   * The other heading reads "Published standard", and printing a Mintro observation under it would
   * put words in the standards' mouth — fabricating the authority rather than overstating the
   * method, which is the worse of the two. Wording beneath a heading cannot fix the heading, so the
   * renderer branches on `source` and this is the other branch.
   */
  mintroObservation: 'Mintro observation, not a published standard',
} as const;

/**
 * URLs, removed before a vocabulary scan.
 *
 * A URL is the merchant's own text quoted back, and it may legitimately contain anything —
 * `/wp-content/uploads/COA_BPC-157.pdf` is not Mintro vocabulary leaking into a report. Scanning
 * it would produce failures no one could act on, and the usual response to those is to weaken the
 * guard.
 */
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Identifiers shaped like code: `batch_lot`, `purity_pct`, `not_evaluable`.
 *
 * **Matched by shape, not by a list** (D-060). A list of known identifiers catches the ones
 * someone thought of; the shape catches the next one, whatever it is called. `auditCopy`'s term
 * list was extended once for check-type names and immediately missed `batch_lot` in COA-004's
 * note, because a rule's own field names are not check types — the same failure in a new spelling.
 *
 * Lowercase-only, so a merchant's `COA_BPC-157` filename is not mistaken for one of ours.
 */
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * Finds Mintro's internal vocabulary in reader-facing text (D-044, D-060).
 *
 * Separate from `auditCopy` because the two failures are different: directive language breaks
 * D-001 and hard constraint 7 by telling the reader what to do, while this breaks the report's
 * usefulness by describing Mintro's implementation to someone who has no reason to know it.
 * Both are build failures; keeping them apart keeps the diagnostic honest about which one fired.
 */
export function auditInternalVocabulary(text: string, quoted: readonly string[] = []): CopyAudit {
  const withoutUrls = text.replace(URL_PATTERN, ' ');

  /*
    What the merchant wrote is exempt; what we wrote is not. **The distinction is provenance, not
    shape** (D-060, amended).

    The first version matched snake_case anywhere and flagged `et_pb_column`, `et_pb_module`,
    `et_pb_text_inner` in DISC-002's finding on two merchants. Those are Divi theme class names —
    the **merchant's markup**, quoted as the evidence for where the disclaimer was found. A CSS
    selector *is* the evidence, and rewriting it would destroy the finding's backing.

    A guard matching form rather than origin keeps catching the wrong things, and one that cries
    wolf on legitimate evidence is one people learn to suppress.

    `quoted` is what the finding recorded as coming from the merchant — `matchedValue`,
    `sourceUrl`, `matchedUrls`, the URLs of attempts. Any identifier appearing there is theirs.
    Anything left is ours.
  */
  const exempt = new Set((quoted.join(' ').match(SNAKE_CASE) ?? []).map((token) => token));

  const named = auditCopy(withoutUrls, INTERNAL_TERMS).flagged.filter((term) => !exempt.has(term));
  const shaped = [...new Set(withoutUrls.match(SNAKE_CASE) ?? [])].filter(
    (token) => !exempt.has(token),
  );

  const flagged = [...named, ...shaped.filter((token) => !named.includes(token))];
  return { flagged, clean: flagged.length === 0 };
}

/**
 * The merchant-derived strings a finding recorded, for `auditInternalVocabulary`.
 *
 * Reads only fields the `Evidence` type defines as the merchant's: `matchedValue` is documented as
 * "what was matched, verbatim", and the URLs are theirs by construction. **Where our own text ends
 * up in one of these, that is a defect in the finding rather than a reason to distrust the field**
 * — and this audit surfaces it, because our identifier then becomes exempt and stops being caught.
 */
export function quotedFromEvidence(
  evidence: readonly {
    readonly matchedValue?: string;
    readonly sourceUrl?: string;
    readonly matchedUrls?: readonly string[];
    readonly attempts?: readonly { readonly url: string }[];
  }[],
): readonly string[] {
  return evidence.flatMap((entry) => [
    entry.matchedValue ?? '',
    entry.sourceUrl ?? '',
    ...(entry.matchedUrls ?? []),
    ...(entry.attempts ?? []).map((attempt) => attempt.url),
  ]);
}

/**
 * What the eye test's **model-authored** copy is audited against.
 *
 * The eye test is the only surface in the report written by a language model rather than by a
 * Mintro template, and it routed through no guard at all — so a read that drifted from describing
 * a storefront to judging one would reach an underwriter with nothing in the way.
 *
 * Composed from the existing lists rather than written fresh: determinations and remedies apply to
 * it exactly as they apply to a finding. What differs is the directive half, where the impression
 * verbs are excluded and `VERDICT_TERMS` replaces the coverage they carried — see both for the
 * measurements.
 *
 * **Narrowed, not weakened.** Every determination the unnarrowed list caught is still caught, and
 * three impression sentences it wrongly caught now survive.
 */
export const EYE_TEST_TERMS: readonly string[] = [
  ...DIRECTIVE_TERMS.filter((term) => !IMPRESSION_VERBS.includes(term)),
  ...DETERMINATION_TERMS,
  ...REMEDY_TERMS,
  ...VERDICT_TERMS,
];
