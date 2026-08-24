-- 0021 — documents and document versions
--
-- `documents` is the logical thing a slot holds — "the voided check" — and survives replacement.
-- `document_versions` is the record, and it is **immutable** (D-002): a replacement is a new row
-- with a `supersedes` pointer, never an overwrite. Under D-097 there is no deletion path for a
-- superseded version either, so *what did the first version of this statement say* stays
-- answerable for the life of the package.
--
-- Content hash is identity (D-091). Filenames are not: the same statement arrives as `scan.pdf`,
-- `Scan 1 (2).pdf` and `bank feb.pdf`, and three unrelated documents arrive as `document.pdf`.

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.packages (id) on delete restrict,
  slot_id     uuid not null references public.slots (id) on delete restrict,
  created_at  timestamptz not null default now(),

  -- Referenced by the composite foreign key below, which is what keeps a version's denormalised
  -- package_id honest without a trigger to maintain it.
  unique (id, package_id)
);

comment on table public.documents is
  'The logical occupant of a slot. Stable across replacement; its versions carry the content.';

alter table public.documents enable row level security;
create policy documents_select on public.documents
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.documents from authenticated, anon;

create trigger documents_are_never_deleted
  before delete on public.documents
  for each row execute function public.reject_delete();

create table public.document_versions (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents (id) on delete restrict,

  -- Denormalised so dedup can be a unique index rather than a trigger. Kept true by the composite
  -- foreign key, not by the writer remembering.
  package_id          uuid not null,

  version             integer not null check (version >= 1),
  supersedes          uuid references public.document_versions (id) on delete restrict,

  -- What is stored and read. For a converted HEIC this is the JPEG (D-104).
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes               integer not null check (bytes >= 0),
  detected_type       text not null check (length(detected_type) > 0),
  storage_key         text not null check (length(storage_key) > 0),

  -- What the merchant actually submitted, when that differs. D-104 converts HEIC at ingest and
  -- **retains the original under constraint 3**: a report citing a value must be able to point at
  -- the submission, not only at a rendering we manufactured from it.
  original_sha256     text check (original_sha256 is null or original_sha256 ~ '^[0-9a-f]{64}$'),
  original_media_type text,
  original_storage_key text,
  original_filename   text,

  -- Every file resolves to a recorded outcome (D-092). There is no row that means "we did not
  -- get to it", and no way to mark one processed without one of these four.
  outcome             text not null check (outcome in ('extracted', 'unreadable', 'unsupported', 'encrypted')),
  outcome_reason      text,

  -- The ExtractionResult verbatim: pages with their routes, values with their provenance and
  -- tier. Stored rather than recomputed, because it is what the report will cite.
  extraction          jsonb,

  created_at          timestamptz not null default now(),

  foreign key (document_id, package_id) references public.documents (id, package_id),

  unique (document_id, version),

  constraint outcome_reason_present_unless_extracted check (
    (outcome = 'extracted') = (outcome_reason is null)
  ),
  -- A conversion keeps both halves or neither. Half a record is worse than none: it would look
  -- like an original was retained when the columns to find it are missing.
  constraint conversion_is_recorded_completely check (
    (original_sha256 is null) = (original_storage_key is null)
  ),
  constraint first_version_supersedes_nothing check (
    (version = 1) = (supersedes is null)
  )
);

comment on table public.document_versions is
  'Immutable. A replacement is a new version with a supersedes pointer (D-002); nothing is deleted (D-097).';
comment on column public.document_versions.original_storage_key is
  'Where the submitted bytes live when they were converted. Constraint 3: the original is retained.';
comment on column public.document_versions.outcome is
  'Recorded for every file (D-092). An unsupported type is an outcome, not a silent skip.';

alter table public.document_versions enable row level security;
create policy document_versions_select on public.document_versions
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.document_versions from authenticated, anon;

-- Not bypassable by service_role, which is the only thing that could overwrite a version.
create trigger document_versions_are_append_only
  before update or delete on public.document_versions
  for each row execute function public.reject_mutation();

-- Dedup: the same bytes uploaded twice into one package are one document, not two (D-091).
-- A unique index rather than a check in the writer, because the writer is the thing that would
-- forget under a race.
create unique index document_versions_package_content_idx
  on public.document_versions (package_id, sha256);

create index document_versions_document_idx on public.document_versions (document_id, version desc);
create index document_versions_supersedes_idx on public.document_versions (supersedes)
  where supersedes is not null;
