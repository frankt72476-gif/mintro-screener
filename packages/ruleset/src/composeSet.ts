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
 *
 * ## And a third case: not decided yet (D-129)
 *
 * A fact can be `null`, meaning nobody has established it. A conditional over an unanswered fact
 * **does not resolve** — the slot is offered and prechecked, exactly as if the template had asked
 * for it unconditionally, and it is never listed as impossible.
 *
 * This is not caution for its own sake. Removal is the destructive direction: an offered document
 * the merchant cannot supply gets a `not_provided` reason and costs a click, while a removed
 * document nobody asked for produces a package that looks complete and is not. So both W-9 and
 * W-8BEN are offered when nobody knows the domicile, and Articles is offered when nobody knows the
 * entity type.
 */

import type {
  EntityType,
  PackageFacts,
  PredicateOutcome,
  SlotDefinition,
  SlotTemplate,
} from './slotTemplate.js';

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
  /**
   * True where the slot is here because the question behind it is unanswered (D-129).
   *
   * Distinct from `because` being non-null: a conditional that *fired* is also explained. This one
   * says the explanation is provisional, so the screen can mark it as an open question rather than
   * a settled reason.
   */
  readonly unresolved: boolean;
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

/**
 * How an entity type reads in a sentence.
 *
 * `entityType.replace(/_/g, ' ')` produced "a llc files formation documents" — wrong article, wrong
 * case, in copy an operator reads on every package. The article is part of the label because "a"
 * and "an" depend on how the abbreviation is *said*, not on its first letter.
 */
const ENTITY_PHRASE: Readonly<Record<EntityType, string>> = {
  sole_proprietor: 'a sole proprietorship',
  partnership: 'a partnership',
  llc: 'an LLC',
  corporation: 'a corporation',
  non_profit: 'a non-profit',
  government: 'a government entity',
};

/**
 * How a conditional reads when it fires, when it does not, and when nobody has said.
 *
 * The unknown wording names the *question*, not a guess at the answer. "Entity type is not
 * recorded, so this stays in the set" is a different sentence from "an LLC files formation
 * documents", and an operator has to be able to tell which they are reading — the first is
 * something they can go and settle, the second is not.
 */
function explain(slotKey: string, facts: PackageFacts, outcome: PredicateOutcome): string {
  if (outcome === 'unknown') {
    switch (slotKey) {
      case 'articles_of_incorporation':
        return 'entity type is not recorded, so this stays in the set';
      case 'w9':
      case 'w8ben':
        return 'US domicile is not recorded, so both tax forms stay in the set';
      default:
        return 'the answer this depends on is not recorded, so it stays in the set';
    }
  }
  switch (slotKey) {
    case 'articles_of_incorporation':
      return outcome
        ? `${facts.entityType === null ? 'this entity type' : ENTITY_PHRASE[facts.entityType]} files formation documents`
        : 'a sole proprietorship files no formation documents';
    case 'w9':
      return outcome ? 'a US-domiciled entity files a W-9' : 'a non-US entity files a W-8BEN, not a W-9';
    case 'w8ben':
      return outcome ? 'a non-US entity files a W-8BEN' : 'a US-domiciled entity files a W-9, not a W-8BEN';
    default:
      return 'the answers given at creation';
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
      offered.push({ ...base, origin: 'required', prechecked: true, because: null, unresolved: false });
      continue;
    }
    if (slot.include === 'off') {
      offered.push({ ...base, origin: 'added', prechecked: false, because: null, unresolved: false });
      continue;
    }

    /*
      A conditional. Three outcomes, not two (D-129).

      Only an outright `false` removes it — an answer is on record and it says the document cannot
      exist. `'unknown'` is offered and prechecked, and behaves exactly as a fired conditional does
      *except* for the flag, because until somebody answers the question it is genuinely part of
      the set.
    */
    const outcome = slot.include(facts);
    if (outcome === false) {
      impossible.push({ slotKey: slot.slotKey, title: slot.title, because: explain(slot.slotKey, facts, false) });
      continue;
    }
    offered.push({
      ...base,
      origin: 'conditional',
      prechecked: true,
      because: explain(slot.slotKey, facts, outcome),
      unresolved: outcome === 'unknown',
    });
  }

  return { offered, impossible };
}

/**
 * Which slot keys these answers make structurally impossible.
 *
 * The list `set_package_facts` waives with (0034). Derived from the same predicates `composeSet`
 * runs, in the same file, so answering a question after creation removes exactly what answering it
 * before creation would have — one derivation, not two that agree until a predicate changes.
 *
 * Unknown never appears here. A fact nobody has established cannot make anything impossible; that
 * is the whole of D-129 stated as a return value.
 */
export function impossibleSlotKeys(facts: PackageFacts, template: SlotTemplate): readonly string[] {
  return template.slots
    .filter((slot) => typeof slot.include === 'function' && slot.include(facts) === false)
    .map((slot) => slot.slotKey);
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

export type { EntityType, PackageFacts, SlotDefinition };
