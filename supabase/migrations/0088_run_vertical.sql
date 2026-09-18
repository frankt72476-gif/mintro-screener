-- 0088 — A run belongs to a vertical (D-284)
--
-- A second screener vertical (adult AI, `docs/adult-ai-screener-design.md`) runs on the same
-- crawler, runs, capture and send path as the peptide screener, against its own rule set. Which
-- rule set a run was screened against has to be a fact recorded on the run: `ruleset_version` is a
-- version string only, and two rule set files may carry overlapping versions
-- (`docs/discovery-adult-ai-vertical.md`, item 1).
--
-- ## Carried from the request, as `org_id` is
--
-- The requester chooses the vertical when they queue a scan; the worker reads it off the request at
-- claim time and writes it onto the run it opens — the same arrangement 0060 made for `org_id`, which
-- is read through the claim select in `claimNext` and passed through `persistRun` to `insertRun`
-- (`apps/worker/bin/worker.ts`, `apps/worker/src/store/persist.ts`). A run's vertical is a fact about the run
-- at the time it was made, never re-derived from anything that can change later.
--
-- ## Existing rows, and why this needs no UPDATE
--
-- Every run to date is a peptide run. `add column ... not null default 'peptides'` stores the default
-- as the column's missing value: no row is rewritten and no row trigger fires, so
-- `runs_are_immutable_once_finished` (0004) is untouched while every finished run reads `peptides`.
-- The precedent is 0060's `runs.org_id` (`0060_organizations.sql:106-164`, comment at `:113-115`).
--
-- The check constraints are added in the same statement as the column, so every existing row holds
-- the default the constraint admits. `apps/worker/test/schema/runVertical.test.ts` applies this
-- migration over a database that already holds a finished run, because an empty-table migrate cannot
-- show that (CLAUDE.md, "Constraints added over existing rows").
--
-- **The default is kept, unlike `org_id`'s.** A request or a run written without a vertical is a
-- peptide one: that is true of every writer that exists today, and it is the ruling for this column.
-- The worker still passes the request's value explicitly rather than relying on it.
--
-- ## The referral policy version
--
-- Adult AI runs stamp the Mintro Referral Policy version they were screened under (D-287). Nullable:
-- peptide runs have no referral policy. Populated from D-287's commit onward; nothing writes it here.

alter table public.scan_requests
  add column vertical text not null default 'peptides'
    constraint scan_requests_vertical_check check (vertical in ('peptides', 'adult_ai'));

comment on column public.scan_requests.vertical is
  'Which screener vertical to run (D-284). Chosen by the requester; carried onto the run by the worker.';

alter table public.runs
  add column vertical text not null default 'peptides'
    constraint runs_vertical_check check (vertical in ('peptides', 'adult_ai'));

comment on column public.runs.vertical is
  'The screener vertical this run was screened under (D-284), carried from its scan request. Selects the rule set.';

alter table public.runs
  add column referral_policy_version text;

comment on column public.runs.referral_policy_version is
  'The Mintro Referral Policy version an adult_ai run was screened under (D-287). Null on peptide runs.';
