-- 0089 — A run's referral policy version is tied to its vertical (D-287)
--
-- 0088 added `runs.vertical` and a nullable `runs.referral_policy_version`. Which runs carry a
-- policy version was then a property of the one writer that sets it (`runRowFor` in
-- `apps/worker/src/store/persist.ts`, which stamps from `referralPolicyVersion(vertical)`), and of
-- nothing else. A second writer, a script or a hand-written insert could record a peptide run as
-- screened under the adult AI referral policy, or an adult AI run as screened under none, and the
-- schema would accept both.
--
-- The rule is one sentence and now lives in the schema: a peptide run has no referral policy; an adult
-- AI run always names the version it was screened under.
--
-- ## Existing rows
--
-- Every run before 0088 is `peptides` (0088's column default) with a null policy version (the column
-- was added nullable with no default), so every existing row satisfies the constraint and no `UPDATE`
-- is needed before it. Adding a check constraint validates rows by reading them; it fires no row
-- trigger, so `runs_are_immutable_once_finished` (0004) is untouched.
-- `apps/worker/test/schema/runVertical.test.ts` applies 0088 and this migration over a database that
-- already holds a finished run.

alter table public.runs
  add constraint runs_referral_policy_matches_vertical check (
    (vertical = 'peptides' and referral_policy_version is null)
    or (vertical = 'adult_ai' and referral_policy_version is not null)
  );
