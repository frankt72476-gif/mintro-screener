-- 0022 — the extraction cache
--
-- Keyed on `(sha256, extractor_version)` (D-096). The hash alone says the bytes are the same; it
-- says nothing about whether the thing that read them still exists, so a prompt revision, a
-- vocabulary change or a routing change must miss rather than serve a result from an extractor
-- that is no longer in the tree.
--
-- Durable rather than in-process, because the bill it prevents is across invocations: a package
-- re-run after one new upload must not re-read the other eight, and a worker restart between the
-- two is normal.
--
-- Note what this is *not*. It serves extraction results **into** a document version; it never
-- reaches backwards. A cache hit still writes its own immutable row (D-002), and "cached" must
-- never come to mean "shared between packages' records".

create table public.extractions (
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  extractor_version text not null check (length(extractor_version) > 0),
  result            jsonb not null,
  created_at        timestamptz not null default now(),

  primary key (sha256, extractor_version)
);

comment on table public.extractions is
  'Extraction results by content and extractor (D-096). Append-only: same inputs, same output, for ever.';

alter table public.extractions enable row level security;
create policy extractions_select on public.extractions
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.extractions from authenticated, anon;

-- Append-only. A cached result that could be edited is a report citing something nobody can
-- reproduce, and the primary key already means a re-write collides rather than overwrites.
create trigger extractions_are_append_only
  before update or delete on public.extractions
  for each row execute function public.reject_mutation();
