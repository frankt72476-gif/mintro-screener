/**
 * Composing a package's document set (D-128).
 *
 * One default set, prechecked, adjusted by the operator. This turns the template plus the three
 * D-081 answers into what the creation screen shows, and then turns the operator's adjustments back
 * into what gets inserted.
 *
 * ## Two kinds of "not in the set", and they are not the same
 *
 * **Structurally impossible** — a sole proprietorship has no Articles of Organization, a domestic
 * entity files a W-9 rather than a W-8BEN. These are removed outright and **never offered**. Asking
 * an operator to decline a document that cannot exist is asking them to confirm a mistake, and a
 * checkbox they must remember to untick is a defect waiting for a distracted afternoon.
 *
 * **Not wanted** — everything else. Offered, prechecked where the template says so, and removable.
 * A removal is *recorded* (0033), because a shorter list is indistinguishable from a list that was
 * always shorter.
 *
 * The distinction is the whole of what D-081 still decides after D-128.
 */

import type { PackageFacts, SlotDefinition, SlotTemplate } from './slotTemplate.js';

/** A slot as the creation screen shows it. */
export interface ComposableSlot {
  readonly slotKey: string;
  readonly title: string;
  readonly origin: 'required' | 'conditional' | 'added';
  /** Ticked when the screen opens. `added` slots never are. */
  readonly prechecked: boolean;
  /** Whether the operator may name further instances of it (D-111). */
  readonly allowsInstances: boolean;
  readonly requiredCount: number | null;
  readonly monthly: boolean;
  readonly graceDays: number | null;
  readonly expiryAfterRun: boolean;
  readonly examined: boolean;
  /**
   * Why a conditional slot is in the set, in words.
   *
   * Rendered beside it, so an operator seeing a document they did not expect can tell whether the
   * template always asks or their own answers put it there — which is the question D-121 keeps the
   * `origin` column for, arriving one step earlier.
   */
  readonly because: string | null;
}

export interface ComposedSet {
  /** Everything the screen offers, in template order. */
  readonly offered: readonly ComposableSlot[];
  /**
   * Slots the facts made impossible. Not offered, and listed only so the screen can say *why* the
   * set is shorter than someone expected — an unexplained absence invites a support question.
   */
  readonly impossible: readonly { readonly slotKey: string; readonly title: string; readonly because: string }[];
}

/** How a conditional reads when it fires, and when it does not. */
function explain(slotKey: string, facts: PackageFacts, fires: boolean): string {
  switch (slotKey) {
    case 'articles_of_incorporation':
      return fires
        ? `a ${facts.entityType.replace(/_/g, ' ')} files formation documents`
        : 'a sole proprietorship files no formation documents';
    case 'w9':
      return fires ? 'a US-domiciled entity files a W-9' : 'a non-US entity files a W-8BEN, not a W-9';
    case 'w8ben':
      return fires ? 'a non-US entity files a W-8BEN' : 'a US-domiciled entity files a W-9, not a W-8BEN';
    default:
      return fires ? 'the answers given at creation' : 'the answers given at creation';
  }
}

/**
 * What the creation screen shows for these three answers.
 *
 * `include: 'off'` in the template means *offered but not prechecked* — the catalogue of things an
 * operator may add. It is not the same as impossible, and conflating the two is how a document
 * nobody can supply ends up in a chase list.
 */
export function composeSet(facts: PackageFacts, template: SlotTemplate): ComposedSet {
  const offered: ComposableSlot[] = [];
  const impossible: { slotKey: string; title: string; because: string }[] = [];

  for (const slot of template.slots) {
    const base = {
      slotKey: slot.slotKey,
      title: slot.title,
      allowsInstances: slot.allowsInstances,
      requiredCount: slot.requiredCount,
      monthly: slot.monthly,
      graceDays: slot.graceDays,
      expiryAfterRun: slot.expiryAfterRun,
      examined: slot.examined,
    };

    if (slot.include === 'always') {
      offered.push({ ...base, origin: 'required', prechecked: true, because: null });
      continue;
    }
    if (slot.include === 'off') {
      offered.push({ ...base, origin: 'added', prechecked: false, because: null });
      continue;
    }

    // A conditional. Fires or it does not, and not firing removes it outright (D-081).
    const fires = slot.include(facts);
    if (fires) {
      offered.push({ ...base, origin: 'conditional', prechecked: true, because: explain(slot.slotKey, facts, true) });
    } else {
      impossible.push({ slotKey: slot.slotKey, title: slot.title, because: explain(slot.slotKey, facts, false) });
    }
  }

  return { offered, impossible };
}

/** What the operator settled on, per slot. */
export interface Choice {
  readonly slotKey: string;
  readonly included: boolean;
  /** Required where the slot is an added instance (D-111, D-122). */
  readonly instanceLabel?: string;
}

export interface SlotRow {
  readonly slot_key: string;
  readonly origin: 'required' | 'conditional' | 'added';
  readonly instance_label: string | null;
  readonly required_count: number | null;
  readonly coverage_monthly: boolean;
  readonly coverage_grace_days: number | null;
  readonly expiry_after_run: boolean;
  readonly examined: boolean;
}

export interface Removal {
  readonly slot_key: string;
  readonly origin: 'required' | 'conditional';
}

export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionError';
  }
}

/**
 * Turn the offered set plus the operator's choices into rows.
 *
 * Refuses rather than repairs. An added instance with no label would produce a slot the operator
 * cannot tell apart from another of the same kind — "Business License" twice, with no way to know
 * which is the pharmacy one — and the schema's `added_slots_are_named` would reject it anyway, so
 * failing here says why instead of surfacing a constraint name.
 */
export function toRows(
  composed: ComposedSet,
  choices: readonly Choice[],
): { readonly slots: readonly SlotRow[]; readonly removals: readonly Removal[] } {
  const chosen = new Map(choices.map((c) => [c.slotKey, c]));
  const slots: SlotRow[] = [];
  const removals: Removal[] = [];

  for (const slot of composed.offered) {
    const choice = chosen.get(slot.slotKey);
    const included = choice === undefined ? slot.prechecked : choice.included;

    if (!included) {
      // Only a slot that was in the default set can be *removed*. Declining one that was merely
      // offered is not a removal — nobody asked for it, so there is nothing to record.
      if (slot.origin !== 'added') removals.push({ slot_key: slot.slotKey, origin: slot.origin });
      continue;
    }

    const label = choice?.instanceLabel?.trim() ?? '';
    if (slot.origin === 'added' && slot.allowsInstances && label === '') {
      throw new CompositionError(
        `${slot.title} is added as a named instance and has no label — two of them would be ` +
          'indistinguishable in the slot table and in every finding that cites one.',
      );
    }
    if (label !== '' && !slot.allowsInstances) {
      throw new CompositionError(`${slot.title} does not take an instance label`);
    }

    slots.push({
      slot_key: slot.slotKey,
      origin: slot.origin,
      instance_label: label === '' ? null : label,
      required_count: slot.requiredCount,
      coverage_monthly: slot.monthly,
      // The schema requires grace exactly for monthly slots, and SlotDefinition already agrees.
      coverage_grace_days: slot.monthly ? slot.graceDays : null,
      expiry_after_run: slot.expiryAfterRun,
      examined: slot.examined,
    });
  }

  if (slots.length === 0) {
    throw new CompositionError('a package must ask for at least one document');
  }
  return { slots, removals };
}

export type { PackageFacts, SlotDefinition };
