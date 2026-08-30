-- 0048 — whether a merchant's screening account exists, and whether it still works
--
-- D-185. Everything about a stored credential except the credential.
--
-- ## The gap this closes
--
-- An analyst could deposit a login and then learn nothing about it ever again. There is no list,
-- no "one exists", no sign of whether it still signs in — and depositing the same domain twice
-- silently overwrote the first. Worse, a dead credential and no credential produced nearly the
-- same report: `describeAccess` said "no screening account was stored for this merchant" in both
-- cases, because the escalation path returned a bare null and the caller guessed.
--
-- ## Why the browser may read this and may read nothing else
--
-- **There is nothing here a leak would compromise.** No sealed value, no username, no vault path,
-- no key material — a domain, two timestamps, an analyst id and a boolean. Everything it says is
-- already visible to an analyst who can queue a scan of that domain and read the coverage note.
--
-- That is what makes a `select` policy defensible where `credential_deposits`, `vault_entries` and
-- `credentials` all refuse one. Those tables hold ciphertext or point at it; this holds facts
-- about it. The property D-038 turns on is unchanged: the number of parties who can read a
-- merchant's password is still one, and it is still the worker.
--
-- **Deliberately not extended to a reveal.** An analyst still cannot read a credential back, here
-- or anywhere. That was considered and declined with this work: the need was "see that it is stale
-- and swap it", which this covers without adding a second reader.
--
-- ## Keyed on domain, like the vault
--
-- `merchants/<domain>` is the vault path, and a credential belongs to a merchant rather than to a
-- run — so a re-run of the same domain picks it up without anyone re-supplying it. Keying this on
-- anything else would introduce a second identity for one thing.

create table public.credential_state (
  merchant_domain text primary key check (merchant_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),

  -- When the credential now in the vault was deposited, and by whom.
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.analysts (id) on delete set null,

  -- The last time a scan tried to sign in with it, and whether that worked.
  --
  -- Null means never tried. That is a real third state and not a missing value: a credential
  -- deposited for a storefront that has not walled its products since is never opened, because
  -- escalation happens on an observed refusal and not otherwise (D-040). "Never used" must not
  -- read as "failed".
  last_login_ok boolean,
  last_login_at timestamptz,

  constraint login_outcome_is_whole check (
    (last_login_ok is null) = (last_login_at is null)
  )
);

comment on table public.credential_state is
  'Whether a merchant screening account exists and whether it last signed in. Never the credential (D-185).';
comment on column public.credential_state.last_login_ok is
  'Null means no scan has needed it yet, which is not the same as failing. See D-040.';

alter table public.credential_state enable row level security;

-- Analysts may look. There is nothing here to protect, and a card that cannot read this is a card
-- that cannot tell anyone their credential stopped working.
create policy credential_state_select on public.credential_state
  for select to authenticated
  using (public.is_analyst());

-- Written by the worker alone. An analyst's browser deposits through `credential_deposits` and the
-- worker records the outcome; letting the browser write here would let it claim a credential exists
-- when the deposit never landed.
revoke insert, update, delete on public.credential_state from authenticated, anon;

-- Not append-only, deliberately. Unlike `credential_access` this is current state rather than an
-- audit trail: one row per merchant, rewritten as the credential is replaced and as sign-ins
-- succeed or fail. The trail of *access* is `credential_access`, which is append-only by trigger
-- and stays the record of what happened.
