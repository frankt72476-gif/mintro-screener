-- 0039 — record the intent before deleting (D-130, P4 amended)
--
-- ## The window this closes
--
-- P4 deleted the objects and then recorded what it had deleted. A crash between the two left the
-- bytes gone, the approval unconsumed, and **no row saying which objects had been removed** — so
-- the only account of what happened was an error message a person had to have been watching for.
-- The `alreadyPurged` exception, which exists so an interrupted purge can be finished, depended on
-- the first attempt having succeeded at the very step that failed.
--
-- Reconstruction by hand is a backstop, not a design. It is the same discipline as
-- export-before-purge, one level down: **write the record of what is about to happen, then do it.**
--
--     begin_package_purge   →  the intent, and the objects named
--     (delete)
--     complete_package_purge→  it finished
--
-- A crash between them leaves a row naming exactly what was about to be removed. Recovery reads
-- that row instead of an operator's memory, and `alreadyPurged` reads it too — so it now works
-- whether or not the interrupted attempt got as far as anything else.
--
-- ## Completion is an insert, because a purge is never an update
--
-- `package_purges` carries `reject_mutation`, and stamping a `completed_at` on it would mean
-- relaxing that for one column. D-130 is explicit that a purge is an insert; completion is a second
-- one, in its own table, with the same rule.

-- ── the intent row says intent ─────────────────────────────────────────────────────────────────
--
-- These columns were named for a world where the row was written afterwards. On an intent row
-- `objects_deleted` is a claim about something that has not happened, and this project has spent
-- several rulings on exactly that kind of name.
alter table public.package_purges rename column objects_deleted to objects_planned;
alter table public.package_purges rename column bytes_deleted to bytes_planned;

comment on table public.package_purges is
  'A purge that was begun: the approval that authorised it and the objects it named. Written '
  'BEFORE anything is deleted, so an interrupted purge leaves a record of what it was removing '
  '(D-130). Completion is a separate row.';
comment on column public.package_purges.objects_planned is
  'How many objects the reconciliation named. Not how many went — that is the completion row.';

comment on table public.purged_objects is
  'Objects a purge named for removal, recorded before the removal. What lets a superseded version '
  'resolve to a location in an export rather than to nothing (D-097, D-130), and what an '
  'interrupted purge is resumed from.';

-- ── completion ─────────────────────────────────────────────────────────────────────────────────

create table public.package_purge_completions (
  id              uuid primary key default gen_random_uuid(),
  -- One completion per purge. A second is not a second event, it is a bug.
  purge_id        uuid not null unique references public.package_purges (id) on delete restrict,
  completed_by    uuid not null references public.analysts (id) on delete restrict,
  objects_removed integer not null check (objects_removed >= 0),
  completed_at    timestamptz not null default now()
);

comment on table public.package_purge_completions is
  'A purge that finished. Its absence beside a package_purges row is exactly the interrupted case, '
  'and is the state recovery looks for (D-130).';

alter table public.package_purge_completions enable row level security;
create policy package_purge_completions_select on public.package_purge_completions
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_purge_completions from authenticated, anon;
create trigger package_purge_completions_are_append_only
  before update or delete on public.package_purge_completions
  for each row execute function public.reject_mutation();

-- ── begin ──────────────────────────────────────────────────────────────────────────────────────
--
-- The same body `record_package_purge` had, renamed for what it now means. Dropped rather than
-- kept alongside: a function called "record" that runs before the thing it records is a name
-- somebody will act on.
drop function if exists public.record_package_purge(uuid, text, jsonb);

create function public.begin_package_purge(
  p_approval_id    uuid,
  p_package_digest text,
  p_objects        jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval record;
  v_purge    uuid;
  v_object   jsonb;
  v_bytes    bigint := 0;
  v_count    integer := 0;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may begin a purge';
  end if;

  select * into v_approval from public.package_purge_approvals where id = p_approval_id;
  if v_approval is null then
    raise exception 'no such approval';
  end if;

  -- Re-checked here and not only at approval. An approval can sit for a week, and the package it
  -- was given for is the one that existed then.
  if p_package_digest <> v_approval.package_digest then
    raise exception
      'the package has changed since this purge was approved; the approval is for a package that '
      'no longer exists in that state';
  end if;

  if jsonb_array_length(p_objects) = 0 then
    raise exception 'a purge must name at least one object';
  end if;

  select count(*), coalesce(sum(nullif(o->>'bytes', '')::bigint), 0)
    into v_count, v_bytes
    from jsonb_array_elements(p_objects) o;

  -- The unique constraint on approval_id is what makes this one-shot. A second attempt against the
  -- same approval raises here — which is right: the first attempt's intent row is the thing to
  -- resume from, not a second intent to write.
  insert into public.package_purges (package_id, approval_id, purged_by, objects_planned, bytes_planned)
  values (v_approval.package_id, p_approval_id, auth.uid(), v_count, v_bytes)
  returning id into v_purge;

  for v_object in select * from jsonb_array_elements(p_objects)
  loop
    insert into public.purged_objects
      (purge_id, kind, document_version_id, upload_id, storage_key, sha256, bytes)
    values (
      v_purge,
      v_object->>'kind',
      nullif(v_object->>'document_version_id', '')::uuid,
      nullif(v_object->>'upload_id', '')::uuid,
      v_object->>'storage_key',
      nullif(v_object->>'sha256', ''),
      nullif(v_object->>'bytes', '')::integer
    );
  end loop;

  return v_purge;
end;
$$;

revoke all on function public.begin_package_purge(uuid, text, jsonb) from public, anon;
grant execute on function public.begin_package_purge(uuid, text, jsonb) to authenticated;

-- ── complete ───────────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_package_purge(
  p_purge_id        uuid,
  p_objects_removed integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planned integer;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may complete a purge';
  end if;

  select objects_planned into v_planned from public.package_purges where id = p_purge_id;
  if v_planned is null then
    raise exception 'no such purge';
  end if;

  -- Fewer removed than named means the executor stopped partway, and a completion row would say it
  -- finished. The intent row stays, which is what resumption reads.
  if p_objects_removed <> v_planned then
    raise exception
      'this purge named % object(s) and removed %; it is not complete, and the intent row remains '
      'so it can be resumed', v_planned, p_objects_removed;
  end if;

  insert into public.package_purge_completions (purge_id, completed_by, objects_removed)
  values (p_purge_id, auth.uid(), p_objects_removed);
end;
$$;

revoke all on function public.complete_package_purge(uuid, integer) from public, anon;
grant execute on function public.complete_package_purge(uuid, integer) to authenticated;
