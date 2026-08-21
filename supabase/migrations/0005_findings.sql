-- 0005 — findings
--
-- The documented model in docs/ARCHITECTURE.md is explicitly a *minimum*. The Finding type has
-- grown since it was written, and the columns below carry what a finding actually holds today:
-- its evidence kind (D-012), why it was not evaluable, and the session that produced it (D-026).
--
-- Insert-only. A finding is an observation made at a point in time; editing one would change what
-- a report said after it was sent.

create table public.findings (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.runs (id) on delete restrict,
  rule_id               text not null,

  state                 text not null
                        check (state in ('fail', 'review', 'pass', 'not_evaluable')),

  note                  text not null,

  -- D-012: every finding names its evidence kind. A documentary finding must never be rendered
  -- as though a screenshot existed.
  evidence_kind         text not null check (evidence_kind in ('document', 'rendered_page')),

  -- Present for not_evaluable. Hard constraint 2: a rule that could not be observed says why.
  not_evaluable_reason  text,

  -- Flattened for querying; the full array lives in `evidence` below.
  source_url            text,
  matched_value         text,
  evidence_key          text,
  captured_at           timestamptz,

  -- The complete evidence array, including matched URLs, attempts and the session descriptor.
  evidence              jsonb not null default '[]'::jsonb,

  created_at            timestamptz not null default now(),

  -- A not_evaluable finding without a reason is the failure hard constraint 2 describes: it
  -- looks like an answer and contains none.
  constraint not_evaluable_findings_state_why check (
    state <> 'not_evaluable' or not_evaluable_reason is not null
  )
);

comment on table public.findings is
  'One observation. Insert-only: editing a finding would change what a sent report said.';
comment on column public.findings.evidence is
  'Full evidence array. Carries vault references at most — never a credential (constraint 6, D-026).';

alter table public.findings enable row level security;

create policy findings_select on public.findings
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.findings from authenticated, anon;

create trigger findings_are_append_only
  before update or delete on public.findings
  for each row execute function public.reject_mutation();

create index findings_run_idx on public.findings (run_id);
create index findings_run_state_idx on public.findings (run_id, state);
create index findings_rule_idx on public.findings (rule_id);
