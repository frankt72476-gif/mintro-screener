-- ================================================================================================
-- 0083 — publish is a request, and the worker answers it (D-261)
-- ================================================================================================
--
-- ## Why publish is not a button that writes
--
-- Publishing re-validates. `publishRefusal` runs the whole of `validateDraft` against the edited
-- content and the run it cites — which findings exist, which angle may cite what, whether every
-- handle in a paragraph resolves in the stored mapping — and that function is TypeScript, because
-- those rules are relations between two documents and the one implementation of them lives in the
-- engine.
--
-- The first cut had the browser run it and then call `publish_evaluation`. That put the only real
-- guard on the far side of the thing being gated: a caller with a REST client and a token skips the
-- client and reaches the function directly, which is precisely the reasoning 0069 opens with.
--
-- Restating the rules in PL/pgSQL was the other way out, and it is worse. It would be a second
-- implementation of the one thing in this system that must have exactly one, and the two would
-- drift on the first rule change — the derivation drift D-216 names, sitting on the decision of
-- whether a document may be sent.
--
-- So publish is a row. The operator asks; the worker builds the run context **through the same
-- `runContextFor` the generator uses**, runs `publishRefusal`, and writes only if it returns null.
-- There is no path to `publish_evaluation` that has not been through the validator.
--
-- ## Refused is not failed
--
-- Five states, and the two unhappy ones mean different things:
--
--   `refused` — the validator said no. The draft is **untouched**, the reasons are on this row, and
--               the operator repairs the document and asks again. This is the system working.
--   `failed`  — the job did not run. The database was unreachable, the rule set would not load.
--               Nothing was decided about the document at all.
--
-- Folding them together would tell an operator to retry a job that worked, or hide a job that never
-- ran behind a document that was merely refused. That is the D-044 distinction, and this schema
-- keeps making it because the alternative keeps being a lie about whose fault something is.

create table public.evaluation_publish_requests (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.runs (id) on delete restrict,
  requested_by   uuid not null references public.analysts (id) on delete restrict,
  status         text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'refused', 'failed')),

  -- Set on success. What was published, so the editor can read the version it produced rather than
  -- guessing that the newest row is the one it asked for.
  evaluation_id  uuid references public.evaluations (id) on delete restrict,

  -- The validator's own words, unedited. The operator reads them and repairs the draft.
  refusal        text,
  -- The job failing. Never the document being refused.
  error          text,

  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,

  constraint published_requests_name_what_they_published check (
    status <> 'done' or evaluation_id is not null
  ),
  constraint refused_requests_say_why check (
    status <> 'refused' or refusal is not null
  ),
  constraint failed_publish_requests_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.evaluation_publish_requests is
  'Queue of publish requests. The worker re-validates with publishRefusal and writes only on a '
  'null refusal; a refused request leaves the draft untouched and carries the reasons (D-261).';
comment on column public.evaluation_publish_requests.refusal is
  'Why the validator refused. Distinct from `error`, which is the job itself not running.';

alter table public.evaluation_publish_requests enable row level security;

create policy evaluation_publish_requests_select on public.evaluation_publish_requests
  for select to authenticated
  using (public.is_analyst());

-- ------------------------------------------------------------------------------------------------
-- The gate of record
-- ------------------------------------------------------------------------------------------------
--
-- This is where publishing is refused for anyone outside the host organisation, and it is the only
-- place it needs to be: `publish_evaluation` is not granted to `authenticated` at all, so the row
-- is the only way to reach it. A partner analyst with a REST client is refused here, by the
-- policy, on a capability resolved from `auth.uid()` — never from a value they passed (D-230).

create policy evaluation_publish_requests_insert on public.evaluation_publish_requests
  for insert to authenticated
  with check (
    public.current_admin_can_edit_evaluation()
    and requested_by = auth.uid()
    and status = 'queued'
  );

revoke update, delete on public.evaluation_publish_requests from authenticated, anon;

create index evaluation_publish_requests_queue_idx
  on public.evaluation_publish_requests (status, created_at);
create index evaluation_publish_requests_run_idx
  on public.evaluation_publish_requests (run_id, created_at desc);
