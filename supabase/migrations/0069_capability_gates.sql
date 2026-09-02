-- ================================================================================================
-- 0069 — Stage 5: the gate of record, for both capabilities
-- ================================================================================================
--
-- `can_run_documents_check` and `can_submit_to_iqwallet` have been set, displayed, toggled and
-- logged since 0060 and 0067. Nothing has ever enforced them. This migration is layer (3) of the
-- four D-230 names — **the API rejects the request** — and it is the only one of the four that
-- holds when the others are bypassed. A hidden nav item is cosmetic, a route guard covers a typed
-- URL, and a worker re-read covers a revocation mid-queue; a caller with a REST client and a token
-- walks past all three.
--
-- There is no HTTP API in front of this database. The browser speaks PostgREST directly, so the
-- request the caller makes IS the insert or the function call, and the place that refuses it is the
-- policy or the function guard. Putting the check anywhere else — in the React client, in a wrapper
-- module — would be putting it on the far side of the thing being gated.
--
-- ## Enforced against the caller, never against a passed value
--
-- Every check below resolves the capability from `auth.uid()` through `analysts`. Nothing reads a
-- flag out of the row being inserted or out of a function argument. A client that could name its
-- own capability would be a client that could grant itself one, which is the same shape
-- `reject_self_promotion()` (0058, 0060, 0065) exists to refuse.
--
-- ## Replace, never add alongside (D-234)
--
-- The three insert policies are dropped and recreated, rewritten from their current definitions —
-- `send_requests_insert` from 0058, the two document policies from 0059 (D-235). An added policy
-- would OR with the existing one and grant strictly more access, which is the opposite of a gate.

-- ------------------------------------------------------------------------------------------------
-- The two capability predicates
-- ------------------------------------------------------------------------------------------------
--
-- Same construction as `current_admin_is_host` (0060): security definer so a policy can call it
-- without recursing, stable so it is evaluated once per statement, and coalesced to false so an
-- absent row denies by statement rather than by the accident of a null propagating through a
-- policy.
--
-- **Suspension is folded in deliberately.** A name that says "can" and returns true for a suspended
-- person is a trap for whoever calls it next. `current_admin_is_active()` (0058) is the same
-- predicate the read path uses, so a suspended member is refused here on the same terms their
-- session goes empty everywhere else (D-232).

create or replace function public.current_admin_can_run_documents_check()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_admin_is_active()
     and coalesce(
       (select can_run_documents_check from public.analysts where id = auth.uid()),
       false
     );
$$;

comment on function public.current_admin_can_run_documents_check is
  'Capability gate: an active analyst holding can_run_documents_check. Resolved from auth.uid(), never from a passed value.';

create or replace function public.current_admin_can_submit_to_iqwallet()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_admin_is_active()
     and coalesce(
       (select can_submit_to_iqwallet from public.analysts where id = auth.uid()),
       false
     );
$$;

comment on function public.current_admin_can_submit_to_iqwallet is
  'Capability gate: an active analyst holding can_submit_to_iqwallet. Resolved from auth.uid(), never from a passed value.';

-- A policy with no grant underneath is dead text, and an over-broad revoke makes a correct-looking
-- policy fail closed (D-236). Both stated for these two as for the four before them.
revoke all on function public.current_admin_can_run_documents_check() from public, anon;
revoke all on function public.current_admin_can_submit_to_iqwallet() from public, anon;
grant execute on function public.current_admin_can_run_documents_check() to authenticated;
grant execute on function public.current_admin_can_submit_to_iqwallet() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- `refused` — a fourth terminal status for the three queues a capability gates
-- ------------------------------------------------------------------------------------------------
--
-- Layer (4) is the worker re-reading the flag at job start, because a job can sit in the queue
-- across a revocation (D-230). When it finds the flag gone it has to put the row somewhere, and
-- `failed` is the wrong place.
--
-- This project has already settled the distinction once, for sends: a provider rejection finishes
-- `done` with `outcome = 'rejected'`, and `failed` is reserved for a job that could not get that
-- far, because "collapsing the two would hide a provider refusal among infrastructure errors"
-- (0017, D-001). A revoked capability is the same shape one level up. Nothing broke; the work was
-- not permitted. An owner reading the queue must be able to tell a fault they have to fix from an
-- access decision that worked exactly as intended, and one bucket holding both cannot say which
-- happened.
--
-- `error` carries the reason rather than a new column. On these three tables that column already
-- means "what this row says about why it did not produce what it was for", which is what a refusal
-- reason is. Three near-empty `refused_reason` columns would say it worse.
--
-- The status constraints are unnamed inline column checks, so Postgres named them
-- `<table>_status_check` — the same convention 0067 relied on for `admin_access_log_action_check`.
-- A drop that matched nothing would leave the old constraint in place and silently keep refusing
-- `refused`, so `queue.test.ts` inserts one of each and would fail loudly if it had.

alter table public.send_requests drop constraint send_requests_status_check;
alter table public.send_requests
  add constraint send_requests_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'refused'));
alter table public.send_requests
  add constraint refused_send_requests_say_why check (status <> 'refused' or error is not null);

alter table public.document_uploads drop constraint document_uploads_status_check;
alter table public.document_uploads
  add constraint document_uploads_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'refused'));
alter table public.document_uploads
  add constraint refused_uploads_say_why check (status <> 'refused' or error is not null);

alter table public.document_send_requests drop constraint document_send_requests_status_check;
alter table public.document_send_requests
  add constraint document_send_requests_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'refused'));
alter table public.document_send_requests
  add constraint refused_document_send_requests_say_why
  check (status <> 'refused' or error is not null);

comment on column public.send_requests.error is
  'Why this row did not produce what it was for. On a refused row that is an access decision, not a fault.';
comment on column public.document_uploads.error is
  'Why this row did not produce what it was for. On a refused row that is an access decision, not a fault.';
comment on column public.document_send_requests.error is
  'Why this row did not produce what it was for. On a refused row that is an access decision, not a fault.';

-- ------------------------------------------------------------------------------------------------
-- Submitting to IQwallet
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from 0058's definition, which is the current one. The capability is the only clause
-- added: org scoping, the pinned `requested_by` and the queued-only status all stay exactly as they
-- were, because loosening one of them while adding a gate is how a stage that tightens access ends
-- up widening it.
--
-- `status = 'queued'` keeps its second job here. A client that could insert a row already
-- `refused`, or already `done`, would be writing an outcome rather than requesting work.

drop policy send_requests_insert on public.send_requests;
create policy send_requests_insert on public.send_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_run(run_id)
    -- 0069: the gate of record for can_submit_to_iqwallet (D-230).
    and public.current_admin_can_submit_to_iqwallet()
  );

-- ------------------------------------------------------------------------------------------------
-- Documents Check
-- ------------------------------------------------------------------------------------------------
--
-- `can_run_documents_check` gates *creating*, and does not gate reading — reading is org scope, and
-- revocation is forward-only (D-232). So every clause below sits on an insert or on a function that
-- writes, and not one `select` policy is touched.
--
-- **What "creating a document run" means today.** The spec's wording is `document_runs`, and
-- nothing in the product creates one yet: `documentRunStore.persist` has no production caller, and
-- CLAUDE.md holds Documents Check as a later phase. What exists and is reachable from the pane is
-- the work that a document run is later computed *from* — opening a package, uploading a document,
-- recording a slot state — plus sending the resulting report. Those are the writes gated here.
-- When the run itself is built, `current_admin_can_run_documents_check()` is the predicate it
-- takes, and it is already written.
--
-- Rewritten from 0059's definitions for the two policies, and from 0060's for
-- `create_document_package` — 0034's body would put `retention_days = 365` back, which is the
-- current-definition mistake this project has now made twice (D-235).

drop policy document_uploads_insert on public.document_uploads;
create policy document_uploads_insert on public.document_uploads
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and public.can_read_package(package_id)
    -- 0069: the gate of record for can_run_documents_check (D-230).
    and public.current_admin_can_run_documents_check()
  );

drop policy document_send_requests_insert on public.document_send_requests;
create policy document_send_requests_insert on public.document_send_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_package(package_id)
    -- 0069: sending the Documents Check report is Documents Check work, and a member without the
    -- capability should not be able to drive that pane at all. Forward-only: this refuses a new
    -- send and hides no report that was already produced (D-232).
    and public.current_admin_can_run_documents_check()
  );

-- ------------------------------------------------------------------------------------------------
-- The two `security definer` functions the pane calls
-- ------------------------------------------------------------------------------------------------
--
-- A `security definer` function runs as its owner and RLS does not apply to what it does inside, so
-- a policy on `packages` or `slots` cannot gate either of these. The guard has to be in the body,
-- which is where `is_analyst()` already sits — the capability joins it there.
--
-- Both bodies are otherwise byte-for-byte their current definitions.

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

  -- 0069: the gate of record for can_run_documents_check (D-230). Raised rather than returned,
  -- because this function's contract is `void` and a silent no-op would read to the operator as a
  -- slot that refused to change for no reason.
  if not public.current_admin_can_run_documents_check() then
    raise exception 'this account cannot run Documents Check'
      using errcode = 'insufficient_privilege';
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

  -- 0069: the gate of record for can_run_documents_check (D-230). A package is the root of every
  -- document object, so this is the earliest point at which the capability can refuse the work.
  if not public.current_admin_can_run_documents_check() then
    raise exception 'this account cannot run Documents Check'
      using errcode = 'insufficient_privilege';
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
    created_by,
    org_id
  )
  values (
    -- 30, not 365: D-084's number, reaffirmed by D-130.
    p_merchant_id, p_processor_key, 'documents-1', 'open', 30,
    p_entity_type, p_has_existing_processor, p_us_domiciled,
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

-- `create or replace` preserves privileges, so these re-grants change nothing today. Stated anyway,
-- because a policy or a function with no grant underneath is dead text and an over-broad revoke
-- makes a correct-looking guard fail closed (D-236) — and the next person editing this file should
-- not have to go and check which of the two it is.
revoke all on function public.set_slot_state(uuid, text, text, text) from public, anon;
grant execute on function public.set_slot_state(uuid, text, text, text) to authenticated;
revoke all on function public.create_document_package(uuid, text, jsonb, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.create_document_package(uuid, text, jsonb, jsonb, text, boolean, boolean) to authenticated;
