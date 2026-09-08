-- 0075 — the evaluation draft, the one mutable object in this schema (D-258, D-260)
--
-- Step 1 of the D-256 evaluation model. The draft is what the generator writes and the operator
-- edits; 0076 is what publishing produces and is append-only like everything else.
--
-- ## Mutable, deliberately, and bounded
--
-- This schema has 37 triggers and almost every one refuses a write. This table is the exception,
-- and the exception is argued rather than assumed: a draft is a work in progress. The operator
-- rewrites paragraphs, a regeneration replaces the row wholesale, and neither is a record of
-- anything until somebody publishes it. A draft is not a record of what Mintro said. The published
-- version is, and that one is frozen.
--
-- Three things bound it. It is never rendered outside the operator UI. It holds no evidence of its
-- own — every citation in `content` points into a run that is already immutable. And publishing
-- deletes it, so the mutable object cannot outlive the moment it stops being a draft.
--
-- ## One row per run at a time
--
-- A unique index on `run_id`, not a primary key on it: the row is replaced by a regeneration, and a
-- second draft for one run is two answers to one question with nothing saying which the operator
-- was reading. Regeneration is an upsert onto this index.
--
-- ## The run row is untouched
--
-- D-002 stands exactly as it was. `runs_are_immutable_once_finished` (0004) is not altered, the
-- append-only triggers on `findings` (0005) and `evidence` (0006) are not altered, and nothing here
-- writes to any of them. The evaluation is a separate artifact that cites into an immutable run —
-- a document about a run, stored beside it, never a column on it.

create table public.evaluation_drafts (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.runs (id) on delete restrict,

  -- Both versions, because they move for different reasons: the rule set says what was checked,
  -- the angle set says what was asked of the model. A draft that cannot name both cannot be
  -- compared with the next one.
  angles_version    text not null,
  ruleset_version   text not null,
  model             text not null,

  -- sha256 of the inputs the prompt was built from. A regenerated draft over the same run is
  -- comparable, and a draft built over changed inputs is detectable — which is the only way to
  -- tell "the model said something different" from "it was shown something different".
  input_sha256      text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),

  -- The whole EvaluationDraft: placement, legality, routing, angles, shoreUps.
  content           jsonb,

  -- What `validateDraft` said. A failed draft is stored rather than discarded: the operator is
  -- entitled to see that a generation was attempted and refused, and why. Same discipline as
  -- `eye_tests`, where an absence is an outcome rather than a null.
  validator_status  text not null
                      check (validator_status in ('ok', 'rejected', 'failed')),
  validator_message text,

  -- What the prompt could not carry. Page text is capped, so a draft reasoning over a truncated
  -- surface says so rather than reading as though it saw everything (hard constraint 3's shape,
  -- one document up).
  truncations       text[] not null default '{}',

  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  edited_by         uuid references public.analysts (id) on delete restrict,

  -- A draft that says it is ok and carries nothing is the shape every defect in this project has
  -- taken: an outcome that looks like an answer and contains none.
  constraint ok_drafts_carry_content
    check (validator_status <> 'ok' or content is not null),
  constraint refused_drafts_say_why
    check (validator_status = 'ok' or validator_message is not null),
  -- An edit is attributed or it did not happen. Two columns that must move together.
  constraint edits_are_attributed
    check ((edited_at is null) = (edited_by is null))
);

comment on table public.evaluation_drafts is
  'The AI draft an operator edits before publishing (D-258). The one deliberately mutable object '
  'in this schema: never rendered outside the operator UI, holds no evidence of its own, and is '
  'deleted when publishing copies it into public.evaluations.';
comment on column public.evaluation_drafts.input_sha256 is
  'sha256 of the prompt inputs. Makes two drafts over one run comparable and a changed input detectable.';

create unique index evaluation_drafts_one_per_run on public.evaluation_drafts (run_id);

alter table public.evaluation_drafts enable row level security;

/*
  Analysts may read it, and write nothing through the API.

  Same gate `eye_tests` carries (0049) and for the same reason: there is nothing here a leak
  compromises that reading the run does not already expose, and the writes are the worker's. The
  operator's edits go through a function in a later migration rather than a direct table grant, so
  that `edited_by` is resolved from `auth.uid()` and never from a value the client passed.
*/
create policy evaluation_drafts_select on public.evaluation_drafts
  for select to authenticated using (public.is_analyst());

revoke insert, update, delete on public.evaluation_drafts from authenticated, anon;

create index evaluation_drafts_run_idx on public.evaluation_drafts (run_id, created_at desc);
