-- 0017 — the report send, wired
--
-- The gate is lifted: `gomintro.com` is verified in Resend and `RESEND_API_KEY` is set on Fly. Two
-- things follow.
--
-- **The send becomes a job.** It was never wired at all — the button said "not connected", which
-- was honest, because nothing reached a mailer. Sending needs the rendered PDF, and the PDF is
-- Playwright printing the report route, which a browser cannot do. So it is a queue with the same
-- shape as `scan_requests`, `pdf_requests` and `comment_invites`, for the reason D-035 gives.
--
-- **The record says which mailer ran.** Real and dry-run stay separate implementations rather than
-- one behind a flag (M5's ruling, reaffirmed): a test send must never be mistakable for a delivered
-- report. That distinction is worth nothing if the record does not carry it, so `sends.mailer`
-- names the implementation that handled each attempt.

-- ---------------------------------------------------------------------------------------------
-- Which mailer handled it
-- ---------------------------------------------------------------------------------------------
--
-- Not nullable, and no useful default: every row from here on states what transmitted it. Existing
-- rows get 'unrecorded', which is the truth about them — they predate the column, and writing
-- 'Resend' across them would be inventing a fact about mail that may never have been sent.

alter table public.sends add column mailer text not null default 'unrecorded';
alter table public.sends alter column mailer drop default;

comment on column public.sends.mailer is
  'The mailer implementation that handled this attempt — ''Resend'' for a live send, a dry-run description for one that was composed and not transmitted. ''unrecorded'' predates the column.';

-- ---------------------------------------------------------------------------------------------
-- The send queue
-- ---------------------------------------------------------------------------------------------

create table public.send_requests (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  requested_by  uuid not null references public.analysts (id) on delete restrict,

  to_email      text not null check (position('@' in to_email) > 1),

  -- The analyst's covering note, as they wrote it. Carried on the request rather than composed by
  -- the worker: it is the one part of the email Mintro does not generate (D-029).
  note          text not null default '',

  -- Whether the analyst was shown a directive-language warning and sent anyway. **Never a gate.**
  -- D-001: nothing here consults it before sending; it is recorded so the log shows a flagged note
  -- went out rather than leaving that invisible.
  note_warning_acknowledged boolean not null default false,

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- The `sends` row this job produced, and what the provider said about it.
  send_id       uuid references public.sends (id) on delete restrict,

  /*
    Accepted or rejected — denormalised from the `sends` row it points at.

    `sends` stays authoritative. This copy exists because the analyst's browser polls this row, and
    a rejection that required a second query to notice is a rejection an analyst will not notice.

    Note that a rejection finishes the job as **done**, not failed: the job's work was to attempt a
    send and record the attempt, and it did both. `failed` is for a job that could not get that far
    — a render that broke, a run with no report. Collapsing the two would hide a provider refusal
    among infrastructure errors, and a provider refusal is exactly what a dispute turns on (D-001).
  */
  outcome       text check (outcome in ('accepted', 'rejected')),

  -- Where the PDF that was actually attached is stored, so an analyst can retrieve the artifact
  -- that went rather than re-render one that might differ.
  storage_key   text,
  error         text,

  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- The same refusal as the other three queues. A finished job that says nothing about what
  -- happened is the shape every defect in this project has taken.
  constraint finished_send_requests_have_a_record check (
    status <> 'done' or (send_id is not null and outcome is not null)
  ),
  constraint failed_send_requests_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.send_requests is
  'Queue of report sends. The worker renders the PDF, sends it, and writes the sends row; the browser watches this one.';

alter table public.send_requests enable row level security;

create policy send_requests_select on public.send_requests
  for select to authenticated
  using (public.is_analyst());

/*
  An analyst may queue a send. Nothing in the policy consults the run's outcome.

  D-001, as a schema property: **send is never blocked.** There is no condition here on fail
  counts, on review counts, or on anything an underwriter would decide. A database that refused to
  queue a send for a merchant with failures would be making the determination this whole product
  exists not to make — and it would leave a record of Mintro deciding what IQwallet gets to see.
*/
create policy send_requests_insert on public.send_requests
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid() and status = 'queued');

revoke update, delete on public.send_requests from authenticated, anon;

create index send_requests_queue_idx on public.send_requests (status, created_at);
create index send_requests_run_idx on public.send_requests (run_id, created_at desc);
