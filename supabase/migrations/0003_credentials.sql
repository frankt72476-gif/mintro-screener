-- 0003 — credentials
--
-- Hard constraint 6: credentials go in a vault, never in Postgres columns. This table therefore
-- holds a **reference** and nothing else — the same discipline `SessionDescriptor` follows in the
-- worker (D-026), applied to storage.
--
-- The column is `vault_ref`. There is no `password` column, no `secret` column, and no jsonb
-- column something could be hidden in. A schema with nowhere to put a secret cannot leak one.

create table public.credentials (
  merchant_id  uuid primary key references public.merchants (id) on delete cascade,
  vault_ref    text not null,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),

  -- A vault reference is a path, not a value. This rejects anything that looks like someone
  -- pasted a credential into the field.
  constraint vault_ref_is_a_reference check (
    vault_ref ~ '^[a-z0-9][a-z0-9._/-]{2,190}$'
  )
);

comment on table public.credentials is
  'Vault references for merchant screening accounts. Never the credentials themselves (constraint 6).';
comment on column public.credentials.vault_ref is
  'Path into the vault, e.g. merchants/acme. Resolving it requires the vault token, which lives only in the worker runtime.';

alter table public.credentials enable row level security;

-- No policy for `authenticated`. Deliberate, and the most important line in this file.
--
-- An analyst has no reason to read even the *reference*: it is not useful without the vault
-- token, but it names which merchants have stored credentials, and that is not information the
-- browser needs. Only service_role reaches this table.
revoke all on public.credentials from authenticated, anon;
