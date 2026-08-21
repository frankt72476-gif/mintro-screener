-- 0013 — merchant-supplied screening accounts
--
-- Hard constraint 6, as restated by D-038: **credentials must never be recoverable from the
-- database alone.** Not "never in a Postgres column" — that was the mechanism, and stating the
-- mechanism would have forced the weaker design, because the option literally named "vault"
-- decrypts through the same service_role connection the worker already holds.
--
-- What is stored here is a sealed envelope: AES-256-GCM payload, its key wrapped to an RSA public
-- key whose private half exists only in the Fly runtime. A complete database dump yields
-- ciphertext. Two independent compromises are required.
--
-- ## The deposit is one-way
--
-- An analyst's browser holds the public key, so it can seal and cannot open. It writes the
-- envelope straight into `credential_deposits`; the worker drains it. Nothing between the two ever
-- sees plaintext — not PostgREST, not Postgres, not Supabase, and not the analyst afterwards.
--
-- The number of parties who can read a merchant's password is one, and it is a machine.

create table public.credential_deposits (
  id               uuid primary key default gen_random_uuid(),
  merchant_domain  text not null check (merchant_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  sealed           text not null,
  deposited_by     uuid not null references public.analysts (id) on delete restrict,
  deposited_at     timestamptz not null default now(),

  -- Refuses anything that is not one of our envelopes. A plausible failure is a UI change that
  -- posts the raw form values; this makes that a constraint violation rather than a credential
  -- sitting in a column in the clear.
  constraint sealed_is_an_envelope check (
    sealed like '{%"v":"mintro-sealed-v1"%' and length(sealed) between 64 and 20000
  )
);

comment on table public.credential_deposits is
  'Sealed merchant logins awaiting collection by the worker. Ciphertext only; the key is not in this database.';

alter table public.credential_deposits enable row level security;

-- Analysts may deposit. They may not read back — not even their own.
--
-- That is the point rather than an oversight: a deposit an analyst could re-read is a credential
-- with a second reader, and "who can see this password" is a list that should only ever shorten.
create policy credential_deposits_insert on public.credential_deposits
  for insert to authenticated
  with check (public.is_analyst() and deposited_by = auth.uid());

revoke select, update, delete on public.credential_deposits from authenticated, anon;

create index credential_deposits_pending_idx on public.credential_deposits (deposited_at);

-- ---------------------------------------------------------------------------------------------
-- The vault store
-- ---------------------------------------------------------------------------------------------
--
-- Backs `VaultBackend` from M4. Sealed values keyed by vault path — `merchants/<domain>/credentials`
-- and `merchants/<domain>/session`. Sessions are sealed identically: a Playwright storageState is
-- a bearer token for a merchant account and is not less sensitive than the password that made it.
--
-- No policy of any kind for `authenticated` or `anon`. The browser has no reason to touch this
-- table, and a table it cannot name is a table it cannot leak.

create table public.vault_entries (
  path        text primary key check (path ~ '^[a-z0-9][a-z0-9._/-]{2,190}$'),
  sealed      text not null,
  updated_at  timestamptz not null default now()
);

comment on table public.vault_entries is
  'Sealed credentials and sessions. Opening one requires the private key, which lives only in the worker runtime.';

alter table public.vault_entries enable row level security;

revoke all on public.vault_entries from authenticated, anon;

-- Deliberately NOT append-only. Sessions are rewritten as they are re-established and cleared when
-- they go stale, and a vault that could only grow would accumulate dead bearer tokens forever.
-- This is not evidence; hard constraint 5 does not reach it.

-- ---------------------------------------------------------------------------------------------
-- The access log
-- ---------------------------------------------------------------------------------------------
--
-- Constraint 6 requires every access to be logged. `CredentialVault` builds this in memory during
-- a run; here it is persisted, because a log that dies with the process answers nothing later.
--
-- Values never appear — only the reference, the action, the purpose and the outcome. Failures are
-- logged too: an attempt to open a credential that did not decrypt is the most interesting line
-- in the file.

create table public.credential_access (
  id         bigserial primary key,
  vault_ref  text not null,
  action     text not null check (action in ('read_credentials', 'read_session', 'write_session', 'clear_session')),
  purpose    text not null,
  outcome    text not null check (outcome in ('ok', 'not_found', 'error')),
  at         timestamptz not null default now()
);

comment on table public.credential_access is
  'Audit trail for vault access. References and purposes, never values (constraint 6).';

alter table public.credential_access enable row level security;

-- Analysts can read the trail. It contains no secrets, and an audit log nobody may look at is
-- a log that exists only to be believed in.
create policy credential_access_select on public.credential_access
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.credential_access from authenticated, anon;

-- Append-only, by trigger, because service_role bypasses RLS. An audit trail the writing process
-- can edit is not an audit trail.
create trigger credential_access_is_append_only
  before update or delete on public.credential_access
  for each row execute function public.reject_mutation();

create index credential_access_ref_idx on public.credential_access (vault_ref, at desc);

-- ---------------------------------------------------------------------------------------------
-- Scan mode
-- ---------------------------------------------------------------------------------------------
--
-- What a requester is asking for. `screening_account` means "use the merchant's supplied login to
-- reach product pages behind the wall".
--
-- It does not, and cannot, mean "evaluate the gate rules while signed in". GATE-002 and GATE-003
-- are decided by `runGateRules`, whose API has no parameter that could carry a session. A supplied
-- credential widens what is visible; it never narrows what is reported.

alter table public.scan_requests
  add column mode text not null default 'public'
  check (mode in ('public', 'screening_account'));

comment on column public.scan_requests.mode is
  'public, or screening_account to use the merchant''s supplied login for pages behind a wall. Never affects GATE-002/GATE-003.';
