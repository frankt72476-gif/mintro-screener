-- ================================================================================================
-- 0057 — runs.created_by, populated as DDL, never by updating a finished run
-- ================================================================================================
--
-- Stage 0 of docs/admin-access-spec.md. The column every Stage 1 policy will scope on.
--
-- ## Why null is not an option, in either reading
--
-- A run with no owner is a row no policy covers, and both readings of null are wrong. *Nobody* hides
-- a run from the owner, who is the person for whom the full picture is the job. *Everybody* shows it
-- to every admin, which is the leak the scoping exists to prevent. There is no third reading, so the
-- column is not null from the moment it exists.
--
-- ## D-002 is never suspended, not even briefly
--
-- `runs_are_immutable_once_finished` (0004) refuses every update to a run with `finished_at` set,
-- and 0004 says of it: *"Not bypassable by service_role, which is the point."* Forty of the
-- forty-one runs in this database are finished. An `UPDATE ... SET created_by = ...` backfill is
-- exactly the statement that guard exists to refuse, and the guard is right to refuse it.
--
-- So there is no backfill. `ADD COLUMN ... NOT NULL DEFAULT <owner>` is DDL: it fires no row
-- triggers, because it performs no row updates. Postgres records the default as the value every
-- pre-existing row already has (`pg_attribute.atthasmissing`) and does not rewrite the table at all.
-- Every run ends up attributed, the immutability guarantee is never lifted, and nothing has to be
-- turned back on afterwards.
--
-- The default is then dropped. The spec is explicit that a service-role insert must carry the owner
-- explicitly — *"no inference, no default, no fallback"* — so the default exists only for the
-- duration of the statement that needs it, and a later insert that omits `created_by` is refused by
-- the not-null rather than quietly attributed to whoever this migration happened to find.
--
-- ## The guard runs first, because that is where the failure actually is
--
-- With no update to check afterwards, "did every row get a value" is answered by `NOT NULL` itself.
-- The question that can still go wrong is the one before it: *is there exactly one owner to
-- attribute them to*. Zero — 0055 not applied, or applied to a database with no active analyst —
-- and there is nothing to write. More than one, and the choice would be arbitrary. Either way the
-- migration aborts before the column exists.

do $$
declare
  owner_id uuid;
  owners   bigint;
  affected bigint;
begin
  select count(*) into owners from public.analysts where role = 'owner';

  if owners <> 1 then
    select count(*) into affected from public.runs;

    raise exception
      'runs.created_by: % run(s) could not be attributed to an owner, so the migration was aborted.',
      affected
      using detail = format(
        '%s row(s) in analysts carry role = ''owner'', and exactly one is required. Every run must '
        || 'resolve to that one, because a run with no owner is covered by no policy — and null '
        || 'read as "nobody" hides it from the owner, while null read as "everybody" shows it to '
        || 'every admin.',
        owners
      ),
      hint = 'Apply 0055 (which promotes the active analyst to owner) before this migration, and confirm the update matched a row.';
  end if;

  select id into owner_id from public.analysts where role = 'owner';

  -- Dynamic only to get the resolved id into the DDL as a literal. The statement executed is the
  -- plain `ADD COLUMN ... NOT NULL DEFAULT '<uuid>'` the ruling calls for; the id is looked up
  -- rather than transcribed so this migration is not pinned to one database's row.
  execute format(
    'alter table public.runs add column created_by uuid not null default %L references public.analysts (id) on delete restrict',
    owner_id
  );
end
$$;

comment on column public.runs.created_by is
  'The admin who started this run. Never inferred: every service-role insert carries it explicitly.';

-- ------------------------------------------------------------------------------------------------
-- The default goes away immediately
-- ------------------------------------------------------------------------------------------------
--
-- It existed to populate rows that predate admin accounts. Left in place it would silently attribute
-- every future run to the owner, which is the "fallback" the spec forbids by name.

alter table public.runs alter column created_by drop default;

create index runs_created_by on public.runs (created_by, started_at desc);

-- ------------------------------------------------------------------------------------------------
-- Confirm the DDL actually populated, rather than assuming it did
-- ------------------------------------------------------------------------------------------------
--
-- `NOT NULL` proves no row is null. It does not prove the rows carry the *owner* — a future edit
-- that changed the default, or an `ADD COLUMN` that behaved differently than expected, would pass
-- the not-null and still leave runs attributed to nothing meaningful. This asks the question the
-- constraint does not.

do $$
declare
  unattributed bigint;
begin
  select count(*) into unattributed
  from public.runs r
  where not exists (
    select 1 from public.analysts a where a.id = r.created_by and a.role = 'owner'
  );

  if unattributed > 0 then
    raise exception
      'runs.created_by: % run(s) do not point at the owner after the column was added.', unattributed
      using hint = 'ADD COLUMN with a default did not populate pre-existing rows. Do not deploy.';
  end if;
end
$$;
