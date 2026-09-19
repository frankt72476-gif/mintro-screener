-- 0090 — Declared segments, and the referral policy's result on the run (D-287, cluster 2)
--
-- ## Segments
--
-- For an adult AI scan the analyst places the product in one or more of the categories of
-- `docs/adult-ai-screener-design.md` section 3.1, or says they do not know. The declaration is stored
-- on the request and carried to the run exactly as the vertical is (0088): read off the request at
-- claim time, written on the run the worker opens, never re-derived afterwards. The ids are the ones
-- `rules/referral-policy-adult-ai.json` lists, and `referralPolicy.test.ts` holds the two lists equal.
--
-- A peptide request or run declares none, and the constraints say so.
--
-- ## The referral policy's result
--
-- At completion an adult AI run records whether Mintro's referral policy lets it proceed
-- (`proceeds`) or not (`not_referred`), with the reasons naming the policy line and what triggered it.
-- It is written in the same update that finishes the run, while the run is still open, so
-- `runs_are_immutable_once_finished` (0004) is untouched. It is never a finding and never a verdict:
-- it is rendered once, in the report's boundary section, as the sentence `referralPolicyLine` builds.
--
-- `not_referred` always names why. A peptide run carries neither a status nor reasons, which the same
-- constraint as 0089's states for this pair.
--
-- ## Existing rows
--
-- Every run and request before this is a peptide one: `segments` defaults to empty, the status is
-- null and the reasons empty, so every existing row satisfies every constraint and no `UPDATE` is
-- needed. `apps/worker/test/schema/runVertical.test.ts` applies 0088, 0089 and this migration over a
-- database that already holds a finished run.

alter table public.scan_requests
  add column segments text[] not null default '{}'
    constraint scan_requests_segments_check
      check (segments <@ array['1','2','3','4','5','6','7','8','9','10','11','unknown']::text[]);

alter table public.scan_requests
  add constraint scan_requests_segments_match_vertical
    check (vertical = 'adult_ai' or cardinality(segments) = 0);

comment on column public.scan_requests.segments is
  'The categories an adult AI scan was declared under (design memo 3.1), or unknown. Empty for peptides.';

alter table public.runs
  add column segments text[] not null default '{}'
    constraint runs_segments_check
      check (segments <@ array['1','2','3','4','5','6','7','8','9','10','11','unknown']::text[]);

alter table public.runs
  add column referral_status text
    constraint runs_referral_status_check check (referral_status in ('proceeds', 'not_referred'));

alter table public.runs
  add column referral_reasons text[] not null default '{}';

alter table public.runs
  add constraint runs_referral_matches_vertical check (
    vertical = 'adult_ai'
    or (referral_status is null and cardinality(referral_reasons) = 0 and cardinality(segments) = 0)
  );

alter table public.runs
  add constraint runs_not_referred_says_why check (
    referral_status is distinct from 'not_referred' or cardinality(referral_reasons) > 0
  );

comment on column public.runs.segments is
  'The categories this adult AI run was declared under, carried from its scan request. Empty for peptides.';
comment on column public.runs.referral_status is
  'Mintro''s referral policy applied at intake (D-287): proceeds or not_referred. Never a finding. Null for peptides.';
comment on column public.runs.referral_reasons is
  'The policy line and the rule ids or declarations that decided referral_status.';
