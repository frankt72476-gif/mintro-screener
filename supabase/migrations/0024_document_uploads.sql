-- 0024 — the upload queue
--
-- Same shape as `scan_requests` (0012) and for the same reason: an operator's action lands here,
-- the worker on Fly claims it and does the work. Ingest runs as a queued job and never in a
-- serverless function (D-094), so the browser cannot call the extractor directly — it writes a row
-- and watches it.
--
-- ## The request is not the document
--
-- A request records that someone uploaded. A document version records what was read. Separate rows
-- because they answer to different rules: a request can be retried or abandoned, and a version is
-- immutable the moment it exists (D-002). `document_version_id` is set when the worker finishes,
-- and is null until then — which is what "nothing has been read yet" looks like, rather than a
-- version in a pending state.
--
-- ## The bytes go to storage first
--
-- The browser uploads to the staging area and then queues `staging_key`. Bytes do not travel
-- through this table: a 25 MB base64 column would be a queue row nobody can read in a list view,
-- and Supabase storage is where every other artifact in this project already lives.

create table public.document_uploads (
  id                  uuid primary key default gen_random_uuid(),
  package_id          uuid not null references public.packages (id) on delete restrict,
  slot_id             uuid not null references public.slots (id) on delete restrict,

  -- Present when the operator is replacing a specific document rather than adding another to the
  -- slot. Absent means a new document — three bank statements are three documents, not three
  -- versions of one.
  replaces_document_id uuid references public.documents (id) on delete restrict,

  -- Where the browser put the bytes. The worker reads from here, hashes, and takes over.
  staging_key         text not null check (length(staging_key) > 0),
  original_filename   text not null check (length(original_filename) > 0),
  requested_by        uuid not null references public.analysts (id) on delete restrict,

  status              text not null default 'queued'
                      check (status in ('queued', 'running', 'done', 'failed')),

  document_version_id uuid references public.document_versions (id) on delete restrict,
  error               text,

  claimed_at          timestamptz,
  created_at          timestamptz not null default now(),
  finished_at         timestamptz,

  -- A finished request either produced a version or recorded why it did not. "Done with no version
  -- and no error" is the shape every defect in this project has taken, and the database refuses to
  -- store it.
  constraint finished_uploads_say_what_happened check (
    status <> 'done' or document_version_id is not null
  ),
  constraint failed_uploads_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.document_uploads is
  'Queue of operator uploads. The worker claims, ingests, and records the document version it produced (D-094).';
comment on column public.document_uploads.document_version_id is
  'The version this upload produced. Null until the worker finishes; never a placeholder.';
comment on column public.document_uploads.replaces_document_id is
  'Set to supersede a specific document (D-002). Absent means a new document on the slot.';

alter table public.document_uploads enable row level security;

-- Operators see the queue and may add to it. They may not edit or remove a request: what happened
-- to an upload is the worker's record, not something the uploader revises afterwards.
create policy document_uploads_select on public.document_uploads
  for select to authenticated
  using (public.is_analyst());

create policy document_uploads_insert on public.document_uploads
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid());

revoke update, delete on public.document_uploads from authenticated, anon;

create index document_uploads_queue_idx on public.document_uploads (created_at)
  where status in ('queued', 'running');
create index document_uploads_package_idx on public.document_uploads (package_id, created_at desc);
