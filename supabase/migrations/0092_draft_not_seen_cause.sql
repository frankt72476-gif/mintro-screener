-- 0092 — a storefront-not-seen draft may name why, where the screen has to branch on it (D-291)
--
-- 0077 gave a refused generation its own status, `run_did_not_see_storefront`, and its reason went
-- into `validator_message` as a sentence. That was enough while every refusal had the same repair:
-- re-scan. Three do not. Run dd48f232 (app.thepeptide.com, 2026-10-08) sent every anonymous request
-- to `/login`; a re-scan meets the same page. A consent gate the crawler does not attest through,
-- and bot protection that answered the crawl, are met again the same way — their own messages say
-- so. The screen cannot tell those refusals from a text collapse without parsing the prose it shows.
--
-- So the cause is a column, naming the three a re-screen cannot get past: `sign_in_wall`,
-- `consent_gate`, `bot_challenge`. Null is every other refusal — a text collapse, an unserved
-- catalogue — and every other status.
--
-- ## Existing rows
--
-- No back-fill. Existing refusals whose message came from the consent-gate or bot-challenge branch
-- keep a null cause: the column records what the generator named when it wrote the row, and those
-- rows were written before it named anything. The column is nullable and every existing row takes
-- null, which satisfies both checks below by construction — the cause check allows null, and the
-- pairing check only constrains a non-null cause. No existing row can violate either.

alter table public.evaluation_drafts
  add column not_seen_cause text;

alter table public.evaluation_drafts
  add constraint evaluation_drafts_not_seen_cause_check
  check (not_seen_cause is null or not_seen_cause in ('sign_in_wall', 'consent_gate', 'bot_challenge'));

-- A cause belongs to a refusal and to nothing else.
alter table public.evaluation_drafts
  add constraint evaluation_drafts_cause_is_a_refusal
  check (not_seen_cause is null or validator_status = 'run_did_not_see_storefront');

comment on column public.evaluation_drafts.not_seen_cause is
  'Why the storefront was not seen, for the refusals a re-screen cannot get past: sign_in_wall, '
  'consent_gate, bot_challenge. Null on every other refusal and every other status (D-291).';
