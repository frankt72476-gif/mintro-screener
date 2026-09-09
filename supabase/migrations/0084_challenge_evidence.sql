-- 0084 — a bot-protection interstitial is a kind of evidence (D-264)
--
-- `evidence.kind` has been checked against a fixed list since 0006. `ArtifactKind` in the engine
-- has since grown past that list twice, and this migration catches the column up with both.
--
-- ## `challenge`
--
-- The crawl now tells a bot-protection interstitial apart from a page, and stores it. Storing it
-- is not optional: the run has to record what happened, and a `not_evaluable` finding that says
-- the page was not seen has to evidence why (hard constraint 3). What the separate kind buys is
-- that nothing downstream can pick it up as a page — `evaluationRun` selects the documents a draft
-- reasons over with `kind = 'dom'`, and the nine interstitials of run 0003c814 were `dom`.
--
-- ## `coa`
--
-- Added at the same time because the column would refuse it. `ArtifactKind` has carried `coa`
-- since the certificate fetch was built, `coa.ts` produces artifacts with that kind, and
-- `persist.ts` inserts `artifact.kind` straight into this column — so the first run that reached a
-- certificate would have failed its evidence insert, thrown out of `writeRunContents`, and left
-- the run marked `failed` with no clue that a check constraint was the cause.
--
-- **It has not happened yet.** Production holds 549 `dom`, 304 `screenshot`, 115 `sitemap` and 32
-- `robots` rows, and no `coa` row, so nothing existing violates this and nothing needs repairing.
-- It is latent rather than live, and it is fixed here rather than left for the run that finds it.
--
-- ## Widening a check over existing rows
--
-- This only ever admits values, so no existing row can be made to violate it and the constraint
-- needs no accompanying `UPDATE`. That is the opposite of the case CLAUDE.md warns about, and it
-- is stated rather than assumed: the counts above were read from production before writing this.

alter table public.evidence
  drop constraint evidence_kind_check;

alter table public.evidence
  add constraint evidence_kind_check
  check (kind in ('robots', 'sitemap', 'screenshot', 'dom', 'coa', 'challenge'));

comment on column public.evidence.kind is
  'What the stored bytes are. `challenge` is a bot-protection interstitial served where a page was asked for: retained as the record of what happened, and deliberately not `dom`, so no reader can take it for the merchant''s page (D-264).';
