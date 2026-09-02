-- ================================================================================================
-- 0060 — Stage 1c: the boundary is the organization
-- ================================================================================================
--
-- Stage 1c of docs/admin-access-spec.md v2. Schema and predicate rework. No UI, no auth wiring, no
-- invite flow, no capability gating.
--
-- Stages 1 and 1b scoped reads to the person who made the work. That is wrong for a tool used by
-- more than one agency: colleagues at one agency could not cover for each other, and the model had
-- no concept of the boundary that outbound email and merchant-facing pages also have to respect.
-- The predicate moves from creator to organization. Everything else from those stages stands —
-- the table enumeration, the storage-key findings, the extractions scoping, the credential scoping.
--
-- ## Why org_id sits on runs and packages rather than being resolved through created_by
--
-- A run's organization is a fact about the run at the time it was made. Resolving it through
-- `created_by → analysts.org_id` on every policy evaluation would mean that moving one person
-- between organizations silently rewrites who owns everything they ever ran — a re-org as a
-- retroactive edit of history, which is the same objection D-002 makes to editing a finished run.
--
-- `created_by` stays, and stays not null. It is attribution, not the predicate: the access log, the
-- Stage 5 review path and any future audit all need to know which person did the work, and the org
-- column answers a different question.

-- ------------------------------------------------------------------------------------------------
-- organizations
-- ------------------------------------------------------------------------------------------------
--
-- Exactly one host, enforced the same way exactly one owner is: a partial unique index, so a second
-- host is a schema violation rather than something an admin screen has to remember to prevent.

create type public.org_type as enum ('host', 'partner');

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) > 0),
  type       public.org_type not null default 'partner',
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'The access boundary. One host (Mintro); every other row is a partner agency. Partners never learn of each other.';

create unique index organizations_one_host on public.organizations (type) where type = 'host';

alter table public.organizations enable row level security;

-- Writes are revoked outright. Supabase's bootstrap grants `authenticated` everything on `public`,
-- and RLS with no policy makes a *read* return nothing — but a write returns 204 with zero rows and
-- no error, which is indistinguishable from success at the client. The grant has to go for the
-- failure to be loud, and this is the one shape in the schema where it fails silently otherwise.
--
-- `select` is then granted back, because the policy below is what does the scoping and a policy
-- without the privilege is dead text. Nothing else is returned: `update`, `delete` and `insert`
-- stay revoked, so an organization is created and renamed by the service role alone.

revoke all on public.organizations from authenticated, anon;
grant select on public.organizations to authenticated;

-- The read policy is defined further down, with the other policies: it calls `current_admin_org()`,
-- which this migration does not define until after the columns those helpers read exist.

insert into public.organizations (name, type) values ('Mintro', 'host');

-- ------------------------------------------------------------------------------------------------
-- The second capability
-- ------------------------------------------------------------------------------------------------
--
-- NOT IN THE STAGE BRIEF'S four schema items, and added because the spec's data model assigns it to
-- this revision: "Added by this revision: org_id ... can_submit_to_iqwallet". Flagged in the report.
-- It is a column and a constraint only — nothing gates on it, which is Stage 5's work.

alter table public.analysts
  add column can_submit_to_iqwallet boolean not null default false;

comment on column public.analysts.can_submit_to_iqwallet is
  'Gates sending a report to IQwallet. Off until the owner grants it. Reading is never gated on a capability.';

-- The owner already exists, promoted by 0055, and the column above defaulted them to false — so the
-- extended constraint below would be violated by the one row it is about. Granted here, before the
-- constraint, in the same statement shape 0055 used to promote them.
--
-- This is an UPDATE, unlike everything else in this migration. `analysts` carries no immutability
-- trigger — it is a roster, not a record of work — and `reject_self_promotion()` passes writes with
-- no `auth.uid()`, which is what a migration is. Neither guard is being worked around.
--
-- Not caught by the schema tests: they apply migrations to an empty database, where there is no
-- owner row for the constraint to be violated by. Caught against a copy of production.

update public.analysts set can_submit_to_iqwallet = true where role = 'owner';

-- The owner check extends to both capabilities. Dropped and recreated rather than supplemented: a
-- second check constraint beside the first would be ANDed, which happens to be right here, but the
-- rule is one sentence and reads as one.

alter table public.analysts
  drop constraint analysts_owner_always_runs_documents_check;

alter table public.analysts
  add constraint analysts_owner_holds_every_capability
  check (
    role <> 'owner'
    or (can_run_documents_check = true and can_submit_to_iqwallet = true)
  );

-- ------------------------------------------------------------------------------------------------
-- analysts.org_id, runs.org_id, packages.org_id
-- ------------------------------------------------------------------------------------------------
--
-- The DDL pattern from 0057, now the house style: guard first, then `add column ... not null
-- default <resolved host org>` as DDL rather than an UPDATE, then drop the default.
--
-- No UPDATE anywhere. `ADD COLUMN` with a non-volatile default fires no row triggers, stores the
-- value as the column's missing value and does not rewrite the table — which is what keeps
-- `runs_are_immutable_once_finished` (0004) intact while forty finished runs gain a column.
--
-- The zero-rows path is carried forward: a table with nothing in it has nothing to attribute, so a
-- fresh checkout with no analysts, no runs and no packages applies cleanly instead of aborting on a
-- guard that is protecting nothing.

do $$
declare
  host_org uuid;
  hosts    bigint;
  t        text;
  n        bigint;
begin
  select count(*) into hosts from public.organizations where type = 'host';
  select id into host_org from public.organizations where type = 'host';

  foreach t in array array['analysts', 'runs', 'packages']
  loop
    execute format('select count(*) from public.%I', t) into n;

    if n = 0 then
      -- Nothing to attribute. Not null from the start, no default, no host org consulted.
      execute format(
        'alter table public.%I add column org_id uuid not null references public.organizations (id) on delete restrict',
        t
      );
      continue;
    end if;

    if hosts <> 1 then
      raise exception
        '%.org_id: % row(s) could not be attributed to an organization, so the migration was aborted.',
        t, n
        using detail = format(
          '%s row(s) in organizations carry type = ''host'', and exactly one is required. Every '
          || 'existing analyst, run and package is Mintro''s — and a row with no organization is '
          || 'covered by no policy, where null read as "nobody" hides it from the host and null '
          || 'read as "everybody" shows one agency''s work to another.',
          hosts
        ),
        hint = 'The host organization is seeded at the top of this same migration. If it is missing, that insert did not run.';
    end if;

    execute format(
      'alter table public.%I add column org_id uuid not null default %L references public.organizations (id) on delete restrict',
      t, host_org
    );
  end loop;
end
$$;

comment on column public.analysts.org_id is
  'The organization this person belongs to. The access boundary; moving it is the owner''s act alone.';
comment on column public.runs.org_id is
  'The organization this run was made by, as at the time it was made. Not resolved through created_by.';
comment on column public.packages.org_id is
  'The organization this package was opened by, as at the time it was opened. Not resolved through created_by.';

-- The defaults existed only for the statement that needed them. A later insert that omits org_id is
-- refused by the not-null rather than quietly attributed to the host, which is the same reasoning
-- 0057 applied to created_by and the same reason the service-role paths had to change.

alter table public.analysts alter column org_id drop default;
alter table public.runs     alter column org_id drop default;
alter table public.packages alter column org_id drop default;

create index analysts_org on public.analysts (org_id);
create index runs_org     on public.runs (org_id, started_at desc);
create index packages_org on public.packages (org_id, opened_at desc);

do $$
declare
  bad bigint;
begin
  select
    (select count(*) from public.analysts a where not exists (select 1 from public.organizations o where o.id = a.org_id))
  + (select count(*) from public.runs r      where not exists (select 1 from public.organizations o where o.id = r.org_id))
  + (select count(*) from public.packages p  where not exists (select 1 from public.organizations o where o.id = p.org_id))
  into bad;

  if bad > 0 then
    raise exception 'org_id: % row(s) do not point at an organization after the columns were added.', bad
      using hint = 'ADD COLUMN with a default did not populate pre-existing rows. Do not deploy.';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------
-- Two more helpers, same construction as the existing four
-- ------------------------------------------------------------------------------------------------

create or replace function public.current_admin_org()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.analysts where id = auth.uid();
$$;

comment on function public.current_admin_org is
  'The calling session''s organization, or null. Null means no scoping decision can be made from it.';

create or replace function public.current_admin_is_host()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- `coalesce` to false, never null, for the same reason `current_admin_is_owner` does it: a policy
  -- reading null evaluates to null and denies, which is the right outcome by accident rather than
  -- by statement.
  select coalesce(
    (
      select o.type = 'host'
      from public.analysts a
      join public.organizations o on o.id = a.org_id
      where a.id = auth.uid()
    ),
    false
  );
$$;

comment on function public.current_admin_is_host is
  'True for a member of the host organization. Host members see all work and hold no administrative controls.';

revoke all on function public.current_admin_org() from public, anon;
revoke all on function public.current_admin_is_host() from public, anon;
grant execute on function public.current_admin_org() to authenticated;
grant execute on function public.current_admin_is_host() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- The two predicates, reworked
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from their current definitions — `can_read_run` from 0058, `can_read_package` from 0059
-- — not from anything earlier. Every table that calls one of these inherits the rework without a
-- policy change, which is the whole reason the predicate was written once in Stage 1 rather than
-- copied into sixteen policies.
--
-- The creator clause is gone, not supplemented. `created_by = current_admin_id() OR org matches`
-- would be the same set today and would quietly reintroduce creator scoping the day someone moves
-- organization: their old work would follow them instead of staying with the org that did it.

create or replace function public.can_read_run(p_run uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_analyst()
     and public.current_admin_is_active()
     and exists (
       select 1
       from public.runs r
       where r.id = p_run
         and (r.org_id = public.current_admin_org() or public.current_admin_is_host())
     );
$$;

comment on function public.can_read_run is
  'Run visibility: an active analyst whose organization made the run, or any host-org member. The single definition.';

create or replace function public.can_read_package(p_package uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_analyst()
     and public.current_admin_is_active()
     and exists (
       select 1
       from public.packages p
       where p.id = p_package
         and (p.org_id = public.current_admin_org() or public.current_admin_is_host())
     );
$$;

comment on function public.can_read_package is
  'Package visibility: an active analyst whose organization opened it, or any host-org member. The single definition.';

-- ------------------------------------------------------------------------------------------------
-- The policies that spell the predicate out rather than calling it
-- ------------------------------------------------------------------------------------------------
--
-- Re-derived rather than taken from the last report: of the 55 policies now in place, 47 call one of
-- the two functions and inherit the rework untouched. Eight state a predicate of their own, and of
-- those, three are owner-only (`admin_access_log`, `credential_state`, `credential_access`) and are
-- unaffected by an org rework — they are deliberately left exactly as they are.
--
-- Each replacement below is written from that policy's *current* text, not from the migration that
-- introduced it.

drop policy runs_select on public.runs;
create policy runs_select on public.runs
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      org_id = public.current_admin_org()
      or public.current_admin_is_host()
    )
  );

drop policy packages_select on public.packages;
create policy packages_select on public.packages
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      org_id = public.current_admin_org()
      or public.current_admin_is_host()
    )
  );

-- `scan_requests` has no org column of its own: a queued request has no run yet, so there is nothing
-- to carry the fact. It resolves through the requester's analyst row instead.
--
-- That is the resolution-through-a-person this migration rejects for runs and packages, and it is
-- right here for the reason it is wrong there: a queue row is live state, not a historical record.
-- Once the worker opens the run, `runs.org_id` fixes the organization permanently and this row stops
-- mattering. Nothing about a completed run is decided by it.

drop policy scan_requests_select on public.scan_requests;
create policy scan_requests_select on public.scan_requests
  for select to authenticated
  using (
    public.can_read_run(run_id)
    or (
      public.is_analyst()
      and public.current_admin_is_active()
      and (
        public.current_admin_is_host()
        or exists (
          select 1 from public.analysts a
          where a.id = scan_requests.requested_by
            and a.org_id = public.current_admin_org()
        )
      )
    )
  );

-- Insert: the original predicate verbatim, with `requested_by` still pinned to the caller. An
-- organization scope would let one colleague queue work under another's name, which is a different
-- and worse thing than letting them read it. `mode = 'public'` is carried over — D-040 made it a
-- schema property that every scan begins anonymous, and this policy has lost it once already.

drop policy scan_requests_insert on public.scan_requests;
create policy scan_requests_insert on public.scan_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and public.current_admin_is_active()
    and requested_by = auth.uid()
    and status = 'queued'
    -- Not a preference the requester may express. The worker escalates on evidence or not at all.
    and mode = 'public'
  );

-- Host-org members list every organization; everyone else sees exactly the one they are in.
--
-- Keyed on `current_admin_is_host()` rather than on the owner. The owner is a member of the host
-- organization, so the host clause already covers them and an owner clause beside it would be dead
-- text that reads as though it were doing something.
--
-- This is the same shape as the run and package predicates — host sees all, everyone else sees their
-- own — and matching them matters more than it looks: a host member who can read every analyst row
-- would otherwise hold `org_id` values with no organization to resolve them against, which is a view
-- that can name a person and not the agency they work for.
--
-- A partner sees one row. Not "their own plus the host's": that a partner cannot enumerate the other
-- agencies is the boundary this stage exists to draw, and Mintro's own row is no more theirs to list
-- than anyone else's.

create policy organizations_select on public.organizations
  for select to authenticated
  using (
    public.is_analyst()
    and (
      public.current_admin_is_host()
      or id = public.current_admin_org()
    )
  );

-- `analysts`: your own row, your own organization's members, everything if you are the owner, and
-- everything if you are a host-org member.
--
-- The org clause is the point of the stage — colleagues have to be able to see each other. The
-- boundary is that a *partner* sees no member of any other organization, including the host's:
-- learning that Mintro has six staff is a smaller leak than learning another agency exists, but it
-- is the same leak, and this policy is the only thing preventing it.
--
-- The host clause is what makes the rest of the system able to say who did something. `created_by`
-- is a uuid; a host member reviewing a partner's run, or reading the Run by column, has to be able
-- to turn it into a name. Without this they would see work they are entitled to see and be unable
-- to attribute it — and the alternative, denormalising a display name onto every run, would be a
-- second copy of a fact free to go stale.
--
-- Note the asymmetry, which is deliberate and not an oversight: a host member reads every analyst
-- row, and a partner member reads only their own organization's. Visibility runs one way across the
-- boundary, the same way it does for runs and packages.

drop policy analysts_select on public.analysts;
create policy analysts_select on public.analysts
  for select to authenticated
  using (
    public.is_analyst()
    and (
      id = auth.uid()
      or public.current_admin_is_owner()
      or public.current_admin_is_host()
      or org_id = public.current_admin_org()
    )
  );

-- `merchants`: the caller's organization holds a run or a package for it, or the caller is the
-- owner. Reworked from creator to org, and the package clause is kept — it was added in Stage 1b
-- because scoping on runs alone left an analyst able to read a package and not its merchant row.
--
-- Host members are covered by `current_admin_is_host()` rather than by the exists clauses, so a
-- merchant nobody has run yet is still visible to nobody, which is unchanged.

drop policy merchants_select on public.merchants;
create policy merchants_select on public.merchants
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      public.current_admin_is_owner()
      or public.current_admin_is_host()
      or exists (
        select 1 from public.runs r
        where r.merchant_id = merchants.id
          and r.org_id = public.current_admin_org()
      )
      or exists (
        select 1 from public.packages p
        where p.merchant_id = merchants.id
          and p.org_id = public.current_admin_org()
      )
    )
  );

-- ------------------------------------------------------------------------------------------------
-- Self-promotion, extended to cover the organization
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from 0058's definition, the current one. `org_id` and `can_submit_to_iqwallet` join the
-- governed set: moving yourself between organizations is the whole boundary, undone in one update.
--
-- `auth.uid() is null` is still the service role and the migration runner — neither has a viewer,
-- both are outside RLS by design, and this migration's own DDL runs that way.

create or replace function public.reject_self_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.role, new.can_run_documents_check, new.can_submit_to_iqwallet, new.status, new.active, new.org_id)
     is distinct from (old.role, old.can_run_documents_check, old.can_submit_to_iqwallet, old.status, old.active, old.org_id)
     and not public.current_admin_is_owner() then
    raise exception
      'only the account owner may change role, can_run_documents_check, can_submit_to_iqwallet, status, active or org_id on analysts'
      using errcode = 'insufficient_privilege',
            detail = format('attempted by %s on row %s', auth.uid(), old.id);
  end if;

  return new;
end;
$$;

comment on function public.reject_self_promotion is
  'Governing columns on analysts are the owner''s to write. Independent of whatever UPDATE grants exist.';

-- ------------------------------------------------------------------------------------------------
-- The only path that creates a package
-- ------------------------------------------------------------------------------------------------
--
-- `packages.org_id` is not null with no default, so this function would fail at the constraint from
-- here on. Rewritten from 0059's definition — the current one, which already carries `created_by`
-- and 0035's `retention_days = 30`. Taking 0034's body instead put 365 back once already.
--
-- The organization is read from the opening analyst and then fixed on the package. `created_by` is
-- unchanged and still records the person: the two columns answer different questions and both are
-- needed.

create or replace function public.create_document_package(
  p_merchant_id            uuid,
  p_processor_key          text,
  p_slots                  jsonb,
  p_removals               jsonb    default '[]'::jsonb,
  p_entity_type            text     default null,
  p_has_existing_processor boolean  default null,
  p_us_domiciled           boolean  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_analyst uuid := auth.uid();
  -- 0060: the organization the package belongs to, as at the moment it was opened.
  v_org     uuid;
  v_package uuid;
  v_slot    jsonb;
  v_known   boolean := p_entity_type is not null
                    or p_has_existing_processor is not null
                    or p_us_domiciled is not null;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may create a package';
  end if;

  if jsonb_array_length(p_slots) = 0 then
    raise exception 'a package must have at least one slot';
  end if;

  select org_id into v_org from public.analysts where id = v_analyst;
  if v_org is null then
    raise exception 'cannot open a package: % belongs to no organization', v_analyst
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.packages (
    merchant_id, processor_key, template_version, lifecycle, retention_days,
    entity_type, has_existing_processor, us_domiciled, facts_set_by, facts_set_at,
    -- 0059: who the package belongs to, and the only place it is written. `v_analyst` is
    -- `auth.uid()`, already proven to be an analyst by the guard at the top of this function.
    -- The column is not null with no default and this is the only insert path, so a package
    -- cannot exist without an owner and nothing has to remember to supply one.
    created_by,
    -- 0060: the access boundary. Read from the opening analyst's row here and then fixed on the
    -- package, so that moving that person to another organization later does not silently move
    -- every package they ever opened along with them.
    org_id
  )
  values (
    -- 30, not 365: D-084's number, reaffirmed by D-130.
    p_merchant_id, p_processor_key, 'documents-1', 'open', 30,
    p_entity_type, p_has_existing_processor, p_us_domiciled,
    -- Stamped only where something was actually answered. An author against three nulls would read
    -- as "this person said they did not know", which nobody did.
    case when v_known then v_analyst end,
    case when v_known then now() end,
    v_analyst,
    v_org
  )
  returning id into v_package;

  for v_slot in select * from jsonb_array_elements(p_slots)
  loop
    insert into public.slots (
      package_id, slot_key, instance_label, required_count,
      coverage_monthly, coverage_grace_days, expiry_after_run, origin, examined, state
    )
    values (
      v_package,
      v_slot->>'slot_key',
      nullif(v_slot->>'instance_label', ''),
      (v_slot->>'required_count')::int,
      coalesce((v_slot->>'coverage_monthly')::boolean, false),
      (v_slot->>'coverage_grace_days')::int,
      coalesce((v_slot->>'expiry_after_run')::boolean, false),
      v_slot->>'origin',
      coalesce((v_slot->>'examined')::boolean, true),
      case when (v_slot->>'required_count') is null then 'not_evaluable' else 'missing' end
    );
  end loop;

  for v_slot in select * from jsonb_array_elements(p_removals)
  loop
    insert into public.package_slot_removals (package_id, slot_key, origin, removed_by)
    values (v_package, v_slot->>'slot_key', v_slot->>'origin', v_analyst);
  end loop;

  return v_package;
end;
$$;
revoke all on function public.create_document_package(uuid, text, jsonb, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.create_document_package(uuid, text, jsonb, jsonb, text, boolean, boolean) to authenticated;
