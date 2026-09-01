-- ================================================================================================
-- 0058 — Stage 1: run-scoped RLS
-- ================================================================================================
--
-- Stage 1 of docs/admin-access-spec.md. Policies only: no UI, no auth wiring, no invite flow, no
-- Documents Check gating.
--
-- ## The thing that makes this stage dangerous
--
-- Multiple PERMISSIVE policies on a table are OR-ed. Every table below already carries a policy
-- reading `using (public.is_analyst())`. Adding a scoping policy beside it would therefore *widen*
-- access to `is_analyst() OR scoped`, which is `is_analyst()` — every admin would keep seeing every
-- run and the new policy would be decorative. It would pass any test that only asks whether the
-- owner can still read.
--
-- So every policy here is `drop policy` followed by `create policy`. Nothing is added alongside.
-- The composition is AND, inside one predicate.
--
-- ## The predicate, in one place
--
-- Written once as `can_read_run(uuid)` and used by every run-derived table, so the sixteen of them
-- cannot drift from each other or from `runs`. `runs` itself spells the composition out, because it
-- is the definition the rest refer back to and it should be readable without following a call.

-- ------------------------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------------------------
--
-- `current_admin_is_active()` exists because a policy on `runs` cannot reach `analysts.status`
-- without a subquery, and repeating that subquery in twenty places is how one of them ends up
-- different. Suspension has to bite everywhere at once or it does not bite.

create or replace function public.current_admin_is_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select status = 'active' and active from public.analysts where id = auth.uid()),
    false
  );
$$;

comment on function public.current_admin_is_active is
  'True only for an analyst row that is both active and status = active. False for no match.';

-- The whole of run visibility. Every run-derived table defers to this rather than restating it.
--
-- `security definer` so it can read `runs` without recursing through the policy being defined in
-- terms of it. `stable` so it is evaluated once per statement per distinct argument.

create or replace function public.can_read_run(p_run uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_analyst()
     and public.current_admin_is_active()
     and exists (
       select 1
       from public.runs r
       where r.id = p_run
         and (r.created_by = public.current_admin_id() or public.current_admin_is_owner())
     );
$$;

comment on function public.can_read_run is
  'Run visibility: an active analyst who either started the run or is the owner. The single definition.';

revoke all on function public.current_admin_is_active() from public, anon;
revoke all on function public.can_read_run(uuid) from public, anon;
grant execute on function public.current_admin_is_active() to authenticated;
grant execute on function public.can_read_run(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- runs — replaced, not supplemented
-- ------------------------------------------------------------------------------------------------

drop policy runs_select on public.runs;

create policy runs_select on public.runs
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      created_by = public.current_admin_id()
      or public.current_admin_is_owner()
    )
  );

-- ------------------------------------------------------------------------------------------------
-- Everything that hangs off a run
-- ------------------------------------------------------------------------------------------------
--
-- Sixteen tables carry `run_id`. Each one is a way to read a run's contents without ever selecting
-- from `runs`, so each is scoped through the run rather than trusted to be reached only via one.
-- `findings` and `evidence` are the obvious two; `merchant_comments`, `comment_submissions` and
-- `response_notices` are the ones that carry what a merchant wrote back, which is no less theirs.

drop policy findings_select on public.findings;
create policy findings_select on public.findings
  for select to authenticated using (public.can_read_run(run_id));

drop policy evidence_select on public.evidence;
create policy evidence_select on public.evidence
  for select to authenticated using (public.can_read_run(run_id));

drop policy sends_select on public.sends;
create policy sends_select on public.sends
  for select to authenticated using (public.can_read_run(run_id));

drop policy run_quarantine_select on public.run_quarantine;
create policy run_quarantine_select on public.run_quarantine
  for select to authenticated using (public.can_read_run(run_id));

drop policy eye_tests_select on public.eye_tests;
create policy eye_tests_select on public.eye_tests
  for select to authenticated using (public.can_read_run(run_id));

drop policy comment_links_select on public.comment_links;
create policy comment_links_select on public.comment_links
  for select to authenticated using (public.can_read_run(run_id));

drop policy comment_visits_select on public.comment_visits;
create policy comment_visits_select on public.comment_visits
  for select to authenticated using (public.can_read_run(run_id));

drop policy merchant_comments_select on public.merchant_comments;
create policy merchant_comments_select on public.merchant_comments
  for select to authenticated using (public.can_read_run(run_id));

drop policy merchant_attestations_select on public.merchant_attestations;
create policy merchant_attestations_select on public.merchant_attestations
  for select to authenticated using (public.can_read_run(run_id));

drop policy comment_submissions_select on public.comment_submissions;
create policy comment_submissions_select on public.comment_submissions
  for select to authenticated using (public.can_read_run(run_id));

drop policy response_notices_select on public.response_notices;
create policy response_notices_select on public.response_notices
  for select to authenticated using (public.can_read_run(run_id));

drop policy response_nonresponses_select on public.response_nonresponses;
create policy response_nonresponses_select on public.response_nonresponses
  for select to authenticated using (public.can_read_run(run_id));

drop policy pdf_requests_select on public.pdf_requests;
create policy pdf_requests_select on public.pdf_requests
  for select to authenticated using (public.can_read_run(run_id));

drop policy send_requests_select on public.send_requests;
create policy send_requests_select on public.send_requests
  for select to authenticated using (public.can_read_run(run_id));

drop policy comment_invites_select on public.comment_invites;
create policy comment_invites_select on public.comment_invites
  for select to authenticated using (public.can_read_run(run_id));

-- `scan_requests.run_id` is nullable: a queued request has no run yet. Scoping it on the run alone
-- would hide an admin's own request from them for the whole interval before the worker opens the
-- run — so the requester is a first-class clause here rather than an afterthought.

drop policy scan_requests_select on public.scan_requests;
create policy scan_requests_select on public.scan_requests
  for select to authenticated
  using (
    public.can_read_run(run_id)
    or (
      public.is_analyst()
      and public.current_admin_is_active()
      and (requested_by = public.current_admin_id() or public.current_admin_is_owner())
    )
  );

-- ------------------------------------------------------------------------------------------------
-- The insert policies on those tables, which were a hole of their own
-- ------------------------------------------------------------------------------------------------
--
-- Each of these read `is_analyst() and requested_by = auth.uid()` and said nothing about the run.
-- An admin could therefore enqueue a PDF of, or a send of, or a comment invitation for, a run that
-- was never theirs — and receive the contents by email or by file. Scoping select without scoping
-- these would leave the report reachable by asking for it to be delivered.
--
-- **Every original predicate is reproduced verbatim and the scope is ANDed onto it.** A policy is
-- replaced whole, so re-creating one from the migration that first introduced it silently drops
-- whatever later migrations added — `mode = 'public'` from 0014 (D-040: every scan begins
-- anonymous) and `link_id is null and visit_id is null` from 0053 (an operator-recorded answer is
-- not a merchant-submitted one) were both lost that way in an earlier draft of this file, and both
-- were caught by tests that assert the policy text rather than the behaviour. Nothing here relaxes
-- a clause; each line only adds one.

drop policy pdf_requests_insert on public.pdf_requests;
create policy pdf_requests_insert on public.pdf_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_run(run_id)
  );

drop policy send_requests_insert on public.send_requests;
create policy send_requests_insert on public.send_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_run(run_id)
  );

drop policy comment_invites_insert on public.comment_invites;
create policy comment_invites_insert on public.comment_invites
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and public.can_read_run(run_id)
  );

drop policy response_nonresponses_insert on public.response_nonresponses;
create policy response_nonresponses_insert on public.response_nonresponses
  for insert to authenticated
  with check (
    public.is_analyst()
    and marked_by = auth.uid()
    and public.can_read_run(run_id)
  );

drop policy merchant_comments_operator_insert on public.merchant_comments;
create policy merchant_comments_operator_insert on public.merchant_comments
  for insert to authenticated
  with check (
    public.is_analyst()
    and recorded_by = auth.uid()
    and link_id is null
    and visit_id is null
    and public.can_read_run(run_id)
  );

drop policy merchant_attestations_operator_insert on public.merchant_attestations;
create policy merchant_attestations_operator_insert on public.merchant_attestations
  for insert to authenticated
  with check (
    public.is_analyst()
    and recorded_by = auth.uid()
    and link_id is null
    and visit_id is null
    and public.can_read_run(run_id)
  );

-- A queued scan has no run yet, so there is no run to scope against. What is scoped is the actor:
-- the request must be their own, and a suspended person may not queue work.
--
-- `mode = 'public'` is carried over verbatim from 0014, not rediscovered here. D-040 made it a
-- schema property that every scan begins anonymous, and re-creating this policy from its 0012 shape
-- would have dropped that silently — a policy replaced is a policy rewritten, including the parts
-- somebody added for a reason two migrations later.

drop policy scan_requests_insert on public.scan_requests;
create policy scan_requests_insert on public.scan_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and public.current_admin_is_active()
    and requested_by = auth.uid()
    and status = 'queued'
    -- Not a preference the requester may express. The worker escalates on evidence or not at all.
    and mode = 'public'
  );

-- ------------------------------------------------------------------------------------------------
-- The screenshots themselves
-- ------------------------------------------------------------------------------------------------
--
-- `evidence_objects_select` let any active analyst read any object in the bucket. The `evidence`
-- table being scoped would not have closed it: a storage object is reachable by key, and 0006 makes
-- the key predictable on purpose — `<run_id>/<layer>/<sha256>`, held by the `key_is_run_scoped`
-- check constraint. Anyone who has seen one report knows the shape.
--
-- So the object is scoped by the run its own path names. The comparison is `r.id::text = <prefix>`
-- rather than a cast of the prefix to uuid: a malformed or foreign object name then fails to match
-- and is denied, where a cast would raise. Fail closed, and without an error that leaks whether the
-- name was well formed.

drop policy evidence_objects_select on storage.objects;

create policy evidence_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and exists (
      select 1
      from public.runs r
      where r.id::text = split_part(storage.objects.name, '/', 1)
        and public.can_read_run(r.id)
    )
  );

-- ------------------------------------------------------------------------------------------------
-- analysts — you read yourself, the owner reads everyone
-- ------------------------------------------------------------------------------------------------
--
-- The roster used to be readable by every analyst. That was defensible when everyone saw everything
-- anyway; it is not now, because the People screen is the owner's and the run list's `Run by` column
-- is owner-only. An admin has no reason to enumerate their colleagues.

drop policy analysts_select on public.analysts;

create policy analysts_select on public.analysts
  for select to authenticated
  using (
    public.is_analyst()
    and (id = auth.uid() or public.current_admin_is_owner())
  );

-- ------------------------------------------------------------------------------------------------
-- An admin cannot promote themselves, and it is not the UI that stops them
-- ------------------------------------------------------------------------------------------------
--
-- `authenticated` currently holds no UPDATE on `analysts` at all (0001 revokes it), so today this
-- is already refused. That is the correct answer for the wrong reason: the moment Stage 3 grants
-- UPDATE so the owner's People screen can work, the revoke stops applying and every admin can write
-- their own role.
--
-- The trigger does not depend on that grant. It refuses any change to the four governing columns
-- from a session that is not the owner's, whatever privileges that session has been given since.
--
-- `auth.uid() is null` is the service role and the migration runner — neither has a viewer, both are
-- outside RLS by design, and 0055's own owner promotion runs that way.

create or replace function public.reject_self_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.role, new.can_run_documents_check, new.status, new.active)
     is distinct from (old.role, old.can_run_documents_check, old.status, old.active)
     and not public.current_admin_is_owner() then
    raise exception
      'only the account owner may change role, can_run_documents_check, status or active on analysts'
      using errcode = 'insufficient_privilege',
            detail = format('attempted by %s on row %s', auth.uid(), old.id);
  end if;

  return new;
end;
$$;

comment on function public.reject_self_promotion is
  'Governing columns on analysts are the owner''s to write. Independent of whatever UPDATE grants exist.';

create trigger analysts_governing_columns_are_owner_only
  before update on public.analysts
  for each row execute function public.reject_self_promotion();

-- ------------------------------------------------------------------------------------------------
-- admin_access_log — the owner reads it
-- ------------------------------------------------------------------------------------------------
--
-- 0056 deliberately left this table with RLS on and no policies, which denies everyone. The owner
-- now reads. Inserts are unchanged: still no insert policy, so still the service role's alone, and
-- the append-only trigger from 0056 still refuses update and delete including to the service role.

create policy admin_access_log_select on public.admin_access_log
  for select to authenticated
  using (public.current_admin_is_owner());

-- ------------------------------------------------------------------------------------------------
-- merchants — NOT IN THE SPEC's list, and scoped anyway. Flagged in the Stage 1 report.
-- ------------------------------------------------------------------------------------------------
--
-- `merchants` does not inherit from a run; runs inherit from it, so it falls outside the brief's
-- "every table with a run foreign key". Left alone, though, every admin can enumerate every domain
-- the account has ever screened — the client list — which is the same disclosure the not-available
-- page exists to prevent, arriving by a different door.
--
-- Scoped to merchants the caller has a visible run for. The owner sees all. A merchant with no runs
-- yet is visible to nobody through this policy; the worker creates merchant and run together under
-- the service role, so the row becomes visible when the run does.

drop policy merchants_select on public.merchants;

create policy merchants_select on public.merchants
  for select to authenticated
  using (
    public.is_analyst()
    and public.current_admin_is_active()
    and (
      public.current_admin_is_owner()
      or exists (
        select 1 from public.runs r
        where r.merchant_id = merchants.id
          and r.created_by = public.current_admin_id()
      )
    )
  );
