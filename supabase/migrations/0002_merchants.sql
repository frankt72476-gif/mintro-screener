-- 0002 — merchants
--
-- RLS is enabled in the same migration that creates the table. Never after, never as a
-- follow-up: turning it on once rows exist is where people get caught (docs/DEPLOY.md).

create table public.merchants (
  id          uuid primary key default gen_random_uuid(),
  legal_name  text,
  domain      text not null unique,
  platform    text,
  created_at  timestamptz not null default now()
);

comment on table public.merchants is 'Merchants screened. One row per storefront domain.';

alter table public.merchants enable row level security;

create policy merchants_select on public.merchants
  for select to authenticated
  using (public.is_analyst());

-- Writes are the worker's, via service_role. An analyst does not create merchants from the
-- browser, so no insert or update policy exists for them.
revoke insert, update, delete on public.merchants from authenticated, anon;

create index merchants_domain_idx on public.merchants (domain);
