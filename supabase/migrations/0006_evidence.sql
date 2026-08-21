-- 0006 — evidence
--
-- Hard constraint 5: evidence storage is append-only. Screenshots and DOM snapshots are never
-- overwritten or deleted by application code. This is a defensibility requirement, not a
-- performance one.
--
-- D-002: evidence keys are unique per run. A second scan never overwrites the first scan's
-- captures — that would destroy the record of what the site looked like at the time.

create table public.evidence (
  key           text primary key,
  run_id        uuid not null references public.runs (id) on delete restrict,
  kind          text not null check (kind in ('robots', 'sitemap', 'screenshot', 'dom')),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes         integer not null check (bytes >= 0),
  content_type  text,
  url           text,
  created_at    timestamptz not null default now(),

  -- The key is the storage path and is run-scoped by construction. This makes the guarantee a
  -- schema property rather than a convention the writer has to remember.
  constraint key_is_run_scoped check (key like (run_id::text || '/%'))
);

comment on table public.evidence is
  'Metadata for stored captures. The bytes live in the private evidence bucket at `key`.';
comment on column public.evidence.key is
  'Storage path, run-scoped: <run_id>/<layer>/<sha256>. Primary key, so a re-write collides rather than overwriting.';

alter table public.evidence enable row level security;

create policy evidence_select on public.evidence
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.evidence from authenticated, anon;

-- Not bypassable by service_role. The whole point of an append-only evidence store is that the
-- process writing it cannot quietly revise it.
create trigger evidence_is_append_only
  before update or delete on public.evidence
  for each row execute function public.reject_mutation();

create index evidence_run_idx on public.evidence (run_id);
create index evidence_run_kind_idx on public.evidence (run_id, kind);
