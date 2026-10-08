-- The TEST copy only, after 0092 (D-291). Writes nothing: everything runs inside one transaction
-- that is rolled back at the end.
--
-- Run with psql so the NOTICE lines are shown. Expected, in this order:
--   NOTICE:  refusal accepts a cause: ok
--   NOTICE:  unknown cause refused: ok
--   NOTICE:  non-refusal refuses a cause: ok          (or: no non-refusal row to test)
--   ROLLBACK
-- Any line beginning UNEXPECTED is a failure of 0092. An error raised by a trigger rather than a
-- check_violation is the trigger's, not 0092's; the shape check is the constraint check of record.

begin;

do $$
declare
  refusal_run uuid;
  other_run uuid;
begin
  select run_id into refusal_run
  from public.evaluation_drafts
  where validator_status = 'run_did_not_see_storefront'
  limit 1;

  select run_id into other_run
  from public.evaluation_drafts
  where validator_status <> 'run_did_not_see_storefront'
  limit 1;

  if refusal_run is null then
    raise notice 'UNEXPECTED: no refusal row to test; the copy is not production''s';
    return;
  end if;

  update public.evaluation_drafts set not_seen_cause = 'bot_challenge' where run_id = refusal_run;
  raise notice 'refusal accepts a cause: ok';

  begin
    update public.evaluation_drafts set not_seen_cause = 'text_collapse' where run_id = refusal_run;
    raise notice 'UNEXPECTED: unknown cause accepted';
  exception when check_violation then
    raise notice 'unknown cause refused: ok';
  end;

  if other_run is null then
    raise notice 'no non-refusal row to test';
  else
    begin
      update public.evaluation_drafts set not_seen_cause = 'sign_in_wall' where run_id = other_run;
      raise notice 'UNEXPECTED: cause accepted on a non-refusal';
    exception when check_violation then
      raise notice 'non-refusal refuses a cause: ok';
    end;
  end if;
end $$;

rollback;
