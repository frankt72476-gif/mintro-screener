-- 0025 — one relationship between document_versions and documents
--
-- `0021` declared two foreign keys to the same table:
--
--     document_id  uuid not null references public.documents (id)
--     foreign key (document_id, package_id) references public.documents (id, package_id)
--
-- Both are true and the second implies the first. PostgREST cannot choose between them, and
-- refuses the embed rather than guessing:
--
--     PGRST201  Could not embed because more than one relationship was found
--               for 'document_versions' and 'documents'
--
-- **The upload page could not load a package at all.** Found by running M1 against a live Supabase;
-- invisible to the PGlite tier, which exercises SQL semantics and not PostgREST's relationship
-- inference. That gap is named in `apps/worker/test/schema/README.md` and this is the first defect
-- to come through it.
--
-- ## Why the plain key goes rather than the composite
--
-- The composite is the one doing work. `document_versions.package_id` is denormalised so dedup can
-- be a unique index rather than a trigger, and the composite key is what keeps that column honest —
-- a version cannot claim a package its document does not belong to. Dropping the composite would
-- leave the denormalisation unguarded; dropping the plain key loses nothing, because
-- `(document_id, package_id)` already guarantees `document_id` references a real document.
--
-- The alternative — naming the constraint in the one query that broke — repairs one call site and
-- leaves the next author to rediscover this. The ambiguity is in the schema, so it is fixed there.

alter table public.document_versions
  drop constraint document_versions_document_id_fkey;

comment on column public.document_versions.document_id is
  'The document this version belongs to. Enforced by the composite key with package_id, which is '
  'the only foreign key to documents — a second one makes the relationship ambiguous to PostgREST.';
