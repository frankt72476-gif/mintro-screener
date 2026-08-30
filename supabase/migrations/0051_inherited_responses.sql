-- 0051 — a merchant's answers carry forward to a re-screen (D-204)
--
-- `docs/inheritance-spec.md`. An agent re-screens a domain and the merchant redoes nineteen
-- questions and every comment they wrote. That is rework the merchant did not cause.
--
-- ## This reverses D-046, and the reversal is the point
--
-- D-046 froze commentary with its run: *"a packing-slip explanation given in August is not evidence
-- about a January re-scan. Carrying it forward would make a stale statement look current."*
--
-- **Right about the risk, wrong about the remedy.** It prevented a stale statement from looking
-- current by preventing the statement from appearing at all — and the cost of that lands on the one
-- party in this system who is doing unpaid work. Visible provenance solves the same risk: every
-- carried-forward response renders with its original date and the run it came from, on every
-- surface, and never counts as answered on this screening (§5). Nothing is silently promoted, which
-- is what D-046 was actually protecting.
--
-- ## Copy, not join
--
-- Each run keeps its own complete rows. A stored run still says what it said (D-002), the merchant
-- edits an inherited row through the ordinary write path rather than a special one, and a report
-- rendered later reads one place.

-- ── The provenance, on both tables ─────────────────────────────────────────────────────────────
--
-- Two columns, and they are set or null together. One without the other is a response whose
-- provenance is half known, which is worse than one with none: a reader would see "inherited" and
-- have no date to weigh it by, or a date with nothing saying it belongs to another screening.

alter table public.merchant_attestations
  add column inherited_from_run     uuid references public.runs (id) on delete restrict,
  add column originally_answered_at timestamptz,
  add constraint attestation_provenance_is_whole
    check ((inherited_from_run is null) = (originally_answered_at is null));

alter table public.merchant_comments
  add column inherited_from_run     uuid references public.runs (id) on delete restrict,
  add column originally_answered_at timestamptz,
  /*
    The observation the merchant was answering, as it read when they answered it (D-204, §3).

    A comment inherits by rule id, and on a re-screen the same rule can produce a different
    observation — more matches, fewer, a different page. Their words would then sit under something
    they never saw, presented as a reply to it.

    Stored on the row rather than resolved by joining back to the source run's report, for the
    reason the whole design copies rather than joins: the row is self-contained, and a run rendered
    later reads one place. Null on a comment written on this run, which is answering what is in
    front of it.
  */
  add column commented_on           text,
  add constraint comment_provenance_is_whole
    check ((inherited_from_run is null) = (originally_answered_at is null));

comment on column public.merchant_attestations.inherited_from_run is
  'The run this answer was first given on, where it was carried forward. Null means it was given '
  'on this run (D-204).';
comment on column public.merchant_comments.inherited_from_run is
  'The run this comment was first written on, where it was carried forward (D-204).';

create index merchant_attestations_inherited_idx
  on public.merchant_attestations (run_id) where inherited_from_run is not null;
create index merchant_comments_inherited_idx
  on public.merchant_comments (run_id) where inherited_from_run is not null;

/*
  ── What `visit_id` holds on an inherited row ────────────────────────────────────────────────────

  **The original visit.** Not a new one, and not null.

  The column is `not null references comment_visits`, and an inherited row has no visit on this run
  — the merchant has not opened it yet. Three options were available and two are wrong:

  - A new visit on this run would be a fabricated event: a record saying somebody identified
    themselves and wrote this, on a run they have not opened. That is the class of defect this
    project exists to refuse.
  - Making the column nullable would lose the link between the words and the moment they were
    written, on exactly the rows where that link matters most.

  So the row points at the visit where the words were actually written, which is what provenance
  means, and `identified_as` is copied beside it as it always is. The visit belongs to a link on
  another run; nothing reads it as run-scoped — `readRunCommentary` scopes visits by run for the
  participation record and takes attribution from the comment row itself (D-063).
*/

-- ── The copy ───────────────────────────────────────────────────────────────────────────────────
--
-- Called once, when a link is issued. A run never invited inherits nothing, because nothing was
-- asked of anyone.
--
-- `security definer` and revoked from every browser role: this writes merchant statements, and the
-- only caller is the worker's invitation job.

create or replace function public.inherit_responses_for_link(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link        public.comment_links;
  v_merchant    uuid;
  v_rules       text[];
  v_attestations integer := 0;
  v_comments    integer := 0;
begin
  select * into v_link from public.comment_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'no such comment link';
  end if;

  select r.merchant_id into v_merchant from public.runs r where r.id = v_link.run_id;

  /*
    Which rules produced a finding on this run.

    A comment inherits only where there is something for it to attach to. Where the rule now passes
    or could not be evaluated, the comment is not copied — a merchant's explanation of a finding
    that no longer exists has nothing to sit under, and rendering it would invent a finding.

    Read from the stored report's `strip`, which is every rule the run rendered, rather than from
    `findings` — one derivation, and it is the one the report itself uses.
  */
  select coalesce(array_agg(distinct value->>'ruleId'), '{}')
    into v_rules
  from public.runs r,
       lateral jsonb_array_elements(coalesce(r.report->'strip', '[]'::jsonb)) as value
  where r.id = v_link.run_id;

  /*
    ── Attestations ───────────────────────────────────────────────────────────────────────────────

    The most recent answer per question across every earlier run of this merchant. The nineteen
    questions are about the business, not about the crawl: *do you maintain a permanent ban list*
    does not change because we re-crawled with a login.

    Latest wins and earlier ones are not consulted — a superseded answer is already visible on the
    run it was given on, and carrying a history forward would put a merchant's corrections in front
    of an underwriter as though they were current alternatives.

    `on conflict do nothing` is not available here (no unique key), so the insert excludes questions
    this run already holds. Issuing a second invitation must not duplicate what the first carried.
  */
  with latest as (
    select distinct on (a.question_id)
           a.question_id, a.outcome, a.body, a.identified_as, a.visit_id,
           a.run_id as source_run,
           coalesce(a.originally_answered_at, a.submitted_at) as first_at
    from public.merchant_attestations a
    join public.runs r on r.id = a.run_id
    where r.merchant_id = v_merchant
      and a.run_id <> v_link.run_id
    order by a.question_id, a.submitted_at desc, a.id desc
  )
  insert into public.merchant_attestations
    (run_id, link_id, question_id, visit_id, identified_as, outcome, body,
     inherited_from_run, originally_answered_at)
  select v_link.run_id, v_link.id, l.question_id, l.visit_id, l.identified_as, l.outcome, l.body,
         l.source_run, l.first_at
  from latest l
  where not exists (
    select 1 from public.merchant_attestations existing
    where existing.run_id = v_link.run_id and existing.question_id = l.question_id
  );
  get diagnostics v_attestations = row_count;

  /*
    ── Comments ───────────────────────────────────────────────────────────────────────────────────

    By rule id and ordinal, where this run rendered that rule. Subject comments — the eye test —
    inherit unconditionally, because a subject is about the storefront rather than about a finding
    and there is no rule for it to attach to. See the spec's §3a for why the eye test always carries
    a changed-read line.
  */
  with latest as (
    select distinct on (c.rule_id, c.ordinal, c.subject)
           c.rule_id, c.ordinal, c.subject, c.body, c.identified_as, c.visit_id,
           c.run_id as source_run,
           coalesce(c.originally_answered_at, c.submitted_at) as first_at,
           /*
             What that rule said on the run this comment was written on.

             `coalesce` keeps an already-inherited comment pointing at the observation it was
             *originally* written about, rather than at whatever the run it passed through said.
             Two hops must not quietly relabel what a merchant was answering.
           */
           coalesce(
             c.commented_on,
             (select f->>'note'
                from jsonb_array_elements(coalesce(r.report->'categories', '[]'::jsonb)) cat,
                     jsonb_array_elements(coalesce(cat->'findings', '[]'::jsonb)) f
               where f->>'ruleId' = c.rule_id
               limit 1)
           ) as observed_then
    from public.merchant_comments c
    join public.runs r on r.id = c.run_id
    where r.merchant_id = v_merchant
      and c.run_id <> v_link.run_id
    order by c.rule_id, c.ordinal, c.subject, c.submitted_at desc, c.id desc
  )
  insert into public.merchant_comments
    (run_id, link_id, rule_id, ordinal, subject, visit_id, identified_as, body,
     inherited_from_run, originally_answered_at, commented_on)
  select v_link.run_id, v_link.id, l.rule_id, l.ordinal, l.subject, l.visit_id, l.identified_as,
         l.body, l.source_run, l.first_at, l.observed_then
  from latest l
  where (l.subject is not null or l.rule_id = any (v_rules))
    and not exists (
      select 1 from public.merchant_comments existing
      where existing.run_id = v_link.run_id
        and existing.rule_id is not distinct from l.rule_id
        and existing.ordinal is not distinct from l.ordinal
        and existing.subject is not distinct from l.subject
    );
  get diagnostics v_comments = row_count;

  return jsonb_build_object('attestations', v_attestations, 'comments', v_comments);
end;
$$;

comment on function public.inherit_responses_for_link is
  'Copies a merchant''s most recent answers and comments from earlier runs of the same domain into '
  'the run this link belongs to, marked with their provenance (D-204). Called once, at invitation.';

revoke all on function public.inherit_responses_for_link(uuid) from public, anon, authenticated;

/*
  ── Editing clears the marks ───────────────────────────────────────────────────────────────────

  An inherited row is editable like any other, and editing makes it theirs: the write path already
  appends a new row rather than updating one, and a new row carries no provenance columns. So this
  needs no code — it is a property of append-only storage, and it is asserted in the schema tests
  rather than left as a happy accident.
*/
