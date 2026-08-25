-- 0037 — hop 2, in its own words (D-130, P3)
--
-- The export goes to the operator's local drive, and from there to Mintro's vault **by hand**. Only
-- the first hop is verifiable in the app: the page writes the archive through a file handle, reads
-- it back, and checks every member against the manifest. That is a measurement, and it lives in
-- `package_export_verifications`.
--
-- The second hop is not verifiable by anything here. Nobody can ask the vault. So it is recorded as
-- what it is — **a person stating they moved a file** — in a separate table, with a column called
-- `statement` rather than `verified`, and no function anywhere treats it as a check.
--
-- ## Why the separation is structural and not a naming convention
--
-- D-064. A send returned 200, wrote no `sends` row, and one report reached a real recipient with
-- nothing behind it — because "the mailer accepted it" and "it was transmitted" were one field.
-- `send_requests.transmitted` exists to hold those apart. This is the same split made before the
-- first time rather than after it.
--
-- A single `verified boolean` on the export would collapse the two, and the collapse would be
-- invisible: every row would read `true` and nobody could say which half it referred to.

create table public.package_vault_attestations (
  id           uuid primary key default gen_random_uuid(),
  export_id    uuid not null references public.package_exports (id) on delete restrict,
  attested_by  uuid not null references public.analysts (id) on delete restrict,

  -- Where the operator says they put it. Free text on purpose: this is a person's statement about
  -- the world outside the system, and an enumeration would be this system pretending to know the
  -- options. Everything the database *can* check is checked elsewhere and is not free text.
  destination  text not null check (length(trim(destination)) > 0),
  statement    text not null check (length(trim(statement)) > 0),

  attested_at  timestamptz not null default now()
);

comment on table public.package_vault_attestations is
  'Hop 2: a person stating they moved an export to the vault. NOT a verification — nothing checked '
  'it, and no surface may render it as one (D-130, D-064).';
comment on column public.package_vault_attestations.statement is
  'The operator''s own words. Free text because it is a claim about the world outside this system; '
  'everything the database can check is checked elsewhere.';

alter table public.package_vault_attestations enable row level security;
create policy package_vault_attestations_select on public.package_vault_attestations
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_vault_attestations from authenticated, anon;
create trigger package_vault_attestations_are_append_only
  before update or delete on public.package_vault_attestations
  for each row execute function public.reject_mutation();
create index package_vault_attestations_export_idx
  on public.package_vault_attestations (export_id, attested_at desc);

/*
  Record one.

  Deliberately **not** a precondition of anything. `approve_package_purge` requires a matched
  read_back or reupload verification and does not look at this table at all — because an attestation
  is a person saying a thing, and the one irreversible action in the system does not turn on that.

  What it is for: when somebody asks in three years where the copy went, the answer is a row with a
  name, a time and a destination against it, rather than an institutional memory.
*/
create or replace function public.record_vault_attestation(
  p_export_id   uuid,
  p_destination text,
  p_statement   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record an attestation';
  end if;
  if not exists (select 1 from public.package_exports where id = p_export_id) then
    raise exception 'no such export';
  end if;

  insert into public.package_vault_attestations (export_id, attested_by, destination, statement)
  values (p_export_id, auth.uid(), p_destination, p_statement)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_vault_attestation(uuid, text, text) from public, anon;
grant execute on function public.record_vault_attestation(uuid, text, text) to authenticated;

-- ── a declared hash checked nothing, and must not claim otherwise ──────────────────────────────
--
-- `record_export_verification` took `members_checked` from the caller and stored it, so a
-- `declared` row could carry "12 members checked" — a number nobody produced, in the one method
-- where nothing was examined. It read as the strongest verification in the table.
--
-- Found by a test asserting the row said zero, against a helper that passed twelve. The helper was
-- wrong and so was the schema for letting it be.
alter table public.package_export_verifications
  add constraint a_declared_hash_checks_nothing check (
    method <> 'declared' or members_checked = 0
  );

comment on constraint a_declared_hash_checks_nothing on public.package_export_verifications is
  'A declared hash is a person reading a string back. Zero is the true number of members examined, '
  'and any other value overstates what was done (D-130).';
