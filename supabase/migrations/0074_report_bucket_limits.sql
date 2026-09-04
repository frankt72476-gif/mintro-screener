-- 0074 — constrain the reports bucket to what a captured report actually is
--
-- Deferred since 0071, and deferred deliberately: the question was whether Supabase matches
-- `allowed_mime_types` against the **base** type or the **full** content-type header, and guessing
-- wrong rejects every future capture at upload.
--
-- Settled 2026-09-04 by probing the live project on a throwaway bucket, not from documentation:
--
--     allowed_mime_types = ['text/html']                 upload REJECTED
--       "mime type text/html; charset=utf-8 is not supported"
--     allowed_mime_types = ['text/html; charset=utf-8']  upload accepted
--
-- Supabase compares the whole string. The value below is therefore the exact content type the
-- uploader sends (`reportCaptureStore.ts`), character for character, and the two must move
-- together. `['text/html']` — the obvious spelling, and the one this migration would have carried
-- had it been written when it was first drafted — would have failed every capture.
--
-- ## Why constrain a bucket that only the worker writes
--
-- The bucket is public-read. Anything in it is served from a Mintro-controlled public origin, so
-- the question is not what the worker intends to write but what would be served if anything else
-- ever wrote here. A bucket that will only ever hold one kind of document should refuse the rest.

do $$
declare
  -- Must equal CAPTURE_SIZE_CEILING_BYTES in apps/worker/src/capture/document.ts. The capture
  -- refuses an oversized document before uploading; this is the backstop for a writer that does
  -- not. `apps/worker/test/schema/reportBucket.test.ts` asserts the two agree, because the same
  -- number in two places is a coincidence until something checks it.
  v_ceiling constant bigint := 41943040;  -- 40 * 1024 * 1024
begin
  if not exists (select 1 from storage.buckets where id = 'reports') then
    raise exception 'the `reports` bucket does not exist — 0071 creates it';
  end if;

  update storage.buckets
     set allowed_mime_types = array['text/html; charset=utf-8'],
         file_size_limit    = v_ceiling
   where id = 'reports';
end;
$$;
