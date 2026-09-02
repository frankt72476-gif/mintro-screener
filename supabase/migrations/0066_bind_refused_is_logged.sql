-- ================================================================================================
-- 0066 — a refused bind is an attempt worth recording, and the third party is not
-- ================================================================================================
--
-- Closing Stage 2. See D-239.
--
-- ## Why the log gains an action that records no change
--
-- `admin_access_log` has recorded access *changes* since 0056. A bind refused under a mismatched
-- address changes nothing — that is the point of the refusal — so on the old reading it would not
-- be written at all.
--
-- It is written anyway, because from the owner's side a forwarded invitation completed under the
-- wrong address and an invitation nobody ever opened look identical: both are a row that stays
-- `invited` and a person who never appears. One of those is somebody failing to get in and the
-- other is somebody's link having gone astray, and the owner cannot act on either without being
-- able to tell them apart.
--
-- ## What the entry may not contain
--
-- **The address that wrongly opened the link is never written.** That address belongs to a third
-- party — whoever the invitation was forwarded to, or whichever account a browser happened to be
-- signed in to — and they are not party to this system. Recording it would turn a refusal into a
-- collection: the owner reads this log, and the log would be handing them an address they were
-- never given and have no business holding. The refusal already did its work by refusing.
--
-- What is recorded is the address the invitation was **scoped to** — which the owner chose, typed
-- and already has on the roster row — plus the fact and the time.
--
-- ## `invite_reissued` is deliberately not added
--
-- The stage brief asked for it "if not already present". `invite_resent` has been in this list
-- since 0056 and means exactly that. Adding a second name for one action is how a log stops being
-- countable — two entries that mean the same thing, and every future reader has to know both.
-- Raised in the Stage 2 report rather than settled by adding the synonym.

alter table public.admin_access_log
  drop constraint admin_access_log_action_check;

alter table public.admin_access_log
  add constraint admin_access_log_action_check check (action in (
    'invited',
    'invite_resent',
    'activated',
    -- 0066: an attempt, not a change. The only entry in this list that records something that did
    -- not happen, and the reason it is here is in D-239.
    'bind_refused',
    'granted_documents_check',
    'revoked_documents_check',
    'suspended',
    'reinstated',
    'replies_rerouted'
  ));

comment on column public.admin_access_log.action is
  'What happened. Every value is an access change except bind_refused, which is a refused attempt (D-239).';

-- ------------------------------------------------------------------------------------------------
-- The bind writes it
-- ------------------------------------------------------------------------------------------------
--
-- Rewritten from 0065, the current and only other definition of this name (D-235). Everything is
-- unchanged except the refusal branch, which now records before it returns.
--
-- The insert names `a.email` — the roster's address, the one the invitation was scoped to — and
-- never `v_session`, which holds the address that actually signed in. `v_session` is read, compared
-- and discarded; it reaches no column.

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
    -- Signed in, not on the roster. The same answer `not_invited` already gives. Not logged: there
    -- is no roster row for `actor_id` to reference, and an entry naming nobody records nothing.
    return jsonb_build_object('ok', false, 'reason', 'this account is not on the roster');
  end if;

  select email::citext into v_session from auth.users where id = v_uid;

  if btrim(v_session::text)::citext is distinct from btrim(a.email::text)::citext then
    /*
      The refusal, recorded (D-239).

      `value_after` carries the address the invitation was scoped to and nothing else. Not
      `v_session`: see the header — that address is a third party's and does not enter this table.
      The column is `value_after` rather than `value_before` because nothing was before; what is
      being described is the state the attempt was made against.
    */
    insert into public.admin_access_log (actor_id, subject_id, action, value_after)
    values (
      v_uid,
      v_uid,
      'bind_refused',
      jsonb_build_object('scopedTo', a.email::text, 'reason', 'address mismatch')
    );

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
    -- Already bound. No update, no log line, no change to `activated_at`. A second sign-in is not
    -- an access change and not a refused attempt; it is nothing, and nothing is what is recorded.
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
  'First sign-in binds an invited analyst, if and only if the session address is the one invited. A refusal is logged as bind_refused, naming the scoped-to address only (D-239). Returns an outcome; never raises.';

revoke all on function public.bind_invited_analyst() from public, anon;
grant execute on function public.bind_invited_analyst() to authenticated;
