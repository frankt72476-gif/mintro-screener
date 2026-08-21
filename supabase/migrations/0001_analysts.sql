-- 0001 — analysts
--
-- Invite-only access, enforced in the database rather than in dashboard configuration.
--
-- Supabase's "disable signups" toggle is not version-controlled, not reviewable, and not
-- testable. If it is ever flipped, `auth.role() = 'authenticated'` would let anyone who signed
-- up read every merchant's evidence. This table closes that: being in `auth.users` is not
-- enough, you must also be an active analyst.
--
-- It also makes revocation possible without deleting an auth user, which matters because the
-- send log references who triggered each send.
--
-- NOTE: this table is an addition to the data model in docs/ARCHITECTURE.md, which documents a
-- *minimum*. Flagged in D-030.

create table public.analysts (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  active      boolean not null default true,
  invited_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.analysts is
  'Invited analysts. Membership here, not merely an auth.users row, grants access to screening data.';

alter table public.analysts enable row level security;

-- Membership test used by every other table's policies.
--
-- SECURITY DEFINER so it can read `analysts` without recursing through that table''s own RLS.
-- `stable` so Postgres evaluates it once per statement rather than once per row.
create or replace function public.is_analyst()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.analysts
    where id = auth.uid() and active
  );
$$;

comment on function public.is_analyst is
  'True when the caller is an active invited analyst. The single gate for all screening data.';

-- An analyst may read the roster (to see who else has access) but may not change it.
-- Adding or deactivating an analyst is a service-role operation: an invite, not a self-service.
create policy analysts_select on public.analysts
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.analysts from authenticated, anon;

-- Shared guard for append-only tables.
--
-- RLS alone cannot enforce this: `service_role` carries BYPASSRLS, so the worker would be free
-- to overwrite its own evidence. A trigger is not bypassed, which makes it the only place this
-- can actually be guaranteed.
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% on %.% is not permitted: this table is append-only (hard constraint 5, D-002)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.reject_mutation is
  'Raises on UPDATE or DELETE. Enforces append-only against service_role, which bypasses RLS.';
