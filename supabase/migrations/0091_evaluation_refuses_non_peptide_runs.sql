-- 0091 — The evaluation tables refuse runs that are not the peptide programme's (D-284, D-285)
--
-- The evaluation layer — angles, the AI draft, placement, publish — is a Mintro assessment built for
-- the peptide programme. D-284 does not use it for any other vertical, and for adult AI it is the
-- verdict A1 forbids. On 2026-09-19 run 6571d6a9 (adult_ai, xchar.ai) was drafted through it: the
-- Regenerate button inserted an `evaluation_requests` row, the worker wrote an `evaluation_drafts`
-- row, and the web showed angles and a placement.
--
-- Cluster 4 commit 1 closed that in every job and in the web (`evaluationRefusal`). This makes it
-- structural: a request or a draft for a non-peptide run cannot be written by any path — a job that
-- forgot the guard, a script, a hand-written insert — because the tables refuse it.
--
-- ## Insert and update, never delete
--
-- Both refused on insert and on update, with the reason the jobs record:
-- "evaluation layer does not apply to vertical <v> (D-284)". Delete is not guarded: removing the draft
-- 6571d6a9 left behind is the one write these rows should still accept.
--
-- ## Existing rows
--
-- Untouched. A trigger reads rows as they are written and never revisits the table, so 6571d6a9's
-- request row (`done`, the record that it happened) and its draft stand until someone deletes the
-- draft. Neither is updated by anything once the request is done. Every other existing row is a
-- peptide run's. `apps/worker/test/schema/evaluationVertical.test.ts` applies this over a database
-- that already holds an adult_ai run with a draft and a request.

create or replace function public.refuse_non_peptide_evaluation()
returns trigger
language plpgsql
as $$
declare
  v_vertical text;
begin
  select vertical into v_vertical from public.runs where id = new.run_id;

  -- A run that does not exist is the foreign key's to refuse, with its own message.
  if v_vertical is not null and v_vertical <> 'peptides' then
    raise exception 'evaluation layer does not apply to vertical % (D-284)', v_vertical
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.refuse_non_peptide_evaluation is
  'Refuses an evaluation request or draft for a run whose vertical is not peptides (D-284, D-285; run 6571d6a9).';

create trigger evaluation_requests_peptide_runs_only
  before insert or update on public.evaluation_requests
  for each row execute function public.refuse_non_peptide_evaluation();

create trigger evaluation_drafts_peptide_runs_only
  before insert or update on public.evaluation_drafts
  for each row execute function public.refuse_non_peptide_evaluation();
