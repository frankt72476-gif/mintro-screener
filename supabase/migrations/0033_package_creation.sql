-- 0033 — creating a package, and recording what the operator changed
--
-- An analyst has had to insert a row by hand. This is the flow that replaces it: pick or create a
-- merchant, answer the three D-081 questions, adjust the resulting set, create.
--
-- ## Why a function rather than insert policies
--
-- A package is not one row. It is a merchant, a package, and fifteen-odd slots that have to agree
-- with each other and with the template — and the browser assembling them one insert at a time can
-- fail halfway and leave a package with four slots that looks exactly like a package that needed
-- four. `security definer` puts the whole thing in one transaction, which is the same reason
-- 0016's comment functions are written this way.
--
-- Table-level insert stays revoked. The function is the only path, `is_analyst()` is the guard,
-- and the schema's own constraints still apply inside it.
--
-- ## Removals are recorded, not implied
--
-- An operator unchecking a default slot produces a row here, not a shorter list. A shorter list is
-- indistinguishable from a list that was always shorter, and "somebody decided this was not needed"
-- is a different fact from "this was never asked for" — the report can say the set was adjusted
-- only if something recorded that it was.
--
-- Structurally impossible slots (D-081) are **not** removals. They were never offered, because a
-- sole proprietorship has no Articles to decline. Recording them here would put an operator's name
-- against a decision they did not make.

create table public.package_slot_removals (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.packages (id) on delete restrict,
  slot_key     text not null check (length(slot_key) > 0),
  -- The origin the slot would have had. Only a default set slot can be removed; a conditional that
  -- did not fire was never in the set, and an `added` slot that is not added is simply not added.
  origin       text not null check (origin in ('required', 'conditional')),
  removed_by   uuid not null references public.analysts (id) on delete restrict,
  removed_at   timestamptz not null default now(),
  unique (package_id, slot_key)
);

create trigger package_slot_removals_are_immutable
  before update or delete on public.package_slot_removals
  for each row execute function public.reject_mutation();

alter table public.package_slot_removals enable row level security;

create policy package_slot_removals_select on public.package_slot_removals
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.package_slot_removals from authenticated, anon;

comment on table public.package_slot_removals is
  'A default slot the operator took out of this package. Recorded so a shorter set is '
  'distinguishable from a set that was always shorter (D-128).';

/*
  Create a package with its slots, atomically.

  `p_slots` is the resolved set the operator confirmed: one object per slot with `slot_key`,
  `origin`, `instance_label`, `required_count`, `coverage_monthly`, `coverage_grace_days`,
  `expiry_after_run` and `examined`. The browser resolves it from the template — it holds the rules
  package — and every value still passes the `slots` table's own constraints on the way in.

  Returns the package id.
*/
create or replace function public.create_document_package(
  p_merchant_id   uuid,
  p_processor_key text,
  p_slots         jsonb,
  p_removals      jsonb default '[]'::jsonb
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
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may create a package';
  end if;

  if jsonb_array_length(p_slots) = 0 then
    -- A package with no slots is a package that asks for nothing, which is never what anybody
    -- meant and is indistinguishable afterwards from one whose slots failed to insert.
    raise exception 'a package must have at least one slot';
  end if;

  insert into public.packages (merchant_id, processor_key, template_version, lifecycle, retention_days)
  values (p_merchant_id, p_processor_key, 'documents-1', 'open', 365)
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
      -- D-107: a slot whose count nobody knows cannot say anything is absent.
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

revoke all on function public.create_document_package(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_document_package(uuid, text, jsonb, jsonb) to authenticated;

/*
  Create a merchant, or return the existing one for a domain.

  Same reasoning: `merchants` has no insert policy and should not get one, but an analyst opening a
  package for a merchant nobody has screened yet must be able to name them. Legal name is required
  here and domain is optional, which is the reverse of the crawl path — a documents package can
  exist for a business with no storefront.
*/
create or replace function public.ensure_merchant(p_legal_name text, p_domain text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may create a merchant';
  end if;
  if coalesce(trim(p_legal_name), '') = '' then
    raise exception 'a merchant needs a legal name';
  end if;

  if p_domain is not null and trim(p_domain) <> '' then
    select id into v_id from public.merchants where domain = trim(p_domain);
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.merchants (legal_name, domain)
  values (
    trim(p_legal_name),
    -- `domain` is not null on this table and is the crawl's identity for a merchant. A documents
    -- package may have no storefront, so one is synthesised from the name rather than left blank:
    -- a placeholder that is visibly a placeholder beats an empty string that reads as a real value.
    coalesce(nullif(trim(p_domain), ''), 'no-domain.' || replace(gen_random_uuid()::text, '-', '') || '.invalid')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_merchant(text, text) from public, anon;
grant execute on function public.ensure_merchant(text, text) to authenticated;
