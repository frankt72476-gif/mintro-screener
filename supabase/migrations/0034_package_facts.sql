-- 0034 — the three creation answers, recorded, and "not known yet" as a first-class state (D-129)
--
-- ## The answers were never stored
--
-- `packages` had thirteen columns and none of them was entity type, existing processor or US
-- domicile. The three questions were asked at creation, resolved the conditionals, produced a slot
-- list, and were then discarded. The package recorded the *result* and not the input, so
-- "why is this slot here" answered "because of an answer nobody wrote down" — which is the gap
-- D-121 keeps the `origin` column to close, reappearing one level up.
--
-- Three nullable columns, and **NULL means not known yet**. Not a sentinel, not an `unknown` enum
-- member: the same shape `slots.required_count` already uses under D-107, where a value would make
-- unknown look like something the operator chose.
--
-- ## A conditional whose predicate is unanswered does not resolve
--
-- Nothing here enforces that — the composition happens in `@mintro/ruleset`, which holds the
-- template. What this migration does is make the unanswered state *expressible*, so the browser can
-- offer both W-9 and W-8BEN when nobody knows the domicile rather than guessing which is impossible.
--
-- ## Resolution afterwards is a waive, and `resolved_by` says whose
--
-- `slots_are_never_deleted` (D-097) means a slot that turns out not to apply cannot be removed. It
-- goes to `waived` with `not_applicable_to_entity_type`, which 0020's enumeration already carries.
--
-- That row is identical whether a person judged it or an answer made it structural, and the two are
-- not the same event. `resolved_by` records which.

-- ── merchants: the operator's DBA ──────────────────────────────────────────────────────────────
--
-- **This is not the report's DBA, and must never become it (D-126, D-129).** It is typed at
-- creation, before any document has been read, so an operator can find a package by the name
-- anybody actually remembers. What the report prints is what the *documents* say, derived once, in
-- C-02. Two names that look alike and mean different things; wiring this one into the masthead
-- would be exactly the second derivation D-125 forbids.
alter table public.merchants add column dba text check (dba is null or length(trim(dba)) > 0);

comment on column public.merchants.dba is
  'Operator-typed trading name, for finding a merchant. NOT the report DBA — that is extracted and '
  'compared in C-02 (D-126, D-129). Nothing on the report path may read this column.';

-- ── packages: the three answers ────────────────────────────────────────────────────────────────

alter table public.packages
  add column entity_type text check (entity_type is null or entity_type in (
    'sole_proprietor', 'partnership', 'llc', 'corporation', 'non_profit', 'government')),
  add column has_existing_processor boolean,
  add column us_domiciled boolean,
  -- Who last answered, and when. A fact with no author is a fact nobody can question later, and
  -- D-129's whole argument for the confirmation step is that a person owns the answer.
  add column facts_set_by uuid references public.analysts (id) on delete restrict,
  add column facts_set_at timestamptz;

comment on column public.packages.entity_type is
  'NULL means not known yet (D-129) — not a default, not a guess. An unanswered predicate leaves '
  'its conditional slots offered rather than removed.';
comment on column public.packages.has_existing_processor is
  'NULL means not known yet. No slot predicates on it today: Processing Statements is default-on '
  'and resolves through not_provided with a reason (D-081, D-129).';
comment on column public.packages.us_domiciled is
  'NULL means not known yet. Unknown offers both W-9 and W-8BEN, because neither can be called '
  'impossible (D-129).';

-- ── slots: whose decision this was ─────────────────────────────────────────────────────────────

alter table public.slots
  add column resolved_by text check (resolved_by is null or resolved_by in ('operator', 'fact'));

-- Backfill before the constraint, not after. Any reason already on a row was set by a person
-- through the upload page — there was no other path — so `operator` is the true value, and
-- asserting it here is cheaper than a constraint that cannot be added to a live table.
update public.slots set resolved_by = 'operator' where reason is not null and resolved_by is null;

alter table public.slots
  add constraint resolved_by_present_exactly_when_a_reason_is check (
    (reason is not null) = (resolved_by is not null)
  );

comment on column public.slots.resolved_by is
  'operator (a person judged this) or fact (a recorded answer made it structural). Same row, '
  'different authority — D-129.';

-- ── setting a slot state from the browser ──────────────────────────────────────────────────────
--
-- The upload page has been calling PostgREST update on `slots` since M1, and `update` on this table
-- is revoked from `authenticated`. It has only ever worked from `service_role` in the verification
-- scripts, so no operator has ever successfully marked a slot not-provided.
--
-- Found while wiring D-129, which needs this path to exist: resolution after creation *is* a slot
-- state change, and a ruling that depends on a path nobody can walk is a ruling on paper.
create or replace function public.set_slot_state(
  p_slot_id     uuid,
  p_state       text,
  p_reason      text default null,
  p_resolved_by text default 'operator'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may change a slot';
  end if;

  update public.slots
     set state       = p_state,
         reason      = p_reason,
         -- Null together, set together. 0020's constraint requires a reason for exactly two
         -- states; this one requires an author for exactly a reason.
         resolved_by = case when p_reason is null then null else coalesce(p_resolved_by, 'operator') end,
         updated_at  = now()
   where id = p_slot_id;

  if not found then
    raise exception 'no such slot';
  end if;
end;
$$;

revoke all on function public.set_slot_state(uuid, text, text, text) from public, anon;
grant execute on function public.set_slot_state(uuid, text, text, text) to authenticated;

-- ── recording the answers after creation ───────────────────────────────────────────────────────
--
-- `p_waive` is the list of slot keys the new answers make structurally impossible, computed by the
-- caller. **It is computed in the browser and not here, deliberately** — which slot depends on
-- which answer is `rules/documents.templates.json`, and a copy of it in plpgsql is a second source
-- of truth that drifts the first time a predicate changes. Same reasoning as
-- `create_document_package` taking a resolved slot list rather than a template version.
--
-- Only a slot that is still outstanding is waived. A slot already `satisfied` holds a document the
-- merchant actually supplied, and an answer saying that document cannot exist does not make the
-- document go away — it makes the two disagree, which is C-05's finding to report and not this
-- function's to erase.
create or replace function public.set_package_facts(
  p_package_id             uuid,
  p_entity_type            text,
  p_has_existing_processor boolean,
  p_us_domiciled           boolean,
  p_waive                  jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lifecycle text;
  v_waived    integer := 0;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record these answers';
  end if;

  select lifecycle into v_lifecycle from public.packages where id = p_package_id;
  if v_lifecycle is null then
    raise exception 'no such package';
  end if;
  -- The required set is what the report measured against. Changing it after the package went out
  -- would make an already-sent report describe a set that no longer exists.
  if v_lifecycle not in ('open', 'reopened') then
    raise exception 'this package is % — its document set is settled', v_lifecycle;
  end if;

  update public.packages
     set entity_type            = p_entity_type,
         has_existing_processor = p_has_existing_processor,
         us_domiciled           = p_us_domiciled,
         facts_set_by           = auth.uid(),
         facts_set_at           = now()
   where id = p_package_id;

  with waived as (
    update public.slots
       set state       = 'waived',
           reason      = 'not_applicable_to_entity_type',
           resolved_by = 'fact',
           updated_at  = now()
     where package_id = p_package_id
       and slot_key in (select jsonb_array_elements_text(p_waive))
       and origin = 'conditional'
       and state in ('missing', 'not_evaluable')
    returning 1
  )
  select count(*) into v_waived from waived;

  return v_waived;
end;
$$;

revoke all on function public.set_package_facts(uuid, text, boolean, boolean, jsonb) from public, anon;
grant execute on function public.set_package_facts(uuid, text, boolean, boolean, jsonb) to authenticated;

-- ── creation, now carrying the answers ─────────────────────────────────────────────────────────
--
-- Dropped and recreated rather than overloaded. Two functions of the same name differing only in
-- arity is a PostgREST call that resolves to whichever one the schema cache saw last, and the one
-- it might pick silently discards the facts.
drop function if exists public.create_document_package(uuid, text, jsonb, jsonb);

create function public.create_document_package(
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
    entity_type, has_existing_processor, us_domiciled, facts_set_by, facts_set_at
  )
  values (
    p_merchant_id, p_processor_key, 'documents-1', 'open', 365,
    p_entity_type, p_has_existing_processor, p_us_domiciled,
    -- Stamped only where something was actually answered. An author against three nulls would read
    -- as "this person said they did not know", which nobody did.
    case when v_known then v_analyst end,
    case when v_known then now() end
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

-- ── naming a merchant, now with a DBA ──────────────────────────────────────────────────────────

drop function if exists public.ensure_merchant(text, text);

create function public.ensure_merchant(
  p_legal_name text,
  p_domain     text default null,
  p_dba        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_dba text := nullif(trim(coalesce(p_dba, '')), '');
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
      -- Fill a blank, never overwrite. A DBA already on the row was typed by somebody who had the
      -- merchant in front of them; a later form filled in from memory does not get to replace it.
      update public.merchants set dba = v_dba where id = v_id and dba is null and v_dba is not null;
      return v_id;
    end if;
  end if;

  insert into public.merchants (legal_name, domain, dba)
  values (
    trim(p_legal_name),
    coalesce(nullif(trim(p_domain), ''), 'no-domain.' || replace(gen_random_uuid()::text, '-', '') || '.invalid'),
    v_dba
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_merchant(text, text, text) from public, anon;
grant execute on function public.ensure_merchant(text, text, text) to authenticated;
