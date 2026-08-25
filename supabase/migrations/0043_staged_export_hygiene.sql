-- 0043 — the staged copy goes, and the link does not linger (D-132, amends D-130)
--
-- Two liabilities P6 left, closed by one pass.
--
-- **The staged archive is a second full copy of every document body**, inside the system the purge
-- exists to remove them from. P6 gave it a manual discard button and nothing else, so an operator
-- who downloaded and walked away left it there indefinitely — and an export interrupted after the
-- upload left one **no control could reach at all**: status `running`, no `storage_key` recorded, a
-- complete archive in the bucket that no row points at. One was found in the test project.
--
-- **The download link is a bearer credential in a column** that is never deleted. Inert after two
-- hours and still a credential-shaped string travelling into every backup, every support export,
-- and every schema audit that has to stop and work out whether it is live.
--
-- ## What is kept, and what is not
--
-- The durable fact is **that a link was issued and when**, not the link. `download_issued_at` says
-- it; the sweep nulls `download_url` once it has lapsed.
--
-- **Not on consumption**: fetching a signed URL tells the database nothing, and inferring it from a
-- verification row would miss the operator who downloads and does not verify. Expiry is the only
-- event this side can observe.

-- ── the fact worth keeping ─────────────────────────────────────────────────────────────────────

alter table public.document_export_requests add column download_issued_at timestamptz;

comment on column public.document_export_requests.download_issued_at is
  'That a link was issued, and when. Survives the URL being nulled — the credential is transient, '
  'the fact that one was handed out is not (D-132).';
comment on column public.document_export_requests.download_url is
  'A signed URL for one archive, nulled by the sweep once it lapses. Transient by design: a bearer '
  'credential in a row that is never deleted would otherwise be permanent (D-132).';

-- True where a URL exists: the worker mints it at the moment it finishes the request.
update public.document_export_requests
   set download_issued_at = finished_at
 where download_url is not null and download_issued_at is null;

/*
  The constraint moves to the durable fact.

  `finished_exports_are_fetchable` required a *live* URL on every finished, undiscarded row — which
  the sweep is about to make false the moment a link lapses. What it was really asserting is that a
  finished export was reachable at some point, and `download_issued_at` says that without going
  stale.
*/
alter table public.document_export_requests drop constraint finished_exports_are_fetchable;

alter table public.document_export_requests
  add constraint finished_exports_were_fetchable check (
    status <> 'done' or discarded_at is not null or download_issued_at is not null
  );

-- ── the freeze, relaxed to exactly one direction ───────────────────────────────────────────────
--
-- A finished row stays finished, and the sweep has to be able to remove the link from one. So the
-- two download columns may change **to NULL and to nothing else**.
--
-- The asymmetry is the point: nulling can only take a download away, while re-pointing could send
-- an operator at a different archive while the row still names the export it was taken for. One is
-- housekeeping, the other is a misdirection with a record that looks correct.
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
    if (new.status, new.export_id, new.storage_key, new.bytes, new.error,
        new.package_id, new.requested_by, new.finished_at, new.download_issued_at)
       is distinct from
       (old.status, old.export_id, old.storage_key, old.bytes, old.error,
        old.package_id, old.requested_by, old.finished_at, old.download_issued_at) then
      raise exception 'export request % is finished; only the discard and the link may still change', old.id
        using errcode = 'restrict_violation';
    end if;

    -- Null-only. A link may be taken away and never swapped.
    if new.download_url is not null and new.download_url is distinct from old.download_url then
      raise exception
        'the download link on export request % may be cleared, not repointed: a new URL would send '
        'an operator at a different archive while the row still names this export', old.id
        using errcode = 'restrict_violation';
    end if;
    if new.download_expires_at is not null
       and new.download_expires_at is distinct from old.download_expires_at then
      raise exception 'the download expiry on export request % may be cleared, not moved', old.id
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ── a verified copy makes the staged one redundant ─────────────────────────────────────────────
--
-- The primary trigger, and it fires on **evidence rather than a timer**: a matched `read_back` or
-- `reupload` means the archive is on the operator's disk and has been hashed member by member. The
-- same logic as export-before-purge, one level down — the copy goes once another one is proven.
--
-- **Never on `declared`.** A typed hash proves somebody read a string; nothing established that a
-- file exists anywhere, and discarding on it would delete the only copy on the strength of an
-- operator's typing.
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

  if v_outcome = 'matched' and p_method in ('read_back', 'reupload') then
    update public.document_export_requests
       set discard_requested_at = coalesce(discard_requested_at, now())
     where export_id = p_export_id and status = 'done' and discarded_at is null;
  end if;

  return v_outcome;
end;
$$;

revoke all on function public.record_export_verification(uuid, text, text, integer) from public, anon;
grant execute on function public.record_export_verification(uuid, text, text, integer) to authenticated;
