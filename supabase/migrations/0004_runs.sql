-- 0004 — runs
--
-- D-002: runs are append-only. Re-scanning a merchant creates a new run and never updates an
-- existing one.
--
-- A run is mutable while it is in progress — `finished_at` and `status` are set when it
-- completes. It becomes immutable at that moment, and the trigger below enforces exactly that
-- boundary rather than a blanket ban that would make finishing a run impossible.

create table public.runs (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references public.merchants (id) on delete restrict,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  mode            text not null check (mode in ('public', 'screening_account', 'assisted')),
  ruleset_version text not null,
  status          text not null default 'running'
                  check (status in ('running', 'complete', 'failed')),

  -- Assembled report: verdict, coverage, counts, categories. Written once, when the run
  -- completes. Stored rather than recomputed so a report always reads exactly as it did when it
  -- was sent — a later rule-set change must not silently alter an old run's conclusions.
  report          jsonb,

  -- What the run did about Crawl-delay (D-013), and any coverage it truncated. Both belong in
  -- the record because both change what the findings mean.
  politeness      text,
  truncations     text[] not null default '{}',

  created_at      timestamptz not null default now(),

  -- runs.ruleset_version is not optional. A finding is meaningless without knowing which version
  -- of the rules produced it (docs/ARCHITECTURE.md).
  constraint ruleset_version_present check (length(ruleset_version) > 0),
  constraint finished_runs_have_a_terminal_status check (
    (finished_at is null) or (status in ('complete', 'failed'))
  )
);

comment on table public.runs is
  'One screening run. Append-only once finished (D-002); re-scanning creates a new row.';

alter table public.runs enable row level security;

create policy runs_select on public.runs
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.runs from authenticated, anon;

-- A finished run is frozen. Not bypassable by service_role, which is the point.
create or replace function public.reject_finished_run_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'runs are never deleted (D-002): run % is % ', old.id, old.status
      using errcode = 'restrict_violation';
  end if;

  if old.finished_at is not null then
    raise exception
      'run % finished at % and is immutable (D-002). Re-scanning creates a new run.',
      old.id, old.finished_at
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger runs_are_immutable_once_finished
  before update or delete on public.runs
  for each row execute function public.reject_finished_run_mutation();

create index runs_merchant_started_idx on public.runs (merchant_id, started_at desc);
create index runs_status_idx on public.runs (status) where status = 'running';
