-- 0080 — why a draft needed a second attempt (D-260)
--
-- 0079 recorded `attempts`. The first generation under it came back `attempts: 2`, `status: ok` —
-- and nothing anywhere said what the first answer got wrong. `validator_message` holds the refusal
-- only when the *final* attempt was refused; a first attempt refused and then corrected leaves no
-- trace at all, which is the case worth reading. It is the validator working.
--
-- Every rule this generator has gained came from looking at one of those refusals. `attempts: 2` on
-- its own says a refusal happened and withholds the only part that was useful.
--
-- ## Not the same column as `validator_message`
--
-- They answer different questions and merging them would lose one. `validator_message` is why the
-- draft **in this row** is unusable — an operator reads it to decide whether to regenerate.
-- `retry_message` is why an **earlier, discarded** answer was refused, on a row whose content may be
-- perfectly good. One is about the artifact, the other about the process that produced it. Filing
-- both under one name would make a stored draft ambiguous about whether its own content was
-- refused, which is exactly what D-044 warns about one document up.
--
-- Nullable, no default, no backfill: a draft that took one attempt has no retry message, and the
-- rows written before this migration had theirs printed to a terminal and lost. Null means "none
-- recorded" in both cases, and neither is a claim that the first attempt was clean.
--
-- Only the most recent refusal is kept. `MAX_ATTEMPTS` is 2, so there is at most one; if the ceiling
-- ever rises this holds the last, and a column that silently kept only the newest of several would
-- need to say so here first.

alter table public.evaluation_drafts
  add column retry_message text;

comment on column public.evaluation_drafts.retry_message is
  'Why the previous attempt was refused, on a draft that then succeeded. Distinct from '
  'validator_message, which says why THIS row is unusable: a row can carry a good draft and a '
  'retry_message explaining what the discarded answer got wrong. Null when the draft took one '
  'attempt, and on every row written before 0080.';
