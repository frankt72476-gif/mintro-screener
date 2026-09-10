/**
 * What an operator's edit does to a draft, separated from the controls that offer it.
 *
 * The same split `evaluationView.ts` makes and for the same reason: vitest runs `environment:
 * 'node'` here, so an edit applied inside a component could only be tested by rendering markup,
 * choosing an element and pretending to click it. The question *what does this edit produce* is
 * about data, and it is answered here where a test can ask it directly.
 *
 * Every function returns a **new** draft and mutates nothing. The editor holds one document in
 * state and replaces it on each change, so a helper that edited in place would leave React with a
 * value it had already seen and a screen that did not move.
 *
 * ## Why the whole document, and not a patch
 *
 * `edit_evaluation_draft` replaces `content` outright. A patch protocol would be a second
 * description of the draft's shape — one in the schema and one in the diffs — and the two would
 * drift the first time a field was added. The editor sends what it is showing.
 */

import { MAX_SHORE_UPS } from '@mintro/engine';
import { PLACEMENT_BY_SPECTRUM } from '@mintro/ruleset';
import type { DraftCitation, StoredDraft } from './evaluationView.js';

export { MAX_SHORE_UPS };

/** The placement a badge can be changed to. Ordered as the badge offers them. */
/**
 * An evaluation request as the screen watches it (D-269).
 *
 * Only the two fields the affordance turns on. The row carries more; a screen typed on the whole
 * of it would compile against `requested_by` and `error` and the constraint that it renders
 * neither would rest on nobody reaching for them.
 */
export interface PendingEvaluationRequest {
  readonly status: string;
  readonly createdAt: string;
}

/**
 * The states an evaluation request occupies while work is outstanding.
 *
 * The same two the partial unique index in `0086` is scoped to, and they have to be the same two:
 * a screen that disabled on `queued` alone would offer a button the database refuses the moment a
 * worker claims the row — which is the round trip D-269 exists to remove.
 */
export const IN_FLIGHT_REQUEST_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

/** What Generate or Regenerate offers right now. */
export interface GenerateAffordance {
  readonly disabled: boolean;
  readonly label: string;
  /** True when a request is outstanding, so the screen shows the pending state instead. */
  readonly pending: boolean;
}

/**
 * Whether a run may be asked for another draft, and what the control says (D-269).
 *
 * ## Why this reads the queue rather than a local flag
 *
 * The button used to flip a `regenerating` boolean true for the duration of one insert and false
 * again as soon as it returned. It reflected the *request* and nothing about the *queue*, so a
 * second click a second later was a second row — and on 2026-09-10 run `2f39223a` got exactly that:
 * one request claimed and running, a second queued six seconds behind it, each a browser, the
 * stored DOM of every sampled page and a vendor charge, the second overwriting the first's draft.
 *
 * ## The refusal of record is the index, not this
 *
 * `0086` is what makes a duplicate impossible, including from a second operator whose browser
 * cannot see this one's state. What this does is explain the refusal *before* it happens, so an
 * operator meets a disabled control and a pending line rather than an insert error — the same
 * division `canEdit` already draws against 0081's function guard.
 *
 * `submitting` is still here and still local: it covers the moment between the click and the row
 * existing, which no read of the queue can see.
 */
export function generateAffordance(
  pending: PendingEvaluationRequest | null,
  submitting: boolean,
  label: string,
): GenerateAffordance {
  if (pending !== null && IN_FLIGHT_REQUEST_STATUSES.has(pending.status)) {
    return {
      disabled: true,
      pending: true,
      // What the queue is doing, not what the button would do. "Queued…" on a claimed request would
      // tell an operator it is waiting when it is running.
      label: pending.status === 'running' ? 'Generating…' : 'Queued…',
    };
  }
  if (submitting) return { disabled: true, pending: false, label: 'Queued…' };
  return { disabled: false, pending: false, label };
}

export const EDITABLE_PLACEMENTS = ['referred_out', 'international', 'domestic'] as const;

/**
 * The placements an operator may choose, for the spectrum the draft is at (D-272).
 *
 * **Reads `PLACEMENT_BY_SPECTRUM`**, which is the single source the validator, the prompt and
 * `publishRefusal` all read. The selector used to offer all three regardless of position, so an
 * operator could put a `mixed` draft at `domestic` and learn at publish that it is refused — a
 * round trip to be told something the screen already knew.
 *
 * Falls back to the full list for a spectrum the table does not carry. That is a draft holding a
 * position the angle set has since dropped, and offering nothing at all would leave an operator
 * with a document they cannot edit; the validator still refuses whatever they pick.
 */
export function placementsFor(spectrum: string): readonly string[] {
  const permitted = (PLACEMENT_BY_SPECTRUM as Readonly<Record<string, readonly string[]>>)[spectrum];
  return permitted ?? EDITABLE_PLACEMENTS;
}

/** The leans an angle can be changed to. */
export const EDITABLE_LEANS = ['research', 'neutral', 'consumer'] as const;

/** The statuses a routing row can be changed to — including the two the application answers. */
export const EDITABLE_ROUTING_STATUSES = ['met', 'not_met', 'not_observable'] as const;

export function withPlacement(draft: StoredDraft, recommended: string): StoredDraft {
  return { ...draft, placement: { ...draft.placement, recommended } };
}

export function withSpectrum(draft: StoredDraft, spectrum: string): StoredDraft {
  return { ...draft, placement: { ...draft.placement, spectrum } };
}

export function withParagraph(draft: StoredDraft, paragraph: string): StoredDraft {
  return { ...draft, placement: { ...draft.placement, paragraph } };
}

/**
 * The operator's note.
 *
 * An empty string removes the field rather than storing `""`. Absent and empty would render the
 * same and mean the same, and a document carrying both would make "does this evaluation have an
 * operator note" a question with two answers.
 */
export function withOperatorNote(draft: StoredDraft, note: string): StoredDraft {
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    const { operatorNote: _dropped, ...rest } = draft;
    return rest;
  }
  return { ...draft, operatorNote: note };
}

/** An angle's lean. Keyed on the angle id, because the draft's order is not the memo's. */
export function withLean(draft: StoredDraft, angleId: string, lean: string): StoredDraft {
  return {
    ...draft,
    angles: draft.angles.map((angle) => (angle.angleId === angleId ? { ...angle, lean } : angle)),
  };
}

/**
 * A routing row's status.
 *
 * Every row is editable, the two the application answers included. Those are the ones an operator
 * is *most* likely to change: the crawl cannot read them, and the operator has the application in
 * front of them. A read-only row there would leave the one person who knows the answer unable to
 * record it.
 */
export function withRoutingStatus(
  draft: StoredDraft,
  conditionId: string,
  status: string,
): StoredDraft {
  return {
    ...draft,
    routing: draft.routing.map((row) =>
      row.conditionId === conditionId ? { ...row, status } : row,
    ),
  };
}

export function withShoreUpText(draft: StoredDraft, index: number, text: string): StoredDraft {
  return {
    ...draft,
    shoreUps: draft.shoreUps.map((shoreUp, at) => (at === index ? { ...shoreUp, text } : shoreUp)),
  };
}

export function withoutShoreUp(draft: StoredDraft, index: number): StoredDraft {
  return { ...draft, shoreUps: draft.shoreUps.filter((_, at) => at !== index) };
}

/**
 * A new shore-up, up to the cap.
 *
 * `MAX_SHORE_UPS` is the validator's, imported rather than restated: an editor that let an operator
 * add a seventh would be offering a document the publish path refuses, and the refusal would arrive
 * after the work rather than instead of it.
 *
 * It carries a citation because every shore-up does — the validator refuses one without. The
 * operator picks it; the caller passes what they picked, and `canAddShoreUp` says whether there is
 * room before the control is drawn.
 */
export function withShoreUp(
  draft: StoredDraft,
  text: string,
  citation: DraftCitation,
): StoredDraft {
  if (!canAddShoreUp(draft)) return draft;
  return { ...draft, shoreUps: [...draft.shoreUps, { text, citation }] };
}

export function canAddShoreUp(draft: StoredDraft): boolean {
  return draft.shoreUps.length < MAX_SHORE_UPS;
}
