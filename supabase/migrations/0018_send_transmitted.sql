-- 0018 — "the job failed" and "nothing was sent" are different facts
--
-- Found by the first live send, which is the only way it could have been found.
--
-- The insert into `sends` named a `merchant_domain` column that has never existed on that table
-- (the domain is reachable through `run_id`). PostgREST refused the row. By then **the message had
-- already been handed to Resend** — `sendReport` transmits and then records, because the provider's
-- message id does not exist until it has — so the outcome was: mail out, no `sends` row, and a
-- queue row reading `failed`.
--
-- The column bug is a one-line fix. The queue row is the real defect: 0017 defines `failed` as *a
-- job that never reached a mailer*, and this job reached one. An operator reading `failed` would
-- re-send, and IQwallet would receive the report twice.
--
-- This is the same shape as `comment_invites.delivery` and for the same reason. The job's outcome
-- and the message's outcome are two facts, and a schema that can only express one of them will
-- express the wrong one at exactly the moment it matters.

alter table public.send_requests
  add column transmitted boolean not null default false;

comment on column public.send_requests.transmitted is
  'Whether the provider accepted the message, recorded the moment it did — before the sends row is written. A failed job with transmitted = true means the mail went and the bookkeeping did not: do not re-send.';

/*
  A job may only be marked done if what it claims about transmission matches its outcome.

  `accepted` without `transmitted` would be a job claiming a delivery it did not make, and
  `rejected` with it would be the reverse. Both are the class of statement this schema exists to
  refuse — the same refusal as `finished_invites_have_a_link`.

  Nothing constrains a `failed` job: it may have transmitted (bookkeeping broke afterwards) or not
  (the render never produced a file), and both are real.
*/
alter table public.send_requests
  add constraint done_send_requests_agree_on_transmission check (
    status <> 'done' or (outcome = 'accepted') = transmitted
  );
