/**
 * Family D — derived figures against stated figures.
 *
 * ## Every finding reports three things and judges none of them
 *
 * The derived value, the stated value, and the derivation with its source pages. Never a judgement
 * about the gap. *"The application states $250,000; three months of processing statements imply
 * $412,000"* is the finding, and the reader draws the conclusion.
 *
 * Anything resembling "understated", "inflated", "misrepresented" or "discrepancy of concern" is
 * IQwallet's to decide and not ours to write (D-001). `findings.ts` audits the note against
 * `FINDING_TERMS` and throws, so this is enforced rather than remembered — but the wording still
 * has to be got right here, because the audit catches determinations, not insinuation.
 *
 * ## Not provided is carried through, not flattened
 *
 * Where the processing statement slot is `not_provided`, D-01 through D-04 return `not_evaluable`
 * **with the recorded reason in the text** — "not evaluated: no processing statements, new
 * business". That is the whole reason D-078 kept `not_provided` distinct from `waived`: a merchant
 * with no processing history and a merchant whose statements nobody asked for are different
 * situations, and a report that renders both as a blank has thrown the difference away.
 *
 * ## D-05 and D-06 are deferred (§6)
 *
 * They exist in `rules/documents.checks.json` marked `deferred`, and `runDocumentChecks` filters to
 * `v1` before any handler sees them. There is deliberately no handler here: a deferred check that
 * quietly worked would put findings from an unreleased rule into a report.
 */

import type { DocumentCheck } from '@mintro/ruleset';
import { adverse, clean, notEvaluable } from './findings.js';
import { tierOf } from './familyA.js';
import { normaliseAmount } from './normalise.js';
import { sources, type Source } from './familyC.js';
import type { DocumentFinding, FindingSubject, PackageSnapshot, ReadDocument } from './types.js';

const PACKAGE: FindingSubject = { kind: 'package' };

/**
 * The first of these conditions the check actually declares.
 *
 * Throws rather than guessing: a family D check that declares none of them cannot describe the
 * situation it is in, and that is a malformed rule, which M0 says to fail loudly on.
 */
function firstDeclared(check: DocumentCheck, candidates: readonly string[]): string {
  const found = candidates.find((c) => check.not_evaluable_when.includes(c));
  if (found === undefined) {
    throw new Error(
      `${check.id} declares none of [${candidates.join(', ')}], so it cannot report that no processing statement was supplied`,
    );
  }
  return found;
}


/**
 * How far a derived figure may sit from a stated one before it is worth a line in the report.
 *
 * A merchant estimating their monthly volume is not reading it off a statement, so exact agreement
 * is not the expectation and reporting every rounding difference would bury the cases that matter.
 *
 * **20% is a judgement and it is unmeasured.** Recorded as one so it is not mistaken later for a
 * figure derived from something.
 *
 * **It is a presentation dial, not a determination.** Both the derived figure and the stated one
 * appear in the finding either way, together with the derivation and its sources — so moving this
 * number moves a finding between `pass` and `review` without hiding anything from anybody. That is
 * what makes it safe to leave unmeasured, and it is also why it must not be made to carry weight
 * it cannot bear: the gap itself is IQwallet's to judge (D-001), and this only decides how loudly
 * we hand it to them.
 *
 * **Do not tune it against the verification package.** Fitting it to the synthetic merchant in
 * `scripts/live/m4-all-checks-live.mjs` would tune it to numbers this repository invented, and the
 * result would look calibrated while meaning nothing. It gets set from real packages or it stays
 * where it is (D-122).
 */
export const MATERIAL_GAP = 0.2;

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Sum of one money field across the processing statements, with the pages it came from. */
function totalOf(snapshot: PackageSnapshot, field: string, slotKey: string): {
  total: number;
  parts: Source[];
  read: ReadDocument[];
} {
  const found = sources(snapshot, field, [slotKey]);
  const parts = found.values.filter((v) => normaliseAmount(v.raw) !== null);
  return {
    total: parts.reduce((sum, v) => sum + (normaliseAmount(v.raw) ?? 0), 0),
    parts,
    read: found.read,
  };
}

/** Where each figure was read, named so the derivation can be followed back to a page. */
function derivation(parts: readonly Source[]): string {
  return parts.map((p) => `${p.slotKey} "${p.raw}"`).join(' + ');
}

/**
 * The processing statement slot's own state.
 *
 * `not_provided` with its reason is a different answer from "there are no statements", and both
 * are different from "the figure was not itemised". D-01 through D-04 each declare all three.
 */
function slotExcuse(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding | null {
  const slots = snapshot.slots.filter((s) => s.slotKey === 'processing_statement');
  const notProvided = slots.find((s) => s.state === 'not_provided');

  if (notProvided !== undefined) {
    return notEvaluable(
      check,
      'processing_statements_not_provided',
      `Not evaluated: the processing statement slot is recorded not_provided, reason "${notProvided.reason}".`,
      PACKAGE,
    );
  }

  const statements = snapshot.documents.filter(
    (d) => d.slotKey === 'processing_statement' && d.supersededBy === null && d.outcome === 'extracted',
  );
  if (statements.length === 0) {
    return notEvaluable(
      check,
      // Each check names this case in its own words. D-01 and D-02 call it "no processing
      // statements"; D-03 and D-04 reach it through their itemisation condition, because a figure
      // that was never itemised is a fortiori not itemised on statements that do not exist. Picking
      // the declared one keeps §1's enumeration honest instead of widening every check to carry a
      // reason three of them would never otherwise use.
      firstDeclared(check, ['no_processing_statements', 'high_ticket_not_itemized', 'chargebacks_not_itemized', 'refunds_not_itemized']),
      'No readable processing statement was supplied, so nothing could be derived.',
      PACKAGE,
      snapshot.documents
        .filter((d) => d.slotKey === 'processing_statement' && d.supersededBy === null)
        .map((d) => ({ versionId: d.versionId, slotKey: d.slotKey, tier: tierOf(d) })),
    );
  }
  return null;
}

/** The single stated figure this check is set against. */
function stated(snapshot: PackageSnapshot, field: string): Source | null {
  const found = sources(snapshot, field, ['application']);
  return found.values.find((v) => normaliseAmount(v.raw) !== null) ?? null;
}

/**
 * Report a derived figure beside its stated one.
 *
 * One place, so every family D finding has the same three parts in the same order and none of them
 * can quietly acquire a fourth that reads as a verdict.
 */
function report(
  check: DocumentCheck,
  label: string,
  derived: number,
  format: (n: number) => string,
  statedValue: Source | null,
  how: string,
  read: readonly ReadDocument[],
): DocumentFinding {
  if (statedValue === null) {
    // The derivation still stands on its own and is worth recording; there is simply nothing to
    // set it against, and that is a comparison we did not make rather than one that passed.
    return notEvaluable(
      check,
      'stated_figure_absent',
      `The statements imply a ${label} of ${format(derived)} (${how}). The application states no ${label}, so the two were not compared.`,
      PACKAGE,
      read,
    );
  }

  const statedNumber = normaliseAmount(statedValue.raw) ?? 0;
  const gap = statedNumber === 0 ? (derived === 0 ? 0 : 1) : Math.abs(derived - statedNumber) / statedNumber;
  const sentence =
    `The application states a ${label} of ${statedValue.raw}; the statements imply ${format(derived)} (${how}).`;

  return gap <= MATERIAL_GAP
    ? clean(check, sentence, PACKAGE, read)
    : adverse(check, sentence, PACKAGE, read);
}

export interface FamilyDInput {
  readonly snapshot: PackageSnapshot;
  readonly checks: ReadonlyMap<string, DocumentCheck>;
}

/**
 * Dispatch is on `compares.derived`, never on a check id — the same rule family C follows.
 *
 * Each branch is a derivation, which is the thing that genuinely differs between these checks. The
 * comparison, the threshold and the wording are shared, so a fifth derived figure is a branch here
 * and nothing else.
 */
export function runFamilyD(input: FamilyDInput): DocumentFinding[] {
  const { snapshot, checks } = input;
  const out: DocumentFinding[] = [];

  for (const check of checks.values()) {
    if (!check.id.startsWith('D-')) continue;
    const derived = (check.compares as Record<string, unknown>)['derived'];
    if (typeof derived !== 'string') throw new Error(`${check.id}: compares.derived is missing or not a string`);

    const excuse = slotExcuse(check, snapshot);
    if (excuse !== null) {
      out.push(excuse);
      continue;
    }

    switch (derived) {
      case 'processing_volume': {
        const volume = totalOf(snapshot, 'processing_volume', 'processing_statement');
        const months = volume.parts.length || 1;
        // Monthly, because the stated figure is monthly: dividing by the number of statements is
        // the derivation, and it is named in the finding so a reader can check the arithmetic.
        out.push(
          report(check, 'monthly volume', volume.total / months, money, stated(snapshot, 'stated_monthly_volume'),
            `${derivation(volume.parts)} over ${months} statement(s)`, volume.read),
        );
        break;
      }

      case 'processing_average_ticket': {
        const volume = totalOf(snapshot, 'processing_volume', 'processing_statement');
        const count = totalOf(snapshot, 'processing_transaction_count', 'processing_statement');
        if (count.total === 0) {
          out.push(
            notEvaluable(check, 'no_processing_statements',
              'The statements state no transaction count, so an average ticket could not be derived.',
              PACKAGE, count.read),
          );
          break;
        }
        out.push(
          report(check, 'average ticket', volume.total / count.total, money, stated(snapshot, 'stated_average_ticket'),
            `${money(volume.total)} over ${count.total} transactions`, volume.read),
        );
        break;
      }

      case 'processing_high_ticket': {
        const high = sources(snapshot, 'processing_high_ticket', ['processing_statement']);
        const amounts = high.values.map((v) => normaliseAmount(v.raw)).filter((n): n is number => n !== null);
        if (amounts.length === 0) {
          out.push(
            notEvaluable(check, 'high_ticket_not_itemized',
              'No statement itemises a high ticket, so none could be derived.', PACKAGE, high.read),
          );
          break;
        }
        out.push(
          report(check, 'high ticket', Math.max(...amounts), money, stated(snapshot, 'stated_high_ticket'),
            `the largest of ${derivation(high.values)}`, high.read),
        );
        break;
      }

      case 'chargeback_rate': {
        const chargebacks = totalOf(snapshot, 'chargeback_count', 'processing_statement');
        const count = totalOf(snapshot, 'processing_transaction_count', 'processing_statement');
        if (chargebacks.parts.length === 0 || count.total === 0) {
          out.push(
            notEvaluable(check, 'chargebacks_not_itemized',
              'The statements do not itemise chargebacks against a transaction count, so a rate could not be derived.',
              PACKAGE, [...chargebacks.read]),
          );
          break;
        }
        const rate = (chargebacks.total / count.total) * 100;
        out.push(
          report(check, 'chargeback rate', rate, (n) => `${n.toFixed(3)}%`,
            stated(snapshot, 'stated_chargeback_rate'),
            `${chargebacks.total} chargeback(s) over ${count.total} transactions`, chargebacks.read),
        );
        break;
      }

      default:
        throw new Error(`${check.id} declares compares.derived '${derived}', which family D has no derivation for`);
    }
  }

  return out;
}
