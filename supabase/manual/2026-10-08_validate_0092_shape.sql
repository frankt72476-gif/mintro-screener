-- Read-only. Run on the TEST copy after 0092 is applied to it (D-291).
--
-- Expected:
--   first result:  rows and refusals equal to the count taken before 0092; with_cause = 0
--   second result: two rows, both convalidated = t
--     evaluation_drafts_cause_is_a_refusal
--       CHECK (((not_seen_cause IS NULL) OR (validator_status = 'run_did_not_see_storefront'::text)))
--     evaluation_drafts_not_seen_cause_check
--       CHECK (((not_seen_cause IS NULL) OR (not_seen_cause = ANY (ARRAY['sign_in_wall'::text, 'consent_gate'::text, 'bot_challenge'::text]))))

select count(*) as rows,
       count(*) filter (where validator_status = 'run_did_not_see_storefront') as refusals,
       count(*) filter (where not_seen_cause is not null) as with_cause
from public.evaluation_drafts;

select conname, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.evaluation_drafts'::regclass
  and conname in ('evaluation_drafts_not_seen_cause_check', 'evaluation_drafts_cause_is_a_refusal')
order by conname;
