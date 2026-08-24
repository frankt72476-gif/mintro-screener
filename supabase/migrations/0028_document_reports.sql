-- 0028 — what a run must remember, and the record of sending
--
-- ## Why a run has to carry its own inputs
--
-- D-085 makes the report a pure function of a run: same run in, byte-identical report out. The
-- report's first section is the slot table, and slot rows are mutable — a document arriving after
-- the run changes `slots.state`. So a report built from the run plus *current* slots is a function
-- of the run and the clock, and regenerating it a week later would produce a different document
-- under the same run id.
--
-- The run therefore records the slot table and the document list it actually ran against. Not a
-- convenience: without it there is no property to assert and D-036's regenerate-and-compare checks
-- have nothing to compare.
--
-- ## And why it carries a digest
--
-- D-117 moved the stale-run precondition out of the engine, because nothing in a snapshot
-- distinguishes a fresh run from an aged one. The digest is what lets the *report* tell: it is
-- computed over the inputs whose change would invalidate the run, so a mismatch against the
-- package's current state means documents have arrived or coverage has moved. That is a refusal,
-- not a warning — a report generated from a superseded run is wrong in a way its reader cannot see.
--
-- ## Sending is an event (D-083)
--
-- Not a state transition. A sent report never changes; a second send is an ordinary second row.
-- Append-only under the same trigger as everything else, so the record of what went to whom cannot
-- be tidied afterwards.

alter table public.document_runs
  add column slots jsonb not null default '[]'::jsonb,
  add column documents jsonb not null default '[]'::jsonb,
  -- sha256 over the run's inputs. Recomputed from the package to test staleness.
  add column package_digest text not null default '';

-- The defaults exist only so the column can be added to a table that already has rows; every write
-- after this supplies all three. Dropping them stops a future insert quietly recording an empty
-- snapshot, which would render as a report with no slots and look like a package with none.
alter table public.document_runs alter column slots drop default;
alter table public.document_runs alter column documents drop default;
alter table public.document_runs alter column package_digest drop default;

comment on column public.document_runs.slots is
  'The slot table as it stood when the run executed. Stored because slots are mutable and D-085 '
  'requires the report be a function of the run alone.';
comment on column public.document_runs.package_digest is
  'sha256 over the run inputs. A mismatch against the package now means the run is stale and a '
  'report may not be generated from it (D-117).';

create table public.document_report_sends (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.document_runs (id) on delete restrict,
  package_id    uuid not null references public.packages (id) on delete restrict,

  recipient     text not null check (position('@' in recipient) > 1),
  sent_by       uuid not null references public.analysts (id) on delete restrict,

  -- Which mailer ran. A dry-run send composes a message and transmits nothing, and the two must
  -- never be indistinguishable in the record — the same reasoning as `sends.mailer` in 0007.
  mailer        text not null check (mailer in ('resend', 'dry_run')),
  provider_id   text,

  -- The bytes that were sent, by hash. The report is regenerable from the run, so storing the hash
  -- is what proves the regenerated document is the one that went out.
  pdf_sha256    text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_bytes     integer not null check (pdf_bytes > 0),

  -- The run this send's diff was computed against — null for the first send of a package.
  diff_against_run_id uuid references public.document_runs (id) on delete restrict,

  sent_at       timestamptz not null default now()
);

create trigger document_report_sends_are_immutable
  before update or delete on public.document_report_sends
  for each row execute function public.reject_mutation();

create index document_report_sends_package_idx
  on public.document_report_sends (package_id, sent_at desc);
create index document_report_sends_run_idx on public.document_report_sends (run_id);

alter table public.document_report_sends enable row level security;

create policy document_report_sends_select on public.document_report_sends
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.document_report_sends from authenticated, anon;

comment on table public.document_report_sends is
  'One row per send, never updated (D-083). A report is pinned to a run and a sent report never '
  'changes; new documents produce a new run and a new report, not an edit to this one.';
