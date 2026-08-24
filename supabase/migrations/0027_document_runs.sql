-- 0027 — Documents Check runs and findings
--
-- M3 built the engine and no persistence, so `runDocumentChecks` returned findings that nothing
-- stored. That made D-002 unverifiable rather than satisfied: re-running a merchant must create a
-- new run and leave the prior run's findings untouched, and there was no prior run to leave.
--
-- Two tables, both append-only under the same `reject_mutation()` trigger the evidence and findings
-- tables already carry. **Immutability is the trigger's job, not RLS's**: `service_role` holds
-- BYPASSRLS, so a policy would not stop the one connection that writes here. RLS is still enabled
-- at the foot of this file, for a different question — which principals may read — and the two
-- should not be confused for each other.
--
-- ## A run is a check pass over a package snapshot
--
-- Re-screening creates a new row here. Nothing updates one. `runs` (0004) is the Site Check's; this
-- is deliberately separate rather than a shared table with a nullable half — the two have different
-- subjects (a merchant's public surface, a merchant's document package), different lifecycles, and
-- a shared table would need a discriminator column plus a check constraint per side to say which
-- columns are meaningful. See D-002 for why immutability is the property both share.
--
-- ## Findings attach to (package, run, document version)
--
-- The version, not the document: a document that was superseded still has findings from the run
-- that read it, and they are findings about the bytes that were read, not about whatever replaced
-- them. `document_version_id` is null for a package- or slot-subject finding, which family B
-- produces — a slot's completeness rests on the package's structure and on no particular file.

create table public.document_runs (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages (id) on delete restrict,

  -- What the run was evaluated against, recorded rather than inferred. A ruleset edit changes what
  -- the same package would produce, so a run that cannot name its ruleset cannot be re-read later.
  ruleset_version text not null check (length(ruleset_version) > 0),
  engine_version  text not null check (length(engine_version) > 0),

  -- D-109's one clock. Coverage, freshness and expiry all measure against this, and it is stored
  -- because it is an input to the run, not a fact about when the row was written.
  run_at        timestamptz not null,

  families      text[] not null check (array_length(families, 1) >= 1),

  created_at    timestamptz not null default now()
);

create trigger document_runs_are_immutable
  before update or delete on public.document_runs
  for each row execute function public.reject_mutation();

create index document_runs_package_idx on public.document_runs (package_id, created_at desc);

create table public.document_findings (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.document_runs (id) on delete restrict,
  package_id          uuid not null references public.packages (id) on delete restrict,

  check_id            text not null check (length(check_id) > 0),

  -- Four states, always (constraint 2). `not_evaluable` is a real answer and is stored as one.
  state               text not null check (state in ('fail', 'review', 'pass', 'not_evaluable')),

  -- D-120: a reason belongs to not_evaluable and only to not_evaluable. Enforced here as an iff so
  -- the database refuses a bare `not_evaluable`, which is the shape §1 exists to prevent.
  not_evaluable_reason text,
  constraint reason_belongs_to_not_evaluable
    check ((state = 'not_evaluable') = (not_evaluable_reason is not null)),

  note                text not null check (length(note) > 0),

  -- The subject. Exactly one of these is set for a document finding; both null for a package one.
  subject_kind        text not null check (subject_kind in ('document', 'slot', 'package')),
  slot_id             uuid references public.slots (id) on delete restrict,
  document_version_id uuid references public.document_versions (id) on delete restrict,
  constraint subject_matches_its_kind check (
    (subject_kind = 'document' and document_version_id is not null)
    or (subject_kind = 'slot' and slot_id is not null and document_version_id is null)
    or (subject_kind = 'package' and slot_id is null and document_version_id is null)
  ),

  -- D-116: computed from the documents actually read, null where a finding rests on none. Stored
  -- as computed, never as declared — a check has no static tier because the same document type
  -- arrives scanned or as text.
  tier                text check (tier in ('character', 'page')),

  -- Which versions the finding read, so the tier above can be checked against its own basis.
  read_versions       uuid[] not null default '{}',
  constraint tier_exactly_when_something_was_read
    check ((tier is not null) = (array_length(read_versions, 1) is not null)),

  ordinal             integer not null check (ordinal >= 0),

  created_at          timestamptz not null default now(),

  -- One finding per position in a run. Re-running produces a new run_id and therefore new rows;
  -- it cannot collide with, or overwrite, what a previous run recorded.
  unique (run_id, ordinal)
);

create trigger document_findings_are_immutable
  before update or delete on public.document_findings
  for each row execute function public.reject_mutation();

create index document_findings_run_idx on public.document_findings (run_id, ordinal);
create index document_findings_package_idx on public.document_findings (package_id, created_at desc);
create index document_findings_version_idx on public.document_findings (document_version_id)
  where document_version_id is not null;

comment on table public.document_findings is
  'Documents Check findings, append-only (D-002). Attached to a document VERSION rather than a '
  'document: a superseded version keeps the findings of the run that read it, because they are '
  'observations about the bytes that were read.';

-- RLS and grants, in the same migration that creates the tables.
--
-- Not the thing that enforces immutability — `service_role` bypasses RLS, which is why the triggers
-- above exist. This governs the other principals: an analyst reads a run through the frontend and
-- writes nothing directly, and `anon` reaches neither table at all.

alter table public.document_runs enable row level security;
alter table public.document_findings enable row level security;

create policy document_runs_select on public.document_runs
  for select to authenticated
  using (public.is_analyst());

create policy document_findings_select on public.document_findings
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.document_runs from authenticated, anon;
revoke insert, update, delete on public.document_findings from authenticated, anon;
