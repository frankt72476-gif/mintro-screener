-- 0030 — the sources a finding consulted
--
-- The report shows every source behind a finding as its own row, with the differing value marked.
-- That is not derivable from the note: the note is a sentence, and re-parsing it in the renderer
-- would be the same comparison done a second time by a second piece of code, which is how two
-- places end up disagreeing about which value was the outlier.
--
-- So the check records it where the comparison happened, and the report renders what it recorded.
-- `[]` for a finding with nothing to show — a slot-level observation consults no document.
--
-- `evidence_note` is the qualification printed beneath. C-10 resolving a routing number says
-- nothing about the account; C-03 agreeing across three documents is not an IRS check. That belongs
-- beside the evidence, where the inference is available to be made, rather than in a section
-- further down that a reader may not reach.

alter table public.document_findings
  add column evidence jsonb not null default '[]'::jsonb,
  add column evidence_note text;

comment on column public.document_findings.evidence is
  'Sources consulted, [{source, value, differs}]. Recorded by the check, not derived by the '
  'renderer: `differs` is the comparison''s own answer about which value was the outlier.';
