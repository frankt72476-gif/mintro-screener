-- ================================================================================================
-- 0045 — The response round (D-143 … D-148)
-- ================================================================================================
--
-- A merchant is invited, responds, and at some point the responding is finished. This file holds
-- what "finished" means, and the shape of it is almost entirely a set of refusals.
--
-- ## Nothing here closes anything
--
-- There is no round state. No `all_in_at`, no `closed`, no status column on `runs` — D-002 forbids
-- writing to a completed run, and D-143 forbids the system deciding the round is over. **All-in is
-- computed**, at read time, from three sets: who was invited, who submitted, and who the operator
-- marked as not responding. The round closes when the operator sends the combined document to
-- IQwallet (D-148), which `sends` already records.
--
-- The one thing stored is the *notification*, not the state — `response_notices` below.
--
-- ## Nothing here is a determination
--
-- A submit event is a responder saying they are finished. A not-responding mark is an operator's
-- judgement. Neither is a fact about the merchant's compliance, neither reaches `findings`, and the
-- not-responding mark never reaches the PDF at all (D-146).

-- ------------------------------------------------------------------------------------------------
-- The invited set
-- ------------------------------------------------------------------------------------------------
--
-- **The set, not the most recent invitation** (D-144). Re-issuing an expired link adds a
-- `comment_links` row; it does not replace the earlier one, so the addresses accumulate. An agent
-- invited in March and a merchant invited in April are both invited.
--
-- Gated on `delivery = 'resend'`, which is D-064 applied one level down: a composed-but-untransmitted
-- invitation invited nobody, and an address that never received a link is not one the round is
-- waiting on. `commentaryStore.readRunCommentary` derives the same set in TypeScript for the
-- participation record; `apps/worker/test/schema/responseRound.test.ts` asserts the two agree.
--
-- Addresses are compared folded and trimmed, and returned as recorded. Nobody types their own
-- address the same way twice, and an invited set that treated `Ops@Shop.example` and
-- `ops@shop.example` as two people would leave a round permanently outstanding.

create or replace function public.invited_addresses(p_run_id uuid)
returns table (address text, invited_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lower(btrim(l.sent_to)))
         l.sent_to,
         l.issued_at
  from public.comment_links l
  join public.comment_invites i on i.link_id = l.id
  where l.run_id = p_run_id
    and i.status = 'done'
    and i.delivery = 'resend'
  order by lower(btrim(l.sent_to)), l.issued_at;
$$;

comment on function public.invited_addresses is
  'The addresses an invitation was transmitted to for one run. The set, not the latest (D-144); transmitted only (D-064).';

grant execute on function public.invited_addresses(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- Submitting
-- ------------------------------------------------------------------------------------------------
--
-- ## What a submit event is, and what it is not
--
-- It is a responder reporting their own state: *I have said what I have to say.* It is **not**
-- authentication, and it carries no more assurance than a comment does (D-144). The identity behind
-- it is self-declared and unverified, exactly as `comment_visits.identified_as` is, and nothing in
-- this file checks an address against anything but the list Mintro itself sent to.
--
-- Scoping the button to the invited set is a display convention. It is enforced server-side too,
-- for a reason that is not security: a submit event from an address nobody invited has no place in
-- the outstanding count, and would leave a round that can never reach all-in — or reach it through
-- an address the operator never asked.
--
-- ## It does not lock anything
--
-- Post-submit edits save normally. `merchant_comments` does not consult this table and cannot: the
-- page stays writable, and a response written afterwards is a response, not an amendment to a closed
-- record. Whether anything was written after the submit is *derived* at read time, never flagged on
-- the run — runs are immutable (D-002).

create table public.comment_submissions (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  link_id       uuid not null references public.comment_links (id) on delete restrict,

  -- The visit in force when they pressed it. Kept for the same reason `merchant_comments` keeps
  -- one: the event carries its own attribution rather than depending on a later join.
  visit_id      uuid not null references public.comment_visits (id) on delete restrict,
  identified_as text not null,

  /*
    The newest thing this identity had written when they pressed it (D-151).

    The watermark that makes a re-submit a real event rather than a repeat: a later press is
    recorded only when there is content newer than this. Null means they submitted having written
    nothing, which is a legitimate thing to say — *I have looked and I have nothing to add.*

    It covers **both** channels a merchant writes in, comments and attestations, because both are
    text they added and a button that re-armed for one and not the other would be lying about half
    of the page.
  */
  covers_content_at timestamptz,

  submitted_at  timestamptz not null default now()
);

comment on table public.comment_submissions is
  'A responder reporting that they are finished. Self-declared, scoped to the invited set, and it locks nothing (D-144).';

/*
  One event per identity **per state of their response** (D-151).

  This was `(run_id, folded identity)` — one submission each, ever. That made a second press a no-op,
  which was right for a repeated press and wrong for a merchant who added a paragraph and pressed
  again: the addition surfaced only as a flag in the operator's panel, which nobody is necessarily
  watching, while the page confirmed something that had not happened.

  Adding the watermark keeps the property that mattered and drops the one that did not:

    pressed twice, nothing written between   same watermark, refused, no event
    pressed again after adding a paragraph   different watermark, a new row, a notice

  Still an index rather than a check in the caller, and for the original reason: two tabs, or a slow
  network and a second press, is a race, and the race is in the database. `-infinity` because nulls
  are distinct in a unique index by default, so two submissions by someone who has written nothing
  would otherwise both be admitted.

  Keyed on the identity, not on the visit: someone who re-identifies under the same address is the
  same person continuing the same response, and a second visit row must not buy them a second event.
*/
create unique index comment_submissions_once_per_state
  on public.comment_submissions (
    run_id,
    (lower(btrim(identified_as))),
    (coalesce(covers_content_at, '-infinity'::timestamptz))
  );

create index comment_submissions_run_idx on public.comment_submissions (run_id, submitted_at);

alter table public.comment_submissions enable row level security;

create policy comment_submissions_select on public.comment_submissions
  for select to authenticated using (public.is_analyst());

-- Writes arrive only through `submit_response_round`, which proves possession of the token.
revoke insert, update, delete on public.comment_submissions from authenticated, anon;
revoke all on public.comment_submissions from anon;

create trigger comment_submissions_is_append_only
  before update or delete on public.comment_submissions
  for each row execute function public.reject_mutation();

-- ------------------------------------------------------------------------------------------------
-- "Not responding" — an operator judgement (D-145)
-- ------------------------------------------------------------------------------------------------
--
-- The operator decides an address is not going to answer. That removes it from the outstanding
-- count and can therefore complete the round.
--
-- **It is recorded as what it is.** A reason is required and there is no enumeration to pick from,
-- because the fact being recorded is *an operator concluded this, and here is why they said so* —
-- not a state the merchant is in. It never renders as a fact about the merchant, and it is on the
-- OUT list for the IQwallet PDF (D-146): the underwriter is entitled to the merchant's
-- participation, not to Mintro's internal workflow judgements about it.
--
-- ## Supersedable, and still append-only
--
-- A mistaken mark can complete a round early, and there was no way back. So a later row for the
-- same address replaces the earlier one at read time — latest wins — and `withdrawn` is how a mark
-- is taken back. Nothing is mutated and nothing is deleted: the operator view shows the current
-- mark, and the earlier one stays in the record with its reason and its author.
--
-- There is no `supersedes` column. The address is the key and the clock is the order; a chain
-- column would be a second way of saying the same thing, and the two could disagree.

create table public.response_nonresponses (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs (id) on delete restrict,

  -- One of the invited addresses. Stored as the operator saw it; compared folded and trimmed.
  address    text not null check (position('@' in address) > 1),

  /*
    Why they concluded it, in their own words. Required, and free text on purpose.

    A dropdown would turn a judgement into a category, and categories are read as findings. The
    reason exists so that a reader of the run record can see the judgement *was* a judgement.
  */
  reason     text not null check (length(btrim(reason)) > 0),

  -- True when this row takes the mark back rather than making one. The address returns to the
  -- outstanding count, and the round can reach all-in again later.
  withdrawn  boolean not null default false,

  marked_by  uuid not null references public.analysts (id) on delete restrict,

  /*
    The analyst's address at the time, filled by the trigger below rather than by the caller.

    Kept alongside the reference for the reason `sends.sent_by_email` keeps one: an analyst may
    later be deactivated, and the record must still say who made the judgement. Filled server-side
    because a browser that supplied it could attribute a judgement to somebody else — and the whole
    point of D-145 is that this is recorded as somebody's judgement.
  */
  marked_by_email text not null default '',

  marked_at  timestamptz not null default now()
);

/** The author's address, from the analyst the row is pinned to. Never from the caller. */
create or replace function public.stamp_nonresponse_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select email into new.marked_by_email from public.analysts where id = new.marked_by;
  if new.marked_by_email is null or new.marked_by_email = '' then
    raise exception 'a not-responding mark must name the analyst who made it'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger response_nonresponses_stamp_author
  before insert on public.response_nonresponses
  for each row execute function public.stamp_nonresponse_author();

comment on table public.response_nonresponses is
  'An operator''s judgement that an invited address is not going to respond, with their reason. Latest row per address wins; never a fact about the merchant, and never in the PDF (D-145, D-146).';
comment on column public.response_nonresponses.withdrawn is
  'A row that takes the mark back. The address returns to the outstanding count and all-in can fire again.';

create index response_nonresponses_run_idx
  on public.response_nonresponses (run_id, (lower(btrim(address))), marked_at desc);

alter table public.response_nonresponses enable row level security;

create policy response_nonresponses_select on public.response_nonresponses
  for select to authenticated using (public.is_analyst());

/*
  Analysts insert this one directly, unlike almost everything else in this schema.

  It is an operator action taken in the operator's own interface, with no token to prove and no
  secret to mint — the two reasons `comment_links` and `merchant_comments` go through the worker and
  a security-definer function. `marked_by = auth.uid()` pins the author to the caller, so the record
  cannot attribute a judgement to somebody who did not make it.
*/
create policy response_nonresponses_insert on public.response_nonresponses
  for insert to authenticated
  with check (public.is_analyst() and marked_by = auth.uid());

revoke update, delete on public.response_nonresponses from authenticated, anon;
revoke all on public.response_nonresponses from anon;

create trigger response_nonresponses_is_append_only
  before update or delete on public.response_nonresponses
  for each row execute function public.reject_mutation();

-- ------------------------------------------------------------------------------------------------
-- The notification, and the one-shot that makes all-in fire once
-- ------------------------------------------------------------------------------------------------
--
-- One email to the operator per submit event. When the last outstanding invited address resolves,
-- the same email leads with "All invited responses are in."
--
-- ## "Never twice for the same set" is an index, not a condition
--
-- The obvious implementation is to check before sending. That is a race with itself: two responders
-- submitting at the same moment both compute all-in, both find no prior notice, and the operator is
-- told twice.
--
-- So the set itself is the key. `all_in_fingerprint` is a SHA-256 over the folded, sorted invited
-- addresses, and a partial unique index refuses a second *sent* all-in notice for the same
-- fingerprint. Invite a new address after all-in and the set changes, the fingerprint changes, and
-- all-in can fire again when that address resolves — the behaviour asked for, arrived at without
-- anyone writing the rule twice.
--
-- Resolution normally moves one way: submissions are append-only and a not-responding mark only
-- removes an address from the outstanding set. A *withdrawal* puts one back, which is the single
-- case where a fingerprint that has already fired could become outstanding again — and it must not
-- fire twice for that set when it resolves again. The index guarantees that too, because it is keyed
-- on the set rather than on the sequence of events that produced it.
--
-- **The fingerprint is claimed before the message is sent, not after.** An index checked on the way
-- out would refuse the second write after the second email had already left, which is the failure it
-- exists to prevent, arriving one step too late. So the worker writes `kind` and the fingerprint
-- while the job is still `running`; the loser of a race gets a unique violation, sends nothing, and
-- records `not_sent`.
--
-- A send that then fails **releases** the claim — `kind` and the fingerprint go back to null — because
-- a failed send notified nobody and must not consume the one shot. The stale-claim reclaim retries
-- it, exactly as it does for every other queue here.
--
-- ## Queue and record in one table
--
-- The same shape as `comment_invites`: a trigger writes an intent, the worker claims it, and the row
-- carries the outcome. A second job mechanism with its own semantics is a second thing to get wrong
-- (D-035).

create table public.response_notices (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.runs (id) on delete restrict,

  -- What happened that might need reporting. Not what will be sent — the worker decides that.
  trigger         text not null check (trigger in ('submit', 'not_responding')),
  submission_id   uuid references public.comment_submissions (id) on delete restrict,
  nonresponse_id  uuid references public.response_nonresponses (id) on delete restrict,

  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'done', 'failed', 'not_sent')),

  /*
    Which email went, decided at send time rather than at enqueue time.

    The trigger that enqueues this row knows one event happened. Whether that event completed the
    round is a question about every invited address, and the answer can change between the enqueue
    and the send. The worker holds the whole picture; the trigger does not, and a trigger that
    guessed would be a second implementation of all-in.
  */
  kind            text check (kind in ('submit', 'resubmit', 'all_in')),

  -- SHA-256 of the folded, sorted invited set this all-in notice was fired for.
  all_in_fingerprint text check (all_in_fingerprint ~ '^[0-9a-f]{64}$'),

  -- The set itself, so the row is readable without recomputing the digest six months out.
  invited_addresses  text[],
  invited_count      integer,
  submitted_count    integer,

  /*
    Who it went to. Operators, not the merchant, and a list rather than one address (D-143).

    Three people are told about every response round, on one message. Stored as the set that was on
    it, so the record answers "who was told" without anyone reconstructing it from a config value
    that has since changed.
  */
  to_addresses    text[],

  /*
    What carried it. `dry_run` means the operator was not told.

    A dry run still consumes the fingerprint, unlike an outright failure: the job ran and produced
    its outcome, which is the same choice `comment_invites` makes. The difference stays visible,
    because the operator view reads this column rather than assuming a `done` row was delivered.
  */
  delivery        text check (delivery in ('resend', 'dry_run')),

  -- Why nothing went: the failure, or the reason there was nothing to send.
  error           text,

  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,

  constraint notices_name_one_source check (
    num_nonnulls(submission_id, nonresponse_id) = 1
  ),
  constraint notices_source_matches_trigger check (
    (trigger = 'submit' and submission_id is not null)
    or (trigger = 'not_responding' and nonresponse_id is not null)
  ),
  -- The same refusal the other three queues carry: a finished job that says nothing about what
  -- happened is the shape every defect in this project has taken.
  constraint sent_notices_say_what_went check (
    status <> 'done'
    or (kind is not null and delivery is not null and coalesce(array_length(to_addresses, 1), 0) > 0)
  ),
  constraint all_in_notices_carry_their_set check (
    kind is distinct from 'all_in' or all_in_fingerprint is not null
  ),
  constraint unsent_notices_say_why check (
    status not in ('failed', 'not_sent') or error is not null
  )
);

comment on table public.response_notices is
  'Operator notifications for a run''s response round: the queue and the record of what was sent. The all-in one-shot is the partial unique index below, not a condition in code.';
comment on column public.response_notices.all_in_fingerprint is
  'SHA-256 of the folded, sorted invited set. A new invitation changes the set, so all-in can fire again for it.';

/** One notice job per submit event. A second press produces no submission, so it produces no job. */
create unique index response_notices_one_per_submission
  on public.response_notices (submission_id)
  where submission_id is not null;

/**
  The one-shot.

  No `status` in the predicate, deliberately: the claim has to be refusable *before* the email is
  composed, and a predicate naming the terminal status could only refuse afterwards. A job that
  fails clears `kind` and releases the set, so the shot is spent by a notification that went, never
  by one that was attempted.
*/
create unique index response_notices_all_in_once
  on public.response_notices (run_id, all_in_fingerprint)
  where kind = 'all_in';

create index response_notices_queue_idx on public.response_notices (status, created_at);
create index response_notices_run_idx on public.response_notices (run_id, created_at desc);

alter table public.response_notices enable row level security;

create policy response_notices_select on public.response_notices
  for select to authenticated using (public.is_analyst());

-- Rows arrive from the triggers below and are completed by the worker. Nothing a browser does
-- writes here directly.
revoke insert, update, delete on public.response_notices from authenticated, anon;
revoke all on public.response_notices from anon;

/*
  The worker may record an outcome. It may not rewrite what the job was about.

  Without this, a bug — or a hand-run UPDATE during a debugging session, which is the case D-002 was
  written against — could repoint a sent notice at a different run or a different event, and the
  record of who was told what would be quietly wrong.
*/
create or replace function public.response_notice_outcome_only()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.run_id, new.trigger, new.submission_id, new.nonresponse_id, new.created_at)
     is distinct from (old.id, old.run_id, old.trigger, old.submission_id, old.nonresponse_id, old.created_at)
  then
    raise exception 'response_notices records an outcome; what the notice is about never changes'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger response_notices_outcome_only
  before update on public.response_notices
  for each row execute function public.response_notice_outcome_only();

create trigger response_notices_no_delete
  before delete on public.response_notices
  for each row execute function public.reject_mutation();

/*
  Enqueuing, as a trigger rather than as a line in each writer.

  Two things can complete a round — a submit and a not-responding mark — and they are written by two
  different callers through two different paths, one anonymous and one an analyst. A caller that
  forgets to enqueue produces a round that reaches all-in and tells nobody, which is a silent failure
  and therefore the one shape this project refuses.

  `security definer` because the analyst-side writer holds `authenticated`, which has no insert
  privilege here — deliberately, since a browser must not be able to fabricate a notification.
*/
create or replace function public.enqueue_response_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'comment_submissions' then
    insert into public.response_notices (run_id, trigger, submission_id)
    values (new.run_id, 'submit', new.id);
  else
    insert into public.response_notices (run_id, trigger, nonresponse_id)
    values (new.run_id, 'not_responding', new.id);
  end if;
  return new;
end;
$$;

create trigger comment_submissions_notify
  after insert on public.comment_submissions
  for each row execute function public.enqueue_response_notice();

/*
  A withdrawal enqueues too, and resolves to `not_sent`.

  It cannot complete a round — it adds an outstanding address — so nothing is sent. Enqueuing it
  anyway keeps one path: every write that can move the outstanding set produces a row saying what was
  decided about it, rather than some of them silently producing nothing.
*/
create trigger response_nonresponses_notify
  after insert on public.response_nonresponses
  for each row execute function public.enqueue_response_notice();

-- ------------------------------------------------------------------------------------------------
-- Submitting, with the token as the whole credential
-- ------------------------------------------------------------------------------------------------
--
-- `security definer`, no run id parameter, one answer for an unknown token and an expired one: the
-- three properties `submit_merchant_comment` has, for the same reasons.

create or replace function public.submit_response_round(p_token text, p_visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link       public.comment_links;
  v_visit      public.comment_visits;
  v_invited    boolean;
  v_submission public.comment_submissions;
  v_last       public.comment_submissions;
  v_content_at timestamptz;
begin
  select * into v_link
  from public.comment_links
  where token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_link.id is null or v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'this link is not valid');
  end if;

  select * into v_visit
  from public.comment_visits
  where id = p_visit_id and link_id = v_link.id;

  if v_visit.id is null then
    return jsonb_build_object('ok', false, 'reason', 'an email address is needed before submitting');
  end if;

  /*
    Scoped to the invited set (D-144).

    Not a security boundary — the identity is self-declared, so this refuses nothing an adversary
    could not walk around by typing a different address. It is here because a submit event from an
    address Mintro never wrote to has no meaning in the outstanding count, and admitting one would
    let a round reach all-in through somebody nobody asked.
  */
  select exists (
    select 1 from public.invited_addresses(v_link.run_id) a
    where lower(btrim(a.address)) = lower(btrim(v_visit.identified_as))
  ) into v_invited;

  if not v_invited then
    return jsonb_build_object('ok', false, 'reason', 'this address is not one the report was sent to');
  end if;

  /*
    The newest thing this identity has written, across both channels (D-151).

    Comments and attestations, because both are text the merchant added. Matched on the folded
    address rather than the visit, for the reason every other comparison here is: a refresh writes a
    new visit and it is the same person.
  */
  select greatest(
    (select max(c.submitted_at) from public.merchant_comments c
      where c.run_id = v_link.run_id
        and lower(btrim(c.identified_as)) = lower(btrim(v_visit.identified_as))),
    (select max(a.submitted_at) from public.merchant_attestations a
      where a.run_id = v_link.run_id
        and lower(btrim(a.identified_as)) = lower(btrim(v_visit.identified_as)))
  ) into v_content_at;

  select * into v_last
  from public.comment_submissions
  where run_id = v_link.run_id
    and lower(btrim(identified_as)) = lower(btrim(v_visit.identified_as))
  order by submitted_at desc, id desc
  limit 1;

  /*
    A press that records nothing, reported as such.

    Nothing has been written since their last submit, so there is no event — and the caller is told
    `recorded: false` rather than being handed the old row to confirm. The page hides the button in
    this state; this is what makes the guarantee hold for a caller that does not.
  */
  if v_last.id is not null
     and coalesce(v_content_at, '-infinity'::timestamptz)
         <= coalesce(v_last.covers_content_at, '-infinity'::timestamptz) then
    return jsonb_build_object(
      'ok', true,
      'recorded', false,
      'id', v_last.id,
      'identifiedAs', v_last.identified_as,
      'submittedAt', v_last.submitted_at,
      'coversContentAt', v_last.covers_content_at
    );
  end if;

  -- The race: two presses carrying the same watermark. The index refuses the second.
  insert into public.comment_submissions
    (run_id, link_id, visit_id, identified_as, covers_content_at)
  values
    (v_link.run_id, v_link.id, v_visit.id, btrim(v_visit.identified_as), v_content_at)
  on conflict (
    run_id,
    (lower(btrim(identified_as))),
    (coalesce(covers_content_at, '-infinity'::timestamptz))
  ) do nothing
  returning * into v_submission;

  if v_submission.id is null then
    -- Lost the race. The other press recorded the identical event, so this one recorded nothing.
    select * into v_submission
    from public.comment_submissions
    where run_id = v_link.run_id
      and lower(btrim(identified_as)) = lower(btrim(v_visit.identified_as))
      and coalesce(covers_content_at, '-infinity'::timestamptz)
          = coalesce(v_content_at, '-infinity'::timestamptz);

    return jsonb_build_object(
      'ok', true,
      'recorded', false,
      'id', v_submission.id,
      'identifiedAs', v_submission.identified_as,
      'submittedAt', v_submission.submitted_at,
      'coversContentAt', v_submission.covers_content_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'recorded', true,
    -- Their first submit, or an addition to a response they had already called complete. The
    -- worker decides which message that is; this says which event happened.
    'resubmit', v_last.id is not null,
    'id', v_submission.id,
    'identifiedAs', v_submission.identified_as,
    'submittedAt', v_submission.submitted_at,
    -- Handed back so the page holds exactly what the row holds. A browser that recomputed this
    -- would be a second expression of the watermark, and the two would eventually disagree.
    'coversContentAt', v_submission.covers_content_at
  );
end;
$$;

comment on function public.submit_response_round is
  'Records that a responder considers their response complete, or has added to it since (D-151). One event per identity per state of their response; scoped to the invited set; locks nothing (D-144).';

grant execute on function public.submit_response_round(text, uuid) to anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- Saving a comment: every autosave is a write, and a repeat is not
-- ------------------------------------------------------------------------------------------------
--
-- The merchant page autosaves on blur. Left as it was, `submit_merchant_comment` would append a row
-- every time a field lost focus, and the document IQwallet reads renders every row as a separate
-- statement by the merchant — including half-written sentences and untouched fields tabbed through.
--
-- Two changes, at two different points, and D-147 is the split between them:
--
--   **At write:** a body identical to the last one stored for that identity and finding writes
--   nothing and returns the row that is already there, with the time it was actually stored. This is
--   where most of the noise is prevented, and it is why pressing Save on unchanged text confirms an
--   earlier timestamp — that is the honest answer to "when was this saved".
--
--   **At render:** superseded drafts are collapsed, in `packages/engine/src/commentary.ts`. Not
--   here. What is stored stays stored.
--
-- Append-only is untouched. A revision is still another row; the only thing refused is a row that
-- says exactly what the previous one said.

create or replace function public.submit_merchant_comment(
  p_token    text,
  p_rule_id  text,
  p_ordinal  integer,
  p_body     text,
  p_visit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link  public.comment_links;
  v_visit public.comment_visits;
  v_last  public.merchant_comments;
  v_id    uuid;
  v_at    timestamptz;
begin
  select * into v_link
  from public.comment_links
  where token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_link.id is null or v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'this link is not valid');
  end if;

  -- A comment carries the identity in force when it was written. No identity, no comment.
  select * into v_visit
  from public.comment_visits
  where id = p_visit_id and link_id = v_link.id;

  if v_visit.id is null then
    return jsonb_build_object('ok', false, 'reason', 'an email address is needed before commenting');
  end if;

  if btrim(coalesce(p_body, '')) = '' then
    -- Nothing written is not a comment. It is also not an error: a merchant may leave a box empty,
    -- and the report distinguishes that from never having opened the report at all.
    return jsonb_build_object('ok', false, 'reason', 'nothing was written');
  end if;

  /*
    The last thing this identity stored about this finding.

    Matched on the folded address rather than on `visit_id`: a merchant who refreshes and
    re-identifies under the same address is the same person continuing the same response, and keying
    on the visit would make their next autosave look like a new draft.
  */
  select * into v_last
  from public.merchant_comments
  where run_id = v_link.run_id
    and rule_id = p_rule_id
    and ordinal is not distinct from p_ordinal
    and lower(btrim(identified_as)) = lower(btrim(v_visit.identified_as))
  order by submitted_at desc, id desc
  limit 1;

  if v_last.id is not null and v_last.body = p_body then
    -- Unchanged. Nothing is written, and the stored time is read back — which is what "Saved" here
    -- honestly refers to (D-147).
    return jsonb_build_object('ok', true, 'id', v_last.id, 'savedAt', v_last.submitted_at, 'wrote', false);
  end if;

  insert into public.merchant_comments (run_id, link_id, visit_id, identified_as, rule_id, ordinal, body)
  values (v_link.run_id, v_link.id, v_visit.id, v_visit.identified_as, p_rule_id, p_ordinal, p_body)
  returning id, submitted_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'id', v_id, 'savedAt', v_at, 'wrote', true);
end;
$$;

comment on function public.submit_merchant_comment is
  'Records a merchant comment verbatim against one finding. Append-only: a revision is another row, and a repeat of the last body is no row at all (D-147).';


-- ------------------------------------------------------------------------------------------------
-- An attestation hands back its stored time
-- ------------------------------------------------------------------------------------------------
--
-- One field added to the payload, and unchanged in every other respect (D-151).
--
-- The merchant page keeps a watermark of the newest thing this identity has written, so it can tell
-- whether pressing Submit again would record anything. Answering one of the nineteen questions moves
-- that watermark, and the page has to move it to the time the row actually carries rather than to
-- its own clock — the two are what the database and the browser would each compare, and a boundary
-- they disagree about is a button that appears when it should not.

create or replace function public.submit_merchant_attestation(
  p_token       text,
  p_question_id text,
  p_outcome     text,
  p_body        text,
  p_visit_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link  public.comment_links;
  v_visit public.comment_visits;
  v_body  text;
  v_id    uuid;
  v_at    timestamptz;
begin
  select * into v_link
  from public.comment_links
  where token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_link.id is null or v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'this link is not valid');
  end if;

  select * into v_visit
  from public.comment_visits
  where id = p_visit_id and link_id = v_link.id;

  if v_visit.id is null then
    return jsonb_build_object('ok', false, 'reason', 'an email address is needed before answering');
  end if;

  if p_outcome not in ('answered', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'an answer is either answered or declined');
  end if;

  -- Declining carries no words even if some were sent, and answering with none is not an answer.
  -- Normalised here rather than trusted from the caller, so the row satisfies its own constraint
  -- whatever the browser posted.
  v_body := case when p_outcome = 'declined' then null else nullif(btrim(coalesce(p_body, '')), '') end;

  if p_outcome = 'answered' and v_body is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing was written');
  end if;

  insert into public.merchant_attestations
    (run_id, link_id, visit_id, identified_as, question_id, outcome, body)
  values
    (v_link.run_id, v_link.id, v_visit.id, v_visit.identified_as, p_question_id, p_outcome, v_body)
  returning id, submitted_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'id', v_id, 'submittedAt', v_at);
end;
$$;
-- ------------------------------------------------------------------------------------------------
-- What the merchant page is told
-- ------------------------------------------------------------------------------------------------
--
-- Two additions to the payload, and one of them is a disclosure worth naming: `invited` tells
-- whoever holds a forwarded link which addresses Mintro wrote to. Accepted deliberately — they
-- received the link from one of those addresses — and it is what lets the page explain an absent
-- Submit button rather than leaving it mysterious.

create or replace function public.open_report_for_comment(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link   public.comment_links;
  v_report jsonb;
  v_domain text;
begin
  select * into v_link
  from public.comment_links
  where token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  -- One answer for "no such token" and "expired": a caller holding a bad token learns nothing about
  -- which it was.
  if v_link.id is null or v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'this link is not valid');
  end if;

  select r.report, m.domain into v_report, v_domain
  from public.runs r
  join public.merchants m on m.id = r.merchant_id
  where r.id = v_link.run_id;

  if v_report is null then
    return jsonb_build_object('ok', false, 'reason', 'this run has no report to comment on');
  end if;

  -- Records that they looked. Set once; a second visit does not move it.
  update public.comment_links
  set first_opened_at = coalesce(first_opened_at, now())
  where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'runId', v_link.run_id,
    'merchantDomain', v_domain,
    'expiresAt', v_link.expires_at,
    'report', v_report,
    'comments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'ruleId', c.rule_id,
            'ordinal', c.ordinal,
            'body', c.body,
            'identifiedAs', c.identified_as,
            'submittedAt', c.submitted_at
          )
          order by c.submitted_at
        )
        from public.merchant_comments c
        where c.run_id = v_link.run_id
      ),
      '[]'::jsonb
    ),
    -- Who arrived, whether or not they wrote anything. IQwallet sees participation without asking.
    'visits', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('identifiedAs', v.identified_as, 'identifiedAt', v.identified_at)
          order by v.identified_at
        )
        from public.comment_visits v
        where v.run_id = v_link.run_id
      ),
      '[]'::jsonb
    ),
    /*
      The set the Submit button is scoped to (D-144), earliest first.

      Earliest first because the page names the *most recent* invited address in the line shown to
      everyone else — "{address} will submit this when it's complete" — and the last element is a
      cheaper thing for a component to take than a sort it could get wrong.
    */
    'invited', coalesce(
      (select jsonb_agg(a.address order by a.invited_at) from public.invited_addresses(v_link.run_id) a),
      '[]'::jsonb
    ),
    /*
      Who has already submitted, and what state of their response each press covered (D-151).

      `coversContentAt` is what lets the page decide whether pressing again would record anything.
      Without it the button has to guess, and the guess it made was "always offer it", which
      confirmed events that never fired.
    */
    'submissions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'identifiedAs', s.identified_as,
            'submittedAt', s.submitted_at,
            'coversContentAt', s.covers_content_at
          )
          order by s.submitted_at
        )
        from public.comment_submissions s
        where s.run_id = v_link.run_id
      ),
      '[]'::jsonb
    ),
    /*
      The attestation answers, with their times.

      Here because the page computes the same watermark the database does, and an answer to one of
      the nineteen questions is text the merchant added exactly as a comment is. Returning only the
      comments would leave the button dark for someone who had answered five questions since
      submitting — the same silence this whole change exists to remove.

      Bodies are deliberately absent: `AttestationForm` shows what this visitor sent this session,
      and the page has never replayed another visitor's answers back at them.
    */
    'attestations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('identifiedAs', a.identified_as, 'submittedAt', a.submitted_at)
          order by a.submitted_at
        )
        from public.merchant_attestations a
        where a.run_id = v_link.run_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.open_report_for_comment is
  'Opens a run''s report for a holder of its comment token, and records that it was opened. The token is the entire credential.';
