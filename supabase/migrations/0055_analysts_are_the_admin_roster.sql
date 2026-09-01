-- ================================================================================================
-- 0055 — analysts become the admin roster: two roles, one capability, one owner
-- ================================================================================================
--
-- Stage 0 of docs/admin-access-spec.md. Schema only: no policies, no UI, nothing wired. The two
-- helper functions at the bottom are defined here and used by nothing until Stage 1.
--
-- ## There is one actor table and it is `analysts`
--
-- The spec was written assuming the screener has no per-user login, and proposes a new
-- `admin_users` table. That assumption is false: `public.analysts` (0001) already exists, already
-- binds to `auth.users`, and `is_analyst()` is already the base predicate in the select policy of
-- every table holding screening data. A second actor table would mean two answers to "who is this
-- person" and two places to suspend them, while `issued_by`, `marked_by`, `recorded_by` and
-- `deposited_by` all continue to reference this one. So the roles, the capability and the status
-- are added here rather than beside it.
--
-- ## What this is not
--
-- Not a permissions system. One boolean. A capabilities table, a role matrix or per-feature grants
-- would be building the general case for a set of one, and the spec names that as a non-goal.
--
-- ## Two columns the spec asks for and this migration does not add
--
-- `auth_user_id` — `analysts.id` *is* the `auth.users` id, by the foreign key 0001 declares. A
-- separate column would be a second copy of the same fact, free to disagree with it.
--
-- `invited_at` — already on the table since 0001, same type, same default.

create type public.admin_role as enum ('owner', 'admin');
create type public.admin_status as enum ('invited', 'active', 'suspended');

alter table public.analysts
  -- Everyone is an admin unless made otherwise. The owner is set by the update below, once.
  add column role public.admin_role not null default 'admin',

  -- Off unless the owner turns it on, and the default is the whole of that sentence. A capability
  -- that defaults on is one nobody chose to grant.
  add column can_run_documents_check boolean not null default false,

  -- Defaults to 'invited' per the spec, which agrees with `active` defaulting true — see the
  -- constraint below, which is what keeps those two from ever disagreeing.
  add column status public.admin_status not null default 'invited',

  -- Who invited them. Restricted rather than cascading: the spec forbids deleting people, and a
  -- cascade would be a deletion path arriving through the back door.
  add column invited_by uuid references public.analysts (id) on delete restrict,

  add column activated_at timestamptz,
  add column suspended_at timestamptz;

comment on column public.analysts.role is
  'Exactly one owner, enforced by a partial unique index. Everyone else is an admin.';
comment on column public.analysts.can_run_documents_check is
  'Off until the owner grants it. Gates creation of document checks, never reading a finished one.';

-- ------------------------------------------------------------------------------------------------
-- Exactly one owner
-- ------------------------------------------------------------------------------------------------
--
-- Partial, because the constraint is about owners and says nothing about how many admins there are.
-- A second owner is a schema violation rather than a thing the People screen has to prevent.

create unique index analysts_one_owner on public.analysts (role) where role = 'owner';

-- ------------------------------------------------------------------------------------------------
-- The owner's Documents Check access is not a grant
-- ------------------------------------------------------------------------------------------------
--
-- Implication, not equality: an admin may hold the capability or not, and both are ordinary. What
-- is refused is an owner without it — the owner is the person who grants it to everyone else, and a
-- row saying otherwise would make the People screen unable to explain itself.

alter table public.analysts
  add constraint analysts_owner_always_runs_documents_check
  check (role <> 'owner' or can_run_documents_check = true);

-- ------------------------------------------------------------------------------------------------
-- `active` and `status` are one fact, so they are constrained to agree
-- ------------------------------------------------------------------------------------------------
--
-- NOT IN THE SPEC. Added because the alternative is worse, and flagged in the Stage 0 report.
--
-- `is_analyst()` reads `active`, and the ruling is that it stays unchanged as the base predicate.
-- The spec adds `status`, whose 'suspended' value means the same thing `active = false` means. Left
-- unconstrained, a People screen that sets `status = 'suspended'` and forgets `active` leaves a
-- suspended person passing the gate that guards every merchant's evidence — a bug no test of the
-- application against itself would catch, because both columns would read exactly as written.
--
-- Stated as `active = (status <> 'suspended')` rather than `= (status = 'active')` so that the
-- defaults agree: a newly invited row is 'invited' and active, which is what an insert with no
-- explicit values already produces. An invited person cannot read anything regardless — Stage 1's
-- policy requires status = 'active' — so the base predicate does not have to carry that half.

alter table public.analysts
  add constraint analysts_active_agrees_with_status
  check (active = (status <> 'suspended'));

-- ------------------------------------------------------------------------------------------------
-- The owner
-- ------------------------------------------------------------------------------------------------
--
-- Not a seed. The account already exists and every run in the database is already their work; this
-- names the row that is already there. No new person, no new address, nothing to bind on first
-- sign-in — which is what makes the spec's `frank@gomintro.com` / `frankt@gomintro.com` mismatch
-- moot rather than resolved in someone's favour.
--
-- Guarded by the single-owner index: applied to a database with more than one active analyst this
-- raises rather than promoting an arbitrary one, and 0057 refuses to proceed on the same basis.

update public.analysts
set role = 'owner',
    can_run_documents_check = true,
    status = 'active',
    activated_at = coalesce(activated_at, created_at)
where active;

-- ------------------------------------------------------------------------------------------------
-- Helpers, defined now and used by nothing until Stage 1
-- ------------------------------------------------------------------------------------------------
--
-- `security definer` so a policy can call them without recursing through the RLS on the table they
-- read — the same reason `is_analyst()` is, and the same shape.
--
-- `stable`, so Postgres evaluates each once per statement rather than once per row.

create or replace function public.current_admin_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.analysts where id = auth.uid();
$$;

comment on function public.current_admin_id is
  'The analyst row for the calling session, or null. Null means no scoping decision can be made from it.';

create or replace function public.current_admin_is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- `coalesce` to false, never null: a policy reading null would evaluate to null and deny, which
  -- is the right outcome by accident rather than by statement. Said here so it is by statement.
  select coalesce(
    (select role = 'owner' from public.analysts where id = auth.uid()),
    false
  );
$$;

comment on function public.current_admin_is_owner is
  'True only for an owner row bound to the calling session. False for everyone else, including no match.';

revoke all on function public.current_admin_id() from public, anon;
revoke all on function public.current_admin_is_owner() from public, anon;
grant execute on function public.current_admin_id() to authenticated;
grant execute on function public.current_admin_is_owner() to authenticated;
