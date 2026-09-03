-- 0071 — the `reports` bucket: public-read, unguessable, not listable
--
-- Step 1 of docs/report-delivery-static-html.md. The report handoff artifact becomes an immutable
-- HTML capture delivered as a link; this creates the bucket that will hold it. **Nothing writes
-- here yet** — the capture step is a later commit, and this file deliberately does not touch the
-- worker's render path.
--
-- No decision number is cited. The spec asks for one to be confirmed against docs/DECISIONS.md
-- and the record is not written yet; a number in code that does not resolve to a record is worse
-- than no number. It goes in when the record lands.
--
-- ## Why this bucket is public when `evidence` may not be
--
-- 0008 raises an exception if the `evidence` bucket is public, and that is not being relaxed here.
-- A merchant capture is read by an analyst who has a session, so it is reached through a
-- short-expiry signed URL, and a public evidence bucket would be a standing leak of the thing the
-- system exists to protect.
--
-- A captured report is a different object with a different reader. It goes to IQwallet and to the
-- agent, neither of whom has an account here, and the link has to open years from now — the whole
-- value of the artifact is that it says the same thing later that it said when it was sent. A
-- signed URL either expires and breaks the report, or is given a life long enough that it is a
-- public URL with extra steps.
--
-- So the object is public and **the path is the credential**: the object key is
-- `<run-id>/<token>.html`, where the token is 32 bytes of CSRNG, base64url
-- (`apps/worker/src/reportToken.ts`). Read through the bucket's public endpoint the full path is
-- `reports/<run-id>/<token>.html`, which is the path the spec names.
--
-- Two consequences follow, both deliberate:
--
--   * **The bucket is not listable.** A public bucket whose contents can be enumerated has no
--     unguessable path — listing would hand over every report in one request. Object listing goes
--     through `storage.objects` RLS, so the enforcement is the *absence* of a select policy for
--     this bucket, asserted in `apps/worker/test/schema/reportBucket.test.ts`.
--   * **Evidence does not move here.** This bucket holds rendered reports and nothing else. The
--     worker's `SUPABASE_EVIDENCE_BUCKET` is untouched and still points at the private bucket.
--
-- ## The run id in the path is not a secret and is not doing the work
--
-- It is there so a run's captures group under one prefix — which is what makes retention and the
-- purge path able to address a run's reports at all. The token is the only thing standing between
-- a stranger and the file. Anyone who can guess a run id learns nothing.
--
-- ## Retention
--
-- No expiry, following the existing run retention posture (0035, 0036): long-term, purged only on
-- operator approval after export verification. Nothing here sets a lifecycle rule and nothing in
-- application code deletes from this bucket.

-- ---------------------------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------------------------
--
-- Created here rather than by hand in the dashboard. 0008 asserts a bucket somebody else made,
-- and the cost of that showed up later: the guard ran at migration time, the uploads happened
-- afterwards, and five runs were written against a project that had no bucket at all. A bucket
-- that ships with the migrations is a bucket every environment has for the same reason.
--
-- Idempotent, then verified. `on conflict do nothing` covers a re-run; the assertion after it
-- covers the case the insert cannot fix — a bucket of this name that already exists and is
-- private, which would make every delivered link 400 rather than fail at write time.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('reports', 'reports', true)
  on conflict (id) do nothing;

  if not exists (select 1 from storage.buckets where id = 'reports') then
    raise exception 'the `reports` bucket could not be created';
  end if;

  if not (select public from storage.buckets where id = 'reports') then
    -- One string literal, deliberately. plpgsql's RAISE wants a literal format, not two adjacent
    -- literals relying on the main parser's concatenation.
    raise exception 'the `reports` bucket exists and is PRIVATE. A captured report is delivered as a link that never expires; a private bucket can only be reached by a signed URL, which can. Make it public — the unguessable token in the object key is what limits access.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may reach objects in it
-- ---------------------------------------------------------------------------------------------
--
-- Nobody, through the API. There is deliberately **no policy of any kind** on `storage.objects`
-- for `bucket_id = 'reports'`:
--
--   * no select  — this is what "not listable" is. Reading a report happens through the bucket's
--                  public object endpoint, which does not consult RLS; listing does, and finds
--                  nothing permitting it. Analysts included: an analyst who needs a report's URL
--                  gets it from the row the capture step writes, not by browsing a bucket.
--   * no insert  — only the worker writes, through `service_role`. A browser that could write here
--                  could publish an arbitrary HTML document on a Mintro-controlled public origin,
--                  which is a phishing primitive, not a report.
--   * no update  — a captured report is the document that was sent (D-002). Overwriting one is
--                  changing what a dated record says.
--   * no delete  — the same reason there is none on `evidence`. Removing a delivered report is a
--                  deliberate administrative act and should feel like one.
--
-- Append-only on the write path is `upsert: false` in the uploader, as it is for evidence, plus
-- the fact that each capture mints a fresh token and therefore a fresh key — a re-capture never
-- addresses an existing object, so there is nothing for it to overwrite.
--
-- No `comment on table storage.buckets` to record any of this. That table belongs to
-- `supabase_storage_admin`, and `comment on` requires ownership — it would apply cleanly against
-- the PGlite tier, where the stub table is ours, and fail on production. The empty tier cannot see
-- an ownership difference it does not have.
