-- 0031 — the send queue for Documents Check reports
--
-- The browser cannot send. Rendering the report needs Playwright and the send needs the service
-- key, neither of which belongs in an analyst's tab. So the operator queues a request and the
-- worker does the work — the same shape as `send_requests` (0017) for Site Check, deliberately: two
-- queues with different mechanics would be two things to reason about for one idea.
--
-- ## The queue is the request, not the record
--
-- `document_report_sends` (0028) is the record of what went out, append-only and permanent. This
-- table is a work item: it moves through statuses and its rows are operational. The two are
-- separate because a request that failed to send is not a send, and putting a `status` column on
-- the send log would make "was this report sent?" a question with a qualified answer.
--
-- ## An analyst may insert, and only queued
--
-- The RLS policy lets an analyst create their own request in `queued` and nothing else. They cannot
-- write a `done` row, cannot name another analyst as the requester, and cannot move a row through
-- the queue — the worker holds the service key for that. An operator who could write `done` could
-- record a send that never happened.

create table public.document_send_requests (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages (id) on delete restrict,
  run_id        uuid not null references public.document_runs (id) on delete restrict,

  to_email      text not null check (position('@' in to_email) > 1),
  requested_by  uuid not null references public.analysts (id) on delete restrict,

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- The send this produced, once there is one. Null until the worker records it.
  send_id       uuid references public.document_report_sends (id) on delete restrict,
  outcome       text check (outcome in ('accepted', 'rejected')),
  error         text,

  claimed_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),

  -- A finished request points at what it produced. Without this a `done` row with no `send_id` is
  -- a request that claims success and cannot show for what.
  constraint finished_requests_have_a_send
    check (status <> 'done' or (send_id is not null and outcome is not null)),
  constraint failed_requests_say_why
    check (status <> 'failed' or error is not null)
);

create index document_send_requests_queue_idx on public.document_send_requests (status, created_at);
create index document_send_requests_package_idx on public.document_send_requests (package_id, created_at desc);

alter table public.document_send_requests enable row level security;

create policy document_send_requests_select on public.document_send_requests
  for select to authenticated
  using (public.is_analyst());

-- Insert only, own row only, `queued` only. Everything after that is the worker's.
create policy document_send_requests_insert on public.document_send_requests
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid() and status = 'queued');

revoke update, delete on public.document_send_requests from authenticated, anon;

comment on table public.document_send_requests is
  'Work items, not the record. The permanent account of what was sent is '
  'document_report_sends, which is append-only; this table is how an operator asks for one.';
