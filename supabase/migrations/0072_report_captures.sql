-- 0072 — the captured report, recorded
--
-- Step 2 of docs/report-delivery-static-html.md. 0071 made the bucket; this records what was
-- written to it.
--
-- ## Why there is a row at all
--
-- The object's key contains the token, and the token is the credential. Nothing can derive the
-- delivered URL from the run — that is the point of it — so if the key is not written down, the
-- link exists exactly once, in whatever email carried it. Three things need it afterwards: the
-- blocked-package path, which links the same captured report without an IQwallet send; an analyst
-- opening the report from the app, now that no PDF is rendered; and anyone asking later what was
-- actually delivered.
--
-- ## The token is stored in plaintext, and that is not the comment-link posture
--
-- `comment_links` stores only a SHA-256, so a leaked database yields no working links. That cannot
-- apply here and pretending otherwise would be worse than not trying: the token **is** the object's
-- address, so a digest would mean nobody could ever produce the link again. What limits the blast
-- radius instead is that this row is analyst-scoped under the same predicate as the run
-- (`can_read_run`), and that a token opens one report and nothing else.
--
-- ## Several rows per run, and none of them replaces another
--
-- A re-capture mints a fresh token and writes a new object at a new key (D-002). It does not
-- overwrite the old one and it does not update this row — the earlier capture is what was
-- delivered, and a table that let it be edited would be a table that can rewrite what an
-- underwriter was sent.

create table public.report_captures (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.runs (id) on delete restrict,

  -- `<run-id>/<token>.html`, inside the `reports` bucket. Unique because two rows naming one
  -- object would make "what was delivered" ambiguous, and because the uploader writes with
  -- `upsert: false` — a duplicate here means a bug, not a retry.
  storage_key  text not null unique check (storage_key ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{43}\.html$'),

  -- The digest of the bytes that were written. Hard constraint 3 asks for the artifact and its
  -- hash: the object is the artifact, and this is what proves the object still standing in the
  -- bucket is the one this run produced.
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  bytes        integer not null check (bytes > 0),
  captured_at  timestamptz not null default now(),

  -- What the page reported it had displayed, at the moment it was captured. Recorded because
  -- "every capture the report cited is inline" is asserted at capture time and is otherwise
  -- unanswerable afterwards without re-reading the file.
  images       integer not null check (images >= 0)
);

create index report_captures_run_idx on public.report_captures (run_id, captured_at desc);

comment on table public.report_captures is
  'Immutable HTML captures of a run''s report, addressed by an unguessable token in the object key.';
comment on column public.report_captures.storage_key is
  'Key in the `reports` bucket. Holds the token, so it is the delivered link and is stored in plaintext.';

alter table public.report_captures enable row level security;

create policy report_captures_select on public.report_captures
  for select to authenticated using (public.can_read_run(run_id));

/*
  No insert, update or delete policy for anyone.

  Captures are written by the worker through `service_role`. A browser that could write one could
  claim an arbitrary object was this run's delivered report.
*/
revoke insert, update, delete on public.report_captures from authenticated, anon;

/*
  Append-only, enforced by a trigger rather than by the absent policies.

  `service_role` carries BYPASSRLS, so a policy would not stop the worker rewriting its own record
  — and the worker is the only writer. The same reasoning as `findings`, `evidence` and `sends`.

  Deletion is refused here too, including for the purge path. Removing a run's captured reports
  deletes the **objects**; this row stays, so the record of what was delivered survives the bytes.
  That is the shape D-130 settled on for packages: a purge deletes objects and inserts rows, it
  updates nothing and deletes no row.
*/
create or replace function public.report_captures_are_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'report_captures is append-only: a captured report is what was delivered'
    using errcode = 'restrict_violation';
end;
$$;

create trigger report_captures_append_only
  before update or delete on public.report_captures
  for each row execute function public.report_captures_are_append_only();
