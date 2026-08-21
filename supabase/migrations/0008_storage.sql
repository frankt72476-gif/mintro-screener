-- 0008 — evidence bucket policies
--
-- The bucket already exists and is private. This governs who may reach objects in it.
--
-- Private means no object has a public URL. Analysts read captures through **short-expiry signed
-- URLs**, minted per view. A signed URL baked into a stored report would either expire and break
-- the report, or be given a long enough life to be a public URL with extra steps.

-- Belt and braces: assert the bucket is private rather than assuming it.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'evidence') then
    raise exception 'the `evidence` bucket does not exist — create it, private, before migrating';
  end if;

  if (select public from storage.buckets where id = 'evidence') then
    raise exception 'the `evidence` bucket is public. Merchant captures must not be publicly readable.';
  end if;
end;
$$;

-- Reading. An active analyst may read any object in the bucket, which is what lets the frontend
-- mint a signed URL for a screenshot.
create policy evidence_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and public.is_analyst());

-- Writing, updating and deleting are deliberately absent for `authenticated` and `anon`.
--
-- Only the worker writes evidence, via service_role. Append-only is enforced on the write path
-- in `apps/worker/src/evidenceStore.ts` (upsert: false) and by the `evidence` table's primary key
-- and trigger — an overwrite collides rather than replacing.
--
-- There is no delete policy for anyone. Application code never deletes a capture (hard
-- constraint 5); removing one is a deliberate administrative act through the dashboard, and it
-- should feel like one.
