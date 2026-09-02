-- ================================================================================================
-- 0070 — Stage 5: ready for Mintro review
-- ================================================================================================
--
-- A partner without `can_submit_to_iqwallet` finishes a report and needs a way to say so. Without a
-- state for it that becomes a Slack message and a dropped ball.
--
-- ## The state is a row about the run, not a column on it
--
-- The obvious design is `runs.review_state`, and it is not available: a finished run is frozen.
-- `reject_finished_run_mutation()` (0004) refuses **every** update once `finished_at` is set, and it
-- refuses it against `service_role` too, which is the point of it. Runs are immutable (D-002) and a
-- run that could acquire a new state after it finished would be a run whose record changed after it
-- was read.
--
-- So marking is an append: a row in `run_review_requests` naming the run, who marked it and when.
-- The run is untouched. This is the same shape `run_quarantine` (0012) already uses to say
-- something about a frozen run without writing to it, and it has the property the column would not:
-- the mark is dated and attributed, so the log line and the row agree about when it happened.
--
-- The state a surface renders is then derived, not stored:
--
--   finished, no mark, no send      complete
--   finished, mark, no send         with Mintro for review
--   finished, send                  sent
--
-- Nothing has to be updated as the run moves between them, which is why there is no `withdrawn` and
-- no `satisfied_at`. A send supersedes the mark by existing.
--
-- ## One mark per run
--
-- A unique index rather than a state machine. Marking twice is a double-click, not a second
-- decision, and `on conflict do nothing` in the function below makes the second one a no-op that
-- writes no second log line — the same reasoning `set_analyst_capability` (0067) applies to setting
-- a flag to the value it already holds.

create table public.run_review_requests (
  id           uuid primary key default gen_random_uuid(),

  run_id       uuid not null references public.runs (id) on delete restrict,

  -- Who marked it. Attribution, and `created_by` is the run's own separate fact — the person who
  -- did the screening and the person who handed it over need not be the same colleague (D-228).
  requested_by uuid not null references public.analysts (id) on delete restrict,

  -- The organization at the moment of marking, denormalized for the same reason `runs.org_id` is:
  -- a fact about the act, not about wherever the person is filed later (D-228).
  org_id       uuid not null references public.organizations (id) on delete restrict,

  requested_at timestamptz not null default now(),

  constraint run_review_requests_one_per_run unique (run_id)
);

comment on table public.run_review_requests is
  'A partner marking a finished run ready for Mintro review. Append-only: runs are immutable, so the state is a row about the run (D-002).';

create index run_review_requests_recent on public.run_review_requests (requested_at desc);

alter table public.run_review_requests enable row level security;

-- Append-only against the service role too, which bypasses RLS. Same mechanism `admin_access_log`
-- (0056) and `credential_access` (0013) use: append-only is a property of the table, not of who is
-- asking.
create trigger run_review_requests_are_append_only
  before update or delete on public.run_review_requests
  for each row execute function public.reject_mutation();

-- Visible to exactly whoever can read the run — the partner who marked it, their colleagues, and
-- every host-org member. That is the whole of "the state is visible to the partner" and "it
-- surfaces to host-org members": one predicate, already the single definition (0060).
create policy run_review_requests_select on public.run_review_requests
  for select to authenticated
  using (public.can_read_run(run_id));

-- No insert policy, and the absence is the mechanism. The mark and its log line are one
-- transaction or they are two events with a window between them where the log does not know a
-- handover happened — the argument 0067 makes for the owner's three acts, applied to a fourth.
revoke insert, update, delete on public.run_review_requests from authenticated, anon;
grant select on public.run_review_requests to authenticated;

-- ------------------------------------------------------------------------------------------------
-- The log learns two more actions, and gains the run they are about
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from 0067's definition of the constraint, which is the current one (D-235).
--
-- `run_id` is a new column rather than a key inside `value_after`. Those two columns mean "what the
-- value was" and "what it became"; a run id is neither, and burying it there would make the one
-- question anybody asks of these rows — *which report was handed over* — unindexable and invisible
-- to anything reading the log generically. Nullable, because the seven existing actions are about a
-- person's access and have no run.
--
-- `on delete restrict` for the same reason every other reference to `runs` carries it: runs are
-- never deleted (D-002), and a log line whose subject could vanish is not a log.

alter table public.admin_access_log
  add column run_id uuid references public.runs (id) on delete restrict;

comment on column public.admin_access_log.run_id is
  'The run a review-path line is about. Null for the access actions, which are about a person.';

alter table public.admin_access_log
  drop constraint admin_access_log_action_check;

alter table public.admin_access_log
  add constraint admin_access_log_action_check check (action in (
    'invited',
    'invite_resent',
    'activated',
    'bind_refused',
    'granted_documents_check',
    'revoked_documents_check',
    'granted_iqwallet_submit',
    'revoked_iqwallet_submit',
    'suspended',
    'reinstated',
    'replies_rerouted',
    -- 0070: the review path. Both name a run; the second names two people as well.
    'marked_ready_for_review',
    'submitted_on_behalf_of'
  ));

-- The two review-path actions are the only ones that carry a run, and the only ones that must.
-- Stated as a constraint rather than left to the two writers below, because "the writer remembers"
-- is what `value_before`/`value_after` being nullable already costs this table.
alter table public.admin_access_log
  add constraint review_path_lines_name_their_run check (
    (action in ('marked_ready_for_review', 'submitted_on_behalf_of')) = (run_id is not null)
  );

-- ------------------------------------------------------------------------------------------------
-- Marking
-- ------------------------------------------------------------------------------------------------
--
-- Owner-less by design: this is not an administrative act and is not gated by a capability. Anyone
-- who can read the run can hand it over, which is the boundary the rest of the build draws and the
-- only one that makes sense here — a partner's colleague finishing their work while they are away
-- is the case org scoping exists for (D-228).
--
-- The UI offers it only to a member without `can_submit_to_iqwallet`, because for anyone else it is
-- a longer way round to the same place. That is a choice about what to draw, not a rule about who
-- may act, and it stays out of the database: a gate here would refuse a host member marking a run
-- for a colleague to look at, which is a reasonable thing to want and nothing in the spec forbids.
--
-- Returns its outcome as data rather than raising. A refusal is an answer the screen renders, and
-- the pattern is `bind_invited_analyst` (0065, 0066) and `set_analyst_capability` (0067).

create or replace function public.mark_run_ready_for_review(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_org      uuid;
  v_finished timestamptz;
  v_status   text;
  v_inserted boolean;
begin
  if not public.can_read_run(p_run) then
    -- Indistinguishable from a run that does not exist, and deliberately so: a different answer
    -- would confirm that some other organization holds a run with this id.
    return jsonb_build_object('ok', false, 'reason', 'no such run');
  end if;

  select finished_at, status into v_finished, v_status from public.runs where id = p_run;

  -- A run still going is not ready for anything. Refused with what it is instead of what it is not,
  -- so the screen can say why rather than reporting a failure it cannot explain.
  if v_finished is null or v_status <> 'complete' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'this run has not finished, so there is nothing to review yet'
    );
  end if;

  -- A run already sent has been through. Not an error and not a state to go back to: the send is
  -- the terminus the review path leads to (D-002 — nothing is rewound).
  if exists (select 1 from public.sends where run_id = p_run) then
    return jsonb_build_object('ok', false, 'reason', 'this run has already been sent');
  end if;

  select org_id into v_org from public.analysts where id = v_actor;

  insert into public.run_review_requests (run_id, requested_by, org_id)
  values (p_run, v_actor, v_org)
  on conflict (run_id) do nothing;

  v_inserted := found;

  -- Already marked. Not an error, and not a second log line either: the log records what happened,
  -- and a double-click is not a second handover.
  if not v_inserted then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  insert into public.admin_access_log (actor_id, subject_id, action, run_id, value_after)
  values (
    v_actor,
    -- The run's own creator, which is what `created_by` is retained for (D-228). The same person as
    -- the actor in the ordinary case, and not in the one this column exists for: a colleague
    -- handing over work somebody else did.
    (select created_by from public.runs where id = p_run),
    'marked_ready_for_review',
    p_run,
    jsonb_build_object('review_state', 'ready_for_review')
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

comment on function public.mark_run_ready_for_review is
  'Marks a finished run ready for Mintro review and logs it, in one transaction. Open to anyone who can read the run.';

revoke all on function public.mark_run_ready_for_review(uuid) from public, anon;
grant execute on function public.mark_run_ready_for_review(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- Submitting somebody else's work
-- ------------------------------------------------------------------------------------------------
--
-- A trigger on the send queue, not a second call from the client.
--
-- The alternative was an RPC wrapping the insert, and it is worse in the way 0067 describes: the
-- send and the line recording who sent whose work would be two statements, and anything between
-- them leaves a partner's report submitted by Mintro with nothing saying so. A trigger cannot be
-- forgotten by a caller and cannot be skipped by a client that speaks PostgREST directly — which,
-- since there is no HTTP API here, is every client.
--
-- **Only when the organizations differ.** Submitting your own organization's work is the ordinary
-- case and needs no line; `submitted_on_behalf_of` means what its name says. The comparison is
-- between the run's org and the submitter's, not between the two people: a partner submitting a
-- colleague's run is one organization doing its own work, and logging that as a handover would bury
-- the real ones.
--
-- `security definer` because `admin_access_log` has no insert policy for `authenticated` and must
-- not get one — the log is written by functions and triggers or not at all.
--
-- D-233 is untouched by any of this. The line names the partner analyst to **the owner**, in the
-- owner-only log, and reaches no merchant-, agent- or IQwallet-facing surface. Nothing about the
-- submission changes: the payload the worker assembles is composed from the run, and it neither
-- knows nor can learn that a second organization exists.

create or replace function public.log_submission_on_behalf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_org   uuid;
  v_run_by    uuid;
  v_actor_org uuid;
begin
  select org_id, created_by into v_run_org, v_run_by from public.runs where id = new.run_id;
  select org_id into v_actor_org from public.analysts where id = new.requested_by;

  if v_run_org is null or v_actor_org is null or v_run_org = v_actor_org then
    return new;
  end if;

  insert into public.admin_access_log (actor_id, subject_id, action, run_id, value_after)
  values (
    -- Both, which is the whole point of the action: who sent it, and whose work it was.
    new.requested_by,
    v_run_by,
    'submitted_on_behalf_of',
    new.run_id,
    jsonb_build_object('submitting_org', v_actor_org, 'run_org', v_run_org)
  );

  return new;
end;
$$;

comment on function public.log_submission_on_behalf is
  'Writes submitted_on_behalf_of when a send is queued for a run belonging to another organization. Names the submitter and the run''s creator.';

create trigger send_requests_log_submission_on_behalf
  after insert on public.send_requests
  for each row execute function public.log_submission_on_behalf();
