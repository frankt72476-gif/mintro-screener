-- ================================================================================================
-- 0064 — the recorder pin covers UPDATE, as a backstop rather than as the gate
-- ================================================================================================
--
-- `reject_self_promotion` (0058) does not trust the revoke on `analysts`: it refuses a change to
-- the governing columns whatever privileges the session has been given since. This applies the
-- same posture to the recorder pin.
--
-- ## What is actually holding today, and why this is still worth adding
--
-- Both tables already refuse every UPDATE outright. `merchant_comments_is_append_only` (0016) and
-- `merchant_attestations_is_append_only` (0044) run `reject_mutation()` `before update or delete`,
-- and Postgres fires BEFORE row triggers in name order — `..._is_append_only` sorts before
-- `..._recorder_is_pinned`, so the append-only trigger raises first and the pin is never reached.
--
-- So on the schema as it stands, the clause added here **cannot fire**. That is stated plainly
-- rather than dressed up: this is not the control that stops an operator rewriting an attribution
-- today, and anyone reading it should know which trigger is doing that work.
--
-- It earns its place as the layer underneath. Append-only is a property of these two tables that a
-- future migration could relax — a correction path for a mistyped answer, a merge, a repair script
-- — and the day someone drops or narrows `..._is_append_only`, the question "may an operator
-- repoint a row at a colleague's address" would go back to having no answer at all. The pin then
-- answers it without anyone remembering to re-derive it. Same argument as 0058's, one level up:
-- there the guard does not trust a revoke, here it does not trust another trigger.
--
-- ## The two skips hold on UPDATE for the same reasons they hold on INSERT
--
-- The function is unchanged. It reads `new`, which on an UPDATE is the row as it will be, so:
--
--   * an inherited row still skips, and must — `inherit_responses_for_link` copies the address
--     forward and D-002 keeps it as written, so re-processing an inherited row after the recording
--     analyst's address changed must not trip the pin;
--   * a null address still defers to `comment_recorder_is_whole` / `attestation_recorder_is_whole`,
--     which are the constraints that answer for an incomplete row.
--
-- Both are asserted on the UPDATE path directly rather than inferred from the INSERT tests, in
-- `apps/worker/test/schema/recorderPinning.test.ts`.

drop trigger merchant_comments_recorder_is_pinned on public.merchant_comments;
create trigger merchant_comments_recorder_is_pinned
  before insert or update on public.merchant_comments
  for each row execute function public.recorder_email_matches_the_recorder();

drop trigger merchant_attestations_recorder_is_pinned on public.merchant_attestations;
create trigger merchant_attestations_recorder_is_pinned
  before insert or update on public.merchant_attestations
  for each row execute function public.recorder_email_matches_the_recorder();
