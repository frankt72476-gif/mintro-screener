-- 0076 — the published evaluation, append-only (D-258, D-260)
--
-- Step 2. 0075 is the draft an operator edits; this is what publishing produces, and from here it
-- behaves like every other record in this schema: written once, never updated, never deleted.
--
-- ## Why this is a second table rather than a status on the draft
--
-- A status column would make one row mean two different things at two different times, and the
-- trigger would have to permit updates in order to move it — which is to say the published
-- evaluation would live in a table where updates are legal. The whole point of the split is that
-- the moment a document stops being a draft it stops being mutable, and a boundary enforced by a
-- column value is not a boundary.
--
-- Publishing copies the draft's content into a new row here and deletes the draft. Earlier versions
-- remain readable: `version` counts 1..n per run, so a re-published evaluation over the same run
-- does not overwrite what an underwriter may already have been shown.
--
-- ## D-002 is preserved, not relaxed
--
-- `runs_are_immutable_once_finished` (0004) and the append-only triggers on `findings` (0005) and
-- `evidence` (0006) are untouched. Nothing here writes to a run. This is a separate artifact that
-- cites into an immutable one, and `draft_input_sha256` is what ties a published evaluation back to
-- the exact inputs it was reasoned from.

create table public.evaluations (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.runs (id) on delete restrict,

  -- 1..n per run. Not a timestamp ordering: an underwriter told "version 2" needs a number that
  -- means the same thing to everyone reading it.
  version            integer not null check (version >= 1),

  content            jsonb not null,

  published_at       timestamptz not null default now(),
  published_by       uuid not null references public.analysts (id) on delete restrict,

  -- The draft's input hash, carried across. Two published versions with the same hash were
  -- reasoned from the same inputs and differ only in what the model or the operator wrote; two
  -- with different hashes were shown different things, and that is a different kind of change.
  draft_input_sha256 text not null check (draft_input_sha256 ~ '^[0-9a-f]{64}$'),

  angles_version     text not null,
  ruleset_version    text not null,
  model              text not null,

  constraint evaluations_version_unique unique (run_id, version)
);

comment on table public.evaluations is
  'A published evaluation. Append-only (D-258): publishing copies the draft here and deletes it, '
  'and nothing in application code updates or removes a row. Earlier versions stay readable.';
comment on column public.evaluations.version is
  '1..n per run. A re-publish adds a version rather than overwriting what was already shown.';

alter table public.evaluations enable row level security;

create policy evaluations_select on public.evaluations
  for select to authenticated using (public.is_analyst());

revoke insert, update, delete on public.evaluations from authenticated, anon;

-- The same refusal `findings` and `evidence` carry (0005, 0006). Not bypassable by service_role,
-- which is the point: a published evaluation is what Mintro said, and it says it permanently.
create trigger evaluations_are_append_only
  before update or delete on public.evaluations
  for each row execute function public.reject_mutation();

create index evaluations_run_idx on public.evaluations (run_id, version desc);
