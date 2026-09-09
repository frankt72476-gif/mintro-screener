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
import anglesJson from '../../../../rules/angles.json';
import rulesetJson from '../../../../rules/ruleset.json';
import eyeTestJson from '../../../../rules/eyetest.json';
import { EvaluationReport } from './EvaluationReport.js';
import type { EvaluationLabels } from '../lib/evaluationView.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import type {
  EvaluationRunContext,
  FindingState,
  StoredDraft,
  StoredHandles,
} from '../lib/evaluationView.js';

/**
 * The names the angle set gives things, read from the bundled file.
 *
 * The same file the generator was built from, so the titles a reader sees and the titles the model
 * was asked about cannot drift (hard constraint 1). Nothing is spelled out in code.
 */
const LABELS: EvaluationLabels = {
  angleTitle: Object.fromEntries(anglesJson.angles.map((angle) => [angle.id, angle.title])),
  conditionLabel: Object.fromEntries(
    anglesJson.routingConditions.map((condition) => [condition.id, condition.label]),
  ),
  angleOrder: anglesJson.angles.map((angle) => angle.id),
  conditionOrder: anglesJson.routingConditions.map((condition) => condition.id),
  ruleTitle: Object.fromEntries(rulesetJson.rules.map((rule) => [rule.id, rule.title])),
  eyeTestQuestion: Object.fromEntries(eyeTestJson.items.map((item) => [item.id, item.question])),
  heavyRuleIds: new Set(
    rulesetJson.rules.filter((rule) => rule.weight === 'heavy').map((rule) => rule.id),
  ),
};

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly draft: StoredDraft; readonly run: EvaluationRunContext };

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

      const report = (runRead.data as { report?: { merchantDomain?: string } } | null)?.report;

      if (!live) return;
      setLoad({
        status: 'ready',
        draft: row.content,
        run: {
          runId,
          merchantDomain: report?.merchantDomain ?? null,
          screenedAt: (runRead.data as { finished_at?: string } | null)?.finished_at ?? null,
          rulesetVersion: row.ruleset_version,
          anglesVersion: row.angles_version,
          model: row.model,
          handles: row.handles,
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
    return (
      <EvaluationReport draft={load.draft} run={load.run} access={access} labels={LABELS} />
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
