-- ================================================================================================
-- 0067 — Stage 3: the three things the owner does, and the log line that goes with each
-- ================================================================================================
--
-- The People screen lets the owner grant a capability, suspend or reinstate somebody, and create a
-- partner organisation while inviting its first member. None of those were possible from a browser:
-- `authenticated` holds no UPDATE on `analysts` (0001) and no INSERT on `admin_access_log` (0056).
--
-- ## Functions rather than grants
--
-- The alternative was to grant UPDATE on `analysts` and write an owner-scoped update policy. That
-- would work and it is worse in two ways.
--
-- **The flag and its log line would be two statements.** A grant lets the browser change a
-- capability and then, separately, record that it did. Anything between the two — a dropped
-- connection, a closed laptop, a rejected second request — leaves a capability granted with nothing
-- saying who granted it, which is precisely what `admin_access_log` exists to prevent (0056: *"the
-- answer must not be the owner's memory"*). Inside a function they are one transaction.
--
-- **A grant is permanent and general.** `reject_self_promotion` (0060, 0065) exists because a grant
-- on this table is one policy mistake away from letting people write their own row, and the guard
-- had to be built on the assumption the grant would appear one day. Not adding it keeps that day
-- further away. These functions are the narrow opening: three acts, owner-only, each checked here.
--
-- Every one is `security definer` and starts by asking `current_admin_is_owner()`. Administration
-- is owner-only, not host-member (D-229) — a second Mintro person has the owner's view of the work
-- and none of the owner's controls.

-- ------------------------------------------------------------------------------------------------
-- The second capability's log actions
-- ------------------------------------------------------------------------------------------------
--
-- `can_submit_to_iqwallet` arrived with 0060 and the log never learned to describe granting it.
-- Taken from the constraint's current definition, 0066 (D-235).

alter table public.admin_access_log
  drop constraint admin_access_log_action_check;

alter table public.admin_access_log
  add constraint admin_access_log_action_check check (action in (
    'invited',
    'invite_resent',
    'activated',
    'bind_refused',
    'granted_documents_check',
    'revoked_documents_check',
    -- 0067: the second capability (D-230). The log describes both or it describes neither.
    'granted_iqwallet_submit',
    'revoked_iqwallet_submit',
    'suspended',
    'reinstated',
    'replies_rerouted'
  ));

-- ------------------------------------------------------------------------------------------------
-- Granting and revoking a capability
-- ------------------------------------------------------------------------------------------------
--
-- Sets the flag and writes the line, or does neither.
--
-- The owner's own row is refused rather than silently ignored. `analysts_owner_holds_every_capability`
-- (0060) makes an owner without a capability unrepresentable, so an attempt would fail at the check
-- constraint with a message about a constraint; this says the actual reason. The People screen
-- renders the owner's capabilities as text for the same reason — there is nothing to toggle.
--
-- Revocation is forward-only (D-232): this flips a flag and nothing else. It does not touch
-- completed work, and reading has never been gated on the flag.

create or replace function public.set_analyst_capability(
  p_analyst    uuid,
  p_capability text,
  p_value      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_before boolean;
  v_action text;
begin
  if not public.current_admin_is_owner() then
    return jsonb_build_object('ok', false, 'reason', 'only the account owner may change capabilities');
  end if;

  if p_capability not in ('can_run_documents_check', 'can_submit_to_iqwallet') then
    return jsonb_build_object('ok', false, 'reason', 'unknown capability');
  end if;

  if exists (select 1 from public.analysts where id = p_analyst and role = 'owner') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'the owner holds every capability and it cannot be taken away'
    );
  end if;

  if p_capability = 'can_run_documents_check' then
    select can_run_documents_check into v_before from public.analysts where id = p_analyst;
  else
    select can_submit_to_iqwallet into v_before from public.analysts where id = p_analyst;
  end if;

  if v_before is null then
    return jsonb_build_object('ok', false, 'reason', 'no such person');
  end if;

  -- Already there. Not an error, and not a log line either: the log records changes, and this is
  -- not one. Writing it would make the page's double-click indistinguishable from two decisions.
  if v_before = p_value then
    return jsonb_build_object('ok', true, 'changed', false, 'value', p_value);
  end if;

  if p_capability = 'can_run_documents_check' then
    update public.analysts set can_run_documents_check = p_value where id = p_analyst;
    v_action := case when p_value then 'granted_documents_check' else 'revoked_documents_check' end;
  else
    update public.analysts set can_submit_to_iqwallet = p_value where id = p_analyst;
    v_action := case when p_value then 'granted_iqwallet_submit' else 'revoked_iqwallet_submit' end;
  end if;

  insert into public.admin_access_log (actor_id, subject_id, action, value_before, value_after)
  values (
    v_actor, p_analyst, v_action,
    jsonb_build_object(p_capability, v_before),
    jsonb_build_object(p_capability, p_value)
  );

  return jsonb_build_object('ok', true, 'changed', true, 'value', p_value);
end;
$$;

comment on function public.set_analyst_capability is
  'Owner-only. Flips a capability and records it in one transaction. Sets no gate — Stage 5 does that.';

-- ------------------------------------------------------------------------------------------------
-- Suspending and reinstating
-- ------------------------------------------------------------------------------------------------
--
-- Suspension is the only exit (D-232, D-097): there is no delete, because removing a person orphans
-- their runs. Their work stays visible to the owner and nothing is hidden.
--
-- `active` moves with `status` because `analysts_active_agrees_with_status` (0055) requires it, and
-- because `is_analyst()` reads `active` — a suspended person who kept it would still pass the gate
-- that guards every merchant's evidence.
--
-- The owner cannot suspend themselves. Nobody could then invite, grant or reinstate, and the spec
-- accepts a single owner rather than a second (D-229's non-goal); locking that one out is the one
-- unrecoverable act on this screen.

create or replace function public.set_analyst_suspended(p_analyst uuid, p_suspended boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_status public.admin_status;
begin
  if not public.current_admin_is_owner() then
    return jsonb_build_object('ok', false, 'reason', 'only the account owner may suspend or reinstate');
  end if;

  if p_analyst = v_actor then
    return jsonb_build_object(
      'ok', false,
      'reason', 'the owner cannot suspend themselves: nobody else can invite, grant or reinstate'
    );
  end if;

  select status into v_status from public.analysts where id = p_analyst;
  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'no such person');
  end if;

  if (v_status = 'suspended') = p_suspended then
    return jsonb_build_object('ok', true, 'changed', false, 'suspended', p_suspended);
  end if;

  if p_suspended then
    update public.analysts
    set status = 'suspended', active = false, suspended_at = now()
    where id = p_analyst;
  else
    /*
      Reinstating returns somebody to `active`, not to `invited`.

      A person who never bound has no password and no session, and putting them back to `invited`
      would be indistinguishable from a fresh invitation while their old link is long expired.
      `activated_at` is left as it was: it records the first time, and a reinstatement is not one.
    */
    update public.analysts
    set status = 'active', active = true, suspended_at = null
    where id = p_analyst;
  end if;

  insert into public.admin_access_log (actor_id, subject_id, action, value_before, value_after)
  values (
    v_actor, p_analyst,
    case when p_suspended then 'suspended' else 'reinstated' end,
    jsonb_build_object('status', v_status::text),
    jsonb_build_object('status', case when p_suspended then 'suspended' else 'active' end)
  );

  return jsonb_build_object('ok', true, 'changed', true, 'suspended', p_suspended);
end;
$$;

comment on function public.set_analyst_suspended is
  'Owner-only. Suspension is the only exit (D-097); reinstatement returns to active. Both logged.';

-- ------------------------------------------------------------------------------------------------
-- Creating a partner organisation
-- ------------------------------------------------------------------------------------------------
--
-- The invite form creates an agency and its first member in one submit. This is the first half.
--
-- **It cannot create a host.** `type` is not a parameter — every organisation this makes is a
-- partner. `organizations_one_host` (0060) would refuse a second host anyway, and the form is
-- written not to offer one; this is the third place the same answer is given, because the one that
-- matters is the one furthest from the button.

create or replace function public.create_partner_org(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(p_name);
  v_id   uuid;
begin
  if not public.current_admin_is_owner() then
    return jsonb_build_object('ok', false, 'reason', 'only the account owner may add an organisation');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'an organisation needs a name');
  end if;

  -- Same name, same agency. Returned rather than duplicated: two organisations with one name is a
  -- boundary nobody can read, and the owner retrying a failed invitation should land on the org
  -- they already made rather than a second one.
  select id into v_id from public.organizations where lower(name) = lower(v_name) and type = 'partner';
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'created', false);
  end if;

  insert into public.organizations (name, type) values (v_name, 'partner') returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', true);
end;
$$;

comment on function public.create_partner_org is
  'Owner-only. Creates a partner organisation, or returns the one already carrying that name. Never creates a host.';

revoke all on function public.set_analyst_capability(uuid, text, boolean) from public, anon;
revoke all on function public.set_analyst_suspended(uuid, boolean) from public, anon;
revoke all on function public.create_partner_org(text) from public, anon;
grant execute on function public.set_analyst_capability(uuid, text, boolean) to authenticated;
grant execute on function public.set_analyst_suspended(uuid, boolean) to authenticated;
grant execute on function public.create_partner_org(text) to authenticated;
