-- 0023 — retrieval log
--
-- D-097 replaced deletion at archival with **restricted access**, and the whole of what
-- "restricted" means is here: bodies remain, retrieval takes an explicit operator action, and
-- every retrieval leaves a trace against the package.
--
-- This is the half that a purge could not have offered. Under deletion the last reads before the
-- data went are invisible and the record of who wanted it goes with it; under this rule nobody
-- reaches an archived body without saying so in writing.
--
-- Logged for every retrieval, not only archived ones. A log that starts when a package archives
-- cannot answer "who read this before it was archived", and the cost of the extra rows is nothing
-- against a question that has no other source.

create table public.document_retrievals (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions (id) on delete restrict,
  package_id          uuid not null references public.packages (id) on delete restrict,
  analyst_id          uuid not null references public.analysts (id) on delete restrict,

  -- The lifecycle at the moment of the read. Stored rather than joined, because the package's
  -- lifecycle moves and this is a statement about what was true when the bytes were handed over.
  package_lifecycle   text not null
                      check (package_lifecycle in ('open', 'submitted', 'cancelled', 'reopened', 'archived')),

  retrieved_at        timestamptz not null default now()
);

comment on table public.document_retrievals is
  'Every retrieval of a stored document body (D-097). Append-only; the accountability a purge cannot give.';
comment on column public.document_retrievals.package_lifecycle is
  'The package state when the body was handed over — a fact about the read, not a join to a moving row.';

alter table public.document_retrievals enable row level security;
create policy document_retrievals_select on public.document_retrievals
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.document_retrievals from authenticated, anon;

create trigger document_retrievals_are_append_only
  before update or delete on public.document_retrievals
  for each row execute function public.reject_mutation();

create index document_retrievals_package_idx on public.document_retrievals (package_id, retrieved_at desc);
create index document_retrievals_version_idx on public.document_retrievals (document_version_id);
