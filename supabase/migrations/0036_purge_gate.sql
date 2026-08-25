-- 0036 — the purge gate (D-130, P1)
--
-- Five append-only tables and five functions. **Nothing here touches storage**, and nothing here
-- deletes anything. This is the record and the permission; the executor comes later and reads what
-- this writes.
--
-- ## The order the gate enforces
--
--     export  →  verify  →  approve  →  purge
--
-- Each step is a row, each row is append-only, and each step refuses unless the one before it
-- exists in the right state. The order is not a convention the caller follows — it is four
-- functions that will not run out of sequence.
--
-- ## Why the digest is passed in rather than computed here
--
-- `packageDigest()` lives in TypeScript (`apps/worker/src/documentsReportGate.ts`) and D-117 already
-- uses it to refuse a stale run. Reimplementing it in plpgsql would be a **second derivation of the
-- same fact**, and D-125 is exactly the ruling against that: the two would agree until somebody
-- changed one.
--
-- So the caller computes it and the database *compares* it. That is weaker against a lying caller
-- and exactly as strong against the thing this defends: a package that changed between export and
-- purge. One caller running one function at two times gets two different answers if the package
-- moved, which is the property wanted. D-130 names this as accident control, not adversary control.
--
-- ## Why the counts are computed here rather than passed in
--
-- The opposite choice, for the opposite reason. Counts are pure database facts — the caller has no
-- special knowledge and a caller-supplied count is a claim about the thing being checked. So the
-- function computes them **and** requires the caller to state what it thinks it exported, and
-- refuses when they differ. A manifest agreeing with itself proves nothing (D-130); a manifest
-- agreeing with the database is the thing worth recording.

-- ── who may approve ────────────────────────────────────────────────────────────────────────────
--
-- A flag, not a hardcoded identity (D-130). It sits beside `active` on the same row and is read by
-- a function shaped exactly like `is_analyst()`, because a second authorisation concept that looks
-- different from the first is a second thing to get wrong.
alter table public.analysts add column purge_approver boolean not null default false;

comment on column public.analysts.purge_approver is
  'May approve a purge (D-130). The only irreversible action in the system, so it is a narrower '
  'gate than is_analyst(). Set by service_role only — analysts cannot grant it to themselves.';

create or replace function public.is_purge_approver()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.analysts
    where id = auth.uid() and active and purge_approver
  );
$$;

comment on function public.is_purge_approver is
  'True when the caller may approve a purge. Strictly narrower than is_analyst() (D-130).';

-- ── the export ─────────────────────────────────────────────────────────────────────────────────

create table public.package_exports (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references public.packages (id) on delete restrict,
  exported_by     uuid not null references public.analysts (id) on delete restrict,

  -- The package as it stood when the export was taken. Compared, never recomputed here.
  package_digest  text not null check (length(package_digest) = 64),

  -- **The anchor.** The export attests to itself; only this row, which is never deleted, can
  -- attest to the export (D-130). Everything else about the export leaves the database.
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  bytes           bigint not null check (bytes >= 0),

  -- What the database held at export time, computed by the function rather than reported by the
  -- caller. A later reader can ask whether the export was complete without the app existing.
  counts          jsonb not null,

  exported_at     timestamptz not null default now()
);

comment on table public.package_exports is
  'An export taken of a package, with the manifest hash and the counts the database held (D-130). '
  'The anchor: the surviving record that attests to an artifact which has left.';

alter table public.package_exports enable row level security;
create policy package_exports_select on public.package_exports
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_exports from authenticated, anon;
create trigger package_exports_are_append_only
  before update or delete on public.package_exports
  for each row execute function public.reject_mutation();
create index package_exports_package_idx on public.package_exports (package_id, exported_at desc);

-- ── the verification ───────────────────────────────────────────────────────────────────────────

create table public.package_export_verifications (
  id                       uuid primary key default gen_random_uuid(),
  export_id                uuid not null references public.package_exports (id) on delete restrict,
  verified_by              uuid not null references public.analysts (id) on delete restrict,

  -- How hop 1 was checked (D-130). `declared` is recordable and **does not satisfy the purge
  -- precondition** — an operator may record what they did, and it does not open the gate.
  method                   text not null check (method in ('read_back', 'reupload', 'declared')),

  observed_manifest_sha256 text not null check (observed_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  -- Members checked against the manifest's per-file hashes. Hashing the archive proves the archive
  -- is intact; checking members proves the manifest describes it.
  members_checked          integer not null check (members_checked >= 0),

  -- Both outcomes are rows. D-064: a send that failed and wrote no row left one report in a
  -- recipient's inbox with nothing behind it, and a verification that failed silently would be the
  -- same mistake pointed at deletion.
  outcome                  text not null check (outcome in ('matched', 'mismatched')),

  verified_at              timestamptz not null default now()
);

comment on table public.package_export_verifications is
  'Hop 1 of two: the export was written intact to the operator''s disk. NOT a statement that it '
  'reached the vault — that is an attestation and is a different fact (D-130, D-064).';

alter table public.package_export_verifications enable row level security;
create policy package_export_verifications_select on public.package_export_verifications
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_export_verifications from authenticated, anon;
create trigger package_export_verifications_are_append_only
  before update or delete on public.package_export_verifications
  for each row execute function public.reject_mutation();
create index package_export_verifications_export_idx
  on public.package_export_verifications (export_id, verified_at desc);

-- ── the approval ───────────────────────────────────────────────────────────────────────────────

create table public.package_purge_approvals (
  id             uuid primary key default gen_random_uuid(),
  package_id     uuid not null references public.packages (id) on delete restrict,
  export_id      uuid not null references public.package_exports (id) on delete restrict,
  approved_by    uuid not null references public.analysts (id) on delete restrict,

  -- The package as it stood when approval was given. The purge re-checks against this, so an
  -- approval cannot outlive the state it was given for.
  package_digest text not null check (length(package_digest) = 64),

  approved_at    timestamptz not null default now()
);

comment on table public.package_purge_approvals is
  'An approver''s authorisation to purge one package, bound to one export and one package digest '
  '(D-130). Not a standing capability: it names what it approves.';

alter table public.package_purge_approvals enable row level security;
create policy package_purge_approvals_select on public.package_purge_approvals
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_purge_approvals from authenticated, anon;
create trigger package_purge_approvals_are_append_only
  before update or delete on public.package_purge_approvals
  for each row execute function public.reject_mutation();

-- ── the purge, as a record ─────────────────────────────────────────────────────────────────────

create table public.package_purges (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references public.packages (id) on delete restrict,

  -- One approval, one purge. A unique constraint rather than a `consumed` column, because this
  -- table is append-only and a mutable flag would need the trigger relaxed to set it.
  approval_id     uuid not null unique references public.package_purge_approvals (id) on delete restrict,

  -- Separately from the approver, though they are the same person today. Recording it makes the
  -- day there are two people visible rather than silent (D-130).
  purged_by       uuid not null references public.analysts (id) on delete restrict,

  objects_deleted integer not null check (objects_deleted >= 0),
  bytes_deleted   bigint not null check (bytes_deleted >= 0),
  purged_at       timestamptz not null default now()
);

comment on table public.package_purges is
  'One purge of one package, citing the approval that authorised it. Append-only (D-130).';

alter table public.package_purges enable row level security;
create policy package_purges_select on public.package_purges
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.package_purges from authenticated, anon;
create trigger package_purges_are_append_only
  before update or delete on public.package_purges
  for each row execute function public.reject_mutation();
create index package_purges_package_idx on public.package_purges (package_id, purged_at desc);

/*
  What was deleted, object by object.

  **This is what makes the supersedes chain resolve to a location rather than to nothing** — the
  failure D-097 named and refused a purge over. A reader following a superseded version reaches a
  row here carrying the key, the hash and, through the purge and its approval, the export id.

  One table for all four object classes rather than a document-version-only one. Staging copies and
  rendered report PDFs are in scope (D-130) and have no version to hang off, and a purge record that
  cannot record two of the four things it deletes is a record that reads as complete and is not.
*/
create table public.purged_objects (
  id                  uuid primary key default gen_random_uuid(),
  purge_id            uuid not null references public.package_purges (id) on delete restrict,

  kind                text not null check (kind in
                        ('document_body', 'document_original', 'upload_staging', 'report_pdf')),

  document_version_id uuid references public.document_versions (id) on delete restrict,
  upload_id           uuid references public.document_uploads (id) on delete restrict,

  storage_key         text not null check (length(storage_key) > 0),
  -- Null where nothing recorded a hash for the object — a staged upload is hashed by the worker
  -- after it reads it, and a report PDF's hash lives on the send. Null means unknown, not zero.
  sha256              text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  bytes               integer check (bytes is null or bytes >= 0),

  purged_at           timestamptz not null default now(),

  -- The reference has to match the kind, or a row can claim to be a document body while pointing
  -- at an upload, and the chain resolves to the wrong place.
  constraint purged_object_reference_matches_its_kind check (
    case kind
      when 'document_body'     then document_version_id is not null and upload_id is null
      when 'document_original' then document_version_id is not null and upload_id is null
      when 'upload_staging'    then upload_id is not null and document_version_id is null
      else document_version_id is null and upload_id is null
    end
  ),
  -- Deleting the same object twice in one purge is a reconciliation bug, not two deletions.
  unique (purge_id, storage_key)
);

comment on table public.purged_objects is
  'Every object a purge removed, with where it was and what it hashed to. What lets a superseded '
  'version resolve to a location in an export rather than to nothing (D-097, D-130).';

alter table public.purged_objects enable row level security;
create policy purged_objects_select on public.purged_objects
  for select to authenticated using (public.is_analyst());
revoke insert, update, delete on public.purged_objects from authenticated, anon;
create trigger purged_objects_are_append_only
  before update or delete on public.purged_objects
  for each row execute function public.reject_mutation();
create index purged_objects_version_idx on public.purged_objects (document_version_id)
  where document_version_id is not null;

-- ── recording an export ────────────────────────────────────────────────────────────────────────

create or replace function public.record_package_export(
  p_package_id      uuid,
  p_package_digest  text,
  p_manifest_sha256 text,
  p_bytes           bigint,
  p_counts          jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual  jsonb;
  v_key     text;
  v_claimed bigint;
  v_have    bigint;
  v_diff    text[] := '{}';
  v_id      uuid;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record an export';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'no such package';
  end if;

  -- Computed here, from the database, because the caller has no special knowledge of these and a
  -- caller-supplied count is a claim about the very thing being checked.
  select jsonb_build_object(
    'slots',            (select count(*) from public.slots where package_id = p_package_id),
    'documents',        (select count(*) from public.documents where package_id = p_package_id),
    'document_versions',(select count(*) from public.document_versions where package_id = p_package_id),
    'document_uploads', (select count(*) from public.document_uploads where package_id = p_package_id),
    'slot_removals',    (select count(*) from public.package_slot_removals where package_id = p_package_id),
    'document_runs',    (select count(*) from public.document_runs where package_id = p_package_id),
    'document_findings',(select count(*) from public.document_findings f
                          join public.document_runs r on r.id = f.run_id
                         where r.package_id = p_package_id),
    'report_sends',     (select count(*) from public.document_report_sends where package_id = p_package_id),
    'retrievals',       (select count(*) from public.document_retrievals where package_id = p_package_id)
  ) into v_actual;

  -- Every key the database knows about must be claimed, and claimed correctly. A missing key is a
  -- mismatch: an exporter that did not mention findings did not export them.
  for v_key in select jsonb_object_keys(v_actual)
  loop
    v_have := (v_actual->>v_key)::bigint;
    v_claimed := nullif(p_counts->>v_key, '')::bigint;
    if v_claimed is distinct from v_have then
      v_diff := v_diff || format('%s: exported %s, database holds %s',
                                 v_key, coalesce(v_claimed::text, 'nothing'), v_have);
    end if;
  end loop;

  if array_length(v_diff, 1) is not null then
    raise exception 'the export does not match the package: %', array_to_string(v_diff, '; ');
  end if;

  insert into public.package_exports
    (package_id, exported_by, package_digest, manifest_sha256, bytes, counts)
  values (p_package_id, auth.uid(), p_package_digest, p_manifest_sha256, p_bytes, v_actual)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_package_export(uuid, text, text, bigint, jsonb) from public, anon;
grant execute on function public.record_package_export(uuid, text, text, bigint, jsonb) to authenticated;

-- ── recording a verification ───────────────────────────────────────────────────────────────────

create or replace function public.record_export_verification(
  p_export_id       uuid,
  p_method          text,
  p_observed_sha256 text,
  p_members_checked integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_outcome  text;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record a verification';
  end if;

  select manifest_sha256 into v_expected from public.package_exports where id = p_export_id;
  if v_expected is null then
    raise exception 'no such export';
  end if;

  -- A mismatch is recorded, not raised. It is a fact about a bad copy and it belongs in the record;
  -- raising would leave the most interesting verification the only one with no row (D-064).
  v_outcome := case when p_observed_sha256 = v_expected then 'matched' else 'mismatched' end;

  insert into public.package_export_verifications
    (export_id, verified_by, method, observed_manifest_sha256, members_checked, outcome)
  values (p_export_id, auth.uid(), p_method, p_observed_sha256, p_members_checked, v_outcome);

  return v_outcome;
end;
$$;

revoke all on function public.record_export_verification(uuid, text, text, integer) from public, anon;
grant execute on function public.record_export_verification(uuid, text, text, integer) to authenticated;

-- ── approving a purge ──────────────────────────────────────────────────────────────────────────

create or replace function public.approve_package_purge(
  p_package_id     uuid,
  p_export_id      uuid,
  p_package_digest text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export record;
  v_id     uuid;
begin
  -- The narrower gate. Everything else in this file is is_analyst().
  if not public.is_purge_approver() then
    raise exception 'only a purge approver may approve a purge';
  end if;

  select * into v_export from public.package_exports where id = p_export_id;
  if v_export is null then
    raise exception 'no such export';
  end if;
  if v_export.package_id <> p_package_id then
    raise exception 'that export belongs to a different package';
  end if;

  -- A strong verification, and a matched one. `declared` is recordable and insufficient (D-130):
  -- an operator may record what they did, and it does not open the gate.
  if not exists (
    select 1 from public.package_export_verifications
     where export_id = p_export_id and outcome = 'matched' and method in ('read_back', 'reupload')
  ) then
    raise exception
      'this export has no verified copy: a purge requires a read_back or reupload verification '
      'that matched, and a declared hash is not one';
  end if;

  -- The package must not have moved since the export was taken, or the export is of something else.
  if p_package_digest <> v_export.package_digest then
    raise exception
      'the package has changed since this export was taken, so the export no longer describes it; '
      'take a new export';
  end if;

  insert into public.package_purge_approvals (package_id, export_id, approved_by, package_digest)
  values (p_package_id, p_export_id, auth.uid(), p_package_digest)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.approve_package_purge(uuid, uuid, text) from public, anon;
grant execute on function public.approve_package_purge(uuid, uuid, text) to authenticated;

-- ── recording a purge ──────────────────────────────────────────────────────────────────────────
--
-- **Records. Does not delete.** The executor deletes objects and then calls this, and the ordering
-- is the executor's problem to get right — but nothing may be deleted without an approval this
-- function would accept, and the executor checks that first by calling nothing else.
--
-- `p_objects` is what was actually removed, so this is a record of an event rather than a plan.

create or replace function public.record_package_purge(
  p_approval_id    uuid,
  p_package_digest text,
  p_objects        jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval record;
  v_purge    uuid;
  v_object   jsonb;
  v_bytes    bigint := 0;
  v_count    integer := 0;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record a purge';
  end if;

  select * into v_approval from public.package_purge_approvals where id = p_approval_id;
  if v_approval is null then
    raise exception 'no such approval';
  end if;

  -- Re-checked here and not only at approval. An approval can sit for a week, and the package it
  -- was given for is the one that existed then.
  if p_package_digest <> v_approval.package_digest then
    raise exception
      'the package has changed since this purge was approved; the approval is for a package that '
      'no longer exists in that state';
  end if;

  if jsonb_array_length(p_objects) = 0 then
    -- A purge that removed nothing is a reconciliation that found nothing, which is a bug in the
    -- executor rather than a purge. Recording it would put a row in the ledger saying bodies went
    -- when they are still there.
    raise exception 'a purge must record at least one removed object';
  end if;

  /*
    Totals first, from the same array the rows come from, so the summary and the detail cannot
    disagree.

    Computed *before* the insert rather than updated after it, because `package_purges` carries
    `reject_mutation` and an update would be refused by its own trigger — correctly. An append-only
    row is written once with what it means, or the guarantee is only for other people's code.
  */
  select count(*), coalesce(sum(nullif(o->>'bytes', '')::bigint), 0)
    into v_count, v_bytes
    from jsonb_array_elements(p_objects) o;

  -- The unique constraint on approval_id is what makes this one-shot; a second call raises there
  -- rather than here, so there is no window between checking and inserting.
  insert into public.package_purges (package_id, approval_id, purged_by, objects_deleted, bytes_deleted)
  values (v_approval.package_id, p_approval_id, auth.uid(), v_count, v_bytes)
  returning id into v_purge;

  for v_object in select * from jsonb_array_elements(p_objects)
  loop
    insert into public.purged_objects
      (purge_id, kind, document_version_id, upload_id, storage_key, sha256, bytes)
    values (
      v_purge,
      v_object->>'kind',
      nullif(v_object->>'document_version_id', '')::uuid,
      nullif(v_object->>'upload_id', '')::uuid,
      v_object->>'storage_key',
      nullif(v_object->>'sha256', ''),
      nullif(v_object->>'bytes', '')::integer
    );
  end loop;

  return v_purge;
end;
$$;

revoke all on function public.record_package_purge(uuid, text, jsonb) from public, anon;
grant execute on function public.record_package_purge(uuid, text, jsonb) to authenticated;
