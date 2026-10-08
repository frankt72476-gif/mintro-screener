-- Read-only. Run on PRODUCTION and on the TEST copy before 0092 is applied to the copy (D-291).
-- The two results must be identical: that is what says the copy is complete for this table.

select count(*) as rows,
       count(*) filter (where validator_status = 'run_did_not_see_storefront') as refusals
from public.evaluation_drafts;
