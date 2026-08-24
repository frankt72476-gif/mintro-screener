/**
 * Family A — document integrity, one finding per document per check.
 *
 * Every check here reads exactly one document, so every finding's tier is that document's tier.
 * Family A is where the tier machinery is simplest and family C is where it earns its keep.
 *
 * **Scope is per check and lives in the handler.** A-03 asks whether a PDF is password-protected
 * and has nothing to say about a JPEG; A-06 asks about expiry and applies to IDs and licences.
 * Running them over documents they do not concern would produce a `pass` on a question that was
 * never asked, which reads in a report exactly like a question that was asked and answered.
 */

import type { DocumentCheck } from '@mintro/ruleset';
import type { Tier } from '@mintro/extraction';
import { adverse, clean, notEvaluable } from './findings.js';
import type { DocumentFinding, DocumentSnapshot, FindingSubject, PackageSnapshot, ReadDocument, SlotSnapshot } from './types.js';

/**
 * The tier a document actually came back at.
 *
 * Read off what happened, not off the catalog's `typical_tier`: a scanned EIN letter and a
 * text-layer one are the same catalog entry and different evidence. A document with no readable
 * page is page tier by default — the weaker claim, which is the safe direction when the thing we
 * are unsure about is how good our evidence is.
 */
export function tierOf(document: DocumentSnapshot): Tier {
  const pages = document.extraction?.pages ?? [];
  if (pages.length === 0) return 'page';
  return pages.some((p) => p.route === 'vision' || p.route === 'none') ? 'page' : 'character';
}

const reading = (document: DocumentSnapshot): ReadDocument[] => [
  { versionId: document.versionId, slotKey: document.slotKey, tier: tierOf(document) },
];

const subjectOf = (document: DocumentSnapshot): FindingSubject => ({
  kind: 'document',
  documentId: document.documentId,
  versionId: document.versionId,
  slotKey: document.slotKey,
});

const name = (document: DocumentSnapshot): string =>
  document.originalFilename ?? `${document.slotKey} v${document.version}`;

/** `page N of M` markers, parsed out of what extraction found. */
function pageMarkers(document: DocumentSnapshot): { seen: number[]; declaredTotal: number | null } {
  const seen: number[] = [];
  let declaredTotal: number | null = null;
  for (const value of document.extraction?.values ?? []) {
    if (value.field !== 'page_marker' || value.value === null) continue;
    const match = /(\d{1,4})\s+of\s+(\d{1,4})|page\s*(\d{1,4})\s*\/\s*(\d{1,4})/i.exec(value.value);
    if (match === null) continue;
    const n = Number(match[1] ?? match[3]);
    const total = Number(match[2] ?? match[4]);
    if (Number.isFinite(n)) seen.push(n);
    if (Number.isFinite(total)) declaredTotal = total;
  }
  return { seen, declaredTotal };
}

function firstValue(document: DocumentSnapshot, field: string): string | null {
  for (const value of document.extraction?.values ?? []) {
    if (value.field === field && value.presence === 'present' && value.value !== null) return value.value;
  }
  return null;
}

/** A date extraction produced, parsed leniently. `null` when it is not a date we can order. */
function asDate(text: string | null): Date | null {
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * A-01 — did anything come back?
 *
 * **Never not_evaluable, and the reason is worth keeping in front of a reader.** We attempted the
 * read, so unreadability is a fact we established rather than one we failed to establish. That is
 * a `fail` here, and a named `not_evaluable` cause for every downstream check that wanted this
 * document. Under D-092 the file resolved to a recorded outcome either way.
 */
function a01(check: DocumentCheck, document: DocumentSnapshot): DocumentFinding {
  const subject = subjectOf(document);
  const read = reading(document);

  if (document.outcome === 'extracted') {
    const pages = document.extraction?.pages.length ?? 0;
    return clean(check, `${name(document)} was read; ${pages} page(s) yielded content.`, subject, read);
  }
  const why = document.outcomeReason ?? document.outcome;
  return adverse(check, `${name(document)} yielded no readable content: ${why}`, subject, read);
}

/** A-02 — do the page markers describe a complete document? */
function a02(check: DocumentCheck, document: DocumentSnapshot): DocumentFinding {
  const subject = subjectOf(document);
  const read = reading(document);
  const { seen, declaredTotal } = pageMarkers(document);

  if (seen.length === 0 || declaredTotal === null) {
    return notEvaluable(
      check,
      'page_numbering_absent',
      `${name(document)} carries no "page N of M" numbering, so the declared range cannot be compared with what was supplied.`,
      subject,
      read,
    );
  }

  const present = new Set(seen);
  const missing: number[] = [];
  for (let n = 1; n <= declaredTotal; n++) if (!present.has(n)) missing.push(n);

  if (missing.length === 0) {
    return clean(check, `${name(document)} declares ${declaredTotal} page(s) and all are present.`, subject, read);
  }
  return adverse(
    check,
    `${name(document)} declares ${declaredTotal} page(s); page(s) ${missing.join(', ')} are not among those supplied.`,
    subject,
    read,
  );
}

/** A-03 — PDFs only. A JPEG cannot be password-protected and is not asked. */
function a03(check: DocumentCheck, document: DocumentSnapshot): DocumentFinding | null {
  if (document.detectedType !== 'pdf') return null;
  const subject = subjectOf(document);
  const read = reading(document);

  return document.outcome === 'encrypted'
    ? adverse(check, `${name(document)} requires a password and could not be opened.`, subject, read)
    : clean(check, `${name(document)} opened without a password.`, subject, read);
}

/**
 * A-04 — does the document carry the markers of the slot it was filed in?
 *
 * **Deliberately weak, and the note must never read otherwise.** There is no classifier and none
 * is being built. This catches the W-9 filed into the EIN Letter slot. It says nothing about
 * whether a document is what it claims to be beyond the presence of a marker, and the copy audit
 * refuses any note that suggests otherwise.
 */
function a04(check: DocumentCheck, document: DocumentSnapshot, markers: readonly string[] | undefined): DocumentFinding {
  const subject = subjectOf(document);
  const read = reading(document);

  if (markers === undefined || markers.length === 0) {
    return notEvaluable(
      check,
      'no_marker_set_for_type',
      `No marker set is defined for ${document.slotKey}, so ${name(document)} was not compared against one.`,
      subject,
      read,
    );
  }

  const values = document.extraction?.values ?? [];
  const haystack = normaliseForMarkers(
    values
      .map((v) => `${v.field} ${v.value ?? ''}`)
      .concat(values.map((v) => ('snippet' in v.provenance ? v.provenance.snippet : '')))
      .join(' '),
  );

  const found = markers.filter((m) => haystack.includes(normaliseForMarkers(m)));

  // Finding one is conclusive whatever else was searched: a partial search is enough to prove
  // presence. This branch is therefore reached before the completeness test, deliberately.
  if (found.length > 0) {
    return clean(
      check,
      `${name(document)} carries ${found.length === 1 ? 'the marker' : 'markers'} ${found.map((m) => `"${m}"`).join(', ')}, expected for ${document.slotKey}.`,
      subject,
      read,
    );
  }

  // Nothing found — and now it matters whether we could have found it (D-118). A presence check
  // over an incomplete haystack cannot report absent, because it never established that its search
  // covered the space.
  const gap = unsearchablePages(document);
  if (gap !== null) {
    return notEvaluable(
      check,
      'markers_not_searchable',
      `${name(document)} carries none of the markers expected for ${document.slotKey}, but ${gap} — ` +
        'so the text those pages show was never part of what was searched, and their absence from ' +
        'the search is not evidence of their absence from the document.',
      subject,
      read,
    );
  }

  return adverse(
    check,
    `${name(document)} carries none of the markers expected for ${document.slotKey} (${markers.map((m) => `"${m}"`).join(', ')}).`,
    subject,
    read,
  );
}

/**
 * Fold away the difference between how a document is referred to and how it is printed.
 *
 * A real notice prints "CP 575 A"; the marker was written "CP-575", which is the form's name in
 * prose. Stripping everything that is not a letter or a digit makes those the same string, along
 * with case and any run of spacing. Deliberately blunt: A-04 is a weak check by design (D-117),
 * and the cost of an over-eager match here is a `pass` on a document that was going to be examined
 * by every other check anyway.
 */
function normaliseForMarkers(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Whether any page's text was outside the search, and if so, how to say it.
 *
 * `text` and `form` pages put their content into values and snippets, so what was searched is what
 * the page says. A `vision` page does not: D-100 stops page tier at the page, so there are no
 * snippets, and the prompt closes the vocabulary — "Report only the field ids listed above" — so
 * anything that is not a field we asked for never leaves the model. A `none` page was not read at
 * all. Both are holes in the haystack.
 */
function unsearchablePages(document: DocumentSnapshot): string | null {
  const pages = document.extraction?.pages ?? [];
  if (pages.length === 0) return 'no page of it was read';

  const vision = pages.filter((p) => p.route === 'vision').map((p) => p.page);
  const unread = pages.filter((p) => p.route === 'none').map((p) => p.page);
  if (vision.length === 0 && unread.length === 0) return null;

  const parts: string[] = [];
  if (vision.length > 0) {
    parts.push(
      `page(s) ${vision.join(', ')} were read by the vision route, which returns only the fields it ` +
        'is asked for and no page text',
    );
  }
  if (unread.length > 0) parts.push(`page(s) ${unread.join(', ')} were not read at all`);
  return parts.join(' and ');
}

/**
 * A-05 — a signature and a date.
 *
 * **The `fail` branch is currently unreachable and that is honest rather than broken.** Extraction
 * can read a signature *date*; it cannot locate a signature *block*. So a document with a date is
 * a `pass`, and a document without one could be either an unsigned document or a document whose
 * signature block we never found — and we cannot tell which. Constraint 2 says the answer to that
 * is `not_evaluable`, not `fail`. See the build report.
 */
function a05(check: DocumentCheck, document: DocumentSnapshot): DocumentFinding {
  const subject = subjectOf(document);
  const read = reading(document);
  const signed = firstValue(document, 'signature_date');

  if (signed === null) {
    return notEvaluable(
      check,
      'signature_block_not_located',
      `No signature block was located in ${name(document)}, so whether one was completed could not be observed.`,
      subject,
      read,
    );
  }
  return clean(check, `${name(document)} carries a signature date of ${signed}.`, subject, read);
}

/** A-06 — expiry after the run. IDs and licences; nothing else expires. */
function a06(check: DocumentCheck, document: DocumentSnapshot, runAt: Date): DocumentFinding | null {
  if (!(check.reads.documents ?? []).includes(document.slotKey)) return null;
  const subject = subjectOf(document);
  const read = reading(document);
  const expiry = asDate(firstValue(document, 'expiry_date'));

  if (expiry === null) {
    return notEvaluable(
      check,
      'expiry_not_extracted',
      `No expiry date was read from ${name(document)}.`,
      subject,
      read,
    );
  }
  return expiry > runAt
    ? clean(check, `${name(document)} expires ${iso(expiry)}, after the run on ${iso(runAt)}.`, subject, read)
    : adverse(check, `${name(document)} expired ${iso(expiry)}, before the run on ${iso(runAt)}.`, subject, read);
}

/**
 * A-07 — is this document's own period inside its slot's window?
 *
 * Per document, where B-04 is per slot. The distinction matters: a statement from last year in a
 * slot that is otherwise fully covered is an observation about that document, and B-04 would not
 * mention it because the slot's required months are all satisfied by the others.
 */
function a07(
  check: DocumentCheck,
  document: DocumentSnapshot,
  slot: SlotSnapshot | undefined,
  runAt: Date,
): DocumentFinding | null {
  if (!(check.reads.documents ?? []).includes(document.slotKey)) return null;
  const subject = subjectOf(document);
  const read = reading(document);
  const period = firstValue(document, 'statement_period');

  if (period === null) {
    return notEvaluable(
      check,
      'date_not_extracted',
      `No statement period was read from ${name(document)}.`,
      subject,
      read,
    );
  }
  if (slot === undefined || !slot.monthly) {
    return clean(check, `${name(document)} states a period of ${period}; its slot sets no window.`, subject, read);
  }

  const parsed = asDate(period);
  if (parsed === null) {
    return notEvaluable(
      check,
      'date_not_extracted',
      `${name(document)} states a period of "${period}", which could not be read as a date.`,
      subject,
      read,
    );
  }

  const ageDays = Math.floor((runAt.getTime() - parsed.getTime()) / 86_400_000);
  // Three months of grace beyond the slot's own, because a slot asking for three consecutive
  // months legitimately holds documents two months older than the newest one.
  const outerLimit = slot.graceDays + 31 * (slot.requiredCount ?? 1);
  return ageDays <= outerLimit
    ? clean(check, `${name(document)} states a period of ${period}, inside the window its slot covers.`, subject, read)
    : adverse(
        check,
        `${name(document)} states a period of ${period}, ${ageDays} days before the run — outside the ${outerLimit}-day span its slot covers.`,
        subject,
        read,
      );
}

export interface FamilyAInput {
  readonly snapshot: PackageSnapshot;
  readonly checks: ReadonlyMap<string, DocumentCheck>;
  /** Marker sets by slot key, from the catalog. Absent means A-04 is not evaluable for that type. */
  readonly markers: ReadonlyMap<string, readonly string[]>;
}

/**
 * Run family A over every live, examined document.
 *
 * **Superseded versions are not re-checked.** They remain readable for ever (D-097), and a run
 * asserting that a replaced document has an expired date would put a finding in a report about a
 * document the merchant already corrected. The version that counts is the live one.
 *
 * **Collected-only documents are not checked at all** (D-082). Present-not-examined means no
 * finding, which is different from a finding that passed.
 */
export function runFamilyA(input: FamilyAInput): DocumentFinding[] {
  const { snapshot, checks, markers } = input;
  const slots = new Map(snapshot.slots.map((s) => [s.id, s]));
  const out: DocumentFinding[] = [];

  for (const document of snapshot.documents) {
    if (document.supersededBy !== null) continue;
    const slot = slots.get(document.slotId);
    if (slot !== undefined && !slot.examined) continue;

    const push = (finding: DocumentFinding | null): void => {
      if (finding !== null) out.push(finding);
    };

    const get = (id: string): DocumentCheck | undefined => checks.get(id);
    const a01Check = get('A-01');
    if (a01Check) push(a01(a01Check, document));

    // Everything after A-01 depends on the document having been read. A-01 already recorded the
    // failure; repeating it as five more findings would be five copies of one observation.
    if (document.outcome !== 'extracted') {
      const a03Check = get('A-03');
      if (a03Check) push(a03(a03Check, document));
      continue;
    }

    const a02Check = get('A-02');
    if (a02Check) push(a02(a02Check, document));
    const a03Check = get('A-03');
    if (a03Check) push(a03(a03Check, document));
    const a04Check = get('A-04');
    if (a04Check) push(a04(a04Check, document, markers.get(document.slotKey)));
    const a05Check = get('A-05');
    if (a05Check) push(a05(a05Check, document));
    const a06Check = get('A-06');
    if (a06Check) push(a06(a06Check, document, snapshot.runAt));
    const a07Check = get('A-07');
    if (a07Check) push(a07(a07Check, document, slot, snapshot.runAt));
  }

  return out;
}
