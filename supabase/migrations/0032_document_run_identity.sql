-- 0032 — the identity a run rendered under (D-126)
--
-- The report data was already a pure function of the run: `merchantName` was a render prop, not
-- part of `DocumentsReport`, and the byte-identical tests were true of the object.
--
-- The rendered page was not. The masthead came from a live read of the merchant row, so renaming a
-- merchant changed the top of a report whose run had not changed — a sent PDF and a regenerated
-- page disagreeing while both claim the same run id, which is the failure D-002 and D-083 exist to
-- prevent, arriving through a prop instead of through the data.
--
-- D-123 made a run record the slots and documents it read. Identity is read too.
--
-- There is deliberately no `dba` column. The trading name is extracted from the application and
-- C-02 is the check that compares it; a second derivation for a masthead could disagree with the
-- check that examines names, which is what D-125 forbids.

alter table public.document_runs
  add column merchant_name text not null default '',
  add column merchant_domain text not null default '';

-- The defaults exist only to add the columns to a table that already has rows. Every write after
-- this supplies both; leaving a default would let a run record an empty masthead by omission, and
-- a report headed by nothing reads as a rendering fault rather than as missing data.
alter table public.document_runs alter column merchant_name drop default;
alter table public.document_runs alter column merchant_domain drop default;

comment on column public.document_runs.merchant_name is
  'The merchant name this run renders under, captured at run time (D-126). Read from here rather '
  'than from merchants, so a later rename cannot change the masthead of a run that did not change.';
