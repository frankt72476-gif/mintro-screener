-- 0012 — the scan queue
--
-- An analyst types a storefront URL; a row lands here; the worker on Fly claims it and screens it.
-- That is the whole mechanism. There is no dashboard and no job service — a queue table and a
-- poller is the smallest thing that lets a scan start from somewhere other than one laptop.
--
-- ## The request is not the run
--
-- A request records that someone asked. A run records what was observed. They are separate rows
-- because they answer to different rules: a request can be retried, superseded or abandoned, and
-- a run is immutable once finished (D-002). Collapsing them would make the queue's bookkeeping
-- into edits of a screening record, which is exactly what D-002 forbids.
--
-- `run_id` is set when the worker finishes. Until then it is null, which is what "no observation
-- exists yet" looks like — not a run in a pending state.

create table public.scan_requests (
  id            uuid primary key default gen_random_uuid(),
  url           text not null check (url ~ '^https?://'),
  requested_by  uuid not null references public.analysts (id) on delete restrict,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- Set by the worker when it finishes. A request that produced no run has none, and says so by
  -- being null rather than by pointing at a placeholder.
  run_id        uuid references public.runs (id) on delete restrict,
  error         text,

  -- Free text the worker appends as it goes, so the UI can say more than "running". Not a log
  -- store: it is truncated by the writer and nothing reads it but the progress line.
  progress      text,

  -- Bounded so a crashed machine's claim can be reclaimed rather than stranding the request.
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- A finished request either produced a run or recorded why it did not. Neither state is allowed
  -- to be silent: "done with no run and no error" is the shape every defect in this project has
  -- taken, and the database refuses to store it.
  constraint finished_requests_say_what_happened check (
    status <> 'done' or run_id is not null
  ),
  constraint failed_requests_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.scan_requests is
  'Queue of scans requested from the UI. The worker polls, claims, screens, and records the run it produced.';
comment on column public.scan_requests.run_id is
  'The run this request produced. Null until the worker finishes; never a placeholder.';

alter table public.scan_requests enable row level security;

-- Analysts see the queue and may add to it. They may not edit or remove a request: what happened
-- to a scan is the worker's record, not something the requester revises afterwards.
create policy scan_requests_select on public.scan_requests
  for select to authenticated
  using (public.is_analyst());

create policy scan_requests_insert on public.scan_requests
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid() and status = 'queued');

revoke update, delete on public.scan_requests from authenticated, anon;

create index scan_requests_queue_idx on public.scan_requests (status, created_at);

-- ---------------------------------------------------------------------------------------------
-- Quarantined runs
-- ---------------------------------------------------------------------------------------------
--
-- Five runs were closed before they were verified (D-033) and carry evidence rows keyed by storage
-- path rather than artifact key (D-034). They are frozen (D-002): they cannot be completed and
-- cannot be deleted. They are also, from the outside, indistinguishable from good runs — status
-- `complete`, a full report, findings that render.
--
-- A demo viewer must not read them as ordinary results. So the fact is recorded here, in the
-- database, where the frontend, the worker and the verification script all reach the same answer.
-- It previously lived in a JSON file only two scripts read; one source of truth, per D-034.
--
-- This is an annotation, not a revision. The run row, its findings and its report are untouched —
-- what is added is a separate statement that its evidence is incomplete, and why. Marking a run
-- as unreliable is not the same as editing what it claimed, and D-002 forbids only the second.

create table public.run_quarantine (
  run_id       uuid primary key references public.runs (id) on delete restrict,
  reason       text not null,
  recorded_at  timestamptz not null default now()
);

comment on table public.run_quarantine is
  'Runs whose evidence is known to be incomplete. An annotation on an immutable run, never an edit of one.';

alter table public.run_quarantine enable row level security;

create policy run_quarantine_select on public.run_quarantine
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.run_quarantine from authenticated, anon;

-- Append-only, like evidence. A quarantine notice that could be quietly withdrawn would be worth
-- nothing — and service_role bypasses RLS, so this has to be a trigger.
create trigger run_quarantine_is_append_only
  before update or delete on public.run_quarantine
  for each row execute function public.reject_mutation();

-- The five, by id. Written as a select against `runs` so this migration is a no-op on a project
-- that never held them — a fresh database has nothing to quarantine, and a hardcoded insert would
-- fail its foreign key there.
insert into public.run_quarantine (run_id, reason)
select r.id,
       'Closed before it was verified (D-033). Its evidence rows are keyed by storage path rather '
       || 'than artifact key (D-034), so findings cite captures that cannot be resolved. The run is '
       || 'frozen and cannot be repaired (D-002); it is retained as history.'
from public.runs r
where r.id in (
  '7fa5a6a1-8fa4-4489-b006-725655821ef2',
  '172587ea-029c-4efd-86af-fe562dae58ea',
  'ced22bc7-7e8a-4fba-8c1f-e8e48cf9834a',
  '8343f7f3-1cb8-4fe7-adb6-201d97b2fe8f',
  'ec70e7cd-04f2-4087-8821-c4cdb93b4350'
)
on conflict (run_id) do nothing;
