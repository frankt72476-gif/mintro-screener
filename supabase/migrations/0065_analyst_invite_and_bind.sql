-- ================================================================================================
-- 0065 — Stage 2: the address is identity, and the bind is scoped to it
-- ================================================================================================
--
-- Stage 2 of docs/admin-access-spec.md v2. Auth and invite only: no screens (Stage 3), no
-- capability gates (Stage 5). The capability columns already exist and this stage stores them; it
-- wires nothing to them.
--
-- ## `analysts.email` becomes citext and unique
--
-- The spec makes this a Stage 2 dependency, because the invite is scoped to an address and a
-- duplicate address means two rows for one person and two answers to "who is this". One row exists,
-- so the conversion is uncontested.
--
-- **Case folding at the column is not the whole of it.** The lookup folds case at the query too
-- (`apps/worker/src/analystInvite.ts`). A column type is the wrong place to rest the guarantee: it
-- protects this table and nothing that joins to it by string, and the day somebody reads the address
-- into TypeScript and compares it with `===` the type has stopped helping. Same principle the
-- recorder pin settled — an address is identity, not a string (D-233).

create extension if not exists citext;

alter table public.analysts
  alter column email type citext using email::citext;

-- Unique after the type change, so the index is built on the folded type and
-- `Frank@…` / `frank@…` collide rather than coexisting.
create unique index analysts_email_is_one_person on public.analysts (email);

comment on column public.analysts.email is
  'The address the invitation is scoped to. citext and unique: case is not identity, and one person is one row.';

-- ------------------------------------------------------------------------------------------------
-- Self-activation, and only that
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from 0060, the current definition — every migration defining this name is 0058 and
-- 0060, and the newest wins (D-235).
--
-- `reject_self_promotion` refuses any change to the governing columns from a session that is not
-- the owner's, and `status` is one of them. The bind below is a person moving their own row from
-- `invited` to `active`, which that rule forbids — correctly, in general, and wrongly for this one
-- transition. Without an exemption the invite cannot complete at all.
--
-- The exemption is written as narrowly as the transition it permits:
--
--   * the row must be the caller's own (`old.id = auth.uid()`);
--   * `status` must move from exactly `invited` to exactly `active` — not from `suspended`, so a
--     suspended person cannot reinstate themselves, which is the escalation this guard exists for;
--   * every other governed column must be unchanged — role, both capabilities, `org_id` and
--     `active` — so the transition cannot carry a promotion, a capability or an org move with it.
--
-- It is also self-limiting: `invited` is a state a row leaves once and cannot return to except by
-- the owner's act, so the exemption is reachable at most once per person.

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

  -- The bind (0065). Everything else about the row is held constant, so this cannot be a promotion
  -- wearing an activation's clothes.
  if old.id = auth.uid()
     and old.status = 'invited'
     and new.status = 'active'
     and (new.role, new.can_run_documents_check, new.can_submit_to_iqwallet, new.org_id, new.active)
         is not distinct from
         (old.role, old.can_run_documents_check, old.can_submit_to_iqwallet, old.org_id, old.active)
  then
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
  'Governing columns on analysts are the owner''s to write, except a person''s own invited→active bind. Independent of whatever UPDATE grants exist.';

-- ------------------------------------------------------------------------------------------------
-- The bind
-- ------------------------------------------------------------------------------------------------
--
-- Called by the app on first successful sign-in. It is the security-sensitive moment of this stage,
-- so the check that matters is stated first and the happy path last.
--
-- ## Why the address is compared at all, when the id already matches
--
-- `analysts.id` IS the `auth.users` id (0001's foreign key), so an invite creates the auth user
-- first and the roster row under that id. A different *person* signing in is therefore a different
-- `auth.uid()` with no roster row, and resolves to nothing before this function is reached.
--
-- That is the common case and it is not the whole case. The address on an auth user can change
-- after the invite was issued — Supabase permits it, and a forwarded invitation completed under a
-- different mailbox is exactly the shape the response-round Submit gate was built to refuse. So the
-- bind compares the session's address to the address the invitation was scoped to, folding case,
-- and refuses when they differ. **Refuses, not repairs**: it does not update the roster address to
-- match, because the invitation was issued to one address and consent does not transfer.
--
-- ## What a refusal must not do
--
-- Not bind, not activate, not write an `activated` log line. It cannot destroy the session — that
-- is Supabase's, minted before this runs — but a session with no active roster row reads nothing:
-- `is_analyst()` requires `active`, and every policy from Stage 1 onward requires
-- `current_admin_is_active()`. The refusal returns a reason for the UI to show and changes nothing.
--
-- ## Errors are returned, not raised
--
-- A raise would roll back and reach the browser as a PostgREST error, which the sign-in path would
-- have to parse to tell "wrong address" from "database down". The outcome is data.

create or replace function public.bind_invited_analyst()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session citext;
  a         public.analysts%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'no session');
  end if;

  select * into a from public.analysts where id = v_uid;
  if a.id is null then
    -- Signed in, not on the roster. The same answer `not_invited` already gives.
    return jsonb_build_object('ok', false, 'reason', 'this account is not on the roster');
  end if;

  select email::citext into v_session from auth.users where id = v_uid;

  -- The scope. `citext` folds case here as well as in the column, and `btrim` covers an address
  -- that arrived with whitespace around it.
  if btrim(v_session::text)::citext is distinct from btrim(a.email::text)::citext then
    return jsonb_build_object(
      'ok', false,
      'reason', 'this invitation was issued to a different address',
      'bound', false
    );
  end if;

  if a.status = 'suspended' then
    return jsonb_build_object('ok', false, 'reason', 'this account is suspended');
  end if;

  if a.status = 'active' then
    -- Already bound. Not a failure and not a second bind: no update, no log line, no change to
    -- `activated_at`, which records the first time and would otherwise drift on every sign-in.
    return jsonb_build_object('ok', true, 'alreadyActive', true, 'bound', false);
  end if;

  update public.analysts
  set status = 'active',
      activated_at = coalesce(activated_at, now())
  where id = v_uid;

  insert into public.admin_access_log (actor_id, subject_id, action)
  values (v_uid, v_uid, 'activated');

  return jsonb_build_object('ok', true, 'bound', true);
end;
$$;

comment on function public.bind_invited_analyst is
  'First sign-in binds an invited analyst, if and only if the session address is the one invited. Returns an outcome; never raises.';

revoke all on function public.bind_invited_analyst() from public, anon;
grant execute on function public.bind_invited_analyst() to authenticated;
