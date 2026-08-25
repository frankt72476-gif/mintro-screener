-- 0040 — the export queue (D-130, P6)
--
-- The panel could show exports and could not take one. The builder needs the service key (it reads
-- document bodies) and Playwright (it re-renders every sent report), neither of which belongs in an
-- analyst's tab — so the operator queues a request and the worker does the work. The same shape as
-- `document_send_requests` (0031) and for the same reason (D-094).
--
-- ## Where the archive is staged, and why not under the package
--
-- `exports/{requestId}.tar`, deliberately **outside** any package prefix. The purge reconciliation
-- walks `{packageId}/` and refuses on anything it cannot account for (D-130, P4); an archive parked
-- there would be an unexplained object that blocks every purge of the package it was taken for.
--
-- ## The staged archive is a second full copy, and it is discardable
--
-- It holds every document body in one file, inside the system the purge exists to remove them from.
-- It is there so the browser can download it, and it should not outlive that. `discard_requested_at`
-- asks the worker to delete it; `discarded_at` records that it did. Neither is a purge — this is an
-- artifact this system made minutes ago, not a merchant's submission, and nothing in D-097 or D-130
-- covers it.
--
-- ## An analyst may ask, and may not answer
--
-- Queued only, under their own name. An operator who could write `done` with an `export_id` could
-- record an export that was never built — and `package_exports` is the anchor the whole purge gate
-- reads.

create table public.document_export_requests (
  id                   uuid primary key default gen_random_uuid(),
  package_id           uuid not null references public.packages (id) on delete restrict,
  requested_by         uuid not null references public.analysts (id) on delete restrict,

  status               text not null default 'queued'
                         check (status in ('queued', 'running', 'done', 'failed')),

  -- What it produced. Null until the worker records it.
  export_id            uuid references public.package_exports (id) on delete restrict,
  storage_key          text,
  bytes                bigint check (bytes is null or bytes >= 0),
  -- Sends whose re-rendered PDF no longer hashes to what the send log recorded (D-130). Not a
  -- failure — the renderer moved — and export time is the last moment it is checkable at all.
  report_hash_mismatches integer not null default 0 check (report_hash_mismatches >= 0),

  error                text,
  discard_requested_at timestamptz,
  discarded_at         timestamptz,

  claimed_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),

  -- A finished request points at what it produced. A `done` row with no export is a request that
  -- claims success and cannot show for what.
  constraint finished_exports_have_an_export
    check (status <> 'done' or (export_id is not null and storage_key is not null)),
  constraint failed_exports_say_why check (status <> 'failed' or error is not null),
  -- Nothing is discarded that was never asked about.
  constraint discarded_exports_were_asked_to_be
    check (discarded_at is null or discard_requested_at is not null)
);

comment on table public.document_export_requests is
  'A queued export. The worker builds it because it needs the service key and a browser (D-094). '
  'The staged archive is a second full copy of the package and is discardable once downloaded.';
comment on column public.document_export_requests.storage_key is
  'Where the archive is staged, under exports/ and never under a package prefix — the purge '
  'reconciliation refuses on unexplained objects in {packageId}/ (D-130).';

alter table public.document_export_requests enable row level security;

create policy document_export_requests_select on public.document_export_requests
  for select to authenticated using (public.is_analyst());

create policy document_export_requests_insert on public.document_export_requests
  for insert to authenticated
  with check (
    public.is_analyst()
    and requested_by = auth.uid()
    and status = 'queued'
    and export_id is null
    and storage_key is null
    and claimed_at is null
    and finished_at is null
  );

revoke update, delete on public.document_export_requests from authenticated, anon;

/*
  Finished requests are final, except for the discard.

  The result of an export is evidence — an operator downloaded a file because this row said it was
  there. What may still change afterwards is whether the staged copy still exists, which is a fact
  about a temporary artifact rather than about the export.
*/
create or replace function public.reject_finished_export_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'export requests are never deleted: the row is why an operator has a copy'
      using errcode = 'restrict_violation';
  end if;

  if old.status in ('done', 'failed') then
    -- Everything but the two discard columns must be unchanged.
    if (new.status, new.export_id, new.storage_key, new.bytes, new.error,
        new.package_id, new.requested_by, new.finished_at)
       is distinct from
       (old.status, old.export_id, old.storage_key, old.bytes, old.error,
        old.package_id, old.requested_by, old.finished_at) then
      raise exception 'export request % is finished; only the discard may still change', old.id
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger document_export_requests_are_final_once_finished
  before update or delete on public.document_export_requests
  for each row execute function public.reject_finished_export_mutation();

create index document_export_requests_package_idx
  on public.document_export_requests (package_id, created_at desc);
create index document_export_requests_queue_idx
  on public.document_export_requests (status, created_at)
  where status in ('queued', 'running');

-- ── the counts, in one place ───────────────────────────────────────────────────────────────────
--
-- Extracted from `record_package_export` so the worker path checks the *same* numbers rather than a
-- second copy that agrees until somebody edits one (D-125).
create or replace function public.package_export_counts(p_package_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
  );
$$;

comment on function public.package_export_counts is
  'What the database holds for a package. One derivation, read by both export paths (D-125).';

-- Raises when an exporter''s claim disagrees with the database. Shared for the same reason.
create or replace function public.assert_export_counts(p_package_id uuid, p_claimed jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actual  jsonb := public.package_export_counts(p_package_id);
  v_key     text;
  v_claimed bigint;
  v_have    bigint;
  v_diff    text[] := '{}';
begin
  for v_key in select jsonb_object_keys(v_actual)
  loop
    v_have := (v_actual->>v_key)::bigint;
    v_claimed := nullif(p_claimed->>v_key, '')::bigint;
    if v_claimed is distinct from v_have then
      v_diff := v_diff || format('%s: exported %s, database holds %s',
                                 v_key, coalesce(v_claimed::text, 'nothing'), v_have);
    end if;
  end loop;

  if array_length(v_diff, 1) is not null then
    raise exception 'the export does not match the package: %', array_to_string(v_diff, '; ');
  end if;

  return v_actual;
end;
$$;

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
  v_id uuid;
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may record an export';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'no such package';
  end if;

  insert into public.package_exports
    (package_id, exported_by, package_digest, manifest_sha256, bytes, counts)
  values (p_package_id, auth.uid(), p_package_digest, p_manifest_sha256, p_bytes,
          public.assert_export_counts(p_package_id, p_counts))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_package_export(uuid, text, text, bigint, jsonb) from public, anon;
grant execute on function public.record_package_export(uuid, text, text, bigint, jsonb) to authenticated;

/*
  The worker's path.

  `service_role` has no `auth.uid()`, so it fails `is_analyst()` and cannot call the function above
  — the guard working, and the reason this exists. The authority comes from the request row instead:
  only an analyst can create one, and `requested_by` is who the export is attributed to.

  The counts are checked identically, by the same function. The worker gets no easier ride than the
  browser; it gets a different way of proving who asked.
*/
create or replace function public.record_export_for_request(
  p_request_id      uuid,
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
  v_request record;
  v_id      uuid;
begin
  select * into v_request from public.document_export_requests where id = p_request_id;
  if v_request is null then
    raise exception 'no such export request';
  end if;
  if v_request.status <> 'running' then
    raise exception 'export request % is %, not running', p_request_id, v_request.status;
  end if;

  insert into public.package_exports
    (package_id, exported_by, package_digest, manifest_sha256, bytes, counts)
  values (v_request.package_id, v_request.requested_by, p_package_digest, p_manifest_sha256, p_bytes,
          public.assert_export_counts(v_request.package_id, p_counts))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_export_for_request(uuid, text, text, bigint, jsonb) from public, anon, authenticated;

-- ── asking for the staged copy to go ───────────────────────────────────────────────────────────

create or replace function public.request_export_discard(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may discard a staged export';
  end if;

  update public.document_export_requests
     set discard_requested_at = coalesce(discard_requested_at, now())
   where id = p_request_id and status = 'done' and discarded_at is null;

  if not found then
    -- Never silently. A request that is not finished has no staged copy to discard, and one already
    -- discarded is not a second event.
    raise exception 'that export is not a finished, undiscarded export';
  end if;
end;
$$;

revoke all on function public.request_export_discard(uuid) from public, anon;
grant execute on function public.request_export_discard(uuid) to authenticated;
