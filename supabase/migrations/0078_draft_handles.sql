-- 0078 — the handle mapping a draft was written against (D-260)
--
-- The draft generator gives the model short handles — `F12`, `E7`, `Y3`, `A5` — in place of finding
-- uuids, 112-character evidence keys, eye-test item ids and angle ids. The answer comes back citing
-- handles and is decoded to real ids before anything is judged or stored.
--
-- ## Why the mapping is stored rather than recomputed
--
-- It could be rebuilt from the run: handles are assigned from the run's ids sorted, so the same run
-- yields the same handles. That is exactly why storing it matters. **Re-scanning a merchant creates
-- a new run with new finding ids** (D-002), and a mapping recomputed later against a different set
-- would silently re-point every citation in a draft an operator is part-way through editing. The
-- draft would still read as valid and would be about other evidence.
--
-- A draft is also read by a person: an operator returning to it hours later, and whoever reviews the
-- published version afterwards. `F12` is unreadable without the key beside it.
--
-- Nullable, because a draft that never reached the model has no mapping to record — a run refused by
-- the storefront-not-seen guard (0077) is written with no handles, correctly.

alter table public.evaluation_drafts
  add column handles jsonb;

comment on column public.evaluation_drafts.handles is
  'Handle to real id, per citation kind: {finding:{F1:<uuid>},evidence:{E1:<key>},eye_test:{},angle:{}}. '
  'Stored rather than recomputed: a re-scan changes the ids, and a rebuilt mapping would re-point '
  'every citation in a draft somebody is editing. Null when no prompt was ever sent.';
