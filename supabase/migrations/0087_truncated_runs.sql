-- 0087 — A run the watchdog cut short is kept, as a truncated run (D-282).
--
-- Until now a run that reached the 30-minute deadline was discarded: nothing was persisted, and the
-- request recorded `watchdog_timeout: ... Nothing was persisted` (D-152, D-155). Three runs of
-- legendarypeptides.com on 2026-09-15 each had eighteen signed-in product pages captured when the
-- deadline fell, and all three left no run behind. The worker now persists what the crawl holds, with
-- every rule it had not reached reported `not_evaluable` for that reason, under a status of its own.
--
-- **Only constraints are widened, and one is added over a value no row holds.** Every existing
-- `runs` and `scan_requests` row satisfies the widened checks as it stands, and no row is
-- `truncated`, so `truncated_requests_say_what_and_why` has nothing to reject. No `UPDATE` is needed
-- before any constraint here.
--
-- **Immutability is unchanged, and covers a truncated run exactly as it covers a complete one
-- (D-002).** `runs_are_immutable_once_finished` (0004) refuses any update or delete once
-- `finished_at` is set, whatever the status. A truncated run is written once, with `finished_at`,
-- by the same `finishRun` call a complete one is, and is frozen from that moment. Its findings and
-- evidence are append-only by their own triggers (0005, 0006), which read no status at all.

-- ---- runs.status ------------------------------------------------------------------------------

alter table public.runs drop constraint runs_status_check;
alter table public.runs add constraint runs_status_check
  check (status in ('running', 'complete', 'truncated', 'failed'));

-- A finished run is complete, truncated or failed. `truncated` is terminal: nothing resumes it.
alter table public.runs drop constraint finished_runs_have_a_terminal_status;
alter table public.runs add constraint finished_runs_have_a_terminal_status check (
  (finished_at is null) or (status in ('complete', 'truncated', 'failed'))
);

-- ---- scan_requests.status ---------------------------------------------------------------------

alter table public.scan_requests drop constraint scan_requests_status_check;
alter table public.scan_requests add constraint scan_requests_status_check
  check (status in ('queued', 'running', 'done', 'truncated', 'failed'));

-- A truncated request produced a run and says why it stopped. Neither half may be silent: the run is
-- what a reader opens, and the reason is what tells them it is not the whole storefront.
alter table public.scan_requests add constraint truncated_requests_say_what_and_why check (
  status <> 'truncated' or (run_id is not null and error is not null)
);

-- ---- a truncated run is a run like any other (Frank, 2026-09-15) -------------------------------
--
-- Listed, openable, evaluable, eye-tested, reviewable and sendable, with its coverage stating what
-- it did not reach. The two places the schema itself asks for `complete` are widened to match.

-- The eye test reads the captures a run kept. A truncated run kept its captures.
drop trigger runs_get_an_eye_test on public.runs;
create trigger runs_get_an_eye_test
  after update on public.runs
  for each row
  when (new.status in ('complete', 'truncated') and old.status not in ('complete', 'truncated'))
  execute function public.enqueue_eye_test();

-- Ready for review: a finished run, complete or truncated. Otherwise unchanged from 0070.
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

  -- A run still going is not ready for anything. A truncated run has finished (D-282).
  if v_finished is null or v_status not in ('complete', 'truncated') then
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
  'Marks a finished run (complete or truncated) ready for Mintro review and logs it, in one transaction. Open to anyone who can read the run.';

revoke all on function public.mark_run_ready_for_review(uuid) from public, anon;
grant execute on function public.mark_run_ready_for_review(uuid) to authenticated;
