-- ================================================================================================
-- 0056 — admin_access_log: append-only, and enforced rather than promised
-- ================================================================================================
--
-- Stage 0 of docs/admin-access-spec.md. Every invite, activation, grant, revocation, suspension,
-- reinstatement and reroute lands here.
--
-- *"Who gave this person access to the document files"* is the question an underwriter or a bank
-- asks, and the answer must not be the owner's memory. A log that could be edited is the owner's
-- memory with extra steps.
--
-- ## Append-only by grant and by absence, not by convention
--
-- An insert policy exists. Update and delete policies do not — and the absence is the mechanism,
-- because RLS denies what no policy permits. `update` and `delete` are also revoked from
-- `authenticated`, so the two would have to be re-granted *and* a policy written before a row could
-- be changed. Neither happens by accident.
--
-- No `updated_at`. A column recording when a row changed is a column asserting rows change.

create table public.admin_access_log (
  id          bigserial primary key,

  -- Who did it. Not null and never inferred: an audit line whose actor is unknown answers the least
  -- interesting half of the question.
  actor_id    uuid not null references public.analysts (id) on delete restrict,

  -- Who it was done to. Null for actions with no subject — the enumerated set has none today, and
  -- the column is nullable so one can be added without a migration to relax it.
  subject_id  uuid references public.analysts (id) on delete restrict,

  -- The enumerated set from the spec, as a check rather than an enum type: a new action is then a
  -- one-line constraint change with a decision number, not an `alter type` that cannot be rolled
  -- back inside a transaction.
  action      text not null check (action in (
    'invited',
    'invite_resent',
    'activated',
    'granted_documents_check',
    'revoked_documents_check',
    'suspended',
    'reinstated',
    'replies_rerouted'
  )),

  -- What changed, on both sides. Nullable because an `invited` has no before and a read-only action
  -- has neither; a shape that forced a value would fill them with something invented.
  value_before jsonb,
  value_after  jsonb,

  created_at  timestamptz not null default now()
);

comment on table public.admin_access_log is
  'Append-only record of every access change. Insert only: no update or delete policy exists, and both are revoked.';

create index admin_access_log_recent on public.admin_access_log (created_at desc);
create index admin_access_log_subject on public.admin_access_log (subject_id, created_at desc);

alter table public.admin_access_log enable row level security;

-- ------------------------------------------------------------------------------------------------
-- Insert only
-- ------------------------------------------------------------------------------------------------
--
-- The insert policy's predicate is Stage 1's business — who may write a line depends on
-- `current_admin_is_owner()`, and the read policy depends on it too. What Stage 0 settles is that
-- the two mutating verbs are gone before any policy exists to argue about.
--
-- Revoked from `authenticated` and `anon` both. `anon` never had a reason to reach this table, and
-- a revoke that names only the role you were thinking about is the one that ages badly.

revoke update, delete on public.admin_access_log from authenticated, anon;
revoke all on public.admin_access_log from anon;

-- ------------------------------------------------------------------------------------------------
-- And against the service role, which bypasses RLS
-- ------------------------------------------------------------------------------------------------
--
-- Every guard above is an RLS guard, and the worker's service role is not subject to RLS — so
-- without this the log is append-only for everyone except the process most able to rewrite it
-- unattended. The trigger closes that: append-only is a property of the table, not of who is asking.
--
-- Same mechanism `credential_access` already uses (0013), for the same reason.

create trigger admin_access_log_is_append_only
  before update or delete on public.admin_access_log
  for each row execute function public.reject_mutation();
