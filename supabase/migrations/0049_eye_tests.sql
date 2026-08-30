-- 0049 — the eye test moves off the crawl's critical path (D-198)
--
-- The eye test is a judgment layer: a model reads the captures the crawl already took and says how
-- the storefront presents itself (D-196). It produces observations that can never move a state, a
-- count, a coverage number or a verdict.
--
-- Measured against real captures it takes **22 seconds typical** — 18.6, 22.7 and 26.4 across three
-- calls — against a 26-33s run. Roughly doubling the crawl for a layer that by design changes
-- nothing is not a trade worth making, so it becomes a job that runs after the run completes.
--
-- ## Why the result cannot live in `runs.report`
--
-- Not a preference. `finishRun` writes `finished_at`, `status` and `report` in one update, and
-- `runs_are_immutable_once_finished` (0004) raises on **every** later update to that row. A layer
-- that finishes half a minute after the run has nowhere to write, and D-002 is why: a run says what
-- it said.
--
-- So the report carries `eyeTestCaptures` — which page was the homepage, which were sampled
-- products, which was the sign-up form — and the outcome lands here, keyed on the run. Assembly
-- decides what to look at; the job does the looking. The division is forced by something real: the
-- structural knowledge of *which page is which* exists only while the crawl is running, and a job
-- that recovered it by matching `/shop/` in a URL would be blind in exactly the way hard constraint
-- 9 describes.
--
-- ## The row is the record of the attempt, including the failures
--
-- One table, `pdf_requests`-shaped, rather than a queue plus a separate result table. An absence
-- carrying its capture list is as much the record as a successful read — it is what a reader needs
-- to tell a vendor outage from a run with nothing to send (hard constraint 3, one level up from a
-- finding). Splitting would file the successes in one place and the failures in another.
--
-- Re-attempts accumulate as new rows. The panel reads the newest finished one, so a transient
-- vendor outage followed by a good read leaves both on the record.

create table public.eye_tests (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.runs (id) on delete restrict,

  status         text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'failed')),

  -- The whole `EyeTestOutcome`: {kind:'ran',test} or {kind:'absent',absence}.
  --
  -- An absence IS an outcome and is stored as one. The alternative — a null outcome and a reason in
  -- `error` — would put the vendor failures in a different shape from the "no captures to send"
  -- failures, and both are the same event to a reader: the eye test was attempted and there is no
  -- read.
  outcome        jsonb,

  -- Denormalised out of `outcome` so calibration can group by them without unpacking jsonb. Which
  -- model answered is part of the rubric (D-196), and comparing two reads needs both.
  rubric_version text,
  model          text,
  elapsed_ms     integer check (elapsed_ms is null or elapsed_ms >= 0),

  error          text,

  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,

  -- The same refusal the rest of the queues make: a finished job that says nothing about what
  -- happened is the shape every defect in this project has taken.
  constraint finished_eye_tests_carry_an_outcome
    check (status <> 'done' or outcome is not null),
  constraint failed_eye_tests_say_why
    check (status <> 'failed' or error is not null)
);

comment on table public.eye_tests is
  'Mintro''s impression of a storefront, produced after the run because it takes 22s and can never '
  'move a state (D-198). Never a finding. Absences are stored as outcomes, not as null.';
comment on column public.eye_tests.outcome is
  'The EyeTestOutcome. kind=''absent'' carries every capture it wanted and what became of each.';

alter table public.eye_tests enable row level security;

/*
  Analysts may read it, and write nothing.

  There is nothing here a leak compromises: it is Mintro's own impression of a public storefront,
  assembled from captures an analyst can already open. The same argument that let `credential_state`
  have a select policy where `credentials` has none (D-185).

  No insert policy at all — not even a queued one. Every other queue in this schema is filled by an
  analyst action; this one is filled by the database, and an analyst who could insert could ask for
  a second read of a run whose first read they did not like.
*/
create policy eye_tests_select on public.eye_tests
  for select to authenticated using (public.is_analyst());

revoke insert, update, delete on public.eye_tests from authenticated, anon;

create index eye_tests_run_idx on public.eye_tests (run_id, created_at desc);
create index eye_tests_queue_idx on public.eye_tests (status, created_at)
  where status in ('queued', 'running');
-- Calibration reads: every read produced under one rubric, newest first.
create index eye_tests_calibration_idx on public.eye_tests (rubric_version, model, created_at desc)
  where status = 'done';

/*
  ── A departure, stated plainly ──────────────────────────────────────────────────────────────────

  This schema has 37 triggers and every one of them **refuses** a write: rows that are append-only,
  runs that are immutable once finished, documents that are never deleted. This is the first trigger
  that **creates** a row, and that is a real change in what triggers mean here.

  The justification is the requirement rather than convenience. The eye test's whole value is
  calibration: a rubric that has not seen a storefront cannot be tuned against it, and the
  storefronts that most need judging are the ones on blocked packages that nobody reads. **A layer
  that produces calibration data only when someone remembers produces none.** An analyst-triggered
  read would be forgotten; so, eventually, would a call site.

  Three code paths finish a run today — `bin/worker.ts`, `bin/scan.ts --supabase` and
  `bin/resume-run.ts`. Enqueueing in code covers the three that exist. The trigger covers the fourth.

  Enqueued on `complete` only. A `failed` run has no assembled report, so no manifest and no panel
  to render beside — there is nothing for the job to read and nowhere for its answer to go.
*/
create or replace function public.enqueue_eye_test()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.eye_tests (run_id) values (new.id);
  return new;
end;
$$;

comment on function public.enqueue_eye_test is
  'Queues the eye test when a run completes. The first trigger in this schema that creates a row '
  'rather than refusing one; see the note in 0049 for why the requirement forces it.';

create trigger runs_get_an_eye_test
  after update on public.runs
  for each row
  when (new.status = 'complete' and old.status is distinct from 'complete')
  execute function public.enqueue_eye_test();
