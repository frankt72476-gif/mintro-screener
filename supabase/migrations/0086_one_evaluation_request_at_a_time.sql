-- 0086 — one evaluation request per run at a time (D-269)
--
-- Run `2f39223a` finished at 03:05:30 on 2026-09-10 and acquired **two** rows in
-- `evaluation_requests` six seconds apart: `d7f8d569` claimed and running, `3a5be521` queued behind
-- it. The second is a second draft generation of the same run — a browser call, the stored DOM of
-- every sampled page and a vendor charge — producing a document that overwrites the first.
--
-- ## Why the index and not only the screen
--
-- The button that produced it flips a local `regenerating` flag true for the duration of one
-- insert and false again as soon as it returns. It reflected nothing about the queue, so a second
-- click a second later was a second row. That is fixed on the screen too, and the screen is not
-- where this belongs:
--
--   - two operators on the same run are two browsers, and neither sees the other's local flag;
--   - a retry, a double submit, or a reload mid-request are all one browser doing it twice;
--   - the queue is drained by a worker that has no idea a screen exists.
--
-- A partial unique index is the only form of this that no path can get around, including the
-- worker's own re-queue and anything written later. The screen's job is to explain the refusal
-- before it happens, not to be the refusal.
--
-- ## Scoped to the states that are actually in flight
--
-- `queued` and `running` only. A run may be regenerated any number of times over its life — that is
-- what the button is for — so `done` and `failed` rows must not block a new request. The index says
-- exactly *one outstanding request per run*, which is the real constraint and not a limit on how
-- often a run may be evaluated.
--
-- ## Existing rows
--
-- Production holds one violating pair right now, both for run `2f39223a`. A unique index cannot be
-- created over it, so the older claim is left alone and the **queued** duplicate is cancelled
-- first: it has never been claimed, no work has been done for it, and its request is satisfied by
-- the running one. Nothing that has been claimed is touched.
--
-- `failed` rather than deleted, with a reason on it, because a row a person created is a record of
-- them asking (D-002's reasoning, one table over) and a queue row that vanishes is a request nobody
-- can account for.

update public.evaluation_requests as duplicate
   set status = 'failed',
       error = 'superseded: another evaluation request for this run was already in flight (0086)',
       finished_at = now()
 where duplicate.status in ('queued', 'running')
   and exists (
     select 1
       from public.evaluation_requests as earlier
      where earlier.run_id = duplicate.run_id
        and earlier.status in ('queued', 'running')
        and (earlier.created_at, earlier.id) < (duplicate.created_at, duplicate.id)
   );

create unique index evaluation_requests_one_in_flight_per_run
    on public.evaluation_requests (run_id)
 where status in ('queued', 'running');

comment on index public.evaluation_requests_one_in_flight_per_run is
  'One outstanding evaluation request per run (D-269). Scoped to queued and running so a run can still be regenerated any number of times; what it forbids is a second generation of the same run while one is in flight.';
