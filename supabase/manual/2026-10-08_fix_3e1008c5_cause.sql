-- One-row correction, after 0092 (D-291). Production only, once. Not a migration.
--
-- Run 3e1008c5-6599-4ab4-882d-8f566ac96508 (written 2026-10-07 13:52 UTC) was refused by the
-- bot-challenge branch of `storefrontNotSeen`: its stored message begins "This run did not see the
-- storefront: the site's bot protection answered 1 of the pages it rendered." It was written before
-- 0092 existed, so its `not_seen_cause` is null, and the editor would show it the Re-screen prompt
-- that its own message says cannot help.
--
-- This names the cause on that one row. It is the only existing refusal from the consent-gate or
-- bot-challenge branch (checked read-only, 2026-10-08). A whole-table back-fill remains off.
--
-- Guarded so it can only touch the row it is for, and only once: a second run updates 0 rows.
-- Expected: "UPDATE 1" the first time, then one row from the SELECT with
-- not_seen_cause = bot_challenge.

update public.evaluation_drafts
set not_seen_cause = 'bot_challenge'
where run_id = '3e1008c5-6599-4ab4-882d-8f566ac96508'
  and validator_status = 'run_did_not_see_storefront'
  and not_seen_cause is null;

select run_id, validator_status, not_seen_cause, left(validator_message, 80) as message_begins
from public.evaluation_drafts
where run_id = '3e1008c5-6599-4ab4-882d-8f566ac96508';
