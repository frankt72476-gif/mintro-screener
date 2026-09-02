-- ================================================================================================
-- 0063 — the same pin on merchant_attestations
-- ================================================================================================
--
-- 0062 pinned `recorded_by_email` to the analyst it names on `merchant_comments`. The attestations
-- table carries the identical pair of columns, was given the identical insert policy by 0053, and
-- had the identical hole: `recorded_by` is pinned to `auth.uid()` by the policy, and the address
-- beside it — the one every surface printed — was not.
--
-- One statement. `recorder_email_matches_the_recorder()` takes no table-specific argument: it reads
-- `new.recorded_by`, `new.recorded_by_email` and `new.inherited_from_run`, all four of which
-- `merchant_attestations` has carried since 0053 and 0051. Nothing about it needed to change.
--
-- ## The layering holds here too, and for the same reason
--
-- A BEFORE INSERT trigger runs ahead of a table's check constraints, so this trigger must not
-- answer for `attestation_recorder_is_whole` — the mirror of `comment_recorder_is_whole`, and the
-- constraint that refuses an operator row carrying no address at all. The function already defers
-- when `recorded_by_email` is null, which is what keeps each guard's error attributable to the
-- thing it actually checks. Asserted for this table rather than assumed from the other:
-- `apps/worker/test/schema/recorderPinning.test.ts`.

create trigger merchant_attestations_recorder_is_pinned
  before insert on public.merchant_attestations
  for each row execute function public.recorder_email_matches_the_recorder();
