-- ================================================================================================
-- 0061 — an operator's address does not leave the building
-- ================================================================================================
--
-- The outbound-surface identity audit found operator emails reaching two places they must not:
-- the merchant comment page could render one the moment this payload carried it, and the PDF that
-- goes to IQwallet already did, as *"Recorded by <analyst address> on the merchant's behalf"*.
--
-- The ruling: no operator email or name reaches any merchant-, agent- or IQwallet-facing surface.
-- That an answer was operator-recorded MAY be shown, attributed to Mintro, never to a person.
--
-- ## Fixed at the payload, not at the renderer
--
-- Three components were ready to print the address and one of them did. Removing the string from
-- the components would leave the next component free to reintroduce it, because the data would
-- still be sitting in the object they are handed. So the payload stops carrying it: a renderer
-- cannot print a name it was never given.
--
-- `recorded_by` and `recorded_by_email` stay on the table. They are what an underwriter chasing a
-- record asks Mintro for, and what an owner- or host-facing internal surface may show. This is
-- about what leaves.
--
-- ## And it closes the empty-attribution defect
--
-- `comment_is_merchant_or_operator` (0053) makes `identified_as` null on every operator row, and
-- this function returned those rows to the merchant page with no way to tell them apart. The page
-- took its merchant branch and rendered *"Identified themselves as , 2026-08-30"* — an operator's
-- words presented as an anonymous self-declaration by the merchant. `recordedByOperator` is what
-- lets the renderer branch cleanly, so the row now reads as Mintro's rather than as nobody's.
--
-- Rewritten from the last definition, 0052_replay_inherited_answers.sql — verified by listing every
-- migration that defines this name (0016, 0045, 0052) and taking the newest.

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
            -- The fact that Mintro recorded it, never who did (D-233). `recorded_by_email` is not
            -- in this payload and must not be added to it: this object is handed to an
            -- unauthenticated merchant page over a forwardable link.
            'recordedByOperator', c.recorded_by is not null,
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

-- `create or replace` keeps existing grants; restated so this file says who may call it.
revoke all on function public.open_report_for_comment(text) from public;
grant execute on function public.open_report_for_comment(text) to anon, authenticated;
