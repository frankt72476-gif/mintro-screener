-- 0042 — validate `finished_exports_are_fetchable` (D-130, P6)
--
-- `0041` added it `not valid` because the test project held rows from the run that found the defect
-- — `done`, an archive staged, and no way to fetch it. Those rows have since been discarded through
-- the real path: the archives were removed and the rows record that they went.
--
-- So the constraint can be validated, and should be. **A `not valid` constraint on a table with no
-- violations reads as weaker than it is**: `convalidated = false` says "Postgres has not checked
-- the existing rows", which invites the reader to wonder which ones are exempt. None are.
--
-- Validation takes a `SHARE UPDATE EXCLUSIVE` lock and scans the table. Both tables are small and
-- production's is empty.
--
-- ## One thing this leaves behind, worth knowing before the next constraint
--
-- A row that violates a `not valid` constraint **cannot be repaired one column at a time**. The
-- check runs against the finished row on every update, so setting `discard_requested_at` alone was
-- refused, and the only way out was to set both discard columns in a single statement. A row can
-- get stuck in a state no ordinary path can leave.
--
-- That is not an argument against `not valid` — it is an argument for either fixing the rows or
-- accepting they are frozen, before adding one.

alter table public.document_export_requests
  validate constraint finished_exports_are_fetchable;
