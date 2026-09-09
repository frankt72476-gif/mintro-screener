-- ================================================================================================
-- 0081 — the operator edits the draft, and asks for a new one (D-261)
-- ================================================================================================
--
-- 0075 created `evaluation_drafts` with `edited_at` and `edited_by` and no way to set them, and
-- said so in as many words:
--
--   > The operator's edits go through a function in a later migration rather than a direct table
--   > grant, so that `edited_by` is resolved from `auth.uid()` and never from a value the client
--   > passed.
--
-- This is that migration. Two things: the edit function, and the queue a regeneration goes through.
--
-- ## Why a function and not an update policy
--
-- An update policy would have to permit the client to write `edited_by`, and a client that names
-- who edited a document can name somebody else. Every attribution in this schema is resolved from
-- `auth.uid()` inside a security-definer function for that reason — `record_owner_act` (0067),
-- `bind_analyst` (0065). This is the same construction.
--
-- It also lets the guard live where the write happens. A policy can refuse a row; it cannot refuse
-- a row *because the caller is not in the host organisation and the column they are changing is the
-- one that decides what an underwriter reads*.
--
-- ## The gate: the host organisation
--
-- Editing is Mintro's. A partner analyst reads the evaluation and cannot change it — the document
-- carries Mintro's name and states Mintro's view, and D-256 is explicit that the view is Mintro's
-- and the decision is the underwriter's. A partner editing it would be a third party writing in
-- Mintro's voice.
--
-- `current_admin_is_host()` (0060) is the predicate, and it folds in `current_admin_is_active()`,
-- so a suspended member is refused here on the same terms their session goes empty everywhere else.
--
-- This is layer (3) of D-230 — **the API rejects the request** — and it is the only layer that
-- holds when the others are bypassed. The React client hides the controls, and that is cosmetic.

-- ------------------------------------------------------------------------------------------------
-- The predicate, named once
-- ------------------------------------------------------------------------------------------------
--
-- A named function rather than `current_admin_is_host()` inline at three call sites: the question
-- "who may edit an evaluation" is going to be asked again by the publish path (0082) and by
-- whatever comes after, and three copies of one predicate is three places to change it.

create or replace function public.current_admin_can_edit_evaluation()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_admin_is_host();
$$;

comment on function public.current_admin_can_edit_evaluation is
  'Capability gate: an active analyst in the host organisation. Editing and publishing an '
  'evaluation are Mintro''s — the document states Mintro''s view under Mintro''s name (D-256).';

revoke all on function public.current_admin_can_edit_evaluation() from public, anon;
grant execute on function public.current_admin_can_edit_evaluation() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- The edit
-- ------------------------------------------------------------------------------------------------
--
-- Replaces the whole `content` document. Not a patch: the editor holds the draft in memory, applies
-- the operator's change to it and saves the result, so a partial write would be the client and the
-- row disagreeing about what the document is.
--
-- **It does not validate.** `validateDraft` is TypeScript and the rules it enforces are relations
-- between the draft and the run — which findings exist, which angle may cite what. Restating them
-- in SQL would be a second implementation of the one thing in this system that must have exactly
-- one. The guard that matters runs at publish (`publishRefusal`), which re-validates and refuses;
-- an edit that breaks the document is saved and refused at the door, which is the right place for
-- it, because an operator repairing a rejected draft edits *through* invalid states to reach a
-- valid one.

create or replace function public.edit_evaluation_draft(
  p_run_id  uuid,
  p_content jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edited_at timestamptz := now();
  v_rows      integer;
begin
  if not public.current_admin_can_edit_evaluation() then
    raise exception 'only a Mintro operator may edit an evaluation draft';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'the draft content must be a JSON object';
  end if;

  update public.evaluation_drafts
     set content   = p_content,
         edited_at = v_edited_at,
         edited_by = auth.uid()
   where run_id = p_run_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'no evaluation draft exists for run %', p_run_id;
  end if;

  return v_edited_at;
end;
$$;

comment on function public.edit_evaluation_draft is
  'Replaces a draft''s content and stamps the edit. Attribution is resolved from auth.uid(), never '
  'from a passed value; gated on the host organisation (D-261).';

revoke all on function public.edit_evaluation_draft(uuid, jsonb) from public, anon;
grant execute on function public.edit_evaluation_draft(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- The regeneration queue
-- ------------------------------------------------------------------------------------------------
--
-- The same shape as `pdf_requests` (0014) and `scan_requests` (0012), on purpose. A second job
-- mechanism with its own semantics is a second thing to get wrong, and this project has a standing
-- objection to that (D-035).
--
-- Generating a draft opens a browser, reads stored DOM artifacts and calls the vendor. None of that
-- is reachable from a tab, so Regenerate is a row and the worker does the work — exactly as Rescan
-- and Download PDF already are.
--
-- The outcome of the job is the draft row's own `validator_status`, which is why there is no
-- `content` column here. What this table carries is whether the *job* ran, and `error` is for the
-- job failing rather than for the draft being refused: a refused draft is a stored draft with a
-- reason on it, and an operator reads that in the editor. A failed job never wrote one.

create table public.evaluation_requests (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  requested_by  uuid not null references public.analysts (id) on delete restrict,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- The job's own failure, never the draft's refusal. A draft refused by the validator is a `done`
  -- job that wrote a row saying why (D-260) — the distinction D-044 draws, one table over.
  error         text,

  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,

  constraint failed_evaluation_requests_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.evaluation_requests is
  'Queue of evaluation-draft generations. Regenerate inserts a row; the worker reads the run, '
  'calls the model and writes evaluation_drafts. `error` is the job failing, never the draft '
  'being refused.';

alter table public.evaluation_requests enable row level security;

create policy evaluation_requests_select on public.evaluation_requests
  for select to authenticated
  using (public.is_analyst());

-- The gate of record, on the same predicate the edit function carries. A partner who typed the
-- insert by hand is refused here rather than by the absence of a button.
create policy evaluation_requests_insert on public.evaluation_requests
  for insert to authenticated
  with check (
    public.current_admin_can_edit_evaluation()
    and requested_by = auth.uid()
    and status = 'queued'
  );

revoke update, delete on public.evaluation_requests from authenticated, anon;

create index evaluation_requests_queue_idx on public.evaluation_requests (status, created_at);
create index evaluation_requests_run_idx on public.evaluation_requests (run_id, created_at desc);
