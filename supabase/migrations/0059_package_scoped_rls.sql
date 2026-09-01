-- ================================================================================================
-- 0059 — Stage 1b: packages are private, and credentials are the owner's alone
-- ================================================================================================
--
-- Stage 1 scoped everything that hangs off a run and left the documents side reading bare
-- `is_analyst()`. That was a real leak, theoretical only because there is one analyst today. Stage 2
-- creates the second, so it closes here first.
--
-- ## The anchor is the package, not the run
--
-- docs/admin-access-spec.md says Documents Check artifacts are "scoped by the run they belong to".
-- They are not: nothing in the documents chain carries a run foreign key. `documents`, `slots`,
-- `document_runs` and every package_* table anchor on `packages`, which anchors on `merchants`.
-- Scoping them through runs is not possible, so packages get their own owner and their own
-- predicate, mirroring runs exactly.
--
-- ## The capability flag is not mentioned anywhere below, deliberately
--
-- `can_run_documents_check` gates *creating* a document run. Package ownership gates *reading* one.
-- Wiring the flag into a select policy would make revocation retroactive — the person would lose
-- sight of work they already produced and already read — and the spec forbids exactly that. The two
-- controls answer different questions and must not be joined.

-- ------------------------------------------------------------------------------------------------
-- packages.created_by
-- ------------------------------------------------------------------------------------------------
--
-- The same shape as 0057, for the same reasons: guard first, then `add column ... not null default`
-- as DDL rather than an UPDATE, then drop the default so nothing is ever attributed by fallback.
--
-- The zero-rows path is carried forward from 0057's fix. A fresh checkout has no packages and no
-- analysts; demanding an owner there aborts the migration chain on every machine that has not
-- restored production, which is the guard firing where it protects nothing.

do $$
declare
  owner_id uuid;
  owners   bigint;
  affected bigint;
begin
  select count(*) into affected from public.packages;
  select count(*) into owners   from public.analysts where role = 'owner';

  if affected = 0 then
    alter table public.packages add column created_by uuid not null references public.analysts (id) on delete restrict;
    return;
  end if;

  if owners <> 1 then
    raise exception
      'packages.created_by: % package(s) could not be attributed to an owner, so the migration was aborted.',
      affected
      using detail = format(
        '%s row(s) in analysts carry role = ''owner'', and exactly one is required. Every package '
        || 'must resolve to that one, because a package with no owner is covered by no policy — '
        || 'and null read as "nobody" hides it from the owner, while null read as "everybody" '
        || 'shows every merchant''s documents to every admin.',
        owners
      ),
      hint = 'Apply 0055 (which promotes the active analyst to owner) before this migration, and confirm the update matched a row.';
  end if;

  select id into owner_id from public.analysts where role = 'owner';

  execute format(
    'alter table public.packages add column created_by uuid not null default %L references public.analysts (id) on delete restrict',
    owner_id
  );
end
$$;

comment on column public.packages.created_by is
  'The admin who opened this package. Never inferred: create_document_package writes it explicitly.';

alter table public.packages alter column created_by drop default;

create index packages_created_by on public.packages (created_by, opened_at desc);

do $$
declare
  unattributed bigint;
begin
  select count(*) into unattributed
  from public.packages p
  where not exists (select 1 from public.analysts a where a.id = p.created_by);

  if unattributed > 0 then
    raise exception
      'packages.created_by: % package(s) do not point at an analyst after the column was added.', unattributed
      using hint = 'ADD COLUMN with a default did not populate pre-existing rows. Do not deploy.';
  end if;
end
$$;

-- ------------------------------------------------------------------------------------------------
-- can_read_package
-- ------------------------------------------------------------------------------------------------
--
-- Deliberately identical in shape to `can_read_run`. Two predicates that mean "this is mine or I am
-- the owner" should not differ in wording, because a reader comparing them has to be able to see at
-- a glance that they do the same thing.

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
         and (p.created_by = public.current_admin_id() or public.current_admin_is_owner())
     );
$$;

comment on function public.can_read_package is
  'Package visibility: an active analyst who either opened the package or is the owner. The single definition.';

revoke all on function public.can_read_package(uuid) from public, anon;
grant execute on function public.can_read_package(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- Fifteen tables that carry package_id
-- ------------------------------------------------------------------------------------------------
--
-- Every one is replaced, never supplemented: permissive policies OR together, so a second policy
-- beside `is_analyst()` would widen rather than narrow. Each predicate below is the *current* one,
-- read from the last migration that defined it rather than the one that introduced it — Stage 1
-- nearly reverted D-040 and 0053 by doing the opposite.

drop policy packages_select on public.packages;
create policy packages_select on public.packages
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      created_by = public.current_admin_id()
      or public.current_admin_is_owner()
    )
  );

drop policy slots_select on public.slots;
create policy slots_select on public.slots
  for select to authenticated using (public.can_read_package(package_id));

drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_runs_select on public.document_runs;
create policy document_runs_select on public.document_runs
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_findings_select on public.document_findings;
create policy document_findings_select on public.document_findings
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_retrievals_select on public.document_retrievals;
create policy document_retrievals_select on public.document_retrievals
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_uploads_select on public.document_uploads;
create policy document_uploads_select on public.document_uploads
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_report_sends_select on public.document_report_sends;
create policy document_report_sends_select on public.document_report_sends
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_send_requests_select on public.document_send_requests;
create policy document_send_requests_select on public.document_send_requests
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_export_requests_select on public.document_export_requests;
create policy document_export_requests_select on public.document_export_requests
  for select to authenticated using (public.can_read_package(package_id));

drop policy document_purge_plans_select on public.document_purge_plans;
create policy document_purge_plans_select on public.document_purge_plans
  for select to authenticated using (public.can_read_package(package_id));

drop policy package_exports_select on public.package_exports;
create policy package_exports_select on public.package_exports
  for select to authenticated using (public.can_read_package(package_id));

drop policy package_purge_approvals_select on public.package_purge_approvals;
create policy package_purge_approvals_select on public.package_purge_approvals
  for select to authenticated using (public.can_read_package(package_id));

drop policy package_purges_select on public.package_purges;
create policy package_purges_select on public.package_purges
  for select to authenticated using (public.can_read_package(package_id));

drop policy package_slot_removals_select on public.package_slot_removals;
create policy package_slot_removals_select on public.package_slot_removals
  for select to authenticated using (public.can_read_package(package_id));

-- ------------------------------------------------------------------------------------------------
-- Four that reach a package one hop out
-- ------------------------------------------------------------------------------------------------
--
-- These carry no `package_id` of their own, so each resolves through the row it annotates. The join
-- is on the primary key of the parent, and a row whose parent has gone (or was never there) matches
-- nothing and is denied — fail closed, which is the right direction for a purge record.

drop policy package_export_verifications_select on public.package_export_verifications;
create policy package_export_verifications_select on public.package_export_verifications
  for select to authenticated
  using (exists (
    select 1 from public.package_exports e
    where e.id = package_export_verifications.export_id
      and public.can_read_package(e.package_id)
  ));

drop policy package_vault_attestations_select on public.package_vault_attestations;
create policy package_vault_attestations_select on public.package_vault_attestations
  for select to authenticated
  using (exists (
    select 1 from public.package_exports e
    where e.id = package_vault_attestations.export_id
      and public.can_read_package(e.package_id)
  ));

drop policy package_purge_completions_select on public.package_purge_completions;
create policy package_purge_completions_select on public.package_purge_completions
  for select to authenticated
  using (exists (
    select 1 from public.package_purges p
    where p.id = package_purge_completions.purge_id
      and public.can_read_package(p.package_id)
  ));

drop policy purged_objects_select on public.purged_objects;
create policy purged_objects_select on public.purged_objects
  for select to authenticated
  using (exists (
    select 1 from public.package_purges p
    where p.id = purged_objects.purge_id
      and public.can_read_package(p.package_id)
  ));

-- ------------------------------------------------------------------------------------------------
-- extractions, which anchor on nothing
-- ------------------------------------------------------------------------------------------------
--
-- `extractions` is keyed `(sha256, extractor_version)` — a cache of what was read out of a document,
-- addressed by the document's content and belonging to no package at all. It nonetheless holds the
-- extracted contents of a merchant's document, so leaving it on `is_analyst()` would hand over the
-- text of every document in the system to anyone who can guess or observe a hash.
--
-- Scoped through the versions that share its hash: readable when some `document_version` with that
-- sha256 sits in a package the caller may read. A hash matching no stored version matches nothing
-- and is denied.
--
-- One consequence, stated rather than buried: the same file uploaded to two packages has one cache
-- row, so either package's reader can read it. That is the same bytes they can already open from
-- their own package, not a second merchant's document — but it is a real property of a
-- content-addressed cache and it should be visible here rather than discovered later.

drop policy extractions_select on public.extractions;
create policy extractions_select on public.extractions
  for select to authenticated
  using (exists (
    select 1 from public.document_versions v
    where v.sha256 = extractions.sha256
      and public.can_read_package(v.package_id)
  ));

-- ------------------------------------------------------------------------------------------------
-- Insert policies: the original predicate, verbatim, with the scope ANDed on
-- ------------------------------------------------------------------------------------------------
--
-- Without this an admin could queue an export, a purge plan, a send or an upload against a package
-- that was never theirs, and be handed the contents by file or by email. Scoping select alone would
-- leave the documents reachable by asking for them to be delivered.

drop policy document_uploads_insert on public.document_uploads;
create policy document_uploads_insert on public.document_uploads
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and public.can_read_package(package_id)
  );

drop policy document_send_requests_insert on public.document_send_requests;
create policy document_send_requests_insert on public.document_send_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_package(package_id)
  );

drop policy document_export_requests_insert on public.document_export_requests;
create policy document_export_requests_insert on public.document_export_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and export_id is null
    and storage_key is null
    and claimed_at is null
    and finished_at is null
    and public.can_read_package(package_id)
  );

drop policy document_purge_plans_insert on public.document_purge_plans;
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
    and public.can_read_package(package_id)
  );

-- ------------------------------------------------------------------------------------------------
-- PART B — credentials
-- ------------------------------------------------------------------------------------------------
--
-- Scoped harder than runs and packages, and with no creator exemption. A merchant's screening-account
-- credentials are access to somebody else's account, not work product: the analyst who deposited them
-- has no more claim to read them back than anyone else, and hard constraint 6 makes their handling a
-- property of the system rather than of who asks.
--
-- Only two of the five tables need changing. The other three are already closed, and are listed here
-- so that "already correct" is on the record rather than mistaken for an omission:
--
--   * `credentials` (0003)         — RLS on, no policy at all, `revoke all from authenticated, anon`.
--   * `credential_deposits` (0013) — insert-only policy; `select` revoked from authenticated.
--   * `vault_entries` (0013)       — RLS on, no policy, `revoke all`. The sealed material itself.
--
-- Each of those is currently readable by *nobody* through PostgREST. Adding an owner-only select
-- policy would be a widening, not a narrowing, so none is added. Raised in the Stage 1b report.

drop policy credential_state_select on public.credential_state;
create policy credential_state_select on public.credential_state
  for select to authenticated
  using (public.current_admin_is_owner());

drop policy credential_access_select on public.credential_access;
create policy credential_access_select on public.credential_access
  for select to authenticated
  using (public.current_admin_is_owner());

-- The insert path and the append-only trigger are untouched: `credential_deposits_insert` still
-- admits a deposit from any active analyst, and `credential_access` is still written by the worker
-- and still refuses update and delete to everyone including the service role.

-- ------------------------------------------------------------------------------------------------
-- The only path that creates a package
-- ------------------------------------------------------------------------------------------------
--
-- `packages.created_by` is not null with no default, so this function would fail at the constraint
-- from here on. It is the sole insert path — `packages` revokes insert from `authenticated`, and no
-- TypeScript in the repo writes the table — so this is where the owner is supplied, once.
--
-- Reproduced in full rather than patched in place, because there is no way to alter one statement of
-- a function body: `create or replace` replaces the whole thing. The body below is 0034's verbatim,
-- with `created_by` added to the column list and `v_analyst` to the values. `v_analyst` is
-- `auth.uid()` and the guard at the top has already refused anyone who is not an analyst, so this
-- attributes the package to the person who actually opened it rather than to a fallback.

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

  insert into public.packages (
    merchant_id, processor_key, template_version, lifecycle, retention_days,
    entity_type, has_existing_processor, us_domiciled, facts_set_by, facts_set_at,
    -- 0059: who the package belongs to, and the only place it is written. `v_analyst` is
    -- `auth.uid()`, already proven to be an analyst by the guard at the top of this function.
    -- The column is not null with no default and this is the only insert path, so a package
    -- cannot exist without an owner and nothing has to remember to supply one.
    created_by
  )
  values (
    -- 30, not 365: D-084's number, reaffirmed by D-130.
    p_merchant_id, p_processor_key, 'documents-1', 'open', 30,
    p_entity_type, p_has_existing_processor, p_us_domiciled,
    -- Stamped only where something was actually answered. An author against three nulls would read
    -- as "this person said they did not know", which nobody did.
    case when v_known then v_analyst end,
    case when v_known then now() end,
    v_analyst
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
