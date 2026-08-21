-- 0010 — findings.ordinal becomes NOT NULL and its index becomes total
--
-- 0009 made the index partial "so rows predating this column do not block it". There were none,
-- and the partial index cost more than it bought:
--
--   1. **PostgREST cannot target it.** Its `on_conflict` parameter accepts column names and has
--      no syntax for a predicate, so `.upsert(..., { onConflict: 'run_id,ordinal' })` produced
--      "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--      A partial unique index is unreachable through the client this code actually uses.
--
--   2. **A nullable ordinal weakened the guarantee it existed to provide.** Postgres treats nulls
--      as distinct in a unique index, so two findings with a null ordinal would both insert — the
--      exact duplication the index was added to prevent.
--
-- The writer always sets `ordinal`, so the column can be NOT NULL and the index total. That
-- removes the inference problem rather than working around it.

-- Defensive: there are no rows today, but a migration should not depend on that being true when
-- it runs. Orders by insertion so any pre-existing rows get a stable, deterministic ordinal.
update public.findings f
set ordinal = numbered.position
from (
  select id, (row_number() over (partition by run_id order by created_at, id) - 1) as position
  from public.findings
  where ordinal is null
) as numbered
where f.id = numbered.id and f.ordinal is null;

alter table public.findings
  alter column ordinal set not null;

drop index if exists public.findings_run_ordinal_key;

-- Total, so `on conflict (run_id, ordinal)` infers it without a predicate.
create unique index findings_run_ordinal_key
  on public.findings (run_id, ordinal);

comment on column public.findings.ordinal is
  'Position in the assembled report. NOT NULL, and unique per run: the natural key that makes a resumed write idempotent rather than duplicating.';
