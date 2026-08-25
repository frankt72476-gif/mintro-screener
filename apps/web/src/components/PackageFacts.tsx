/**
 * The three creation answers, after creation (D-129).
 *
 * A package can be opened before anybody knows what kind of business it is. The answers live on the
 * package as three nullable columns where **null means not known yet**, and this is where they get
 * filled in once the documents arrive.
 *
 * ## Answering later removes documents, so it is a waive and not a delete
 *
 * `slots_are_never_deleted` (D-097). A conditional slot that turns out not to apply goes to
 * `waived` with `not_applicable_to_entity_type`, and `resolved_by = 'fact'` records that an answer
 * did it rather than a person — the same row, different authority.
 *
 * A slot already holding a document is left alone. An answer saying that document cannot exist does
 * not make it go away; it makes the two disagree, which is C-05's finding to report. The count this
 * panel shows back is what the function actually waived, not what it was asked to.
 *
 * ## What extraction is allowed to do here
 *
 * Show its work. Where the application states an entity type, this offers it with the page it was
 * read from and a button. **It never applies it.** D-088 removed confidence from extraction on
 * purpose, so an extracted "LLC" is a value with provenance and no score — the right shape for
 * something a person reads, the wrong shape for something that silently deletes a requirement. And
 * the circularity settles it: an entity type applied by itself can remove the very document C-05
 * compares it against, leaving a report that looks complete and is not.
 */

import { useState } from 'react';
import { impossibleSlotKeys, UNKNOWN_FACTS } from '@mintro/ruleset';
import type { EntityType, PackageFacts } from '@mintro/ruleset';
import { browserSlotTemplate } from '../lib/documentsTemplate';
import type { PackageCreation } from '../lib/packageCreation';
import type { DocumentReading, DocumentSummary, PackageSummary, SlotSummary } from '../lib/packages';

const ENTITY_TYPES: readonly { readonly value: EntityType; readonly label: string }[] = [
  { value: 'sole_proprietor', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'non_profit', label: 'Non-profit' },
  { value: 'government', label: 'Government' },
];

const ENTITY_LABEL: Readonly<Record<EntityType, string>> = Object.fromEntries(
  ENTITY_TYPES.map((t) => [t.value, t.label]),
) as Record<EntityType, string>;

/**
 * What an extracted entity type would be, as one of the six the package records.
 *
 * A **suggestion**, and named as one. The document's own words are what the operator is shown; this
 * only decides which button to offer. Where the wording maps to nothing — a trust, an S-corp, a
 * classification we do not model — there is no button and the reading is still displayed, because
 * "the application says something we cannot act on" is worth seeing.
 *
 * Deliberately *not* `normaliseEntityType` from the engine. That one produces C-05's comparison
 * vocabulary (`s_corp`, `c_corp`, `trust`), which is a different set for a different purpose, and
 * routing one through the other would make a change to how C-05 compares documents silently change
 * which slots a package requires.
 */
export function suggestEntityType(text: string): EntityType | null {
  const t = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bsole (proprietor|prop)/.test(t) || /\bindividual\b/.test(t)) return 'sole_proprietor';
  if (/\bl ?l ?c\b/.test(t) || /limited liability/.test(t)) return 'llc';
  if (/\b(non profit|nonprofit)\b/.test(t) || /\b501 ?c/.test(t)) return 'non_profit';
  if (/\bgovernment\b|municipal|\bstate agency\b/.test(t)) return 'government';
  if (/\b(partnership|llp|lp)\b/.test(t)) return 'partnership';
  if (/\b(corporation|corp|incorporated|inc)\b/.test(t)) return 'corporation';
  return null;
}

type Tristate = 'yes' | 'no' | '';
const asTristate = (value: boolean | null): Tristate => (value === null ? '' : value ? 'yes' : 'no');
const fromTristate = (value: Tristate): boolean | null => (value === '' ? null : value === 'yes');

/** A reading, plus where it came from, as the panel needs it. */
export interface FactEvidence {
  readonly reading: DocumentReading;
  /** The slot the document sits in — "Pre App / Existing App", not a uuid. */
  readonly documentLabel: string;
  readonly suggestion: EntityType | null;
}

/**
 * Extracted entity types, with the document they were read from.
 *
 * Exported and pure so the wording can be tested without a database. Identical readings from the
 * same document collapse; the same value on two different documents does not, because two documents
 * agreeing is a different thing to see than one document saying it twice.
 */
export function entityEvidence(
  documents: readonly DocumentSummary[],
  slots: readonly SlotSummary[],
): readonly FactEvidence[] {
  const label = new Map(slots.map((s) => [s.id, s.instanceLabel ?? titleOf(s.slotKey)]));
  const seen = new Set<string>();
  const out: FactEvidence[] = [];
  for (const document of documents) {
    for (const reading of document.readings) {
      if (reading.field !== 'entity_type') continue;
      const documentLabel = label.get(document.slotId) ?? 'an uploaded document';
      const key = `${documentLabel}|${reading.value.toLowerCase()}|${reading.page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ reading, documentLabel, suggestion: suggestEntityType(reading.value) });
    }
  }
  return out;
}

function titleOf(slotKey: string): string {
  return slotKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PackageFactsPanelProps {
  readonly pkg: PackageSummary;
  readonly slots: readonly SlotSummary[];
  readonly documents: readonly DocumentSummary[];
  readonly creation: PackageCreation;
  readonly onSaved: () => void;
}

export function PackageFactsPanel({
  pkg,
  slots,
  documents,
  creation,
  onSaved,
}: PackageFactsPanelProps): JSX.Element {
  const [entityType, setEntityType] = useState<EntityType | ''>(pkg.facts.entityType ?? '');
  const [usDomiciled, setUsDomiciled] = useState<Tristate>(asTristate(pkg.facts.usDomiciled));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const settled = pkg.lifecycle !== 'open' && pkg.lifecycle !== 'reopened';
  const evidence = entityEvidence(documents, slots);

  const pending: PackageFacts = {
    ...UNKNOWN_FACTS,
    entityType: entityType === '' ? null : entityType,
    // Carried through unchanged. Nothing asks for it, and dropping it here would quietly clear an
    // answer somebody had recorded through another path (D-129).
    hasExistingProcessor: pkg.facts.hasExistingProcessor,
    usDomiciled: fromTristate(usDomiciled),
  };

  /*
    What these answers would waive.

    Computed from the same template and the same predicates the creation screen composed with, so
    answering afterwards removes exactly what answering beforehand would have. Narrowed to slots
    that are actually still outstanding, because that is what the function will act on and the
    operator should be told the true number before clicking, not after.
  */
  const outstanding = new Set(
    slots.filter((s) => s.origin === 'conditional' && (s.state === 'missing' || s.state === 'not_evaluable')).map((s) => s.slotKey),
  );
  const wouldWaive = impossibleSlotKeys(pending, browserSlotTemplate()).filter((key) => outstanding.has(key));

  const unchanged =
    pending.entityType === pkg.facts.entityType && pending.usDomiciled === pkg.facts.usDomiciled;

  const save = (): void => {
    setProblem(null);
    setOutcome(null);
    setBusy(true);
    void (async () => {
      try {
        const waived = await creation.setFacts({
          packageId: pkg.id,
          facts: pending,
          // The full list, not the narrowed one. The function decides what it can act on — a slot
          // that changed state between this render and the click is its problem to skip, not this
          // component's to have guessed correctly.
          waive: impossibleSlotKeys(pending, browserSlotTemplate()),
        });
        setOutcome(
          waived === 0
            ? 'Recorded. No document was removed from the set.'
            : `Recorded. ${waived} document${waived === 1 ? '' : 's'} waived as not applicable.`,
        );
        onSaved();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section className="pf" aria-label="About the business">
      <div className="pf-head">
        <h3>About the business</h3>
        <p className="pf-why">
          {pkg.factsSetAt === null
            ? 'Not answered yet. Every document that depends on these stays in the set until it is.'
            : 'Answered. Changing an answer waives the documents it rules out — it never deletes them.'}
        </p>
      </div>

      <div className="pf-answers">
        <label className="np-field">
          <span className="np-field-label">Entity type</span>
          <select
            className="input"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value === '' ? '' : (e.target.value as EntityType))}
            disabled={busy || settled}
          >
            <option value="">Not known yet</option>
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
            disabled={busy || settled}
          >
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      {evidence.length > 0 && (
        <div className="pf-evidence">
          <h4>What the documents say</h4>
          {/*
            Shown, offered, and never applied. The button fills the dropdown in — it does not save,
            so the answer is still a person's, taken after they saw the page it came from (D-129).
          */}
          <ul>
            {evidence.map((item) => (
              <li key={`${item.documentLabel}-${item.reading.page}-${item.reading.value}`}>
                <span className="pf-said">
                  {item.documentLabel} states <strong>{item.reading.value}</strong>
                </span>{' '}
                <span className="pf-prov">p.{item.reading.page}</span>{' '}
                {item.suggestion === null ? (
                  <span className="pf-nomatch">not one of the six recorded types — answer above</span>
                ) : (
                  <button
                    className="btn btn-ghost pf-use"
                    onClick={() => setEntityType(item.suggestion as EntityType)}
                    disabled={busy || settled || entityType === item.suggestion}
                  >
                    Use {ENTITY_LABEL[item.suggestion]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {wouldWaive.length > 0 && (
        <p className="pf-warn">
          Saving waives {wouldWaive.length} outstanding document
          {wouldWaive.length === 1 ? '' : 's'}: {wouldWaive.map(titleOf).join(', ')}.
        </p>
      )}

      {problem !== null && <div className="err">{problem}</div>}
      {outcome !== null && <p className="pf-outcome">{outcome}</p>}

      <div className="pf-foot">
        {settled ? (
          <p className="pf-why">This package is {pkg.lifecycle} — its document set is settled.</p>
        ) : (
          <button className="btn btn-primary" onClick={save} disabled={busy || unchanged}>
            {busy ? 'Saving…' : 'Record answers'}
          </button>
        )}
      </div>
    </section>
  );
}
