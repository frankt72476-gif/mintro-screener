-- ================================================================================================
-- 0068 — the invitation the owner asks for, and the worker issues
-- ================================================================================================
--
-- The invite form cannot complete an invitation. It was written as though it could, and it cannot:
-- creating the account needs `auth.admin.generateLink`, which needs the **service key**, which a
-- browser must never hold. And the roster row cannot be written first either — `analysts.id` IS the
-- `auth.users` id (0001), so there is no id to write it under until the account exists.
--
-- So the form asks, and the worker issues. Exactly the shape `comment_invites` (0016) already uses
-- for the merchant invitation, for the same reason: the thing that mints a credential runs where
-- the credential-minting key lives.
--
-- ## What the owner is actually submitting
--
-- Not a person — a *request* for one. The row carries everything `issueAnalystInvitation` needs and
-- nothing it can decide for itself: which organisation (never guessed — `analysts.org_id` is not
-- null with no default since 0060), and both capabilities, which default false here as they do
-- everywhere (D-230). The form's staff/partner defaults are the form's; this table's are the
-- schema's, and they disagree deliberately — a row inserted by anything other than the form should
-- grant nothing.

create table public.analyst_invites (
  id           uuid primary key default gen_random_uuid(),

  -- Folded and unique-per-pending: the same person asked for twice is one invitation, and the
  -- partial index below is what makes a double-submit a no-op rather than two accounts.
  email        citext not null,
  full_name    text not null check (length(btrim(full_name)) > 0),

  org_id       uuid not null references public.organizations (id) on delete restrict,

  can_run_documents_check boolean not null default false,
  can_submit_to_iqwallet  boolean not null default false,

  requested_by uuid not null references public.analysts (id) on delete restrict,

  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed')),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  -- Why it failed, for the owner to read. The send-time redirect guard lands here.
  error        text,
  analyst_id   uuid references public.analysts (id) on delete restrict,

  created_at   timestamptz not null default now()
);

comment on table public.analyst_invites is
  'The owner asks; the worker issues. A browser cannot mint an account — that needs the service key.';

-- One live request per address. A second submit while the first is queued collides rather than
-- creating a second account, and a request that failed can be made again.
create unique index analyst_invites_one_pending
  on public.analyst_invites (email)
  where status in ('queued', 'running');

create index analyst_invites_queue on public.analyst_invites (status, created_at)
  where status in ('queued', 'running');

alter table public.analyst_invites enable row level security;

/*
  The owner asks, and reads what came of it. Nobody else does either.

  Administration is owner-only, not host-member (D-229), and this table is administration: it names
  people across organisations before they exist, which is the same disclosure `admin_access_log`
  is owner-only for.
*/
create policy analyst_invites_select on public.analyst_invites
  for select to authenticated
  using (public.current_admin_is_owner());

create policy analyst_invites_insert on public.analyst_invites
  for insert to authenticated
  with check (
    public.current_admin_is_owner()
    and requested_by = auth.uid()
    and status = 'queued'
    -- The worker's columns are the worker's. A request that arrived already claimed, already
    -- finished, or already naming an analyst is a request describing something that did not happen.
    and claimed_at is null
    and finished_at is null
    and analyst_id is null
    and error is null
  );

-- Update and delete stay with the worker's service role: the owner asks once and reads the outcome.
revoke update, delete on public.analyst_invites from authenticated, anon;
revoke all on public.analyst_invites from anon;
