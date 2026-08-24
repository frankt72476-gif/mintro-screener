-- 0029 — a send that was refused is still a send
--
-- 0028 recorded who was sent what and when, and had nowhere to say the provider turned it down.
-- That is the easy half of the question. "We tried to send this report to the underwriter and
-- Resend rejected it" is precisely the fact a dispute turns on, and a log that only records
-- successes answers the half nobody asks about.
--
-- Site Check's `sends` table has carried this since 0007 for the same reason. The gap here was
-- mine: 0028 was written before the send path existed, from the shape of the happy case.
--
-- `mailer` already distinguishes a real send from a dry run, which is a different axis and stays.
-- A dry-run send can be accepted (it composed) and a real send can be rejected; the two columns
-- are not redundant and collapsing them would lose one of the two facts.

alter table public.document_report_sends
  add column outcome text not null default 'accepted'
    check (outcome in ('accepted', 'rejected')),
  add column error text;

-- The default exists only to add the column to a table that already has rows. Every write after
-- this states the outcome, and leaving a default would let a failed send record itself as accepted
-- by omission — which is the exact failure this migration exists to prevent.
alter table public.document_report_sends alter column outcome drop default;

-- An error belongs to a rejection and only to a rejection. A rejected send with no reason recorded
-- is a row that says something went wrong and refuses to say what.
alter table public.document_report_sends
  add constraint error_belongs_to_a_rejection
  check ((outcome = 'rejected') = (error is not null));

comment on column public.document_report_sends.outcome is
  'Whether the provider accepted it. Rejections are recorded, not dropped: sending is never '
  'blocked (D-001), so this log is the only record of what went out and what did not.';
