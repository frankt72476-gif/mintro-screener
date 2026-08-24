-- 0020 — slots
--
-- A slot is a required thing, not a file. Counts and coverage windows live here rather than one
-- slot per period (D-080): merchants combine three months into one PDF, billing cycles are not
-- calendar months, and per-period slots cannot express consecutiveness at all.
--
-- **Six states, not five.** D-078 named five; CHECK-INVENTORY §4 and the Owner Photo ID case need
-- a sixth. Where the ownership section cannot be extracted the required count is *unknown*, and a
-- slot whose count is unknown cannot honestly say anything is absent — `missing` would assert we
-- know what to chase. `not_evaluable` says we do not. Ruled 2026-08-24; see D-107.
--
-- Freshness is stored as **the rule, not a verdict** (D-109). One clock: coverage measures against
-- the run's timestamp, computed wherever it is read. A stored `fresh` boolean is right when written
-- and silently wrong afterwards, which is the defect D-047 found in another form.
--
-- The rule itself is **calendar months, not a day count** (D-113): the required month is the last
-- complete month ending on or before `run − grace`, and `required_count` months work backward from
-- there. Consecutiveness needs no column — the months are consecutive by construction.

create table public.slots (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references public.packages (id) on delete restrict,

  -- Stable key from the template. `instance_label` is null for template-seeded slots and set for
  -- operator-created instances — "state pharmacy licence" beside "city business licence", which
  -- CHECK-INVENTORY §4 asks for and a single checkbox cannot express.
  slot_key         text not null check (length(slot_key) > 0),
  instance_label   text check (instance_label is null or length(instance_label) > 0),

  -- Null means unknown, and unknown is not zero. Owner Photo ID derives its count from the
  -- application's ownership section; until that is read the count has no value, and the state
  -- is `not_evaluable` rather than `missing`.
  required_count   integer check (required_count is null or required_count >= 0),

  -- D-113's monthly coverage. When set, `required_count` is a number of consecutive calendar
  -- months rather than a bare count of documents.
  coverage_monthly boolean not null default false,
  -- Days between a cycle closing and its statement existing. **10 is a guess** — D-113 says so.
  coverage_grace_days integer check (coverage_grace_days is null or coverage_grace_days >= 0),
  expiry_after_run boolean not null default false,

  -- Where this slot came from (D-112). A template slot came from the processor's required set; an
  -- added slot came from an operator's judgement about this merchant. The two answer to different
  -- rules, so the distinction is recorded rather than inferred from whether a label happens to be
  -- present.
  origin           text not null default 'template' check (origin in ('template', 'added')),

  -- D-082. A collected-only slot reports "present, not examined" and never carries findings.
  examined         boolean not null default true,

  state            text not null default 'missing'
                   check (state in ('satisfied', 'not_provided', 'waived', 'superseded', 'missing', 'not_evaluable')),

  -- Fixed enumerations (D-079). Free text here is unreproducible — D-085 makes the report a pure
  -- function of a run, and a typed reason makes it a function of a run plus whoever was typing —
  -- and it is where "this looks fine to me" gets into a document forwarded under Mintro's name.
  reason           text check (reason is null or reason in (
                     -- not_provided: the requirement stands, the document does not exist (§5)
                     'new_business_no_processing_history',
                     'prior_processing_cash_or_check_only',
                     'prior_processor_will_not_release',
                     'account_closed_records_unavailable',
                     'does_not_exist_for_entity_type',
                     'issuing_authority_will_not_reissue',
                     'lost_or_destroyed_cannot_reissue',
                     'provided_directly_to_processor',
                     'merchant_declines',
                     -- waived: the requirement was removed (§5)
                     'processor_confirmed_not_required',
                     'not_applicable_to_entity_type',
                     'superseded_by_another_document',
                     'provided_under_prior_package'
                   )),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A reason belongs to exactly the two states that take one, and those two states require it.
  -- Without both directions a `waived` slot can carry no reason at all, which is the free-text
  -- problem wearing an empty string.
  constraint reason_present_exactly_when_the_state_takes_one check (
    (state in ('not_provided', 'waived')) = (reason is not null)
  ),
  constraint reason_matches_its_state check (
    reason is null
    or (state = 'waived') = (reason in (
      'processor_confirmed_not_required', 'not_applicable_to_entity_type',
      'superseded_by_another_document', 'provided_under_prior_package'))
  ),
  -- The sixth state exists for exactly one situation. Allowing it with a known count would let it
  -- become a general "we would rather not say", which is what `missing` is for.
  constraint not_evaluable_means_the_count_is_unknown check (
    (state = 'not_evaluable') = (required_count is null)
  ),
  constraint grace_is_set_exactly_for_monthly_slots check (
    coverage_monthly = (coverage_grace_days is not null)
  ),
  -- A named instance is always operator-added, and an added slot always carries a name. An
  -- unlabelled second Business License would render as "Business License: satisfied" on a package
  -- with two licences — §3's complaint about Additional Document, in another costume (D-112).
  constraint added_slots_are_named check ((origin = 'added') = (instance_label is not null))
);

comment on table public.slots is
  'Required documents for a package. Counts and windows (D-080); six states (D-078 as amended by D-107).';
comment on column public.slots.required_count is
  'Null means unknown, which is why the sixth state exists. Unknown is not zero and not one.';
comment on column public.slots.coverage_monthly is
  'D-113 calendar-month freshness. The rule, never a verdict — computed against the run timestamp (D-109).';
comment on column public.slots.origin is
  'template (from the processor set) or added (operator judgement about this merchant). D-112.';

alter table public.slots enable row level security;

create policy slots_select on public.slots
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.slots from authenticated, anon;

-- Slots change state; they are never deleted. Removing a slot would delete the record that a
-- requirement existed, which is the fact `not_provided` exists to preserve (D-078).
create or replace function public.reject_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'DELETE on %.% is not permitted: this record is part of a package and packages are never deleted (D-097)',
    tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.reject_delete is
  'Raises on DELETE while permitting UPDATE. For mutable records inside an undeletable package.';

create trigger slots_are_never_deleted
  before delete on public.slots
  for each row execute function public.reject_delete();

-- One row per requirement. `coalesce` because Postgres treats nulls as distinct in a unique
-- index, so a plain three-column constraint would happily seed the same template slot twice.
create unique index slots_identity_idx
  on public.slots (package_id, slot_key, coalesce(instance_label, ''));

create index slots_package_state_idx on public.slots (package_id, state);
