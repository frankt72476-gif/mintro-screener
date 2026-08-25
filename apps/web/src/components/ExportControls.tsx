/**
 * The export and verification controls (D-130, P6).
 *
 * The panel could show exports and could not take one, and `exportVerification.ts` was written,
 * tested and **tree-shaken out of the bundle** because nothing imported it. This is the component
 * that imports it, and the sequence an operator actually walks:
 *
 *     request  →  the worker builds  →  save to disk  →  read back and check  →  attest  →  discard
 *
 * ## The manifest hash is not shown until something has been verified
 *
 * Displaying it first is what would reduce a returned hash to reading a number off the screen
 * (D-130). It is recorded at export time — that row is the anchor — and shown afterwards, as a
 * receipt for what was checked.
 *
 * ## An attestation is never rendered as a verification
 *
 * Hop 1 is measured on this machine. Hop 2 is a person saying they moved a file somewhere nobody
 * here can ask about. They are different controls, worded differently, and D-064 is why: a send
 * that returned 200 and wrote no row put a report in a recipient's inbox with nothing behind it,
 * because "the mailer accepted it" and "it went" were one field.
 *
 * ## There is no purge control here and there will not be one
 *
 * Nothing in `apps/web` reaches the executor. A button that is safe only because nobody holds
 * `purge_approver` becomes unsafe the moment somebody does.
 */

import { useState } from 'react';
import {
  createExportVerification,
  type ExportVerification,
  type VerificationOutcome,
} from '../lib/exportVerification';
import type { ExportRequestRecord, ExportRequests } from '../lib/exportRequests';
import type { ExportRecord } from '../lib/retention';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExportControlsProps {
  readonly client: SupabaseClient;
  readonly analystId: string;
  readonly packageId: string;
  readonly requests: ExportRequests;
  readonly requestRecords: readonly ExportRequestRecord[];
  /** The recorded exports, so a request can be matched to its anchor row. */
  readonly exports: readonly ExportRecord[];
  readonly onChanged: () => void;
}

const kb = (bytes: number | null): string => (bytes === null ? '—' : `${(bytes / 1024).toFixed(1)} KB`);

export function ExportControls({
  client, analystId, packageId, requests, requestRecords, exports, onChanged,
}: ExportControlsProps): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [attesting, setAttesting] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [statement, setStatement] = useState('');
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [declared, setDeclared] = useState('');

  const verification: ExportVerification = createExportVerification(client);

  const run = (what: string, job: () => Promise<string | null>): void => {
    setBusy(what);
    setProblem(null);
    setOutcome(null);
    void (async () => {
      try {
        setOutcome(await job());
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
        onChanged();
      }
    })();
  };

  const say = (result: VerificationOutcome | null): string =>
    result === null
      ? 'Cancelled — nothing was recorded.'
      : result.outcome === 'matched' && result.result.ok
        ? `Verified: ${result.result.membersChecked} files checked against the manifest.`
        : `Did not verify. ${result.result.problems[0] ?? 'The manifest did not match what was recorded.'}`;

  const recorded = (exportId: string | null): ExportRecord | undefined =>
    exports.find((e) => e.id === exportId);

  return (
    <div className="rt-block">
      <div className="rt-block-head">
        <h4>Take an export</h4>
        <button
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() =>
            run('request', async () => {
              const result = await requests.request(packageId, analystId);
              if ('error' in result) throw new Error(result.error);
              return 'Queued. The worker builds it — this can take a minute for a package with sends.';
            })
          }
        >
          Request an export
        </button>
      </div>
      <p className="rt-why">
        The worker builds it: reading the document bodies needs the service key, and every report
        that was sent is re-rendered into the archive because only its hash was ever kept.
      </p>

      {requestRecords.length === 0 ? (
        <p className="rt-none">No export has been requested.</p>
      ) : (
        <ul className="rt-list">
          {requestRecords.map((request) => {
            const anchor = recorded(request.exportId);
            const verified = (anchor?.verifications ?? []).some((v) => v.outcome === 'matched' && v.method !== 'declared');
            return (
              <li key={request.id} className="rt-request" data-status={request.status}>
                <div className="rt-plan-head">
                  <span className="rt-status" data-status={request.status}>{request.status}</span>{' '}
                  <span className="rt-detail">
                    {request.createdAt.slice(0, 10)} · {kb(request.bytes)}
                    {request.discardedAt === null ? '' : ' · staged copy discarded'}
                  </span>
                </div>

                {request.error !== null && <p className="err">{request.error}</p>}

                {/*
                  Recorded, not hidden. `document_report_sends` keeps a PDF's hash and never its
                  bytes, so a renderer change since the send moves it — and export time is the last
                  moment anybody can check the difference at all (D-130).
                */}
                {request.reportHashMismatches > 0 && (
                  <p className="rt-detail">
                    {request.reportHashMismatches} re-rendered report
                    {request.reportHashMismatches === 1 ? '' : 's'} no longer hash to what the send
                    log recorded. The archive carries what was rendered now.
                  </p>
                )}

                {request.status === 'done' && request.discardedAt === null && request.downloadUrl === null && (
                  <p className="rt-none">
                    The download link has lapsed. Take a new export to fetch the archive again.
                  </p>
                )}

                {request.status === 'done' && request.downloadUrl !== null && request.discardedAt === null && (
                  <div className="rt-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null || anchor === undefined}
                      onClick={() =>
                        run('verify', async () => {
                          const archive = await requests.download(request.downloadUrl!);
                          const result = await verification.writeAndVerify({
                            exportId: anchor!.id,
                            archive,
                            expectedManifestSha256: anchor!.manifestSha256,
                            suggestedName: `mintro-package-${packageId.slice(0, 8)}.tar`,
                          });
                          if (result !== null) return say(result);
                          // No File System Access API. Not a verification, and it must not record
                          // one — the operator is offered the fallback instead.
                          return 'This browser cannot save and read back. Save the file, then use “I saved it — check it”.';
                        })
                      }
                    >
                      Save and verify
                    </button>

                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null || anchor === undefined}
                      onClick={() =>
                        run('reverify', async () =>
                          say(
                            await verification.reselectAndVerify({
                              exportId: anchor!.id,
                              expectedManifestSha256: anchor!.manifestSha256,
                            }),
                          ),
                        )
                      }
                    >
                      I saved it — check it
                    </button>

                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null}
                      onClick={() => setDeclaring(declaring === request.id ? null : request.id)}
                    >
                      Record a hash by hand
                    </button>

                    {verified && (
                      <>
                        <button
                          className="btn btn-ghost"
                          disabled={busy !== null}
                          onClick={() => setAttesting(attesting === request.id ? null : request.id)}
                        >
                          Say where it went
                        </button>
                        <button
                          className="btn btn-ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            run('discard', async () => {
                              const failed = await requests.discard(request.id);
                              if (failed !== null) throw new Error(failed.error);
                              return 'The staged copy will be removed. The record of the export stays.';
                            })
                          }
                        >
                          Discard the staged copy
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/*
                  The receipt, and only now. Before a verification this is the answer to the
                  question the operator is about to be asked (D-130).
                */}
                {anchor !== undefined && anchor.verifications.length > 0 && (
                  <p className="rt-detail">
                    Manifest <code className="rt-hash">{anchor.manifestSha256}</code>
                  </p>
                )}

                {declaring === request.id && anchor !== undefined && (
                  <div className="rt-form">
                    <p className="rt-why">
                      Recorded as a hash you typed. It does not count as a verified copy, and a purge
                      cannot be approved on it.
                    </p>
                    <input
                      className="input"
                      placeholder="The manifest SHA-256 from the archive"
                      value={declared}
                      onChange={(e) => setDeclared(e.target.value.trim())}
                      aria-label="Declared manifest hash"
                    />
                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null || !/^[0-9a-f]{64}$/.test(declared)}
                      onClick={() =>
                        run('declare', async () => {
                          const result = await verification.declare({ exportId: anchor.id, hash: declared });
                          setDeclaring(null);
                          setDeclared('');
                          return `Recorded as declared (${result.outcome}). This does not open the purge gate.`;
                        })
                      }
                    >
                      Record it
                    </button>
                  </div>
                )}

                {attesting === request.id && anchor !== undefined && (
                  <div className="rt-form">
                    {/*
                      Worded as a statement throughout. Nothing here checked anything, and the
                      database keeps it in its own table for that reason.
                    */}
                    <p className="rt-why">
                      Your own words. Nothing verifies this — the vault is somewhere this system
                      cannot ask about.
                    </p>
                    <input
                      className="input"
                      placeholder="Where you put it"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      aria-label="Destination"
                    />
                    <input
                      className="input"
                      placeholder="What you did"
                      value={statement}
                      onChange={(e) => setStatement(e.target.value)}
                      aria-label="Statement"
                    />
                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null || destination.trim() === '' || statement.trim() === ''}
                      onClick={() =>
                        run('attest', async () => {
                          await verification.attest({
                            exportId: anchor.id,
                            destination: destination.trim(),
                            statement: statement.trim(),
                          });
                          setAttesting(null);
                          setDestination('');
                          setStatement('');
                          return 'Recorded as your statement, not as a check.';
                        })
                      }
                    >
                      Record the statement
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {problem !== null && <div className="err">{problem}</div>}
      {outcome !== null && <p className="rt-outcome-line">{outcome}</p>}
    </div>
  );
}
