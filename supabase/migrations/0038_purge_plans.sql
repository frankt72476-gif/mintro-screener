-- 0038 — the dry run, as a queued job with a recorded result (D-130, P4)
--
-- ## Why this cannot be computed in the browser
--
-- The plan reconciles what the database expects against **what is actually in the bucket**, and
-- `authenticated` cannot list the bucket. Measured, not assumed: `storage.from('documents').list()`
-- as an analyst returns `[]` with **no error** — there is no select policy on `storage.objects`, so
-- the call succeeds and finds nothing.
--
-- That is the silent-write shape from the `set_slot_state` audit, in Storage rather than PostgREST,
-- and pointed at a deletion planner. A browser-side dry run would list zero objects, find nothing
-- unexpected, and report a clean plan for a package full of files. It would be at its most
-- confident when it was most blind.
--
-- So the plan is a worker job holding the service key, and this is the queue.
--
-- ## One table, because a dry run is a diagnostic and not a record about a merchant
--
-- `document_send_requests` is separate from `document_report_sends` because a request that failed
-- is not a send. Nothing equivalent applies here: a plan produces no fact about the merchant, it
-- produces a description of the bucket at a moment. The row is the work item and its own result.
--
-- The result is still append-only once written. A plan an operator read and a plan that was
-- rewritten afterwards are different things to have been shown.

create table public.document_purge_plans (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages (id) on delete restrict,

  -- The approval this plan is for, when there is one. Null for a dry run taken before approval —
  -- which is the normal case and the whole point: look before anybody authorises anything.
  approval_id   uuid references public.package_purge_approvals (id) on delete restrict,

  requested_by  uuid not null references public.analysts (id) on delete restrict,

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  /*
    What the worker found, verbatim.

    Four lists, and the interesting ones are the last two:
      targets      — expected by the database and present in the bucket
      unexpected   — present in the bucket and accounted for by nothing
      alreadyPurged— expected, absent, and named in a prior purge for this package
      unexplained  — expected, absent, and named by nothing

    `unexpected` and `unexplained` are refusals. An object we cannot account for means our model of
    what is stored is wrong, and deleting under a wrong model is the failure this design exists to
    prevent (D-130).
  */
  plan          jsonb,
  -- Empty exactly when the plan would proceed. Stored rather than derived so the row says on its
  -- face whether it was a refusal.
  refusals      text[] not null default '{}',

  error         text,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),

  -- A finished plan has a plan in it. Without this, a `done` row with a null plan is a dry run that
  -- claims to have looked and cannot show at what.
  constraint finished_plans_have_a_plan check (status <> 'done' or plan is not null),
  constraint failed_plans_say_why check (status <> 'failed' or error is not null)
);

comment on table public.document_purge_plans is
  'A dry run: what a purge would delete, what it cannot account for, and whether it would refuse. '
  'Computed by the worker because authenticated cannot list the bucket — and a browser-side list '
  'returns empty rather than erroring (D-130).';
comment on column public.document_purge_plans.refusals is
  'Empty exactly when the plan would proceed. An unexpected object or an unexplained absence means '
  'our model of what is stored is wrong.';

alter table public.document_purge_plans enable row level security;

create policy document_purge_plans_select on public.document_purge_plans
  for select to authenticated
  using (public.is_analyst());

/*
  An analyst may ask for a dry run, and may not write its result.

  Queued only, and under their own name. An operator who could insert `done` with an empty refusal
  list could manufacture the evidence that a purge is safe — which is the one thing this table is
  for producing.
*/
create policy document_purge_plans_insert on public.document_purge_plans
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and plan is null
    and refusals = '{}'
    and claimed_at is null
    and finished_at is null
  );

revoke update, delete on public.document_purge_plans from authenticated, anon;

-- The row is a work item until it finishes, and a finished one is evidence. Deleting a plan an
-- operator was shown would remove the record of what they were told.
create or replace function public.reject_finished_plan_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'purge plans are never deleted: a plan an operator was shown is evidence of what they were told'
      using errcode = 'restrict_violation';
  end if;
  if old.status in ('done', 'failed') then
    raise exception 'purge plan % is finished and is append-only (D-130)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger document_purge_plans_are_final_once_finished
  before update or delete on public.document_purge_plans
  for each row execute function public.reject_finished_plan_mutation();

create index document_purge_plans_package_idx on public.document_purge_plans (package_id, created_at desc);
create index document_purge_plans_queue_idx on public.document_purge_plans (status, created_at)
  where status in ('queued', 'running');
