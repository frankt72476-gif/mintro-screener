-- 0009 — findings ordinal
--
-- Makes finding inserts idempotent, so a half-written run can be completed rather than
-- abandoned.
--
-- The migration that prompted this failed partway: five runs were inserted, every artifact upload
-- failed, and `insertFindings` never ran. Retrying could not fix it — a re-run collided on the
-- run's primary key and was misread as "already migrated" — and the runs could not be deleted
-- either, because runs are never deleted (D-002).
--
-- So the repair path has to be *resume*, and resuming means writing findings into a run that may
-- already hold some. Without a natural key that would duplicate them. `(run_id, ordinal)` gives a
-- second write something to collide with, so `on conflict do nothing` becomes safe.
--
-- `ordinal` is the finding's position in the assembled report, which is deterministic: the report
-- orders categories by their rule-set position and findings by state then severity. The same
-- report always produces the same ordinals.

alter table public.findings
  add column ordinal integer;

comment on column public.findings.ordinal is
  'Position in the assembled report. Deterministic, and the natural key that makes a resumed write idempotent.';

-- Partial, so rows predating this column (there are none, but the constraint should not depend on
-- that) do not block it.
create unique index findings_run_ordinal_key
  on public.findings (run_id, ordinal)
  where ordinal is not null;

-- `on conflict do nothing` does not fire a BEFORE UPDATE trigger, so this does not weaken the
-- append-only guarantee in 0005: a duplicate is skipped, never overwritten.
