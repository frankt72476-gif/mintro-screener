-- 0041 — how the archive reaches the operator (D-130, P6)
--
-- ## The defect this fixes, found by running it
--
-- P6 staged the archive and the browser could not fetch it. `authenticated` has no select on the
-- documents bucket, so `download()` fails and `list()` returns `[]` with no error — the same
-- permission gap that put the purge dry run in the worker, arriving again at the last step of the
-- operator's sequence. The export built, the row said `done`, and the file was unreachable.
--
-- ## Why a signed URL rather than a read policy
--
-- A select policy on the documents bucket would let every analyst read every document body of every
-- package, permanently. That is the **opposite** of D-097's restricted access — the regime that is
-- still unbuilt — and building its inverse by accident, to fix a download, is how a retention
-- policy quietly becomes a filing cabinet with the door off.
--
-- So the worker mints a URL for **one object**, with an expiry, and records it here. No standing
-- permission is granted to anybody, and when the link lapses the archive is unreachable again.
--
-- The URL is a bearer credential in a column, which is worth naming rather than glossing: it is
-- readable only by an analyst (`is_analyst()` on select), it names one archive, and it expires.
-- That is strictly narrower than the read policy it replaces — the alternative was a standing grant
-- over every body in the system.

alter table public.document_export_requests
  add column download_url text,
  add column download_expires_at timestamptz;

comment on column public.document_export_requests.download_url is
  'A signed URL for this one archive, minted by the worker. Narrower than a bucket read policy, '
  'which would grant every analyst standing access to every document body (D-097, D-130).';
comment on column public.document_export_requests.download_expires_at is
  'When the link lapses. After this the archive is unreachable until somebody exports again.';

-- The finished-row guard has to know about the two new columns, or the worker cannot write them
-- alongside `done` — and more importantly, so they cannot be edited afterwards.
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
    -- Everything but the two discard columns must be unchanged. The download link is part of the
    -- finished row: re-pointing it at another object would change which file an operator fetches
    -- while the record still names the export it was taken for.
    if (new.status, new.export_id, new.storage_key, new.bytes, new.error,
        new.package_id, new.requested_by, new.finished_at,
        new.download_url, new.download_expires_at)
       is distinct from
       (old.status, old.export_id, old.storage_key, old.bytes, old.error,
        old.package_id, old.requested_by, old.finished_at,
        old.download_url, old.download_expires_at) then
      raise exception 'export request % is finished; only the discard may still change', old.id
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

/*
  A finished export has somewhere to fetch it from, until it is discarded.

  Without this a `done` row can name a staged archive nobody can reach, which is exactly what
  shipped and what this migration exists for.

  **`not valid`**, and deliberately. Rows written before the column existed are `done` with no link
  — the test project has several from the run that found the defect — and they are a true record of
  what happened. Rewriting them to satisfy a constraint added afterwards would erase the evidence
  of the state this migration is fixing, which is the same move as backfilling a value nobody
  chose (D-129 on `retention_days`).

  `not valid` means Postgres enforces it on every insert and every update from here and does not
  re-examine what is already there. On production the table is empty, so nothing is exempt.
*/
alter table public.document_export_requests
  add constraint finished_exports_are_fetchable check (
    status <> 'done' or discarded_at is not null or download_url is not null
  ) not valid;
