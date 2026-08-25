/**
 * Creating a package, and composing its document set — one flow (D-128, D-129).
 *
 * An analyst has had to insert a row by hand. This replaces that: name the merchant, answer what
 * you know about the business, adjust the prechecked set, create.
 *
 * ## The questions are answerable with "not known yet", and that is the default (D-129)
 *
 * They resolve structural impossibility (D-081): a sole proprietorship has no Articles to supply, a
 * domestic entity files a W-9 rather than a W-8BEN. What a recorded answer rules out is removed
 * outright and never offered, because a checkbox an operator must remember to untick is a defect
 * waiting for a distracted afternoon.
 *
 * But at creation the operator often has not read the documents that carry the answer, and a
 * required dropdown with a plausible default does not obtain it — it manufactures one. So the
 * default is **unanswered**, an unanswered predicate does not resolve, and the slot stays in the
 * set: both tax forms when nobody knows the domicile, Articles when nobody knows the entity type.
 * Removal is the destructive direction, and it waits for a fact.
 *
 * The impossible slots are still *listed*, with the reason. An absence with no explanation invites
 * a support question; an absence that says why does not.
 *
 * ## What is not asked here
 *
 * **Existing processor.** No slot predicates on it, and a question that changes nothing trains an
 * operator to answer without reading. Processing Statements is default-on and resolves through
 * `not_provided` with a reason, which is the path D-081 already intended (D-129).
 *
 * **The merchant, from a dropdown.** Legal name, DBA and domain are typed. The DBA is here because
 * it is often the only name anybody remembers — and it is *the operator's label for finding this
 * package*, not the report's DBA. That one is what the documents say, derived once, in C-02
 * (D-125, D-126, D-129). Nothing here reaches the masthead.
 */

import { useEffect, useMemo, useState } from 'react';
import { composeSet, toRows, CompositionError, UNKNOWN_FACTS } from '@mintro/ruleset';
import type { ComposedSet, EntityType, PackageFacts } from '@mintro/ruleset';
import type { PackageCreation } from '../lib/packageCreation';
import { browserSlotTemplate } from '../lib/documentsTemplate';

export interface NewPackageProps {
  readonly creation: PackageCreation;
  readonly onCreated: (packageId: string) => void;
  readonly onCancel: () => void;
}

/**
 * `''` is not-known-yet, because a `<select>` value is a string and `null` is not one.
 *
 * It is converted at exactly one boundary — `asEntityType` below — so nothing downstream of this
 * component ever sees the empty string. A sentinel that leaks is a sentinel that gets stored.
 */
const NOT_KNOWN = '';

const ENTITY_TYPES: readonly { readonly value: EntityType; readonly label: string }[] = [
  { value: 'sole_proprietor', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'non_profit', label: 'Non-profit' },
  { value: 'government', label: 'Government' },
];

const asEntityType = (value: string): EntityType | null =>
  ENTITY_TYPES.some((t) => t.value === value) ? (value as EntityType) : null;

/** Three-valued, and "unsure" is the default. `''` for the same reason as above. */
type Tristate = 'yes' | 'no' | '';
const asBoolean = (value: Tristate): boolean | null => (value === '' ? null : value === 'yes');

export function NewPackage({ creation, onCreated, onCancel }: NewPackageProps): JSX.Element {
  const [legalName, setLegalName] = useState('');
  const [dba, setDba] = useState('');
  const [domain, setDomain] = useState('');

  const [entityType, setEntityType] = useState<EntityType | ''>(NOT_KNOWN);
  const [usDomiciled, setUsDomiciled] = useState<Tristate>('');

  /** Slot key → included. Seeded from the precheck, then owned by the operator. */
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const facts: PackageFacts = {
    ...UNKNOWN_FACTS,
    entityType: asEntityType(entityType),
    usDomiciled: asBoolean(usDomiciled),
  };
  const composed: ComposedSet = useMemo(
    () => composeSet(facts, browserSlotTemplate()),
    [entityType, usDomiciled],
  );

  /*
    Re-seed when the answers change, keeping the operator's own decisions.

    A slot they unticked stays unticked when an unrelated answer moves; a slot that has just
    appeared arrives at its default. Resetting everything would silently undo work each time
    somebody corrected a dropdown.
  */
  useEffect(() => {
    setIncluded((prior) => {
      const next: Record<string, boolean> = {};
      for (const slot of composed.offered) {
        next[slot.slotKey] = prior[slot.slotKey] ?? slot.prechecked;
      }
      return next;
    });
  }, [composed]);

  const isIncluded = (key: string, fallback: boolean): boolean => included[key] ?? fallback;

  const create = (): void => {
    setProblem(null);
    setBusy(true);

    void (async () => {
      try {
        const merchantId = await creation.ensureMerchant({
          legalName: legalName.trim(),
          dba: dba.trim() === '' ? null : dba.trim(),
          domain: domain.trim() === '' ? null : domain.trim(),
        });

        const { slots, removals } = toRows(
          composed,
          composed.offered.map((slot) => ({
            slotKey: slot.slotKey,
            included: isIncluded(slot.slotKey, slot.prechecked),
            ...(labels[slot.slotKey] === undefined ? {} : { instanceLabel: labels[slot.slotKey]! }),
          })),
        );

        onCreated(
          await creation.create({ merchantId, processorKey: 'default', slots, removals, facts }),
        );
      } catch (error) {
        setBusy(false);
        // A CompositionError says what is wrong with the set in the operator's terms; anything else
        // is a database or network problem and is shown as it arrived.
        setProblem(error instanceof CompositionError || error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const chosenCount = composed.offered.filter((s) => isIncluded(s.slotKey, s.prechecked)).length;
  const openQuestions = composed.offered.filter((s) => s.unresolved).length;

  return (
    <div className="veil on" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal-wide new-package" role="dialog" aria-modal="true" aria-label="New document package">
        <div className="modal-head">
          <h2>New document package</h2>
        </div>

        <div className="modal-body">
          {/* 1 — the merchant */}
          <section className="np-step">
            <h3>1 · Merchant</h3>
            <p className="np-why">
              How this package is found later. The DBA here is what you call them — what the report
              prints is what the documents say.
            </p>
            <div className="np-fields">
              <label className="np-field">
                <span className="np-field-label">Legal name</span>
                <input
                  className="input"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  disabled={busy}
                  aria-label="Legal name"
                />
              </label>
              <label className="np-field">
                <span className="np-field-label">
                  DBA <span className="np-optional">optional</span>
                </span>
                <input
                  className="input"
                  value={dba}
                  onChange={(e) => setDba(e.target.value)}
                  disabled={busy}
                  aria-label="DBA"
                />
              </label>
              <label className="np-field">
                <span className="np-field-label">
                  Domain <span className="np-optional">optional</span>
                </span>
                <input
                  className="input"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={busy}
                  aria-label="Domain"
                />
              </label>
            </div>
          </section>

          {/* 2 — what is known about the business */}
          <section className="np-step">
            <h3>2 · About the business</h3>
            <p className="np-why">
              Answer only what you know. An unanswered question leaves every document it touches in
              the set — nothing is removed until there is an answer to remove it.
            </p>
            <div className="np-answers">
              <label className="np-field">
                <span className="np-field-label">Entity type</span>
                <select
                  className="input"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value === NOT_KNOWN ? NOT_KNOWN : (e.target.value as EntityType))}
                  disabled={busy}
                >
                  <option value={NOT_KNOWN}>Not known yet</option>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="np-field">
                <span className="np-field-label">US-domiciled</span>
                <select
                  className="input"
                  value={usDomiciled}
                  onChange={(e) => setUsDomiciled(e.target.value as Tristate)}
                  disabled={busy}
                >
                  <option value="">Not sure</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
          </section>

          {/* 3 — the set */}
          <section className="np-step">
            <h3>3 · Documents</h3>
            <p className="np-why">
              {chosenCount} selected. Prechecked from the default set; adjust as needed.
              {openQuestions === 0
                ? null
                : ` ${openQuestions} ${openQuestions === 1 ? 'is' : 'are'} here pending an answer above.`}
            </p>

            <ul className="np-slots">
              {composed.offered.map((slot) => {
                const on = isIncluded(slot.slotKey, slot.prechecked);
                return (
                  <li key={slot.slotKey} data-origin={slot.origin} data-included={on} data-unresolved={slot.unresolved}>
                    {/*
                      Three grid areas: the box, the name, the metadata.

                      Origin and count are facts *about* the row, not part of the document's name —
                      so they live in their own element and their own column. As inline siblings of
                      the name they concatenated: "Voided Checkrequired×1".

                      The `{' '}` between them is deliberate and is not formatting. A grid separates
                      the boxes visually and changes nothing about `textContent`, so without it the
                      row still reads "Voided Checkrequired×1" to a screen reader and to anyone who
                      copies it. The gap handles the eye; the space handles everything else.
                    */}
                    <label className="np-row">
                      <input
                        type="checkbox"
                        className="np-box"
                        checked={on}
                        disabled={busy}
                        onChange={(e) => setIncluded((p) => ({ ...p, [slot.slotKey]: e.target.checked }))}
                      />
                      <span className="np-name">{slot.title}</span>{' '}
                      <span className="np-meta">
                        <span className="np-origin" data-origin={slot.origin} data-unresolved={slot.unresolved}>
                          {slot.origin}
                        </span>{' '}
                        {slot.requiredCount === null ? (
                          <span className="np-count np-count-unknown" title="derived from the application">
                            ?
                          </span>
                        ) : (
                          <span className="np-count">×{slot.requiredCount}</span>
                        )}
                      </span>
                    </label>

                    {/* Attached to the row it explains, in the name's column — not a loose paragraph. */}
                    {slot.because === null ? null : (
                      <p className="np-because" data-unresolved={slot.unresolved}>
                        {slot.because}
                      </p>
                    )}

                    {on && slot.allowsInstances && (
                      <input
                        className="input np-label"
                        placeholder="Label this instance — e.g. DE pharmacy licence"
                        value={labels[slot.slotKey] ?? ''}
                        onChange={(e) => setLabels((p) => ({ ...p, [slot.slotKey]: e.target.value }))}
                        disabled={busy}
                        aria-label={`Label for ${slot.title}`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {composed.impossible.length > 0 && (
              <div className="np-impossible">
                <h4>Not applicable to this business</h4>
                {/* Listed, not offered. An unexplained absence invites a support question. */}
                <ul>
                  {composed.impossible.map((slot) => (
                    <li key={slot.slotKey} data-slot={slot.slotKey}>
                      <span className="np-name">{slot.title}</span>{' '}
                      <span className="np-because">{slot.because}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {problem !== null && <div className="err">{problem}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={create}
            disabled={busy || legalName.trim() === '' || chosenCount === 0}
          >
            {busy ? 'Creating…' : 'Create package'}
          </button>
        </div>
      </div>
    </div>
  );
}
