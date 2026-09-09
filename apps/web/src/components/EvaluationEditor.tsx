/**
 * The operator's editor: the evaluation, editable in place (D-261).
 *
 * ## The same component, in edit mode
 *
 * `EvaluationReport` renders it, with an `edit` prop. That is the addendum's requirement in as many
 * words — *the operator sees exactly what the reader will see* — and a second editing screen would
 * be a second rendering of one document. Two renderings drift; this repository has the scars, which
 * is why the PDF is printed from the report route rather than composed again.
 *
 * ## Nothing here is a gate
 *
 * The caller decides whether to mount this at all, and a caller who mounts it for the wrong person
 * has not granted them anything: `edit_evaluation_draft` and `evaluation_requests_insert` resolve
 * the capability from `auth.uid()` inside the database (0081). This screen is layer (1) of D-230 —
 * what a person is offered — and the API is the layer that holds when it is bypassed.
 *
 * ## Save replaces the document
 *
 * The editor holds one draft in state and each control returns the next one, so Save sends what is
 * on the screen. A patch protocol would be a second description of the draft's shape, and it would
 * drift from the schema the first time a field was added.
 *
 * ## Regenerate is a row, not a call
 *
 * Generating a draft opens a browser, reads stored DOM artifacts and calls the vendor — none of it
 * reachable from a tab. So it is a queue row and the worker does the work, exactly as Rescan and
 * Download PDF already are. What comes back is the draft's own `validator_status`, and a refused
 * draft is shown as refused with its reason: the content is kept so it can be repaired, and this
 * screen is where the repair happens.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScreeningReport } from '@mintro/engine';
import {
  EvaluationReport,
  type EvaluationEdit,
  type PublishedBy,
} from './EvaluationReport.js';
import { EvaluationEvidence, EvaluationNotChecked, anchoredRuleIds } from './EvaluationEvidence.js';
import { EvidenceDisclosureProvider } from './EvidenceDisclosure.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import {
  type EvaluationLabels,
  type EvaluationRunContext,
  type FindingState,
  type StoredDraft,
  type StoredHandles,
} from '../lib/evaluationView.js';

interface DraftRow {
  readonly content: StoredDraft | null;
  readonly handles: StoredHandles | null;
  readonly validator_status: string;
  readonly validator_message: string | null;
  readonly ruleset_version: string;
  readonly angles_version: string;
  readonly model: string;
  readonly edited_at: string | null;
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'absent' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly row: DraftRow;
      readonly run: EvaluationRunContext;
      readonly report: ScreeningReport | null;
      /** The newest published version, or `null` while the run is still a draft. */
      readonly published: PublishedRow | null;
    };

/** What Save is doing, so the button says it rather than appearing inert. */
type Saving = 'idle' | 'saving' | 'saved' | { readonly failed: string };

/**
 * The publish request, as the editor watches it.
 *
 * Publishing is a queue row and the worker answers it, so the button cannot report the outcome —
 * it can only say that the question was asked. This is what the answer looks like when it lands.
 */
interface PublishRow {
  readonly id: string;
  readonly status: string;
  readonly refusal: string | null;
  readonly error: string | null;
  readonly evaluation_id: string | null;
}

/** A published version, as the masthead needs it. */
interface PublishedRow {
  readonly version: number;
  readonly content: StoredDraft;
  readonly published_at: string;
  readonly analysts: { readonly full_name: string | null; readonly email: string } | null;
}

/** How long between polls of the publish request. The job is seconds, not minutes. */
const POLL_MS = 2_000;

export function EvaluationEditor({
  client,
  runId,
  access,
  labels,
  analystId,
  canEdit,
}: {
  readonly client: SupabaseClient;
  readonly runId: string;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly analystId: string;
  /**
   * Whether this person may edit.
   *
   * Presence of the controls only. The gate of record is 0081's function guard and insert policy,
   * which resolve the capability from `auth.uid()`; drawing the controls for somebody without it
   * would not let them save, it would let them try and be refused — which is worse than a
   * read-only document (the reasoning `showsSubmitAction` already carries).
   */
  readonly canEdit: boolean;
}): JSX.Element | null {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const [saving, setSaving] = useState<Saving>('idle');
  const [regenerating, setRegenerating] = useState(false);
  const [publishing, setPublishing] = useState<PublishRow | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [draftRead, publishedRead, runRead, findingsRead, evidenceRead] = await Promise.all([
        client
          .from('evaluation_drafts')
          .select(
            'content, handles, validator_status, validator_message, ruleset_version, angles_version, model, edited_at',
          )
          .eq('run_id', runId)
          .maybeSingle(),
        /*
          The newest published version.

          Read alongside the draft rather than instead of it: publishing deletes the draft, so a run
          that has been published has one of these and no draft, and a run mid-edit has the reverse.
          Reading both in one round trip means the screen never shows "no evaluation" for a document
          that exists.
        */
        client
          .from('evaluations')
          /*
            The relationship is named, not inferred.

            PostgREST resolves an unnamed embed by looking for exactly one foreign key between the
            two tables, and answers PGRST201 — failing the whole query — the day a second one
            arrives. D-213 is that bug, and `embeds.test.ts` reads this line out of the source and
            asks the database about it.
          */
          .select(
            'version, content, published_at, analysts!evaluations_published_by_fkey (full_name, email)',
          )
          .eq('run_id', runId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client.from('runs').select('report').eq('id', runId).maybeSingle(),
        client.from('findings').select('id, rule_id, state, evidence_key').eq('run_id', runId),
        client.from('evidence').select('key, kind, url').eq('run_id', runId),
      ]);

      if (!live) return;

      if (draftRead.error !== null) {
        setLoad({ status: 'error', message: draftRead.error.message });
        return;
      }
      const publishedRow = (publishedRead.data as unknown as PublishedRow | null) ?? null;

      // No draft and no published version is not an error. Most runs have never been evaluated, and
      // this screen sits above a report that stands on its own.
      if (draftRead.data === null && publishedRow === null) {
        setLoad({ status: 'absent' });
        return;
      }

      /*
        A published run has no draft. The row below is the draft's metadata, and a published version
        carries its own — so the versions and the model come off whichever exists.
      */
      const row = (draftRead.data as unknown as DraftRow | null) ?? {
        content: publishedRow!.content,
        handles: null,
        validator_status: 'ok',
        validator_message: null,
        ruleset_version: '',
        angles_version: '',
        model: '',
        edited_at: null,
      };
      const report = (runRead.data as { report?: ScreeningReport } | null)?.report ?? null;

      setDraft(row.content);
      setLoad({
        status: 'ready',
        row,
        report,
        published: publishedRow,
        run: {
          runId,
          merchantDomain: report?.merchantDomain ?? null,
          screenedAt: report?.finishedAt ?? null,
          rulesetVersion: row.ruleset_version,
          anglesVersion: row.angles_version,
          model: row.model,
          handles: row.handles ?? { finding: {}, evidence: {}, eye_test: {}, angle: {} },
          ...(report === null ? {} : { anchoredRuleIds: anchoredRuleIds(report) }),
          // The same run fact the published render carries, from the same place (D-264).
          ...(report?.challenge === undefined ? {} : { challenge: report.challenge }),
          findings: (findingsRead.data ?? []).map((finding) => ({
            id: finding['id'] as string,
            ruleId: finding['rule_id'] as string,
            state: finding['state'] as FindingState,
            evidenceKey: (finding['evidence_key'] as string | null) ?? null,
          })),
          evidence: (evidenceRead.data ?? []).map((entry) => ({
            key: entry['key'] as string,
            kind: entry['kind'] as string,
            url: entry['url'] as string,
          })),
        },
      });
    })();

    return () => {
      live = false;
    };
  }, [client, runId, reloads]);

  const save = useCallback(async () => {
    if (draft === null) return;
    setSaving('saving');
    const { error } = await client.rpc('edit_evaluation_draft', {
      p_run_id: runId,
      p_content: draft,
    });
    setSaving(error === null ? 'saved' : { failed: error.message });
  }, [client, draft, runId]);

  /*
    Publish asks; the worker answers.

    The row is the whole of what this does. `publishRefusal` runs in the worker against the run —
    there is no path to `publish_evaluation` that has not been through it — so the button cannot
    know the outcome and does not pretend to. It inserts, then watches.
  */
  const publish = useCallback(async () => {
    const { data, error } = await client
      .from('evaluation_publish_requests')
      .insert({ run_id: runId, requested_by: analystId, status: 'queued' })
      .select('id, status, refusal, error, evaluation_id')
      .single();

    if (error !== null) {
      setSaving({ failed: error.message });
      return;
    }
    setPublishing(data as unknown as PublishRow);
  }, [analystId, client, runId]);

  /*
    Watching the request.

    Polled rather than subscribed, for the reason the scan already is: a realtime channel is more
    machinery for the same half-minute, and this one is seconds. It stops the moment the row settles.
  */
  useEffect(() => {
    if (publishing === null) return;
    if (publishing.status !== 'queued' && publishing.status !== 'running') return;

    let live = true;
    const timer = setInterval(() => {
      void (async () => {
        const { data } = await client
          .from('evaluation_publish_requests')
          .select('id, status, refusal, error, evaluation_id')
          .eq('id', publishing.id)
          .maybeSingle();
        if (!live || data === null) return;
        const row = data as unknown as PublishRow;
        setPublishing(row);
        // Published: the draft is gone and a version exists. Re-read rather than guess.
        if (row.status === 'done') setReloads((n) => n + 1);
      })();
    }, POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, publishing]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    const { error } = await client
      .from('evaluation_requests')
      .insert({ run_id: runId, requested_by: analystId, status: 'queued' });
    setRegenerating(false);
    if (error !== null) setSaving({ failed: error.message });
  }, [analystId, client, runId]);

  /*
    An edit is a new document, held here.

    `undefined` in read mode, and that is what puts the component in read mode — not a flag it
    checks, but the absence of anything to call. A viewer without the capability has no callback to
    reach, which is the same shape `ReportActions` uses for Send (D-066).
  */
  const edit = useMemo<EvaluationEdit | undefined>(
    () =>
      canEdit
        ? {
            onChange: (next) => {
              setDraft(next);
              setSaving('idle');
            },
          }
        : undefined,
    [canEdit],
  );

  if (load.status === 'loading') return null;
  /*
    No draft, and this is the whole report now (D-262).

    It used to return null and let `ReportView` fill the screen. `ReportView` is not mounted here
    any more, so returning null would leave a finished run showing nothing at all — a reader with no
    way to tell an unevaluated run from a broken screen. It says which, and offers the one thing
    that changes it.
  */
  if (load.status === 'absent') {
    return (
      <div className="eval-empty">
        <p className="eval-empty-head">No evaluation drafted yet.</p>
        <p className="eval-empty-sub">
          The run is finished and its findings are stored. Generating reads them, with the pages the
          crawl captured, and drafts the evaluation for review.
        </p>
        {canEdit && (
          <button
            type="button"
            className="eval-editor-regen"
            onClick={() => void regenerate()}
            disabled={regenerating}
          >
            {regenerating ? 'Queued…' : 'Generate'}
          </button>
        )}
      </div>
    );
  }
  if (load.status === 'error') {
    return <div className="empty">The evaluation draft could not be read: {load.message}</div>;
  }
  if (draft === null) {
    return (
      <RefusedNotice
        status={load.row.validator_status}
        message={load.row.validator_message}
        {...(canEdit ? { onRegenerate: () => void regenerate() } : {})}
        regenerating={regenerating}
      />
    );
  }

  /*
    A published run has no draft, so nothing is editable and nothing is published again from here.

    The controls are absent rather than disabled: there is no draft to save, and a re-publish is a
    new draft rather than a second press of this button (0076 — a re-review produces its own
    version).
  */
  const draftIsLive = load.published === null || load.row.edited_at !== null;

  const report = load.report;
  const appendix =
    report === null ? null : (
      <>
        <EvaluationEvidence report={report} access={access} />
        <EvaluationNotChecked report={report} />
      </>
    );

  return (
    <div className="eval-editor">
      {load.row.validator_status !== 'ok' && (
        <RefusedNotice
          status={load.row.validator_status}
          message={load.row.validator_message}
          {...(canEdit ? { onRegenerate: () => void regenerate() } : {})}
          regenerating={regenerating}
        />
      )}

      {/*
        The publish request's answer, in place.

        A refusal is the validator's own words and the draft is untouched — the operator repairs the
        document here and asks again, which is why a refused draft keeps its content at all.
      */}
      {publishing !== null && <PublishState row={publishing} />}

      {canEdit && draftIsLive && (
        <div className="eval-editor-bar">
          <button type="button" className="eval-editor-save" onClick={() => void save()} disabled={saving === 'saving'}>
            {saving === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="eval-editor-regen"
            onClick={() => void regenerate()}
            disabled={regenerating}
          >
            {regenerating ? 'Queued…' : 'Regenerate'}
          </button>
          {/*
            Publish is offered on an accepted draft only. A rejected one is repaired first, and a
            button that queued a request the worker would refuse would be a round trip to learn what
            the screen already says.
          */}
          {load.row.validator_status === 'ok' && (
            <button
              type="button"
              className="eval-editor-publish"
              onClick={() => void publish()}
              disabled={publishing !== null && publishing.status !== 'refused' && publishing.status !== 'failed'}
            >
              Publish
            </button>
          )}
          <span className="eval-editor-state">
            {saving === 'saved' && 'Saved.'}
            {typeof saving === 'object' && `Not saved: ${saving.failed}`}
            {saving === 'idle' && load.row.edited_at !== null && 'Edited.'}
          </span>
        </div>
      )}

      <EvidenceDisclosureProvider>
        <EvaluationReport
          draft={draft}
          run={load.run}
          access={access}
          labels={labels}
          appendix={appendix}
          {...(edit === undefined || !draftIsLive ? {} : { edit })}
          {...(load.published === null || draftIsLive
            ? {}
            : { published: publishedBy(load.published) })}
        />
      </EvidenceDisclosureProvider>
    </div>
  );
}

/** The masthead's published line, from the row. */
function publishedBy(row: PublishedRow): PublishedBy {
  return {
    at: row.published_at,
    // The name where there is one, and the address where there is not. Never a uuid: that looks
    // like information and is not (`internalIdentity.ts`).
    operator: row.analysts?.full_name ?? row.analysts?.email ?? 'a Mintro operator',
    version: row.version,
  };
}

/**
 * What the worker said about a publish request.
 *
 * Three outcomes and three sentences. `refused` is the validator's own words and the draft is
 * untouched; `failed` is the job not running and says nothing about the document — the D-044
 * distinction the queue's own columns already make.
 */
function PublishState({ row }: { readonly row: PublishRow }): JSX.Element | null {
  if (row.status === 'queued' || row.status === 'running') {
    return <p className="eval-publish-state">Publishing… the worker is re-validating the document.</p>;
  }
  if (row.status === 'done') {
    return <p className="eval-publish-state is-done">Published.</p>;
  }
  if (row.status === 'refused') {
    return (
      <div className="eval-refused">
        <p className="eval-refused-head">
          <strong>Not published.</strong> The draft is unchanged — repair it here and publish again.
        </p>
        <pre className="eval-refused-why">{row.refusal}</pre>
      </div>
    );
  }
  return (
    <div className="eval-refused">
      <p className="eval-refused-head">
        <strong>The publish job did not run.</strong> Nothing was decided about the document.
      </p>
      {row.error !== null && <pre className="eval-refused-why">{row.error}</pre>}
    </div>
  );
}

/**
 * A draft the validator refused, and the two ways out of it.
 *
 * Shown rather than hidden. A refused draft keeps its content so an operator can repair one word
 * instead of paying for a regeneration (D-260), and a screen that hid the refusal would leave them
 * editing a document they did not know was rejected.
 */
function RefusedNotice({
  status,
  message,
  onRegenerate,
  regenerating,
}: {
  readonly status: string;
  readonly message: string | null;
  readonly onRegenerate?: () => void;
  readonly regenerating: boolean;
}): JSX.Element {
  return (
    <div className="eval-refused">
      <p className="eval-refused-head">
        This draft was stored as <strong>{status}</strong>. It can be repaired here, or generated
        again.
      </p>
      {message !== null && <pre className="eval-refused-why">{message}</pre>}
      {onRegenerate !== undefined && (
        <button
          type="button"
          className="eval-editor-regen"
          onClick={onRegenerate}
          disabled={regenerating}
        >
          {regenerating ? 'Queued…' : 'Regenerate'}
        </button>
      )}
    </div>
  );
}
