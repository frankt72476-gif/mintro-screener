/**
 * Creating a package, and composing its document set — one flow (D-128).
 *
 * An analyst has had to insert a row by hand. This replaces that: pick or name a merchant, answer
 * the three questions, adjust the prechecked set, create.
 *
 * **The three questions are not preferences.** They resolve structural impossibility (D-081): a
 * sole proprietorship has no Articles to supply, a domestic entity files a W-9 rather than a
 * W-8BEN. What they remove is removed outright and never offered, because a checkbox an operator
 * must remember to untick is a defect waiting for a distracted afternoon. Everything else is theirs
 * to adjust.
 *
 * The impossible slots are still *listed*, greyed and unselectable, with the reason. An absence
 * with no explanation invites a support question; an absence that says why does not.
 */

import { useEffect, useMemo, useState } from 'react';
import { composeSet, toRows, CompositionError } from '@mintro/ruleset';
import type { ComposedSet, PackageFacts } from '@mintro/ruleset';
import type { MerchantOption, PackageCreation } from '../lib/packageCreation';
import { browserSlotTemplate } from '../lib/documentsTemplate';

export interface NewPackageProps {
  readonly creation: PackageCreation;
  readonly onCreated: (packageId: string) => void;
  readonly onCancel: () => void;
}

const ENTITY_TYPES: readonly { readonly value: PackageFacts['entityType']; readonly label: string }[] = [
  { value: 'sole_proprietor', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'non_profit', label: 'Non-profit' },
  { value: 'government', label: 'Government' },
];

export function NewPackage({ creation, onCreated, onCancel }: NewPackageProps): JSX.Element {
  const [merchants, setMerchants] = useState<readonly MerchantOption[]>([]);
  const [merchantId, setMerchantId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');

  const [entityType, setEntityType] = useState<PackageFacts['entityType']>('llc');
  const [hasProcessor, setHasProcessor] = useState(true);
  const [usDomiciled, setUsDomiciled] = useState(true);

  /** Slot key → included. Seeded from the precheck, then owned by the operator. */
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void creation.merchants().then(setMerchants).catch(() => setMerchants([]));
  }, [creation]);

  const facts: PackageFacts = { entityType, hasExistingProcessor: hasProcessor, usDomiciled };
  const composed: ComposedSet = useMemo(
    () => composeSet(facts, browserSlotTemplate()),
    [entityType, hasProcessor, usDomiciled],
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
        const id =
          merchantId !== ''
            ? merchantId
            : await creation.ensureMerchant(newName.trim(), newDomain.trim() === '' ? null : newDomain.trim());

        const { slots, removals } = toRows(
          composed,
          composed.offered.map((slot) => ({
            slotKey: slot.slotKey,
            included: isIncluded(slot.slotKey, slot.prechecked),
            ...(labels[slot.slotKey] === undefined ? {} : { instanceLabel: labels[slot.slotKey]! }),
          })),
        );

        onCreated(await creation.create({ merchantId: id, processorKey: 'default', slots, removals }));
      } catch (error) {
        setBusy(false);
        // A CompositionError says what is wrong with the set in the operator's terms; anything else
        // is a database or network problem and is shown as it arrived.
        setProblem(error instanceof CompositionError || error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const namedMerchant = merchantId !== '' || newName.trim() !== '';
  const chosenCount = composed.offered.filter((s) => isIncluded(s.slotKey, s.prechecked)).length;

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
            <select
              className="input"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              disabled={busy}
              aria-label="Existing merchant"
            >
              <option value="">— create a new merchant —</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.legalName ?? m.domain}
                </option>
              ))}
            </select>
            {merchantId === '' && (
              <div className="np-new-merchant">
                <input
                  className="input"
                  placeholder="Legal name (required)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={busy}
                  aria-label="Legal name"
                />
                <input
                  className="input"
                  placeholder="Domain (optional)"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  disabled={busy}
                  aria-label="Domain"
                />
              </div>
            )}
          </section>

          {/* 2 — the three questions */}
          <section className="np-step">
            <h3>2 · About the business</h3>
            <p className="np-why">
              These decide which documents can exist at all. What they rule out is not offered below.
            </p>
            <div className="np-answers">
              <label>
                Entity type
                <select
                  className="input"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value as PackageFacts['entityType'])}
                  disabled={busy}
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Has an existing processor
                <select className="input" value={hasProcessor ? 'yes' : 'no'} onChange={(e) => setHasProcessor(e.target.value === 'yes')} disabled={busy}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                US-domiciled
                <select className="input" value={usDomiciled ? 'yes' : 'no'} onChange={(e) => setUsDomiciled(e.target.value === 'yes')} disabled={busy}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
          </section>

          {/* 3 — the set */}
          <section className="np-step">
            <h3>3 · Documents</h3>
            <p className="np-why">{chosenCount} selected. Prechecked from the default set; adjust as needed.</p>

            <ul className="np-slots">
              {composed.offered.map((slot) => {
                const on = isIncluded(slot.slotKey, slot.prechecked);
                return (
                  <li key={slot.slotKey} data-origin={slot.origin} data-included={on}>
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
                        <span className="np-origin" data-origin={slot.origin}>
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
                    {slot.because === null ? null : <p className="np-because">{slot.because}</p>}

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
          <button className="btn btn-primary" onClick={create} disabled={busy || !namedMerchant || chosenCount === 0}>
            {busy ? 'Creating…' : 'Create package'}
          </button>
        </div>
      </div>
    </div>
  );
}
