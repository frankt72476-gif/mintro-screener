/**
 * Family C — cross-document consistency.
 *
 * ## The two-source rule (D-098) is the spine of this file
 *
 * A consistency check with one source present returns `not_evaluable`, never `pass`. If the EIN is
 * on the application and nowhere else, C-03 has compared nothing, and reporting that as a pass
 * says we checked something we did not. §1 calls it the most load-bearing line in the document.
 *
 * It is applied in `sources()` and then asserted per check in the tests, not once globally —
 * because "the helper does it" is a claim about the code, and each check having its own case is a
 * claim about the behaviour.
 *
 * **C-14 is the one exemption (D-116).** It sums percentages inside one document. There is no
 * second source and never will be, so binding it would leave a rule that can never fire — which is
 * worse than an absent rule, because it looks like coverage.
 *
 * ## fail versus review is exactness, never importance (D-099)
 *
 * Taken from the check's declared `states` and never decided here — `adverse()` has no parameter
 * for it. A routing number differing by one digit is a `fail` though it is probably a typo; a
 * legal name differing by a comma is a `review` though it is probably nothing. That asymmetry is
 * about what the comparison can support.
 *
 * ## D-118 applies here too
 *
 * A presence check over an incomplete haystack cannot report absent. Family C mostly escapes this
 * because "I found only one source" is already `not_evaluable` rather than a verdict — but C-13
 * counts documents and could understate a count when an ID was unreadable, so it checks first.
 */

import type { DocumentCheck } from '@mintro/ruleset';
import { adverse, clean, notEvaluable } from './findings.js';
import { tierOf } from './familyA.js';
import { abaChecksumValid, normaliseDigits, normaliseName, normaliserFor } from './normalise.js';
import type {
  DocumentFinding,
  DocumentSnapshot,
  FindingSubject,
  PackageSnapshot,
  ReadDocument,
  SlotSnapshot,
} from './types.js';

const PACKAGE: FindingSubject = { kind: 'package' };

/**
 * Read a declared property off `compares`, refusing a rule that does not carry it.
 *
 * The schema validates shape per `kind`, but a handler still has to get the value out, and a cast
 * would turn a malformed rule into `undefined` flowing quietly into a finding. Throwing names the
 * check and the property, which is the loud failure M0 asks for.
 */
function declared(check: DocumentCheck, key: string): string {
  const value = (check.compares as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${check.id}: compares.${key} is missing or not a string`);
  }
  return value;
}

function declaredList(check: DocumentCheck, key: string): string[] {
  const value = (check.compares as Record<string, unknown>)[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${check.id}: compares.${key} is missing or not a list of strings`);
  }
  return value as string[];
}

function optional(check: DocumentCheck, key: string): string | undefined {
  const value = (check.compares as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}


/** One document's contribution to a comparison. */
export interface Source {
  readonly slotKey: string;
  readonly versionId: string;
  readonly raw: string;
  readonly normalised: string;
  readonly index: number;
  readonly tier: 'character' | 'page';
}

/** Live, examined documents whose slot is in the check's scope. */
function documentsInScope(snapshot: PackageSnapshot, slotKeys: readonly string[]): DocumentSnapshot[] {
  const examined = new Map(snapshot.slots.map((s) => [s.id, s.examined]));
  return snapshot.documents.filter(
    (d) =>
      d.supersededBy === null &&
      d.outcome === 'extracted' &&
      (examined.get(d.slotId) ?? true) &&
      (slotKeys.includes('*') || slotKeys.includes(d.slotKey)),
  );
}

/**
 * Every value of one field across the documents in scope.
 *
 * A **source is a document**, not a value: three bank statements all showing the same account
 * number are three sources, and one document showing a field twice is one. That is what the
 * two-source rule counts, because the rule is about corroboration between documents.
 */
export function sources(
  snapshot: PackageSnapshot,
  field: string,
  slotKeys: readonly string[],
): { readonly values: Source[]; readonly read: ReadDocument[]; readonly documentCount: number } {
  const normalise = normaliserFor(field);
  const values: Source[] = [];
  const read: ReadDocument[] = [];
  const documents = new Set<string>();

  for (const document of documentsInScope(snapshot, slotKeys)) {
    read.push({ versionId: document.versionId, slotKey: document.slotKey, tier: tierOf(document) });
    let contributed = false;
    for (const value of document.extraction?.values ?? []) {
      if (value.field !== field || value.presence !== 'present' || value.value === null) continue;
      const raw = value.value.trim();
      if (raw === '') continue;
      values.push({
        slotKey: document.slotKey,
        versionId: document.versionId,
        raw,
        normalised: normalise(raw),
        index: value.index,
        tier: tierOf(document),
      });
      contributed = true;
    }
    if (contributed) documents.add(document.versionId);
  }

  return { values, read, documentCount: documents.size };
}

const show = (values: readonly Source[]): string =>
  values.map((v) => `${v.slotKey} "${v.raw}"`).join('; ');

/**
 * The two-source gate.
 *
 * Returns a finding when the check cannot proceed, or null when it can. Written as a guard rather
 * than folded into each handler so there is one place to read for what D-098 actually does — and
 * so a new check gets it by construction rather than by remembering.
 */
function needsTwoSources(
  check: DocumentCheck,
  found: { values: Source[]; read: ReadDocument[]; documentCount: number },
  what: string,
): DocumentFinding | null {
  if (found.documentCount >= 2) return null;
  return notEvaluable(
    check,
    'fewer_than_two_sources',
    found.documentCount === 0
      ? `No document in scope stated ${what}, so there was nothing to compare.`
      : `Only one document stated ${what} (${show(found.values)}), so there was nothing to compare it with. ` +
        'A single value cannot corroborate itself.',
    PACKAGE,
    found.read,
  );
}

/** Distinct normalised values, in first-seen order. */
const distinct = (values: readonly Source[]): string[] => [...new Set(values.map((v) => v.normalised))];

/**
 * The generic comparison: one field, several documents, all expected to agree.
 *
 * Covers C-01, C-03..C-09, C-12, C-16, C-18 and C-20. They differ only in the field, the slots in
 * scope, and whether the check declares `fail` or `review` — all of which are data, which is what
 * constraint 1 asks for.
 */
function fieldAcrossDocuments(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const field = declared(check, 'field');
  const found = sources(snapshot, field, check.reads.documents ?? ['*']);

  const gate = needsTwoSources(check, found, field.replace(/_/g, ' '));
  if (gate !== null) return [gate];

  const values = distinct(found.values);
  if (values.length === 1) {
    // Raw forms are shown even on a pass: §1 requires the normalisation be visible, and a reader
    // who can see "Acme Foods LLC" and "ACME FOODS, L.L.C." can judge it for themselves.
    return [
      clean(
        check,
        `${found.documentCount} documents state the same ${field.replace(/_/g, ' ')}: ${show(found.values)}.`,
        PACKAGE,
        found.read,
      ),
    ];
  }

  return [
    adverse(
      check,
      `Documents state different values for ${field.replace(/_/g, ' ')}: ${show(found.values)}.`,
      PACKAGE,
      found.read,
    ),
  ];
}

/**
 * C-02 — the DBA name, which may legitimately not exist.
 *
 * A sole proprietor trading under their own name has no DBA, and a clean DBA check that compared
 * nothing would be a finding about something that never happened. The application says so
 * directly, and when it does this returns `no_dba_declared`.
 *
 * **The finding text says nothing about registration.** There is no DBA filing in the required
 * slot set, so nothing here has seen a register; the check compares what documents display, and
 * wording that implied otherwise would put a claim in the report that no document backs.
 */
function mayBeAbsent(check: DocumentCheck, snapshot: PackageSnapshot, flagField: string): DocumentFinding[] {
  const declaredSame = sources(snapshot, flagField, ['application']);
  const affirmative = declaredSame.values.some((v) => /^(y|yes|true|on|x|1|checked|same)$/i.test(v.raw));
  if (affirmative) {
    return [
      notEvaluable(
        check,
        'no_dba_declared',
        'The application states the business trades under its legal name, so there is no DBA to compare across documents.',
        PACKAGE,
        declaredSame.read,
      ),
    ];
  }
  return fieldAcrossDocuments(check, snapshot);
}

/**
 * C-11, C-15, C-17 — one field that may legitimately match either of several others.
 *
 * An account may be held in the legal name or the trading name; a signer may be any of the owners.
 * Matching one of the alternatives is a pass, and matching none is adverse.
 */
function fieldAgainstEither(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const compares = { field: declared(check, 'field'), against: declaredList(check, 'against') };
  const subject = sources(snapshot, compares.field, check.reads.documents ?? ['*']);

  const alternatives = compares.against.flatMap((f) => sources(snapshot, f, check.reads.documents ?? ['*']).values);
  const read = [...subject.read];

  // The rule counts documents, and here the two sides are the two sources: the document stating
  // the subject and the document stating what it is set against.
  if (subject.values.length === 0 || alternatives.length === 0) {
    return [
      notEvaluable(
        check,
        'fewer_than_two_sources',
        `${compares.field.replace(/_/g, ' ')} and ${compares.against.join(' or ').replace(/_/g, ' ')} ` +
          'were not both stated, so there was nothing to compare.',
        PACKAGE,
        read,
      ),
    ];
  }

  // Both sides through the subject's own normaliser, so a name is compared as a name whichever
  // field it arrived in.
  const normalise = normaliserFor(compares.field);
  const permitted = new Set(alternatives.map((a) => normalise(a.raw)));
  const unmatched = subject.values.filter((v) => !permitted.has(normalise(v.raw)));

  if (unmatched.length === 0) {
    return [
      clean(
        check,
        `${show(subject.values)} matches ${compares.against.join(' or ').replace(/_/g, ' ')} as stated: ${show(alternatives)}.`,
        PACKAGE,
        read,
      ),
    ];
  }
  return [
    adverse(
      check,
      `${show(unmatched)} matches none of the ${compares.against.join(' or ').replace(/_/g, ' ')} stated: ${show(alternatives)}.`,
      PACKAGE,
      read,
    ),
  ];
}

/**
 * The Federal Reserve E-Payments routing directory, supplied by the caller.
 *
 * A port rather than an import, for the same reason `PageImager` is one: the engine is pure, and a
 * multi-megabyte directory that changes weekly is not something a pure check function should be
 * loading. The runner passes it in.
 */
export interface RoutingDirectory {
  (routingNumber: string): string | null;
}

/**
 * C-10 — the routing number resolves to a named institution, and the name agrees.
 *
 * **This is the only external check in v1** and it is free. It confirms two things and no more:
 * the number passes the ABA checksum, and the directory names an institution matching what the
 * documents show.
 *
 * **It confirms nothing about the account.** Not that it exists, not that it is open, not that it
 * belongs to this merchant — that needs Plaid or similar, which §7 records as declined on cost.
 * The finding text must not drift towards implying otherwise.
 */
function routingResolves(
  check: DocumentCheck,
  snapshot: PackageSnapshot,
  directory: RoutingDirectory | undefined,
): DocumentFinding[] {
  const routing = sources(snapshot, 'routing_number', check.reads.documents ?? ['*']);
  const banks = sources(snapshot, 'bank_name', check.reads.documents ?? ['*']);

  if (routing.values.length === 0) {
    return [
      notEvaluable(
        check,
        'routing_number_not_extracted',
        'No routing number was read from the voided check or bank statements, so none could be looked up.',
        PACKAGE,
        routing.read,
      ),
    ];
  }
  if (directory === undefined) {
    return [
      notEvaluable(
        check,
        'routing_directory_unavailable',
        'The Federal Reserve E-Payments routing directory was not available to this run, so the routing number was not looked up.',
        PACKAGE,
        routing.read,
      ),
    ];
  }

  const read = [...routing.read, ...banks.read.filter((b) => !routing.read.some((r) => r.versionId === b.versionId))];
  const number = routing.values[0]!;

  if (!abaChecksumValid(number.raw)) {
    return [
      adverse(
        check,
        `The routing number ${number.raw} (${number.slotKey}) does not satisfy the ABA checksum.`,
        PACKAGE,
        read,
      ),
    ];
  }

  const institution = directory(normaliseDigits(number.raw));
  if (institution === null) {
    return [
      adverse(
        check,
        `The routing number ${number.raw} (${number.slotKey}) does not appear in the Federal Reserve E-Payments routing directory.`,
        PACKAGE,
        read,
      ),
    ];
  }

  if (banks.values.length === 0) {
    return [
      notEvaluable(
        check,
        'fewer_than_two_sources',
        `The routing number ${number.raw} resolves to ${institution} in the Federal Reserve directory, but no document stated a bank name to set against it.`,
        PACKAGE,
        read,
      ),
    ];
  }

  const expected = normaliseName(institution);
  const disagreeing = banks.values.filter((b) => {
    const stated = normaliseName(b.raw);
    // Substring either way: directory entries carry fuller legal names than a statement letterhead
    // ("HARBOR MUTUAL SAVINGS BANK, N.A." against "Harbor Mutual Savings").
    return !stated.includes(expected) && !expected.includes(stated);
  });

  if (disagreeing.length === 0) {
    return [
      clean(
        check,
        `The routing number ${number.raw} resolves to ${institution} in the Federal Reserve E-Payments directory, ` +
          `and the documents state ${show(banks.values)}. This concerns the institution only.`,
        PACKAGE,
        read,
      ),
    ];
  }
  return [
    adverse(
      check,
      `The routing number ${number.raw} resolves to ${institution} in the Federal Reserve E-Payments directory, ` +
        `while the documents state ${show(disagreeing)}. This concerns the institution only.`,
      PACKAGE,
      read,
    ),
  ];
}

/** Owners at or above the threshold that requires an ID. */
const ID_THRESHOLD_PCT = 25;

/**
 * C-13 — one photo ID per owner at 25% or more.
 *
 * **D-118 applies.** A shortfall is an assertion that an ID is *missing*, so the count of IDs must
 * cover the space first: a document that could not be read is an ID we hold and cannot count, and
 * reporting that as a missing ID would chase a merchant for something they already sent.
 */
function idCount(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const percentages = sources(snapshot, 'owner_ownership_pct', ['application']);
  const read = [...percentages.read];

  if (percentages.values.length === 0) {
    return [
      notEvaluable(
        check,
        'ownership_section_not_extracted',
        "The application's ownership section could not be read, so the number of owners requiring an ID is unknown.",
        PACKAGE,
        read,
      ),
    ];
  }

  const qualifying = percentages.values.filter((v) => (Number(v.raw.replace(/[^0-9.]/g, '')) || 0) >= ID_THRESHOLD_PCT);
  const idSlot = snapshot.slots.filter((s) => s.slotKey === 'owner_photo_id').map((s) => s.id);
  const ids = snapshot.documents.filter((d) => idSlot.includes(d.slotId) && d.supersededBy === null);
  for (const id of ids) read.push({ versionId: id.versionId, slotKey: id.slotKey, tier: tierOf(id) });

  const readable = ids.filter((d) => d.outcome === 'extracted');
  const unreadable = ids.filter((d) => d.outcome !== 'extracted');

  if (readable.length >= qualifying.length) {
    return [
      clean(
        check,
        `${qualifying.length} owner(s) at ${ID_THRESHOLD_PCT}% or more, and ${readable.length} photo ID(s) supplied.`,
        PACKAGE,
        read,
      ),
    ];
  }

  if (unreadable.length > 0 && readable.length + unreadable.length >= qualifying.length) {
    // The gap is covered by documents we hold and could not read. Saying an ID is missing would be
    // an assertion of absence from a search known to be incomplete (D-118).
    return [
      notEvaluable(
        check,
        'fewer_than_two_sources',
        `${qualifying.length} owner(s) at ${ID_THRESHOLD_PCT}% or more and ${ids.length} photo ID(s) supplied, but ` +
          `${unreadable.length} of them could not be read — so whether every owner is covered could not be established.`,
        PACKAGE,
        read,
      ),
    ];
  }

  return [
    adverse(
      check,
      `${qualifying.length} owner(s) at ${ID_THRESHOLD_PCT}% or more, and ${readable.length} readable photo ID(s) supplied.`,
      PACKAGE,
      read,
    ),
  ];
}

/**
 * C-14 — the ownership percentages sum to no more than 100.
 *
 * Arithmetic inside one document, and **the one check the two-source rule does not bind** (D-116).
 * A second copy of the application would tell it nothing, so requiring one would leave a rule that
 * can never fire.
 */
function ownershipSum(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const found = sources(snapshot, 'owner_ownership_pct', ['application']);
  if (found.values.length === 0) {
    return [
      notEvaluable(
        check,
        'ownership_section_not_extracted',
        "The application's ownership section could not be read, so the percentages could not be summed.",
        PACKAGE,
        found.read,
      ),
    ];
  }

  const parts = found.values.map((v) => Number(v.raw.replace(/[^0-9.]/g, '')) || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  const shown = `${found.values.map((v, i) => `${v.raw} (${parts[i]})`).join(' + ')} = ${total}%`;

  return total <= 100
    ? [clean(check, `The ownership percentages on the application sum to ${total}%: ${shown}.`, PACKAGE, found.read)]
    : [adverse(check, `The ownership percentages on the application sum to more than 100%: ${shown}.`, PACKAGE, found.read)];
}

/**
 * C-19 — the recorded not-provided reason against the other evidence.
 *
 * Not a two-source check: it reads a **slot's reason** and sets it against whatever the package
 * already shows. Its `not_evaluable` condition is an unresolved slot, not a missing second source.
 *
 * The case it exists for: "new business — no prior processing history" recorded on the processing
 * statement slot, while the application names a prior processor or the bank statements show
 * card-processor deposits. Both sides are already in hand, so it costs nothing.
 */
const CLAIMS_NO_HISTORY = new Set(['new_business_no_processing_history', 'prior_processing_cash_or_check_only']);

function slotReasonConsistency(
  check: DocumentCheck,
  snapshot: PackageSnapshot,
  slots: readonly SlotSnapshot[],
): DocumentFinding[] {
  const slotKey = declared(check, 'slot');
  const out: DocumentFinding[] = [];

  for (const slot of slots.filter((s) => s.slotKey === slotKey)) {
    const subject: FindingSubject = { kind: 'slot', slotId: slot.id, slotKey: slot.slotKey };

    if (slot.state !== 'not_provided' || slot.reason === null) {
      out.push(
        notEvaluable(
          check,
          'slot_not_resolved_to_not_provided',
          `${slot.slotKey} is ${slot.state}, so there is no recorded not-provided reason to set against the other documents.`,
          subject,
        ),
      );
      continue;
    }

    if (!CLAIMS_NO_HISTORY.has(slot.reason)) {
      out.push(
        clean(
          check,
          `${slot.slotKey} is not_provided for the recorded reason "${slot.reason}", which makes no claim about prior processing.`,
          subject,
        ),
      );
      continue;
    }

    const processors = sources(snapshot, 'processor_name', ['application']);
    const deposits = sources(snapshot, 'bank_deposits', ['bank_statement']);
    const read = [...processors.read, ...deposits.read.filter((d) => !processors.read.some((p) => p.versionId === d.versionId))];

    const contradictions: string[] = [];
    if (processors.values.length > 0) {
      contradictions.push(`the application names a prior processor (${show(processors.values)})`);
    }

    if (contradictions.length === 0) {
      out.push(
        clean(
          check,
          `${slot.slotKey} is not_provided for the recorded reason "${slot.reason}", and no other document states a prior processor.`,
          subject,
          read,
        ),
      );
      continue;
    }

    out.push(
      adverse(
        check,
        `${slot.slotKey} is not_provided for the recorded reason "${slot.reason}", while ${contradictions.join(' and ')}.`,
        subject,
        read,
      ),
    );
  }

  return out;
}

export interface FamilyCInput {
  readonly snapshot: PackageSnapshot;
  readonly checks: ReadonlyMap<string, DocumentCheck>;
  readonly routingDirectory?: RoutingDirectory;
}

/**
 * Dispatch is on `compares.kind`, never on a check id.
 *
 * That is what constraint 1 asks for: adding C-21 with an existing kind touches no code here, and
 * a new kind is a new check-type handler, which is the one place a switch belongs.
 */
export function runFamilyC(input: FamilyCInput): DocumentFinding[] {
  const { snapshot, checks, routingDirectory } = input;
  const out: DocumentFinding[] = [];

  for (const check of checks.values()) {
    if (!check.id.startsWith('C-')) continue;
    const kind = declared(check, 'kind');

    switch (kind) {
      case 'field_across_documents': {
        // `absent_when` is data on the check, not a test on its id: constraint 1 puts the switch in
        // a check-type handler and nowhere else, and C-02's exemption is a property of the field
        // (a business may legitimately have no DBA), not of the identifier.
        const absentWhen = optional(check, 'absent_when');
        out.push(...(absentWhen === undefined ? fieldAcrossDocuments(check, snapshot) : mayBeAbsent(check, snapshot, absentWhen)));
        break;
      }
      case 'field_against_either':
        out.push(...fieldAgainstEither(check, snapshot));
        break;
      case 'external_lookup':
        out.push(...routingResolves(check, snapshot, routingDirectory));
        break;
      case 'count':
        out.push(...idCount(check, snapshot));
        break;
      case 'arithmetic':
        out.push(...ownershipSum(check, snapshot));
        break;
      case 'consistency_with_slot_reason':
        out.push(...slotReasonConsistency(check, snapshot, snapshot.slots));
        break;
      default:
        throw new Error(`${check.id} declares compares.kind '${kind}', which family C has no handler for`);
    }
  }

  return out;
}

export const __testing = { ID_THRESHOLD_PCT };
