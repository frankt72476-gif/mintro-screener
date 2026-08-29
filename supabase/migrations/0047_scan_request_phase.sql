-- 0047 — what a running scan is doing, as structure rather than prose
--
-- `scan_requests.progress` is free text the worker appends as it goes, and 0012 says exactly what
-- it is for: "so the UI can say more than 'running'". It does that and no more. The run page
-- receives whichever sentence was written last and cannot tell which phase it belongs to, cannot
-- order two of them, and cannot tell a line from Layer 1 from a line from Layer 3.
--
-- So the phase is recorded beside the sentence. The sentence stays: it is the current-state line,
-- and it says things no enum can.
--
-- ## Why these columns belong on a request and not on a run
--
-- 0012 already draws the line: "A request records that someone asked. A run records what was
-- observed. They are separate rows because they answer to different rules: a request can be
-- retried, superseded or abandoned, and a run is immutable once finished (D-002)."
--
-- Phase is bookkeeping about an attempt in flight. It is overwritten many times per run, which is
-- precisely what may never happen to a screening record — and precisely what a request row is for.
-- Nothing here reaches a report.
--
-- ## Null is the honest default, and the common case
--
-- `phase_done` and `phase_total` are nullable and are **null unless the denominator is genuinely
-- known at that moment**. Discovery cannot have one: the sitemap queue grows as index documents are
-- parsed. Sign-in cannot have one either. A bar that invents a denominator is a determination
-- rather than an observation (D-001), and it is wrong in the direction that reads as a hang.
--
-- The CHECK below is the database refusing to store half a fraction. A `done` without a `total` is
-- a numerator with nothing under it, which is exactly the shape a display would render as progress.

alter table public.scan_requests
  add column phase             text,
  add column phase_started_at  timestamptz,
  add column phase_done        integer,
  add column phase_total       integer;

comment on column public.scan_requests.phase is
  'Which stage of the crawl is running, named as screen.ts names its sections. Null before a worker claims the request.';
comment on column public.scan_requests.phase_started_at is
  'When the current phase began. Elapsed is measured from here; nothing is estimated from it.';
comment on column public.scan_requests.phase_done is
  'Units completed in this phase. Null wherever the denominator is not genuinely known.';
comment on column public.scan_requests.phase_total is
  'Units this phase will cover. Null for discovery and escalate, which have no denominator while they run.';

-- The vocabulary, closed. A phase the UI has no label for would render as a blank line, which is
-- the failure mode D-044 is about in another place: an absent value shown as an answer.
alter table public.scan_requests
  add constraint scan_requests_phase_is_known check (
    phase is null or phase in (
      'discovery', 'homepage', 'sample', 'escalate', 'surfaces', 'gate', 'assembly'
    )
  );

-- Counts are a pair or they are nothing.
alter table public.scan_requests
  add constraint scan_requests_counts_are_whole check (
    (phase_done is null and phase_total is null)
    or (phase_done is not null and phase_total is not null
        and phase_done >= 0 and phase_total > 0 and phase_done <= phase_total)
  );

-- Neither discovery nor sign-in can be counted. Enforced here rather than trusted to the writer,
-- because a count on an indeterminate phase is the one thing this model exists to refuse.
alter table public.scan_requests
  add constraint scan_requests_indeterminate_phases_are_uncounted check (
    phase is null
    or phase not in ('discovery', 'escalate')
    or (phase_done is null and phase_total is null)
  );

-- RLS is unchanged and needs no addition: `scan_requests_select` already limits reads to analysts
-- (`public.is_analyst()`), and `update`/`delete` are revoked from `authenticated` and `anon`, so the
-- worker's service role remains the only writer. Merchants and agents never see the queue and never
-- trigger a run.
