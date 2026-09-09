-- 0085 — a merchant's consent gate is a kind of evidence (D-266)
--
-- The second widening of `evidence.kind` in as many decisions, and the reason is the same both
-- times: the crawl learned to tell a document apart from the page it was standing in front of, and
-- the distinction is worth nothing unless it survives into storage.
--
-- ## Why not `challenge`
--
-- Because they are opposite facts about opposite parties. A challenge is a third party refusing to
-- show us the site; it says nothing about the merchant and there is no legitimate way through it.
-- A consent gate is the **merchant's own control**, and its presence is a finding in their favour:
-- GATE-001 now returns `pass` on it and cites this artifact as the evidence a gate was observed.
--
-- Filing the two under one kind would mean the capture behind a merchant's compliance credit and
-- the capture behind an obstruction were the same sort of thing, and a reader querying for one
-- would get the other.
--
-- ## Why not `dom`
--
-- `evaluationRun` selects the documents a draft reasons over with `kind = 'dom'`. Run 97bf366a
-- stored sixteen consent gates as `dom`, which is how a seven-kilobyte acknowledgement form came
-- to be evaluated as sixteen product pages.
--
-- ## Widening a check over existing rows
--
-- Admits a value and removes none, so no existing row can be made to violate it and no accompanying
-- `UPDATE` is needed. Verified against production before writing: the table holds `dom`,
-- `screenshot`, `sitemap` and `robots` only.

alter table public.evidence
  drop constraint evidence_kind_check;

alter table public.evidence
  add constraint evidence_kind_check
  check (kind in ('robots', 'sitemap', 'screenshot', 'dom', 'coa', 'challenge', 'gate'));

comment on column public.evidence.kind is
  'What the stored bytes are. `challenge` is a bot-protection interstitial served where a page was asked for (D-264). `gate` is the merchant''s own consent gate, served in the same position but by the merchant and to their credit (D-266). Neither is `dom`, so no reader can take either for the merchant''s page.';
