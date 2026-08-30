-- 0052 — the comment form replays inherited answers (D-205)
--
-- `open_report_for_comment` returned attestation *times* and withheld the bodies, for a reason it
-- stated at the line:
--
--     Bodies are deliberately absent: `AttestationForm` shows what this visitor sent this session,
--     and the page has never replayed another visitor's answers back at them.
--
-- **That reason is wrong now, and this migration is where it stops being repeated.**
--
-- ## Why it no longer holds
--
-- It withheld nothing. The *report* returned in the same payload, rendered on the same page at the
-- same link, already carries every one of those answers with its text and the address that wrote
-- it. A holder of this link can read them by scrolling. Keeping them out of the form protected
-- nothing and forced a retype of what is visible above it — which is precisely the rework D-204
-- exists to remove, reintroduced two inches lower down the page.
--
-- ## The forwardable link argues for replay, not against it
--
-- D-063: the link is forwardable, so whoever holds it is not necessarily who wrote the answer. That
-- was read as a reason to withhold. It is the reason to show.
--
-- If an agent answered on an earlier screening and the merchant now holds the link, seeing
-- *"answered 12 Aug by someone who identified themselves as sue@agency.example"* is strictly better
-- than answering blind — the alternative is a merchant unknowingly contradicting their own agent in
-- a document that goes to an underwriter, with no way to have seen it coming.
--
-- So every replayed answer carries its attribution into the form, not only onto the report. The
-- attribution is what makes replay safe; withholding the body while showing the time was the worst
-- of both.

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

comment on function public.open_report_for_comment is
  'Everything the merchant''s page renders for one link: the report, the comments, the attestation '
  'answers in full with their attribution, and who has submitted. Bodies are included — the report '
  'in the same payload already carries them, so withholding them only forced a retype (D-205).';
