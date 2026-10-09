-- 0093 — when a stored login last met a second-factor step
--
-- D-293. The generic sign-in submitted a stored login, the site took the password and asked for a
-- one-time code, and the worker recorded the run as a failed sign-in: `last_login_ok = false`, which
-- the lockout guard (D-292) reads as "this password is wrong" and pauses every later attempt.
--
-- ## Why a column of its own
--
-- A code step says nothing about the password, so it is written to neither `last_login_ok` nor
-- `last_login_at` — those stay what the guard reads, and only a password outcome moves them. The
-- credential card still has to say what happened, and `credential_state` is the only thing it reads.
-- So the fact goes here, beside the outcome rather than inside it.
--
-- The card shows it while it is the latest thing known about the login: later than `updated_at` (a
-- login stored since has not met it) and than `last_login_at` where that is set. Compared, not
-- cleared: the deposit path does not write this column, so a worker running ahead of this migration
-- still records deposits — only the second-factor write fails, and it swallows its own error.
--
-- ## Over existing rows
--
-- Nullable, no default, no constraint: every existing row reads "never met a code step", which is
-- true of each of them as far as this table ever knew. Nothing here can be violated by a row already
-- present, so there is no backfill.

alter table public.credential_state
  add column last_second_factor_at timestamptz;

comment on column public.credential_state.last_second_factor_at is
  'When a scan last submitted this login and the site then asked for a second-factor code (D-293). '
  'Not a sign-in outcome: last_login_ok and last_login_at are untouched by it.';
