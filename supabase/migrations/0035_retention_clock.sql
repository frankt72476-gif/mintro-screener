-- 0035 — start the retention clock, and correct the number nobody ruled (D-130, P0)
--
-- ## The clock was never started
--
-- `packages.retention_started_at` has existed since 0019. `enforce_package_lifecycle` validates
-- transitions and does not set it; no function anywhere sets it; the only writers in the repository
-- are two lines in a schema test. The partial index over it indexes zero rows.
--
-- Everything that measures from it therefore never fires. D-084's 30-day open→restricted boundary
-- never arrives, and D-130's 180-day purge candidacy would never arrive either — a retention policy
-- measured from a column that is null on every row is a retention policy that does nothing, and
-- looks from the schema exactly like one that works.
--
-- This is the whole of P0. **The retrieval regime stays unbuilt** (D-130): `document_retrievals` is
-- still written by nothing and no package has ever been archived. Starting the clock does not
-- imply the rest of D-097 exists, and this migration deliberately does not gesture at it.
--
-- ## Why the trigger and not a function
--
-- There is no `submit_package()`. Lifecycle transitions are plain updates, made by scripts and by
-- `service_role`, and adding a function now would leave every existing caller bypassing it. The
-- trigger is the one place every transition already passes through, and it is `before update`, so
-- it can assign.
--
-- The clock is the machine's, not the caller's: a value supplied in the same statement is ignored
-- in favour of the transition's own timestamp. A caller cannot backdate retention by naming it.
-- Setting it by hand outside a transition is still refused by 0019's
-- `retention_clock_runs_only_when_closed`, which is left to do exactly that job.

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

  /*
    The retention clock (D-084 as amended by D-130).

    - **submitted / cancelled** start it, and `coalesce` on the *old* value means the first close
      wins. A package submitted and later cancelled has been closed since submission; cancelling it
      does not extend how long the bodies sit here, and restarting the clock would quietly do that.
    - **reopened** clears it. That is what "restarts on reopen" means: a reopened package is live
      work and is not counting down towards anything. It is also required — 0019 refuses a running
      clock on any lifecycle but the three closed ones.
    - **archived** preserves it. Archival is the *result* of the clock elapsing, so resetting it
      there would restart the count at the moment it finished.

    Reading `old` rather than `new` throughout is what makes the value the machine's.
  */
  if new.lifecycle in ('submitted', 'cancelled') then
    new.retention_started_at := coalesce(old.retention_started_at, now());
  elsif new.lifecycle = 'reopened' then
    new.retention_started_at := null;
  else
    new.retention_started_at := old.retention_started_at;
  end if;

  return new;
end;
$$;

comment on function public.enforce_package_lifecycle is
  'Legal lifecycle transitions, an absolute refusal to delete, and the retention clock (D-130). '
  'Not bypassed by service_role.';

comment on column public.packages.retention_started_at is
  'Start of the retention clock, set by the lifecycle trigger and never by a caller. Cleared on '
  'reopen (D-084). Access restricts at retention_days; purge candidacy at 180 days (D-130).';

/*
  The 365 nobody ruled.

  `create_document_package` has written `retention_days = 365` since 0033. D-084 ruled 30, the
  column defaults to 30, and nothing anywhere reads the value — so the departure had no effect and
  nothing surfaced it for two milestones. D-130 reaffirms 30 as the open→restricted boundary and
  corrects this to match.

  The number is left recorded in D-130 rather than only fixed here. The useful fact is not 30 versus
  365; it is that a value entered the system without a ruling, in a function nobody re-read, and
  became load-bearing the moment something started reading it.

  Existing rows keep their 365 — `retention_days` is per-package and configurable by design (D-084),
  and rewriting a stored value to match a later default would be this system deciding something on
  a package's behalf. The one production package holding it is reported, not amended.
*/
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
    entity_type, has_existing_processor, us_domiciled, facts_set_by, facts_set_at
  )
  values (
    -- 30, not 365: D-084's number, reaffirmed by D-130.
    p_merchant_id, p_processor_key, 'documents-1', 'open', 30,
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
