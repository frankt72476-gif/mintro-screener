-- 0019 — packages
--
-- A package is an **application attempt**, not a merchant. A merchant declined by one processor
-- and resubmitted to another is two packages under one merchant, with different templates and
-- different findings — so `processor_key` and `template_version` live here rather than on the
-- merchant, and neither package can see the other's slots.
--
-- Lifecycle is mutable; a package is never deleted (D-097). Archival is an **access boundary, not
-- a deletion event**: bodies remain, retrieval takes an explicit operator action, and each
-- retrieval is logged (0023).

create table public.packages (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references public.merchants (id) on delete restrict,

  -- Which processor's required set this attempt is measured against. M1 seeds the template from
  -- CHECK-INVENTORY §4; M2 replaces the seeder with a loader over rules/documents.templates.json
  -- (D-101). The column does not change when that happens.
  processor_key        text not null check (length(processor_key) > 0),
  template_version     text not null check (length(template_version) > 0),

  lifecycle            text not null default 'open'
                       check (lifecycle in ('open', 'submitted', 'cancelled', 'reopened', 'archived')),

  opened_at            timestamptz not null default now(),
  submitted_at         timestamptz,
  cancelled_at         timestamptz,
  reopened_at          timestamptz,
  archived_at          timestamptz,

  -- When the retention clock started. Set on entering `submitted` or `cancelled`, cleared on
  -- reopen — which is what "restarts on reopen" means in practice: a reopened package is live
  -- work and is not counting down towards anything.
  retention_started_at timestamptz,

  -- Configurable rather than constant (D-084). 30 days is a starting position, and a constant
  -- would need a deploy to move.
  retention_days       integer not null default 30 check (retention_days > 0),

  created_at           timestamptz not null default now(),

  constraint archived_packages_have_a_date check ((lifecycle = 'archived') = (archived_at is not null)),
  constraint retention_clock_runs_only_when_closed check (
    retention_started_at is null or lifecycle in ('submitted', 'cancelled', 'archived')
  )
);

comment on table public.packages is
  'One application attempt. Keyed to the attempt, not the merchant: a resubmission to a second processor is a second package.';
comment on column public.packages.retention_started_at is
  'Start of the retention clock. Cleared on reopen (D-084). Archival changes access, never existence (D-097).';

alter table public.packages enable row level security;

create policy packages_select on public.packages
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.packages from authenticated, anon;

-- Legal transitions, and no deletion at all.
--
-- Not a role check and not an override flag. D-097 removed every deletion path from a package's
-- record, and a trigger that yielded to `service_role` would be a guarantee that holds only
-- against the people who are not writing the worker.
create or replace function public.enforce_package_lifecycle()
returns trigger
language plpgsql
as $$
declare
  legal boolean;
begin
  if tg_op = 'DELETE' then
    raise exception
      'packages are never deleted (D-097): archival is an access boundary, not a deletion event'
      using errcode = 'restrict_violation';
  end if;

  if new.lifecycle = old.lifecycle then
    return new;
  end if;

  legal := case old.lifecycle
    when 'open'      then new.lifecycle in ('submitted', 'cancelled')
    when 'submitted' then new.lifecycle in ('reopened', 'cancelled', 'archived')
    when 'cancelled' then new.lifecycle in ('reopened', 'archived')
    when 'reopened'  then new.lifecycle in ('submitted', 'cancelled')
    -- Archived is terminal for the lifecycle, but not for the record: the bodies stay readable
    -- and a reopen is still possible, which is why it is not a dead end here.
    when 'archived'  then new.lifecycle in ('reopened')
    else false
  end;

  if not legal then
    raise exception 'package % cannot move from % to %', old.id, old.lifecycle, new.lifecycle
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_package_lifecycle is
  'Legal lifecycle transitions, and an absolute refusal to delete. Not bypassed by service_role.';

create trigger packages_lifecycle
  before update or delete on public.packages
  for each row execute function public.enforce_package_lifecycle();

create index packages_merchant_idx on public.packages (merchant_id, opened_at desc);
create index packages_lifecycle_idx on public.packages (lifecycle);
-- The archival sweep's working set: closed packages still counting down.
create index packages_retention_idx on public.packages (retention_started_at)
  where retention_started_at is not null and lifecycle <> 'archived';
