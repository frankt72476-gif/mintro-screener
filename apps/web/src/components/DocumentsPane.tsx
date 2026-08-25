/**
 * Documents check — the operator's upload page (M1).
 *
 * **Operator-only.** No agent link, no merchant link. Everything here is behind `is_analyst()`, and
 * there is no token route into it.
 *
 * **Slot-oriented, not file-oriented.** The operator sees the required set and uploads against it.
 * A file list would answer "what did we receive"; this answers "what is outstanding", which is the
 * question the page exists for.
 *
 * ## What this deliberately does not show
 *
 * **No extracted values.** M1 has no checks, so a value is an observation about a document and
 * nothing more — a field list here would look like verified data about the merchant, and people
 * would start trusting it before M4 exists to check it. What is shown instead is the *outcome* per
 * document and the *route* per page: whether we could read it, and how. An operator who cannot see
 * that a scan failed to read will not re-request it (D-092).
 *
 * **One named exception (D-129).** The facts panel shows what the application says the entity type
 * is, with the page it was read from, beside a button that fills the dropdown in. That is the
 * opposite of a field list presented as data: it is a value offered for a person to accept, and it
 * is never applied on its own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentsSendModal } from './DocumentsSendModal';
import { NewPackage } from './NewPackage';
import { PackageFactsPanel } from './PackageFacts';
import { RetentionPanel } from './RetentionPanel';
import { createPackageCreation } from '../lib/packageCreation';
import {
  createDocumentsSendQueue,
  type DocumentsSendQueue,
  type PastSend,
  type Sendability,
} from '../lib/documentsSendQueue';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPackages,
  type DocumentSummary,
  type PackageView,
  type SlotState,
  type SlotSummary,
} from '../lib/packages.js';

/** Fixed enumerations (D-079). An operator picks from a menu, never a text box. */
const NOT_PROVIDED_REASONS: readonly [string, string][] = [
  ['new_business_no_processing_history', 'New business — no prior processing history'],
  ['prior_processing_cash_or_check_only', 'Prior processing was cash or check only'],
  ['prior_processor_will_not_release', 'Prior processor will not release statements'],
  ['account_closed_records_unavailable', 'Account closed — records no longer available'],
  ['does_not_exist_for_entity_type', 'Document does not exist for this entity type'],
  ['issuing_authority_will_not_reissue', 'Issuing authority will not reissue'],
  ['lost_or_destroyed_cannot_reissue', 'Lost or destroyed, cannot be reissued'],
  ['provided_directly_to_processor', 'Provided directly to processor outside this package'],
  ['merchant_declines', 'Merchant declines to provide'],
];

const WAIVED_REASONS: readonly [string, string][] = [
  ['processor_confirmed_not_required', 'Processor confirmed not required'],
  ['not_applicable_to_entity_type', 'Not applicable to this entity type'],
  ['superseded_by_another_document', 'Superseded by another document in this package'],
  ['provided_under_prior_package', 'Provided under a prior package for this merchant'],
];

const STATE_LABEL: Record<SlotState, string> = {
  satisfied: 'Satisfied',
  not_provided: 'Not provided',
  waived: 'Waived',
  superseded: 'Superseded',
  missing: 'Missing',
  not_evaluable: 'Not evaluable',
};

const OUTCOME_LABEL: Record<DocumentSummary['outcome'], string> = {
  extracted: 'Read',
  unreadable: 'Could not be read',
  unsupported: 'Type not supported',
  encrypted: 'Password protected',
};

function slotTitle(slot: SlotSummary): string {
  const base = slot.slotKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return slot.instanceLabel === null ? base : `${base} — ${slot.instanceLabel}`;
}

/**
 * What the slot asks for, in words.
 *
 * `not_evaluable` reads as an unknown count rather than a number, because that is the fact: we do
 * not know how many owner IDs to expect, so we cannot say any are absent (D-107).
 */
function requirementLine(slot: SlotSummary, held: number): string {
  if (slot.requiredCount === null) {
    return 'Required count unknown — derived from the application’s ownership section, which has not been read.';
  }
  const months = slot.coverageMonthly
    ? ` · ${slot.requiredCount} consecutive calendar months, ${slot.coverageGraceDays ?? 0}-day grace`
    : '';
  return `${held} of ${slot.requiredCount} held${months}`;
}

export interface DocumentsPaneProps {
  readonly client: SupabaseClient;
  readonly analystId: string;
  /** The package on screen. Absent until a package is created — M1 has no package picker. */
  readonly packageId: string | null;
}

export function DocumentsPane({ client, analystId, packageId }: DocumentsPaneProps): JSX.Element {
  const [view, setView] = useState<PackageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendable, setSendable] = useState<Sendability | null>(null);
  const [history, setHistory] = useState<readonly PastSend[]>([]);
  const sendQueue = useRef<DocumentsSendQueue>(createDocumentsSendQueue(client, analystId));
  const creation = useRef(createPackageCreation(client));
  const [creating, setCreating] = useState(false);
  const packages = useRef(createPackages(client));

  const refresh = useCallback(async () => {
    if (packageId === null) return;
    const result = await packages.current.load(packageId);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setView(result);
    if (packageId !== null) {
      // Read together, because the button and the history are two halves of one answer: whether
      // this run may be sent, and what has already gone out.
      const [state, past] = await Promise.all([
        sendQueue.current.sendability(packageId).catch(() => null),
        sendQueue.current.history(packageId).catch(() => []),
      ]);
      setSendable(state);
      setHistory(past);
    }
  }, [packageId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While anything is queued or running, poll: ingest is a worker job and the page is watching a
  // row, not awaiting a call.
  const pending = (view?.uploads ?? []).some((u) => u.status === 'queued' || u.status === 'running');
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const onFile = useCallback(
    async (slotId: string, file: File, replacesDocumentId?: string) => {
      if (packageId === null) return;
      setBusySlot(slotId);
      const result = await packages.current.queueUpload({
        packageId,
        slotId,
        file,
        analystId,
        ...(replacesDocumentId === undefined ? {} : { replacesDocumentId }),
      });
      setBusySlot(null);
      if ('error' in result) setError(result.error);
      await refresh();
    },
    [packageId, analystId, refresh],
  );

  /*
    Setting a slot state.

    Through `set_slot_state` (0034), not a PostgREST update. `update` on `slots` is revoked from
    `authenticated` and always has been, so the direct call this replaces could never affect a row.
    No operator has ever managed to mark a slot not-provided.

    **It failed loudly, not silently.** A revoked grant raises `42501 permission denied for table
    slots`, supabase-js puts that in `error`, and the code below already surfaced it. Worth stating
    because the opposite was assumed and is the more dangerous shape: a revoked *grant* raises,
    while a *present* grant whose RLS policy filters the row returns 204 with zero rows and no
    error. Nothing in this schema is in the second shape — `authenticated` holds no UPDATE or
    DELETE grant on any table, verified against production — so there is no silent write path
    here. The bug was a visible error nobody had exercised, which is a different problem.

    The function also records `resolved_by`. Every state change from this page is `'operator'` by
    construction: a person clicked it. `'fact'` belongs to `set_package_facts` alone.
  */
  const setSlot = useCallback(
    async (slotId: string, state: SlotState, reason: string | null) => {
      setBusySlot(slotId);
      const { error: rpcError } = await client.rpc('set_slot_state', {
        p_slot_id: slotId,
        p_state: state,
        p_reason: reason,
        p_resolved_by: 'operator',
      });
      setBusySlot(null);
      if (rpcError !== null) setError(rpcError.message);
      await refresh();
    },
    [client, refresh],
  );

  if (packageId === null) {
    return (
      <>
        <h1>Documents check</h1>
        <p className="sub">
          Uploads attach to a package — an application attempt, not a merchant. Create one to begin.
        </p>
        <div className="doc-send">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New package
          </button>
        </div>
        {creating && (
          <NewPackage
            creation={creation.current}
            onCancel={() => setCreating(false)}
            // The package is opened by navigating to it, so a reload lands on the same place and
            // the URL is shareable — the same `?package=` the upload page already reads.
            onCreated={(id) => {
              window.location.search = `?package=${id}`;
            }}
          />
        )}
      </>
    );
  }

  if (error !== null && view === null) {
    return (
      <>
        <h1>Documents check</h1>
        <p className="sub">Could not load the package: {error}</p>
      </>
    );
  }

  if (view === null) {
    return (
      <>
        <h1>Documents check</h1>
        <p className="sub">Loading…</p>
      </>
    );
  }

  const documentsBySlot = new Map<string, DocumentSummary[]>();
  for (const doc of view.documents) {
    const list = documentsBySlot.get(doc.slotId) ?? [];
    list.push(doc);
    documentsBySlot.set(doc.slotId, list);
  }
  const supersededIds = new Set(view.documents.map((d) => d.supersedes).filter((id): id is string => id !== null));

  return (
    <>
      <h1>Documents check</h1>
      <p className="sub">
        {view.pkg.processorKey} · {view.pkg.lifecycle} · template {view.pkg.templateVersion}
      </p>

      {/*
        The send control.

        The stale-run gate answers before the modal opens (D-117). Where the run no longer describes
        the package the button is replaced by the reason — asking for a recipient and then refusing
        reads as the tool losing the send, and the operator can act on "run it again" immediately.
      */}
      <div className="doc-send">
        {sendable === null ? null : sendable.sendable && sendable.runId !== null ? (
          <button className="btn btn-primary" onClick={() => setSending(true)}>
            Send to agent
          </button>
        ) : (
          <p className="doc-send-blocked" role="status">
            {sendable.reason}
          </p>
        )}
        {history.length === 0 ? null : (
          <span className="doc-send-count">
            {history.length} previous send{history.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {sending && sendable?.runId != null && (
        <DocumentsSendModal
          packageId={packageId}
          runId={sendable.runId}
          merchantName={view.pkg.merchantName}
          queue={sendQueue.current}
          history={history}
          onCancel={() => setSending(false)}
          onSent={() => {
            setSending(false);
            void refresh();
          }}
        />
      )}
      {error !== null ? <p className="sub" role="alert">{error}</p> : null}

      {/*
        Above the grid, because it changes what the grid contains. An operator who answers the
        entity type here watches documents leave the set below, which is the connection the ordering
        has to make legible.
      */}
      <PackageFactsPanel
        pkg={view.pkg}
        slots={view.slots}
        documents={view.documents}
        creation={creation.current}
        onSaved={() => void refresh()}
      />

      {/*
        Below the facts and above the grid. Retention is about the package as a whole rather than
        about any one document, and it is the last thing that happens to one.
      */}
      <RetentionPanel client={client} analystId={analystId} packageId={packageId} />

      <p className="sub">
        Values read from these documents are not shown here. M1 records what each document is and
        whether it could be read; nothing has checked anything against anything yet.
      </p>

      <div className="doc-grid">
        {view.slots.map((slot) => {
          const docs = documentsBySlot.get(slot.id) ?? [];
          const live = docs.filter((d) => !supersededIds.has(d.versionId));
          const queued = view.uploads.filter((u) => u.slotId === slot.id);
          const busy = busySlot === slot.id;

          return (
            <div className="card doc-card" key={slot.id}>
              <h3>
                {slotTitle(slot)}{' '}
                <span className={`state state-${slot.state}`}>{STATE_LABEL[slot.state]}</span>
              </h3>

              <p className="d">{requirementLine(slot, live.length)}</p>
              {!slot.examined ? (
                <p className="d">Collected only — present, not examined.</p>
              ) : null}
              {slot.reason !== null ? <p className="d">Reason: {slot.reason.replace(/_/g, ' ')}</p> : null}

              <ul className="doc-list">
                {docs.map((doc) => (
                  <li key={doc.versionId}>
                    <span className="m">v{doc.version}</span>
                    {doc.originalFilename ?? '(unnamed)'} — <strong>{OUTCOME_LABEL[doc.outcome]}</strong>
                    {doc.outcomeReason !== null ? <> · {doc.outcomeReason}</> : null}
                    {supersededIds.has(doc.versionId) ? <> · superseded, still readable</> : null}
                    {doc.pageRoutes.length > 0 ? (
                      <div className="d">
                        {doc.pageRoutes.map((p) => (
                          <span key={p.page}>
                            p{p.page}:{p.route}
                            {p.reason === null ? '' : ` (${p.reason})`}{' '}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <label>
                      Replace
                      <input
                        type="file"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file !== undefined) void onFile(slot.id, file, doc.documentId);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </li>
                ))}
                {queued.map((u) => (
                  <li key={u.id}>
                    <span className="m">…</span>
                    {u.filename} — {u.status}
                    {u.error === null ? null : <> · {u.error}</>}
                  </li>
                ))}
              </ul>

              <label>
                Add a document
                <input
                  type="file"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file !== undefined) void onFile(slot.id, file);
                    e.target.value = '';
                  }}
                />
              </label>

              {/*
                Resolving a slot is a menu of the fixed reasons, never a text box (D-079). Free
                text is unreproducible, and it is where "this looks fine to me" gets into a
                document forwarded under Mintro's name.
              */}
              <label>
                Not provided
                <select
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') void setSlot(slot.id, 'not_provided', e.target.value);
                  }}
                >
                  <option value="">Choose a reason…</option>
                  {NOT_PROVIDED_REASONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label>
                Waive
                <select
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') void setSlot(slot.id, 'waived', e.target.value);
                  }}
                >
                  <option value="">Choose a reason…</option>
                  {WAIVED_REASONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
}
