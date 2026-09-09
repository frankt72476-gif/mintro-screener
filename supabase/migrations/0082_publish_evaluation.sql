-- ================================================================================================
-- 0082 — publishing an evaluation, and the capture that follows it (D-261)
-- ================================================================================================
--
-- 0076 created `evaluations` and said what publishing does: copy the draft's content into a new
-- row, delete the draft, count versions 1..n per run. This is the function that does it, and the
-- queue for the artifact that follows.
--
-- ## One function, because it is one moment
--
-- Insert, delete and enqueue are a transaction or they are a bug. A publish that inserted and
-- failed to delete would leave a draft an operator could publish twice; one that deleted and failed
-- to insert would lose the document. A function is a transaction, and this is the whole reason the
-- three statements are not three round trips from a browser.
--
-- ## Nobody calls this from a browser
--
-- The worker calls it, and only the worker. `publishRefusal` re-validates the edited content against
-- the run before the call, and that function is TypeScript enforcing relations between the draft and
-- the run — which findings exist, which angle may cite what, whether a paragraph's handles resolve
-- in the stored mapping. Restating those in PL/pgSQL would be a second implementation of the one
-- thing in this system that must have exactly one.
--
-- The first cut had the browser run `publishRefusal` and then call this, which left a caller with a
-- REST client able to skip the validation. Publish is a queue row now (0083): the operator asks, the
-- worker validates and writes, and there is no path that reaches this function without having run
-- the validator first.
--
-- **So the gate moved to the insert.** `evaluation_publish_requests_insert` is what refuses a caller
-- outside the host organisation, and this function is not granted to `authenticated` at all. It
-- checks what it still owns: an absent draft, a draft stored as anything but `ok`, and a `domestic`
-- recommendation with a routing row that is not `met`. Those are the database's own invariants about
-- what may become a permanent row, and they hold whatever calls it.
--
-- `p_published_by` is passed rather than read from `auth.uid()`, and that is safe **here and only
-- here**: the caller is the worker, and the value comes off a queue row whose insert policy resolved
-- it from `auth.uid()` at the time the operator pressed the button. The attribution is still never a
-- value a client chose.

-- ------------------------------------------------------------------------------------------------
-- The capture queue
-- ------------------------------------------------------------------------------------------------
--
-- The same shape as `pdf_requests` (0014). Keyed on the **evaluation**, not the run: a run can have
-- several published versions and each is its own document, so a capture that named only the run
-- could not say which version it was of.

create table public.evaluation_capture_requests (
  id             uuid primary key default gen_random_uuid(),
  evaluation_id  uuid not null references public.evaluations (id) on delete restrict,
  requested_by   uuid not null references public.analysts (id) on delete restrict,
  status         text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'failed')),

  storage_key    text,
  error          text,

  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,

  constraint finished_evaluation_captures_have_a_file check (
    status <> 'done' or storage_key is not null
  ),
  constraint failed_evaluation_captures_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on table public.evaluation_capture_requests is
  'Queue of published-evaluation captures. One per published version, because each version is its '
  'own document. The worker refuses these until the capture route renders the evaluation layout.';

alter table public.evaluation_capture_requests enable row level security;

create policy evaluation_capture_requests_select on public.evaluation_capture_requests
  for select to authenticated
  using (public.is_analyst());

-- No insert policy. Rows are written by `publish_evaluation` and by nothing else: a capture exists
-- because a document was published, and a client that could enqueue one directly could ask for a
-- capture of a version that was never published.
revoke insert, update, delete on public.evaluation_capture_requests from authenticated, anon;

create index evaluation_capture_requests_queue_idx
  on public.evaluation_capture_requests (status, created_at);

-- ------------------------------------------------------------------------------------------------
-- Publish
-- ------------------------------------------------------------------------------------------------

create or replace function public.publish_evaluation(
  p_run_id       uuid,
  p_published_by uuid
)
returns table (evaluation_id uuid, version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft   public.evaluation_drafts%rowtype;
  v_version integer;
  v_id      uuid;
  v_open    integer;
begin
  -- Locked, so two requests claimed at the same moment produce one version rather than two rows
  -- racing for the same number and one of them failing on the unique index.
  select * into v_draft
    from public.evaluation_drafts
   where run_id = p_run_id
   for update;

  if not found then
    raise exception 'no evaluation draft exists for run %', p_run_id;
  end if;

  if v_draft.validator_status <> 'ok' then
    raise exception
      'this draft was stored as %; its content is kept so it can be repaired, not so it can be sent',
      v_draft.validator_status;
  end if;

  if v_draft.content is null then
    raise exception 'this draft has no content, so there is nothing to publish';
  end if;

  /*
    `domestic` at publish means every condition is met — all five, not only the observable ones.

    A draft may propose domestic over the two the application answers, by saying they must hold. A
    published evaluation is immutable and states rather than proposes: nobody comes back to add
    "provided the application answers hold". The operator has the application in front of them and
    the editor records both, so the answer exists.
  */
  if v_draft.content -> 'placement' ->> 'recommended' = 'domestic' then
    select count(*) into v_open
      from jsonb_array_elements(v_draft.content -> 'routing') as row
     where row ->> 'status' is distinct from 'met';

    if v_open > 0 then
      raise exception
        'this recommends domestic with % routing condition(s) not met; record the answers you have, or publish the placement available today',
        v_open;
    end if;
  end if;

  select coalesce(max(e.version), 0) + 1 into v_version
    from public.evaluations e
   where e.run_id = p_run_id;

  insert into public.evaluations
    (run_id, version, content, published_by, draft_input_sha256, angles_version, ruleset_version, model)
  values
    (p_run_id, v_version, v_draft.content, p_published_by, v_draft.input_sha256,
     v_draft.angles_version, v_draft.ruleset_version, v_draft.model)
  returning id into v_id;

  -- The draft is gone. 0076: "publishing copies the draft here and deletes it", and the boundary
  -- between mutable and immutable is that the mutable row stops existing.
  delete from public.evaluation_drafts where run_id = p_run_id;

  insert into public.evaluation_capture_requests (evaluation_id, requested_by)
  values (v_id, p_published_by);

  return query select v_id, v_version;
end;
$$;

comment on function public.publish_evaluation is
  'Copies a draft into public.evaluations as the next version, deletes the draft and queues the '
  'capture — one transaction. Called by the worker only: the gate is the publish-request insert '
  'policy (0083), and publishRefusal has already re-validated the content (D-261).';

-- Not granted to `authenticated`. The worker holds service_role and reaches it that way; a client
-- that could call it would be a client that could publish without the validator having run.
revoke all on function public.publish_evaluation(uuid, uuid) from public, anon, authenticated;
