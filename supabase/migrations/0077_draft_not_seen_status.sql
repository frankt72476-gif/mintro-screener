-- 0077 — a draft may record that the run never saw the storefront (D-260)
--
-- 0075 allowed three validator statuses: `ok`, `rejected`, `failed`. A fourth is needed, and it is
-- not a shade of `failed`.
--
-- Run 97bf366a captured thirty artifacts at thirty URLs with thirty distinct sha256 values, and
-- twenty-eight of them extracted to the same 677-character age-gate interstitial. Nothing about
-- that run failed: the crawl ran, the findings were made, the artifacts were stored. What did not
-- happen is that anybody saw the storefront — and a generator that sent those pages to a model
-- would get back a confident reading of a gate, in a document whose page list looks like broad
-- coverage.
--
-- `failed` would say the generation broke. It did not; it was refused, deliberately, before a
-- token was spent, and the operator's next move is to re-scan rather than to retry. Filing that
-- under the same word as a vendor outage would put two different next actions behind one status —
-- the conflation D-044 names one document down.
--
-- Widening a check constraint cannot invalidate an existing row, so this needs no backfill: every
-- row already written holds one of the original three.

alter table public.evaluation_drafts
  drop constraint evaluation_drafts_validator_status_check;

alter table public.evaluation_drafts
  add constraint evaluation_drafts_validator_status_check
  check (validator_status in ('ok', 'rejected', 'failed', 'run_did_not_see_storefront'));

comment on column public.evaluation_drafts.validator_status is
  'ok | rejected | failed | run_did_not_see_storefront. The last is not a shade of failed: the run '
  'completed and the pages it captured were one document repeated, so the generation was refused '
  'before the model was called. The operator re-scans rather than retries.';
