-- 0026 — slot origin is the same three values everywhere (D-121)
--
-- `slots_origin_check` allowed 'template' | 'added'. The template file and the engine's
-- SlotSnapshot use 'required' | 'conditional' | 'added'. Three values onto two, so the seeding code
-- had to map, and no mapping preserved the distinction.
--
-- **`conditional` has to survive to the database.** D-081's mechanism is that a conditional slot
-- fires on structural impossibility — it is seeded because the facts make omitting it wrong, not
-- because someone chose to include it. So `conditional` on a stored row is the answer to "why is
-- this slot here?", which is exactly what gets asked when a merchant contests a request or a
-- reviewer compares two packages months later. Folded into 'template' that answer is gone, and the
-- only way back is re-deriving the template against facts that may have been edited since.
--
-- Found by the first live seeding run. Nothing in the repo had mapped a SlotDefinition to a slots
-- row before, so neither PGlite nor any fixture could have caught it.

alter table public.slots drop constraint slots_origin_check;

-- Existing rows carry 'template', and every one of them becomes 'required'.
--
-- **This is lossy and it cannot be otherwise.** 'template' collapsed 'required' and 'conditional'
-- into one value, so nothing in the row says which it was; the only route back is re-deriving the
-- template against the package's facts, and those may have been edited since. Any slot seeded
-- before this migration that was in fact conditional now reads as required, permanently.
--
-- That is the concrete form of what D-121 argues, and it is worth leaving visible here rather than
-- tidying away: a non-injective mapping is not an adapter, it is data loss with a later date on it.
update public.slots set origin = 'required' where origin = 'template';

-- 'template' is deliberately NOT retained. No row carries it — this widens a vocabulary that has
-- never been written to in production, and leaving the old value accepted would let the mapping
-- that caused this quietly persist.
alter table public.slots
  add constraint slots_origin_check
  check (origin in ('required', 'conditional', 'added'));

comment on column public.slots.origin is
  'Why this slot exists: required (the template always asks), conditional (D-081 — the facts made '
  'omitting it wrong), added (an operator named a further instance). Same three values as '
  'rules/documents.templates.json and the engine SlotSnapshot — D-121.';

-- `added_slots_are_named` is unchanged and still correct: an operator-created instance carries a
-- label, and a template-seeded one does not, whichever of the two template origins it has.

-- The column default was 'template' too. Left alone, every insert that does not name an origin
-- would write a value the new constraint rejects — which is how the whole schema suite failed the
-- moment this migration landed, and a fair warning about widening a vocabulary without moving its
-- default with it.
alter table public.slots alter column origin set default 'required';
