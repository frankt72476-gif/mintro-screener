-- 0011 — a finding may only cite a capture that exists
--
-- `0006` documents `evidence.key` as `<run_id>/<layer>/<sha256>` — the artifact key, which is what
-- a finding's `evidence_key` carries. The writer stored the *storage path* instead, appending
-- `.gz` to every text artifact. Screenshots were unaffected because their path and key are the
-- same string, which is why the divergence stayed invisible: the captures anyone looked at
-- resolved fine.
--
-- The result was five runs whose findings cite robots.txt and sitemap captures that have no
-- evidence row. The objects are in the bucket and the rows are in the table; they are filed under
-- two different names and cannot be joined.
--
-- Hard constraint 3: no finding without evidence. That was being checked in application code,
-- by code that had the same blind spot as the writer. Here it becomes a schema property.
--
-- NOT VALID deliberately. It constrains every row written from now on and does not re-check the
-- rows already there. The five historical runs are frozen (D-002) and cannot be repaired, so a
-- validating constraint could not be added at all without deleting them — and the guarantee is
-- worth more than the runs. They stay as honest history of a defect.
--
-- Scope: this covers `evidence_key`, the primary capture. A finding's full `evidence` array may
-- cite several, and those are checked by `assessContents` before a run is allowed to close.

alter table public.findings
  add constraint findings_evidence_key_exists
  foreign key (evidence_key) references public.evidence (key)
  on delete restrict
  not valid;

comment on constraint findings_evidence_key_exists on public.findings is
  'A finding cites a capture that exists. NOT VALID: pre-0011 runs are immutable and cannot be repaired.';

comment on column public.evidence.key is
  'Artifact key, run-scoped: <run_id>/<layer>/<sha256>. What a finding cites. The bytes live at this key for screenshots and at <key>.gz for gzipped text — the path is derived from the key by storagePathForKey(), in one place.';
