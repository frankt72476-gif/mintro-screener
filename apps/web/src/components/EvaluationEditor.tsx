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
import { EvaluationReport, type EvaluationEdit } from './EvaluationReport.js';
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
    };

/** What Save is doing, so the button says it rather than appearing inert. */
type Saving = 'idle' | 'saving' | 'saved' | { readonly failed: string };

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

  useEffect(() => {
    let live = true;
    void (async () => {
      const [draftRead, runRead, findingsRead, evidenceRead] = await Promise.all([
        client
          .from('evaluation_drafts')
          .select(
            'content, handles, validator_status, validator_message, ruleset_version, angles_version, model, edited_at',
          )
          .eq('run_id', runId)
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
      // No draft is not an error. Most runs have never been evaluated, and this screen sits above
      // a report that stands on its own.
      if (draftRead.data === null) {
        setLoad({ status: 'absent' });
        return;
      }

      const row = draftRead.data as unknown as DraftRow;
      const report = (runRead.data as { report?: ScreeningReport } | null)?.report ?? null;

      setDraft(row.content);
      setLoad({
        status: 'ready',
        row,
        report,
        run: {
          runId,
          merchantDomain: report?.merchantDomain ?? null,
          screenedAt: report?.finishedAt ?? null,
          rulesetVersion: row.ruleset_version,
          anglesVersion: row.angles_version,
          model: row.model,
          handles: row.handles ?? { finding: {}, evidence: {}, eye_test: {}, angle: {} },
          ...(report === null ? {} : { anchoredRuleIds: anchoredRuleIds(report) }),
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
  }, [client, runId]);

  const save = useCallback(async () => {
    if (draft === null) return;
    setSaving('saving');
    const { error } = await client.rpc('edit_evaluation_draft', {
      p_run_id: runId,
      p_content: draft,
    });
    setSaving(error === null ? 'saved' : { failed: error.message });
  }, [client, draft, runId]);

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
  if (load.status === 'absent') return null;
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

      {canEdit && (
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
          {...(edit === undefined ? {} : { edit })}
        />
      </EvidenceDisclosureProvider>
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
