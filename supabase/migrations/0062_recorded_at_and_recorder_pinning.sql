-- ================================================================================================
-- 0062 — when it was recorded, and who it may be recorded under
-- ================================================================================================
--
-- Two follow-ups to 0061.
--
-- ## `recordedAt` comes back, as a bare timestamp
--
-- 0061 removed `recorded_at` along with `recorded_by_email`, and the renderers fell back to
-- `submitted_at` for the date. That was a substitution, not a fix: the two columns are the same
-- instant on a fresh operator row and different on an inherited one, where `submitted_at` is when
-- this run copied the answer forward and `recorded_at` is when somebody actually took it down.
--
-- A timestamp identifies nobody. The participation record is entitled to say *when* an answer was
-- recorded on the merchant's behalf; it is not entitled to say by whom. So the date returns and
-- the address stays gone.
--
-- ## `recorded_by_email` is pinned to the analyst it names
--
-- 0053 pinned `recorded_by = auth.uid()` in the insert policy, and said why: an operator who could
-- write another analyst's id "could put words in a colleague's mouth in a document that reaches an
-- underwriter". The email column was left unpinned, so exactly that was still possible one column
-- to the right — and the email is the one every surface printed.
--
-- A check constraint cannot do this: the answer lives in another table. A trigger can.
--
-- ### Why it does not fire on an inherited row
--
-- `inherit_responses_for_link` copies `recorded_by`, `recorded_by_email` and `recorded_at` forward
-- to the new run, and 0053 keeps both columns precisely because "an analyst's address can change,
-- and a row must still say what it said when it was written (D-002)". A blanket equality check
-- would therefore break inheritance the first time somebody's address changed — the copy would
-- carry the old address, no longer match the roster, and be refused.
--
-- So the check applies to rows being recorded for the first time, which is where the substitution
-- it prevents would happen. An inherited row is a copy of a row that already passed it.

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
    /*
      Comments now carry their subject and their provenance (D-203, D-204).

      `subject` so the page can tell the eye-test reply from a finding comment; `inheritedFromRun`
      and `originallyAnsweredAt` so a carried-forward comment says so in the box a merchant is about
      to type into, rather than only on the report above it.
    */
    'comments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'ruleId', c.rule_id,
            'ordinal', c.ordinal,
            'subject', c.subject,
            'body', c.body,
            'identifiedAs', c.identified_as,
            -- The fact that Mintro recorded it, never who did (0061). `recorded_by_email` is not
            -- in this payload and must not be added to it: this object is handed to an
            -- unauthenticated merchant page over a forwardable link.
            'recordedByOperator', c.recorded_by is not null,
            -- When it was taken down, which is a fact about the record and identifies nobody.
            -- Separate from `submittedAt`: they are the same instant on a fresh operator row and
            -- diverge on an inherited one, where `submitted_at` is this run and `recorded_at` is
            -- when the answer was actually given.
            'recordedAt', c.recorded_at,
            'submittedAt', c.submitted_at,
            'inheritedFromRun', c.inherited_from_run,
            'originallyAnsweredAt', c.originally_answered_at,
            'commentedOn', c.commented_on
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
      The attestation answers, in full (D-205).

      **Bodies included, and the earlier note saying otherwise is withdrawn.** It said the page has
      never replayed another visitor's answers back at them, and that it was deliberate. It withheld
      nothing: the `report` above carries the same answers with the same attribution, rendered on
      this page at this link, so a holder can already read every one of them. All the omission
      achieved was making them retype what was on screen.

      `identifiedAs` travels with each one and the form shows it. Under a forwardable link (D-063)
      that is the safeguard, not the risk — a merchant who can see that their agent answered this on
      12 August is better placed than one answering blind into a box.

      `outcome` so a declination replays as a declination rather than as an empty answer, and the
      provenance columns so an untouched inherited answer submits as carried forward rather than as
      answered on this run (D-204, §5).
    */
    'attestations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'questionId', a.question_id,
            'outcome', a.outcome,
            'body', a.body,
            'identifiedAs', a.identified_as,
            -- As above: the fact, not the person.
            'recordedByOperator', a.recorded_by is not null,
            'recordedAt', a.recorded_at,
            'submittedAt', a.submitted_at,
            'inheritedFromRun', a.inherited_from_run,
            'originallyAnsweredAt', a.originally_answered_at
          )
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

revoke all on function public.open_report_for_comment(text) from public;
grant execute on function public.open_report_for_comment(text) to anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- The recorder is the analyst the row names
-- ------------------------------------------------------------------------------------------------
--
-- Written against `analysts` by id. `recorded_by` is already pinned to `auth.uid()` by the insert
-- policy (0058's definition, which carries 0053's clause forward), so the pair is then: the id is
-- the caller, and the email is the id's. Neither can name somebody else.

create or replace function public.recorder_email_matches_the_recorder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actual public.analysts.email%type;
begin
  -- Not an operator row: nothing to pin.
  if new.recorded_by is null then
    return new;
  end if;

  -- A carried-forward row keeps what it said when it was written (D-002). See the header.
  if new.inherited_from_run is not null then
    return new;
  end if;

  /*
    An absent address is `comment_recorder_is_whole`'s business, not this trigger's.

    A BEFORE INSERT trigger runs ahead of the table's check constraints, so raising here on a null
    would pre-empt that constraint and answer a different question in its name — "the address is
    not the recorder's" for a row that carries no address at all. Deferring keeps each guard's
    error attributable to the thing it actually checks, and the row is still refused, one step
    later, by the constraint written for it.
  */
  if new.recorded_by_email is null then
    return new;
  end if;

  select email into actual from public.analysts where id = new.recorded_by;

  if actual is null then
    raise exception
      'cannot record an answer: % is not an analyst', new.recorded_by
      using errcode = 'foreign_key_violation';
  end if;

  if lower(btrim(new.recorded_by_email)) is distinct from lower(btrim(actual)) then
    raise exception
      'recorded_by_email must be the address of the analyst recording it'
      using errcode = 'check_violation',
            detail = format(
              'row names %L as the recorder but carries %L as the address; %L is the address on '
              || 'that analyst row.',
              new.recorded_by, new.recorded_by_email, actual
            ),
            hint = 'Leave recorded_by_email to the caller that knows who is signed in, and do not pass another analyst''s address.';
  end if;

  return new;
end;
$$;

comment on function public.recorder_email_matches_the_recorder is
  'An operator records under their own address or not at all. The email half of what 0053 pinned by id.';

create trigger merchant_comments_recorder_is_pinned
  before insert on public.merchant_comments
  for each row execute function public.recorder_email_matches_the_recorder();
