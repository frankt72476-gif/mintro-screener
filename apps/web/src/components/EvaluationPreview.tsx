/**
 * `/evaluation-preview/:runId` — the evaluation rendering, against a stored draft.
 *
 * **Temporary, and unlinked.** It exists so the rendering can be looked at against real drafts while
 * the operator surface is built. Nothing navigates here; the path is typed.
 *
 * Two gates stand in front of it and neither is this component's doing: `AnalystWorkspace` renders
 * nothing without a signed-in analyst, and every policy on `evaluation_drafts` gates on
 * `public.is_analyst()`. A visitor who reached this path with no session would read nothing from
 * the database — this screen only says so plainly rather than showing an empty document.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvaluationReport } from './EvaluationReport.js';
import { EvaluationEvidence, EvaluationNotChecked, anchoredRuleIds } from './EvaluationEvidence.js';
import { EvidenceDisclosureProvider } from './EvidenceDisclosure.js';
import type { ScreeningReport } from '@mintro/engine';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EVALUATION_LABELS as LABELS } from '../lib/evaluationLabels.js';
import type {
  EvaluationRunContext,
  FindingState,
  StoredDraft,
  StoredHandles,
} from '../lib/evaluationView.js';

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly draft: StoredDraft;
      readonly run: EvaluationRunContext;
      /**
       * The screening report, for sections 6 and 7.
       *
       * Null when the run carries none. Null rather than absent because the two say different
       * things: a run with no stored report has no evidence section to render, and rendering the
       * document without one is correct — rendering it while implying the evidence was checked and
       * empty would not be.
       */
      readonly report: ScreeningReport | null;
    };

interface DraftRow {
  readonly content: StoredDraft | null;
  readonly handles: StoredHandles | null;
  readonly validator_status: string;
  readonly ruleset_version: string;
  readonly angles_version: string;
  readonly model: string;
}

export function EvaluationPreview({
  client,
  runId,
  access,
}: {
  readonly client: SupabaseClient;
  readonly runId: string;
  readonly access: EvidenceAccess;
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    const fail = (message: string): void => {
      if (live) setLoad({ status: 'error', message });
    };

    void (async () => {
      const draftRead = await client
        .from('evaluation_drafts')
        .select('content, handles, validator_status, ruleset_version, angles_version, model')
        .eq('run_id', runId)
        .maybeSingle();

      if (draftRead.error !== null) return fail(`the draft could not be read: ${draftRead.error.message}`);
      if (draftRead.data === null) return fail('no evaluation draft is stored for this run.');

      const row = draftRead.data as unknown as DraftRow;
      /*
        A refused draft is not rendered.

        `validator_status` other than `ok` means the document was refused — it may cite evidence the
        run does not hold, or carry a legality block that is not the computed one. Rendering it
        behind a warning would put an unchecked document on a screen, and the whole arrangement
        exists so that does not happen.
      */
      if (row.validator_status !== 'ok') {
        return fail(`this draft was not accepted (${row.validator_status}), so it is not rendered.`);
      }
      if (row.content === null || row.handles === null) {
        return fail('this draft is missing its content or its handle mapping.');
      }

      const [runRead, findingsRead, evidenceRead] = await Promise.all([
        client.from('runs').select('report, finished_at').eq('id', runId).maybeSingle(),
        client.from('findings').select('id, rule_id, state, evidence_key').eq('run_id', runId),
        client.from('evidence').select('key, kind, url').eq('run_id', runId),
      ]);

      const problem =
        runRead.error?.message ?? findingsRead.error?.message ?? evidenceRead.error?.message;
      if (problem !== undefined) return fail(`the run could not be read: ${problem}`);

      const report = (runRead.data as { report?: ScreeningReport } | null)?.report ?? null;

      if (!live) return;
      setLoad({
        status: 'ready',
        draft: row.content,
        report,
        run: {
          runId,
          merchantDomain: report?.merchantDomain ?? null,
          screenedAt: (runRead.data as { finished_at?: string } | null)?.finished_at ?? null,
          rulesetVersion: row.ruleset_version,
          anglesVersion: row.angles_version,
          model: row.model,
          handles: row.handles,
          /*
            What section 6 will anchor, decided from the same report it renders.

            Absent when the run carries no report: with no evidence section there is nothing for a
            chip to scroll to, and a link would point into a document that is not there.
          */
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

  const body = useMemo(() => {
    if (load.status === 'loading') return <div className="empty">Loading the evaluation…</div>;
    if (load.status === 'error') return <div className="empty">{load.message}</div>;
    /*
      Sections 6 and 7, composed here rather than inside `EvaluationReport`.

      This is where the run is already loaded, and it keeps the rendering component typed on the
      draft alone — see the note on its `appendix` prop.
    */
    const report = load.report;
    const appendix =
      report === null ? null : (
        <>
          <EvaluationEvidence report={report} access={access} />
          <EvaluationNotChecked report={report} />
        </>
      );
    /*
      The provider wraps the whole document, because the two ends of the disclosure are far apart:
      a finding chip in the summary block asks, and section 6 answers.
    */
    return (
      <EvidenceDisclosureProvider>
        <EvaluationReport
          draft={load.draft}
          run={load.run}
          access={access}
          labels={LABELS}
          appendix={appendix}
        />
      </EvidenceDisclosureProvider>
    );
  }, [load, access]);

  return (
    <div className="shell">
      <main className="main">
        <p className="eval-preview-banner">
          Preview surface. This renders a stored draft read-only; nothing here is published or sent.
        </p>
        {body}
      </main>
    </div>
  );
}
