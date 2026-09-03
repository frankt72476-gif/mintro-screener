/**
 * One continuous 1..N over everything a person can point at (D-248).
 *
 * `GATE-002 · 3 of 5` is what the system keys a comment on, and it is unsayable: an agent on a call
 * with a merchant cannot read out an internal rule id, and neither can the merchant. So every
 * referenceable line also carries a plain integer, and the two sit side by side on the row — the
 * number prominent, the code a quiet tag — so they are visibly one thing with two labels rather
 * than two identities for one line. That last part is the whole of why the earlier ruling rejected
 * numbering, and it is what this design answers rather than overrides.
 *
 * ## Allocated in render order, because only the render knows the order
 *
 * `ordinalsFor` and `referencesFor` derive from `groupReport` and key by finding identity. They can,
 * because they answer *which finding is this* — a question with the same answer whichever way you
 * walk the report.
 *
 * This one answers *where does this sit on the page*, and the page's order is not `groupReport`'s.
 * The reader sees the stopping panel, then the not-met section, then the eye test, then the review
 * section — an order assembled by `ReportView`'s JSX out of four different structures. A function
 * mirroring that walk would be a second copy of it, and the first time the two disagreed the numbers
 * would be wrong in a way nothing would catch (D-216's argument, applied to sequence rather than to
 * counts).
 *
 * So numbers are allocated **on first sight during render**. React renders a tree depth-first in
 * document order and elements are lazy — creating one does not call it — so first-sight order is
 * display order by construction rather than by a walk that has to agree with it.
 *
 * Two properties make that safe rather than clever:
 *
 * - **Idempotent.** A key already seen returns the number it was given. A second render, a
 *   re-render under `StrictMode`, a row that opens and closes — all return the same number.
 * - **Asserted against the rendered document.** `numbering.test.ts` reads the numbers out of the
 *   markup in document order and checks they are exactly 1..N with no gaps and no repeats. That
 *   test is the guarantee; this module only has to be deterministic.
 *
 * ## Not stored, not an identity
 *
 * Per report, fresh on a re-screen — a re-screen is a new report and gets a new sequence. Nothing
 * writes it to the database and nothing keys on it: comments still key on `(rule_id, ordinal)` or
 * `(subject, ordinal)`. It is a pointer for people, and a pointer that changed the storage key would
 * be the second identity the earlier ruling was right to refuse.
 */

import { createContext, useContext } from 'react';
import type { ReportFinding } from '@mintro/engine';

export interface Numbering {
  /**
   * The number for anything referenceable that is neither a finding nor an eye-test line.
   *
   * Keyed by a string the caller owns — an operational question's `questionId`, say. Findings key by
   * object identity because they have no id of their own that survives grouping; everything else
   * does, and a string key is what lets a component in another file join the sequence without this
   * module learning about it.
   */
  forLine(key: string): number;
  /**
   * The number for a finding, allocated on first sight.
   *
   * Keyed by the finding object: within one render every surface holds the same `report`, and
   * identity is what survives the four traversals the page makes of it.
   */
  forFinding(finding: ReportFinding): number;
  /**
   * The number for an eye-test line, keyed by its rubric id (`EYE-07`).
   *
   * By id rather than by position in the array, so a rubric that grows or reorders does not silently
   * hand one line's number to another within a single render.
   */
  forEyeLine(rubricId: string): number;
  /** How many have been allocated. For a test; nothing on the page states a total. */
  readonly count: number;
}

export function createNumbering(): Numbering {
  const findings = new Map<ReportFinding, number>();
  const lines = new Map<string, number>();
  let next = 1;

  const allocate = <K,>(map: Map<K, number>, key: K): number => {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const assigned = next;
    next += 1;
    map.set(key, assigned);
    return assigned;
  };

  return {
    forFinding: (finding) => allocate(findings, finding),
    // Namespaced, so an eye-test id and an attestation id that happened to match are still two
    // lines. They do not today; a shared map with unprefixed keys is how they would stop being.
    forEyeLine: (rubricId) => allocate(lines, `eye:${rubricId}`),
    forLine: (key) => allocate(lines, key),
    get count() {
      return next - 1;
    },
  };
}

/**
 * The report's numbering, reachable from any row in any file.
 *
 * **It lived in `ReportView.tsx` and that is why this has now been missed twice.** A context that is
 * not exported can only be consumed from the file that declares it, so the eye test joined the
 * sequence when it was wired inside that file and the operational questions — rendered by
 * `Attestations.tsx` — silently did not. Nothing failed; the section simply had no numbers, which is
 * indistinguishable from a section that was never meant to have any.
 *
 * Here instead, beside the allocator, so a section added in a new file can reach it. That does not
 * make forgetting impossible — `numbering.test.ts` is what makes forgetting *loud*, by counting the
 * chips in the rendered document against the rows that should carry them.
 *
 * The default is a live numbering rather than null, so a row rendered outside a provider gets a
 * consistent number instead of throwing. A missing number is a cosmetic fault; a crash in a report
 * is not.
 */
export const NumberingContext = createContext<Numbering>(createNumbering());

/** The number for one referenceable line, by whichever key that kind of line uses. */
export function useLineNumber(key: string): number {
  return useContext(NumberingContext).forLine(key);
}

/** The number for one finding. Keyed by identity — see `Numbering.forFinding`. */
export function useFindingNumber(finding: ReportFinding): number {
  return useContext(NumberingContext).forFinding(finding);
}

/**
 * The rubric id's own number, which is what a per-line response is stored under.
 *
 * `EYE-07` → `7`. The **stored key for an eye-test line comment is this**, not the display number:
 * `merchant_comments` takes `subject = 'eye-test'` with `ordinal = 7`, and the rubric id is fixed
 * where the display number moves with the report's contents. A reply written against `EYE-07` on one
 * run reads back against `EYE-07` on the next, which a display number could not promise.
 *
 * Throws rather than guessing. A rubric id that does not parse would silently store every line's
 * reply under the same key, and a merchant's words attached to the wrong impression is worse than
 * an error somebody sees.
 */
export function eyeLineOrdinal(rubricId: string): number {
  const digits = /^EYE-(\d+)$/.exec(rubricId);
  if (digits === null) {
    throw new Error(`eye-test rubric id "${rubricId}" is not EYE-nn, so it has no stored ordinal`);
  }
  return Number(digits[1]);
}
