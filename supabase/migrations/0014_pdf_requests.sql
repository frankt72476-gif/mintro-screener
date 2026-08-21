-- 0014 — PDF jobs, and access mode as an outcome rather than a choice
--
-- ## The PDF queue
--
-- "Download PDF" did nothing. The M5 pipeline works, but it is `page.pdf()` driven by Playwright
-- against the report route, and a browser has no way to reach it. So it becomes a job, exactly
-- like a scan: a row, a poller, an artifact.
--
-- The same shape as `scan_requests` on purpose. A second job mechanism with its own semantics is
-- a second thing to get wrong, and this project has a standing objection to that (D-035).

create table public.pdf_requests (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  requested_by  uuid not null references public.analysts (id) on delete restrict,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- Where the rendered PDF landed in the evidence bucket. Set when the worker finishes.
  storage_key   text,
  pages         integer,
  error         text,

  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- The same refusal as the scan queue: a finished job that says nothing about what happened is
  -- the shape every defect in this project has taken, and the database will not store it.
  constraint finished_pdf_requests_have_a_file check (
    status <> 'done' or storage_key is not null
  ),
  constraint failed_pdf_requests_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.pdf_requests is
  'Queue of PDF renders. The worker prints the report route and stores the file; the browser downloads it through a signed URL.';

alter table public.pdf_requests enable row level security;

create policy pdf_requests_select on public.pdf_requests
  for select to authenticated
  using (public.is_analyst());

create policy pdf_requests_insert on public.pdf_requests
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid() and status = 'queued');

revoke update, delete on public.pdf_requests from authenticated, anon;

create index pdf_requests_queue_idx on public.pdf_requests (status, created_at);
create index pdf_requests_run_idx on public.pdf_requests (run_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Access mode is now detected, not chosen
-- ---------------------------------------------------------------------------------------------
--
-- D-040 removed the three-way access picker. The analyst chooses nothing: every crawl starts
-- anonymous, and a stored credential is applied only if the sampled product pages come back
-- unserved. Asking was redundant — the tool already detects the platform and already knows when
-- it hits a login wall — and a picker invites the wrong answer, which produces a report whose
-- coverage does not match what was actually possible.
--
-- So `scan_requests.mode` changes meaning: it was a request, and it is now a record of what the
-- worker did. The database enforces the first half of that by refusing any insert that does not
-- start public. **Every scan begins anonymous, as a schema property rather than a convention.**

drop policy scan_requests_insert on public.scan_requests;

create policy scan_requests_insert on public.scan_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    -- Not a preference the requester may express. The worker escalates on evidence or not at all.
    and mode = 'public'
  );

comment on column public.scan_requests.mode is
  'How the scan actually ran, written by the worker. Always inserted as ''public'': a credential is applied only after an anonymous crawl is refused (D-040). Never affects GATE-002/GATE-003.';
