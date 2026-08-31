/**
 * The COA checks — COA-002, COA-003, COA-004 (D-057).
 *
 * Pure: a rule plus the certificate's extracted text in, a finding out. The worker fetches the
 * document and establishes it is one; nothing here touches the network.
 *
 * ## What these findings may claim
 *
 * **They report what a certificate states. They never report that it is genuine.** A COA is a
 * document a merchant chose to publish, and forged COAs are a known failure mode — COA-005 stays
 * `manual` for exactly that reason, and no finding here may quietly answer the question COA-005
 * exists to leave open. So the wording is always "the certificate states 99.2% purity", never
 * "purity is 99.2%".
 *
 * ## Two of these are auto_fail, which sets the direction
 *
 * COA-002 and COA-003 are `critical` and `auto_fail`. A value that could not be extracted must
 * therefore never read as a value that is missing or wrong: a scanned certificate carries no text
 * at all, and failing a merchant because our reader cannot see an image would be the worst kind of
 * false positive. Every absence here is `not_evaluable`, and it names what could not be read.
 */

import type { RuleOfType } from '@mintro/ruleset';
import {
  notEvaluable,
  satisfied,
  violation,
  type Evidence,
  type FetchAttempt,
  type Finding,
  type NotEvaluableKind,
} from '../findings.js';

/**
 * What looking for a certificate produced (D-058).
 *
 * Four outcomes, because they are four different facts and the first version of this reported them
 * as one sentence — *"no certificate of analysis was reached: no product page linked to one, **or**
 * the link did not resolve to a document"*. A reader could not tell which had happened, and the
 * attempts that would have said were computed and then dropped before they reached a finding. That
 * is hard constraint 3 broken, and the pre-D-044 conflation one check down.
 *
 *   `certificate`    a document was fetched and established as a PDF
 *   `not_published`  no product page linked to one, or every link returned 404
 *   `link_broken`    a certificate link served something that is not a PDF
 *   `not_retrieved`  the request failed or timed out
 *
 * `link_broken` is the sharpest of the three failures and used to be invisible: a link that
 * returns a themed error page **looks live to a customer**. That is a worse observation about a
 * merchant than publishing no link at all, and it was being reported in the same words.
 */
export type CertificateOutcome =
  | { readonly found: true; readonly certificate: Certificate }
  | {
      readonly found: false;
      readonly why: 'not_published' | 'link_broken' | 'not_retrieved';
      readonly attempts: readonly FetchAttempt[];
    };

/** A certificate the worker fetched and established. */
export interface Certificate {
  readonly url: string;
  readonly sha256: string;
  /** Evidence-store key for the stored document body. Hard constraint 3: the body, not only its hash. */
  readonly evidenceKey: string;
  readonly text: string;
  /** Set when no text could be recovered, naming why. */
  readonly emptyReason?: string;
  readonly fetchedAt: string;
}

/**
 * What each field is called in a report (D-060).
 *
 * `batch_lot` is an identifier in the rule set, not something an underwriter reads. The audit that
 * was supposed to keep Mintro's vocabulary out of reader-facing text listed check-type names and
 * missed these, because a rule's own field names are not check types — `auditInternalVocabulary`
 * now matches the *shape* rather than a list, and this is what it flagged first.
 */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  batch_lot: 'a batch or lot number',
  test_date: 'a testing date',
  compound: 'the compound tested',
  purity_pct: 'a purity percentage',
  method: 'the method used',
};

/** How a field is named in a finding. Unknown ids are quoted rather than silently prettified. */
const nameOf = (field: string): string => FIELD_NAMES[field] ?? `'${field}'`;

/** Fields COA-004 asks a certificate to carry, and how each is recognised in the text. */
const FIELD_PATTERNS: Readonly<Record<string, RegExp>> = {
  batch_lot: /\b(batch|lot)\s*(no\.?|number|#|id)?\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{2,}/i,
  test_date: /\b(date\s*(of)?\s*(test|analysis|report|issue)|test(ed)?\s*date|report\s*date)\b/i,
  compound: /\b(compound|product|analyte|substance|sample)\s*(name)?\s*[:#]?/i,
  purity_pct: /\b(purity|assay)\b[^%]{0,40}\d{1,3}(\.\d+)?\s*%/i,
  method: /\b(HPLC|UPLC|LC-MS|GC-MS|MS\/MS|NMR|method)\b/i,
};

function certificateEvidence(certificate: Certificate, matched?: string): readonly Evidence[] {
  return [
    {
      kind: 'document',
      sourceUrl: certificate.url,
      sourceSha256: certificate.sha256,
      evidenceKey: certificate.evidenceKey,
      capturedAt: certificate.fetchedAt,
      ...(matched === undefined ? {} : { matchedValue: matched }),
    },
  ];
}

/**
 * No certificate, or one whose text could not be read.
 *
 * Every branch carries the attempts, and each lands in the kind that names **whose** limitation it
 * is (D-044, D-058). The distinction is not cosmetic: `link_broken` and `not_retrieved` used to
 * share a sentence, and one is a fact about the merchant while the other is a fact about this run.
 */
function unreadable(rule: RuleOfType<'doc_parse'>, outcome: CertificateOutcome): Finding {
  if (outcome.found) {
    return notEvaluable(
      rule,
      `the certificate at ${outcome.certificate.url} was fetched and stored, but no text could be ` +
        `read from it: ${outcome.certificate.emptyReason ?? 'no text objects were found'}`,
      'document',
      'not_exposed',
      certificateEvidence(outcome.certificate),
    );
  }

  const { reason, kind } = describeFailure(outcome.why, outcome.attempts);
  return notEvaluable(rule, reason, 'document', kind, attemptEvidence(outcome.attempts));
}

/**
 * The requests that were made and what each returned.
 *
 * Hard constraint 3: a finding that could not read a document evidences *why*, with what was
 * requested and what came back. These were computed and discarded before D-058. Shared by the
 * unreadable path and by COA-006, so the two cannot describe the same attempts differently.
 */
function attemptEvidence(attempts: readonly FetchAttempt[]): Evidence[] {
  return [
    {
      kind: 'document',
      sourceUrl: attempts[0]?.url ?? '',
      sourceSha256: '',
      evidenceKey: '',
      capturedAt: new Date().toISOString(),
      attempts,
    },
  ];
}

function describeFailure(
  why: 'not_published' | 'link_broken' | 'not_retrieved',
  attempts: readonly FetchAttempt[],
): { readonly reason: string; readonly kind: NotEvaluableKind } {
  const tried = attempts.length;

  switch (why) {
    case 'not_published':
      return {
        kind: 'not_exposed',
        reason:
          tried === 0
            ? 'no sampled product page linked to a certificate of analysis'
            : `${tried} certificate link(s) on the sampled product pages were requested and none ` +
              `returned a document — each is listed with what it returned`,
      };

    case 'link_broken':
      return {
        kind: 'not_exposed',
        reason:
          /*
            The reason three certificate-content rules are unevaluated (D-217).

            They read a certificate's test date, purity and required fields out of a parsed PDF. The
            link returned a response that does not begin with `%PDF`, so there was no parsed
            document to read them from — that, and not "what it serves is not a certificate", is why
            these could not be evaluated. The distinction matters here: on CoMo Peptides the
            certificate content is present as HTML, so a reader told the link "is not a certificate"
            would be told something false about the merchant's site.
          */
          `a certificate link on the sampled product pages resolved and returned a response that ` +
          `does not begin with %PDF, and this check reads the certificate as a PDF, so there was ` +
          `no parsed document to read this from. The link resolves and looks live to a customer. ` +
          `${tried} link(s) were requested, each listed with what it returned and the content type ` +
          `it declared`,
      };

    case 'not_retrieved':
      return {
        kind: 'not_retrieved',
        reason:
          `the request for the certificate did not complete, so nothing was established about it ` +
          `either way. This is a limitation of this run rather than an observation about the ` +
          `merchant; ${tried} request(s) were made and are listed with what each returned`,
      };
  }
}

/**
 * COA-002 — the date the certificate states it was issued, against a maximum age.
 *
 * The copy says "reported", not "tested". D-058 renamed the param from `test_date` to
 * `report_date` because those are different things, and the note a reader sees has to name the
 * same one — a rename that fixes the param and leaves the sentence answering the old question is
 * the failure D-058 was made to prevent, surviving where it is actually read.
 *
 * `cure_days` is honoured as the rule declares it: a certificate past the limit but within the
 * cure window is reported for review rather than failed, because the program allows that time.
 */
/**
 * COA-006 — the certificate link serves a certificate (D-136).
 *
 * The observation this exists to carry, from run 730764d4: every certificate link on the site
 * resolved, and every one served a `.webp` image. COA-002, COA-003 and COA-004 each reported
 * `not_evaluable` with an accurate reason, and the report showed three not-assessed rows whose
 * shared cause a reader had to piece together for themselves.
 *
 * **That the certificates cannot be read is itself a finding, and a substantive one.** No purity,
 * batch or test date on this storefront is verifiable by anybody — not by Mintro, not by an
 * underwriter, not by a customer following the link. Filing it only as the absence of three other
 * checks understates it.
 *
 * The four outcomes stay four things:
 *
 *   - a certificate that was fetched and read → `pass`
 *   - a link that served something else, or a document with no readable text → the finding
 *   - no link published at all → `not_evaluable`; that is COA-001's subject, not this one
 *   - a request that did not complete → `not_evaluable`, and about this run (D-058)
 */
export function checkCoaServed(rule: RuleOfType<'doc_parse'>, outcome: CertificateOutcome): Finding {
  if (outcome.found) {
    const certificate = outcome.certificate;
    if (certificate.text !== '') {
      return satisfied(
        rule,
        `The certificate link served a document that could be read: ${certificate.url}.`,
        'document',
        certificateEvidence(certificate),
      );
    }

    // A PDF was served and carries no recoverable text — a scan, or an image wrapped in a
    // container. Same consequence for a reader as a `.webp`: nothing on it can be checked.
    return violation(
      rule,
      `The certificate at ${certificate.url} was retrieved and no text could be recovered from it` +
        `${certificate.emptyReason === undefined ? '' : ` (${certificate.emptyReason})`}. ` +
        `Nothing it states — purity, batch or test date — can be read from it.`,
      'document',
      certificateEvidence(certificate),
    );
  }

  if (outcome.why === 'link_broken') {
    return violation(
      rule,
      /*
        The content type, not a verdict on what was served (D-217).

        This read *"what it serves is not a certificate, so nothing it would state can be read"* —
        two conclusions the method never reached. What it observed is that the bytes do not begin
        with `%PDF`; whether the response is a certificate rendered as a web page, an error page, or
        anything else was not established, and on this merchant the certificate content **is** there
        as HTML. Naming the observation leaves that open, which is what a reader needs (D-076).
      */
      `A certificate link on the sampled product pages resolved and returned a response that does ` +
        `not begin with %PDF. This check reads the certificate as a PDF, so it did not parse what ` +
        `was served and nothing about the contents is established here. The link resolves and ` +
        `looks live to a customer. ${outcome.attempts.length} link(s) were requested, each listed ` +
        `with what it returned and the content type it declared.`,
      'document',
      attemptEvidence(outcome.attempts),
    );
  }

  const { reason, kind } = describeFailure(outcome.why, outcome.attempts);
  return notEvaluable(rule, reason, 'document', kind, attemptEvidence(outcome.attempts));
}

export function checkCoaDate(
  rule: RuleOfType<'doc_parse'>,
  outcome: CertificateOutcome,
  now: Date,
): Finding {
  if (!outcome.found || outcome.certificate.text === '') return unreadable(rule, outcome);
  const certificate = outcome.certificate;

  const found = findDate(certificate.text);
  if (found === null) {
    return notEvaluable(
      rule,
      `no report or issue date could be read from the certificate at ${certificate.url}. Its text was ` +
        `extracted and searched; no date in a recognised format was found near a date label.`,
      'document',
      'not_exposed',
      certificateEvidence(certificate),
    );
  }

  const maxAge = rule.params.max_age_days ?? 60;
  const cure = rule.params.cure_days ?? 0;
  const ageDays = Math.floor((now.getTime() - found.date.getTime()) / 86_400_000);

  if (ageDays <= maxAge) {
    return satisfied(
      rule,
      `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` +
        `day(s) before this run and within the ${maxAge}-day limit. This reports the date the ` +
        `certificate carries; it is not a verification that any test occurred.`,
      'document',
      certificateEvidence(certificate, found.text),
    );
  }

  if (ageDays <= maxAge + cure) {
    return violation(
      rule,
      `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` +
        `day(s) before this run — past the ${maxAge}-day limit but within the ${cure}-day cure ` +
        `window the rule allows. This reports the date the certificate carries.`,
      'document',
      certificateEvidence(certificate, found.text),
    );
  }

  return violation(
    rule,
    `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` +
      `day(s) before this run, past the ${maxAge}-day limit and the ${cure}-day cure window. This ` +
      `reports the date the certificate carries.`,
    'document',
    certificateEvidence(certificate, found.text),
  );
}

/** COA-003 — the stated purity, against a minimum. */
export function checkCoaPurity(
  rule: RuleOfType<'doc_parse'>,
  outcome: CertificateOutcome,
): Finding {
  if (!outcome.found || outcome.certificate.text === '') return unreadable(rule, outcome);
  const certificate = outcome.certificate;

  const found = findPurity(certificate.text);
  if (found === null) {
    return notEvaluable(
      rule,
      `no purity figure could be read from the certificate at ${certificate.url}. Its text was ` +
        `extracted and searched; no percentage was found near a purity or assay label.`,
      'document',
      'not_exposed',
      certificateEvidence(certificate),
    );
  }

  const min = rule.params.min ?? 0;

  if (found.value >= min) {
    return satisfied(
      rule,
      `The certificate at ${certificate.url} states ${found.text}, at or above the ${min}% the ` +
        `rule requires. This reports what the certificate states; the assay was not repeated.`,
      'document',
      certificateEvidence(certificate, found.text),
    );
  }

  return violation(
    rule,
    `The certificate at ${certificate.url} states ${found.text}, below the ${min}% the rule ` +
      `requires. This reports what the certificate states; the assay was not repeated.`,
    'document',
    certificateEvidence(certificate, found.text),
  );
}

/** COA-004 — the fields a certificate must carry. */
export function checkCoaFields(
  rule: RuleOfType<'doc_parse'>,
  outcome: CertificateOutcome,
): Finding {
  if (!outcome.found || outcome.certificate.text === '') return unreadable(rule, outcome);
  const certificate = outcome.certificate;

  const required = rule.params.require_fields ?? [];
  const present: string[] = [];
  const absent: string[] = [];
  const unimplemented: string[] = [];

  for (const field of required) {
    const pattern = FIELD_PATTERNS[field];
    if (pattern === undefined) {
      // A field the rule set names and this handler cannot look for. Reported, never counted as
      // absent — that would be our gap presented as the merchant's (D-044).
      unimplemented.push(nameOf(field));
      continue;
    }
    (pattern.test(certificate.text) ? present : absent).push(nameOf(field));
  }

  const preferred = rule.params.prefer_method;
  const methodNote =
    preferred === undefined
      ? ''
      : new RegExp(`\\b${preferred}\\b`, 'i').test(certificate.text)
        ? ` The preferred method, ${preferred}, is named.`
        : ` The preferred method, ${preferred}, is not named in the text.`;

  // Ours, and reported as ours. A field this handler cannot look for is never counted against the
  // merchant, and the sentence says which is which (D-044).
  const ourGap =
    unimplemented.length === 0
      ? ''
      : ` Mintro does not yet look for ${unimplemented.join(', ')}, so ` +
        `${unimplemented.length === 1 ? 'it was' : 'they were'} not searched for.`;

  if (absent.length === 0) {
    return satisfied(
      rule,
      `The certificate at ${certificate.url} names everything the rule requires: ` +
        `${present.join(', ')}.${methodNote}${ourGap} This reports what the certificate states.`,
      'document',
      certificateEvidence(certificate, present.join(', ')),
    );
  }

  return violation(
    rule,
    `${absent.length} of ${required.length} required item(s) were not found in the text of the ` +
      `certificate at ${certificate.url}: ${absent.join(', ')}. Found: ` +
      `${present.length === 0 ? 'none' : present.join(', ')}.${methodNote}${ourGap} ` +
      `The extracted text was searched; anything present only as an image would not be found.`,
    'document',
    certificateEvidence(certificate, absent.join(', ')),
  );
}

/**
 * The date a certificate states it was issued.
 *
 * Searched near a date label rather than anywhere in the document — a COA carries an issue date,
 * an expiry, a print date and often a batch date, and picking whichever appears first would report
 * one of those as the issue date.
 */
export function findDate(text: string): { readonly date: Date; readonly text: string } | null {
  /*
    Labels naming when the certificate was **issued** (D-058).

    COA-002 asks how recently the documentation was updated, so a report or issue date answers it
    and a sample-collection date does not. `Date Reported` is included — note the `(?:ed)?`, whose
    absence made the first version fail on exactly that label, since `\b` does not fall between
    "report" and "ed". `Date Received` and `Sampled` are deliberately excluded: accepting those
    would answer an easier question while appearing to answer this one.
  */
  const labelled =
    /\b(date\s*(?:of)?\s*(?:report(?:ed)?|issue[ds]?|analysis|test(?:ing|ed)?)|report(?:ed)?\s*date|issue[ds]?\s*date|analysis\s*date|test(?:ed)?\s*date)\b[^A-Za-z0-9]{0,12}([A-Za-z0-9 ,./-]{6,24})/i;

  const match = labelled.exec(text);
  if (match === null) return null;

  /*
    The quoted value is the date, not the window it was found in (D-060).

    The first version returned the whole 24-character capture, so the evidence slip read
    `7/22/2026 7/22/2026 Cert` — the date, a repeat of it, and the start of the next heading. This
    is a report of the merchant's document and a quoted value has to be the value: a reader
    checking the finding against the stored PDF should see the same string in both.

    So the window locates, and the date pattern extracts.
  */
  const window = (match[2] ?? '').trim();

  for (const candidate of dateTokensIn(window)) {
    const parsed = parseDate(candidate);
    // The first token that **parses**, not the first that matches. The numeric shape can match
    // `26 Batch 44` out of `July 15, 2026 Batch 44`, and only parsing tells the two apart — the
    // first draft returned the match and refused a date that was plainly there.
    if (parsed !== null) return { date: parsed, text: candidate };
  }

  return null;
}

/**
 * Date-shaped tokens inside a window, most specific shape first.
 *
 * Every match of every shape is offered, because a pattern matching is not the same as a date
 * being there — `parseDate` is the arbiter and this only supplies candidates. Tokens come back
 * exactly as the document wrote them: an evidence slip quotes, it does not normalise.
 */
function dateTokensIn(window: string): readonly string[] {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}\b/g,
    /\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/g,
    /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  ];

  return patterns.flatMap((pattern) => [...window.matchAll(pattern)].map((hit) => hit[0]));
}

function parseDate(candidate: string): Date | null {
  // ISO first: unambiguous, and what a lab's software usually emits.
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(candidate);
  if (iso !== null) {
    return valid(new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))));
  }

  const named =
    /(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})|([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/.exec(candidate);
  if (named !== null) {
    const day = Number(named[1] ?? named[5]);
    const monthName = (named[2] ?? named[4] ?? '').slice(0, 3).toLowerCase();
    const year = Number(named[3] ?? named[6]);
    const month = MONTHS.indexOf(monthName);
    if (month >= 0 && Number.isFinite(day) && Number.isFinite(year)) {
      return valid(new Date(Date.UTC(year, month, day)));
    }
  }

  /*
    Numeric with separators, parsed **only when the value itself settles the order** (D-058).

    `03/04/2026` is March 4th to a US lab and April 3rd to a European one, and COA-002 is
    `auto_fail` — a month's error either way could fail a compliant merchant, so that stays
    refused. `7/22/2026` is not ambiguous: 22 cannot be a month, so the order is determined by the
    number rather than by a guess about which lab wrote it.

    This reads the same question from the same document. It does not widen the reader to whatever
    format one certificate happened to use.
  */
  const numeric = /(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(candidate);
  if (numeric !== null) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = fullYear(Number(numeric[3]));

    // Year-first is unambiguous on its own.
    if (a > 31) return valid(new Date(Date.UTC(a, b - 1, Number(numeric[3]))));

    if (a > 12 && b <= 12) return valid(new Date(Date.UTC(year, b - 1, a))); // day/month
    if (b > 12 && a <= 12) return valid(new Date(Date.UTC(year, a - 1, b))); // month/day

    // Both 12 or under: genuinely ambiguous, and no disambiguation is defensible on a document
    // whose originating lab is unknown.
    return null;
  }

  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const valid = (date: Date): Date | null => (Number.isNaN(date.getTime()) ? null : date);

/** Two-digit years are this century. A COA from 1926 is not a case worth handling. */
const fullYear = (year: number): number => (year < 100 ? 2000 + year : year);

/** A purity percentage the certificate states, found near a purity or assay label. */
export function findPurity(text: string): { readonly value: number; readonly text: string } | null {
  const pattern = /\b(purity|assay)\b[^%\d]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/i;
  const match = pattern.exec(text);
  if (match === null) return null;

  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;

  return { value, text: `${match[1]} ${value}%` };
}
