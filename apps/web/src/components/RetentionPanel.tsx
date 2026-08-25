/**
 * Retention: the export, its verification, and the dry run (D-130, P4).
 *
 * One panel because it is one sequence — export, verify, attest, plan, purge — and a screen that
 * showed three of those and left the fourth to a script would be a screen an operator learns to
 * distrust.
 *
 * ## What this deliberately cannot do
 *
 * **There is no purge button, and no code path here reaches the executor.** The dry run is the only
 * thing this queues. Deletion happens when a person decides it does, after a reconciliation they
 * have read — and a button that is safe only because nobody currently holds `purge_approver` is a
 * button that becomes unsafe the moment somebody does.
 *
 * ## What it says about a verification, and how carefully
 *
 * A verification is a measurement of hop 1: the archive on the operator's disk is the one the export
 * recorded. An attestation is a person saying they moved it to the vault. The two are shown in
 * different words, in different rows, and the panel never renders an attestation as a check —
 * D-064, where "the mailer accepted it" and "it was transmitted" being one field put a report in a
 * recipient's inbox with nothing behind it.
 *
 * **The manifest hash is not shown until a verification exists.** Displaying it first is what would
 * reduce a returned hash to reading a number off the screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExportControls } from './ExportControls';
import { createExportRequests, type ExportRequestRecord } from '../lib/exportRequests';
import {
  createRetention,
  isVerifiedForPurge,
  PURGE_ELIGIBLE_DAYS,
  type ExportRecord,
  type PurgePlanRecord,
  type RetentionView,
} from '../lib/retention';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RetentionPanelProps {
  readonly client: SupabaseClient;
  readonly analystId: string;
  readonly packageId: string;
}

const day = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

/** How a verification reads. The method is the point, so it is never abbreviated away. */
const METHOD_LABEL: Readonly<Record<string, string>> = {
  read_back: 'read back from disk',
  reupload: 'file re-selected and hashed',
  declared: 'hash typed by the operator',
};

function Verifications({ record }: { readonly record: ExportRecord }): JSX.Element {
  if (record.verifications.length === 0) {
    return <p className="rt-none">Not verified. The archive has not been read back and checked.</p>;
  }
  return (
    <ul className="rt-list">
      {record.verifications.map((v, i) => (
        <li key={`${v.verifiedAt}-${i}`} data-outcome={v.outcome} data-method={v.method}>
          <span className="rt-outcome" data-outcome={v.outcome}>
            {v.outcome === 'matched' ? 'matched' : 'did not match'}
          </span>{' '}
          <span className="rt-method">{METHOD_LABEL[v.method] ?? v.method}</span>{' '}
          <span className="rt-detail">
            {/*
              Zero is shown rather than hidden. A declared hash examined nothing, and the number is
              how a reader tells the weakest method from the strongest at a glance.
            */}
            {v.membersChecked} file{v.membersChecked === 1 ? '' : 's'} checked · {day(v.verifiedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Plan({ record }: { readonly record: PurgePlanRecord }): JSX.Element {
  const plan = record.plan;
  return (
    <li className="rt-plan" data-status={record.status} data-refused={record.refusals.length > 0}>
      <div className="rt-plan-head">
        <span className="rt-status" data-status={record.status}>
          {record.status}
        </span>{' '}
        <span className="rt-detail">{day(record.createdAt)}</span>
      </div>

      {record.error !== null && <p className="err">{record.error}</p>}

      {plan !== null && (
        <p className="rt-detail">
          {plan.targets?.length ?? 0} object{(plan.targets?.length ?? 0) === 1 ? '' : 's'} would be
          deleted{plan.bytes === undefined ? '' : ` · ${kb(plan.bytes)}`}
          {(plan.alreadyPurged?.length ?? 0) > 0 && ` · ${plan.alreadyPurged?.length} already purged`}
        </p>
      )}

      {/*
        The refusals, in full and never summarised to a count.

        An object the reconciliation cannot account for is the finding this whole surface exists to
        produce. Collapsing it to "3 problems" would make the one thing worth reading the one thing
        somebody has to click for.
      */}
      {record.refusals.length > 0 && (
        <div className="rt-refusals">
          <h5>This purge would be refused</h5>
          <ul>
            {record.refusals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {plan !== null && (plan.unexpected?.length ?? 0) > 0 && (
        <details className="rt-objects">
          <summary>{plan.unexpected?.length} object(s) accounted for by no row</summary>
          <ul>
            {plan.unexpected?.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function RetentionPanel({ client, analystId, packageId }: RetentionPanelProps): JSX.Element {
  const [view, setView] = useState<RetentionView | null>(null);
  const [requestRecords, setRequestRecords] = useState<readonly ExportRequestRecord[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const retention = createRetention(client);

  const requests = createExportRequests(client);

  const refresh = useCallback(async () => {
    const result = await createRetention(client).load(packageId);
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setView(result);
    // Read together, because the export request and the export it produced are two halves of one
    // row on screen: a queued request has no anchor yet, and an anchor with no request is history.
    setRequestRecords(await createExportRequests(client).list(packageId).catch(() => []));
  }, [client, packageId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A queued plan or export is a worker job; the page watches a row, the same as an upload does.
  const working = (r: { status: string }): boolean => r.status === 'queued' || r.status === 'running';
  const pending = (view?.plans ?? []).some(working) || requestRecords.some(working);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const dryRun = (): void => {
    setBusy(true);
    void (async () => {
      const result = await retention.requestDryRun(packageId, analystId);
      setBusy(false);
      if ('error' in result) setProblem(result.error);
      await refresh();
    })();
  };

  if (view === null) {
    return (
      <section className="rt" aria-label="Retention">
        <h3>Retention</h3>
        <p className="rt-detail">{problem ?? 'Loading…'}</p>
      </section>
    );
  }

  return (
    <section className="rt" aria-label="Retention">
      <div className="rt-head">
        <h3>Retention</h3>
        <p className="rt-why">
          {view.retentionStartedAt === null
            ? `The retention clock starts when this package is submitted or cancelled. Purge candidacy is ${PURGE_ELIGIBLE_DAYS} days after that.`
            : `Closed ${day(view.retentionStartedAt)} · candidate for deletion from ${day(view.purgeEligibleAt)}.`}
        </p>
      </div>

      {view.purged && (
        <p className="rt-purged">
          The document bodies for this package have been purged. The findings, run history, send log
          and slot states remain.
        </p>
      )}

      <ExportControls
        client={client}
        analystId={analystId}
        packageId={packageId}
        requests={requests}
        requestRecords={requestRecords}
        exports={view.exports}
        onChanged={() => void refresh()}
      />

      <div className="rt-block">
        <h4>Exports on record</h4>
        {view.exports.length === 0 ? (
          <p className="rt-none">No export has been taken. Bodies cannot be purged until one has.</p>
        ) : (
          <ul className="rt-list">
            {view.exports.map((record) => (
              <li key={record.id} className="rt-export" data-verified={isVerifiedForPurge(record)}>
                <div className="rt-export-head">
                  <span className="rt-detail">
                    {day(record.exportedAt)} · {kb(record.bytes)} ·{' '}
                    {Object.values(record.counts).reduce((a, b) => a + b, 0)} rows
                  </span>
                  {/*
                    Shown only once something has been verified. Before that it is the answer to the
                    question the operator is about to be asked (D-130).
                  */}
                  {record.verifications.length > 0 && (
                    <code className="rt-hash" title="manifest SHA-256">
                      {record.manifestSha256.slice(0, 16)}…
                    </code>
                  )}
                </div>

                <Verifications record={record} />

                {record.attestations.length > 0 && (
                  <div className="rt-attest">
                    {/*
                      Worded as a statement, never as a check. Nothing verified this and nothing
                      could — the vault is out of band (D-064, D-130).
                    */}
                    <h5>Stated by an operator, not verified</h5>
                    <ul>
                      {record.attestations.map((a) => (
                        <li key={a.attestedAt}>
                          “{a.statement}” — {a.destination}, {day(a.attestedAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rt-block">
        <div className="rt-block-head">
          <h4>Dry runs</h4>
          <button className="btn btn-ghost" onClick={dryRun} disabled={busy || pending}>
            {pending ? 'Running…' : 'Run a dry run'}
          </button>
        </div>
        <p className="rt-why">
          Lists what is actually in storage for this package and compares it with what the database
          expects. Deletes nothing.
        </p>
        {view.plans.length === 0 ? (
          <p className="rt-none">No dry run yet.</p>
        ) : (
          <ul className="rt-list">
            {view.plans.map((p) => (
              <Plan key={p.id} record={p} />
            ))}
          </ul>
        )}
      </div>

      {problem !== null && <div className="err">{problem}</div>}
    </section>
  );
}
