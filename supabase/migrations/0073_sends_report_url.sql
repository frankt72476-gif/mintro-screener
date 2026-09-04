-- 0073 — the send log records the link, because that is what is sent now
--
-- D-255 replaced the attached PDF with a link to an immutable HTML capture. `sends` is the only
-- record of what went out and to whom, and after that ruling what goes out is a URL. Without this
-- column the log can say a report was delivered and not say *which* report.
--
-- Nullable, and that is the point. Rows written before the ruling carried a file and no link, and
-- `sends` is append-only history: back-filling a URL onto a row that carried an attachment would
-- be inventing a fact about a send that happened.
--
-- `attachment_bytes` stays. It is `not null default 0`, so new rows record 0 without a change
-- here, and 0 beside a non-null `report_url` reads unambiguously: nothing was attached, and the
-- artifact is at that address. Dropping the column would erase the byte counts of every send that
-- did carry a file.

alter table public.sends add column if not exists report_url text;

comment on column public.sends.report_url is
  'The captured-report link this send carried (D-255). Null on sends that predate the ruling, which carried a PDF attachment instead.';
