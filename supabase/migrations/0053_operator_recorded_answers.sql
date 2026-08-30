-- 0053 — an operator may record an answer on the merchant's behalf (D-212)
--
-- An agent often has the answer already — from a call, an email, an earlier package — and had no way
-- to record it short of sending a comment link to herself. Three things stopped her and a fourth
-- decided the shape:
--
--   1. the report renders no response field for an analyst;
--   2. every insert goes through a `security definer` function whose first argument is a link token,
--      and then requires a visit row belonging to that link;
--   3. `insert` is revoked from `authenticated` on both tables;
--   4. **the schema could not say who wrote it.** `link_id` and `visit_id` are `not null` and both
--      point at merchant-link machinery, so on a run that was never invited an operator answer had
--      nothing to hang on — and `identified_as` is read by every surface as the merchant's own
--      self-declaration.
--
-- The fourth is why this is a migration. Inventing a link and a visit would record that somebody was
-- sent a link, arrived, and identified themselves, when nobody did — the same objection D-204 raised
-- about `visit_id`, where the answer was to point at the *original* visit. Here there is no original,
-- because the case this exists for is a run the merchant was never invited on.
--
-- ## Exclusive, not conventional
--
-- A row is **either** merchant-written (a link and a visit, no recorder) **or** operator-recorded (a
-- recorder, no link and no visit). A row that were both is one the document could render twice
-- saying different things about who said it. Enforced the way `comment_provenance_is_whole` holds
-- inheritance: in the constraint, not in the caller.
--
-- ## `identified_as` becomes nullable, and that is the point
--
-- It is `not null` today and every surface reads it as *"identified themselves as"* — the merchant's
-- own declaration. Putting an analyst's address in it would make a reader that missed the
-- discriminator print something **plausible and false**: the merchant saying what the operator said.
--
-- Null on an operator row makes the same mistake print an obvious gap instead. This project has
-- resolved that trade-off the same way before (D-044, D-199): a visible hole beats a credible
-- falsehood, because only one of them gets noticed.
--
-- ## The token path is untouched
--
-- `submit_merchant_comment` and `submit_merchant_attestation` are not modified here. They insert a
-- link, a visit and an address, and no recorder — which satisfies the merchant side of the
-- constraint exactly as before. **An analyst path must not weaken the merchant one**, and the way to
-- be sure is to not touch it.

-- ── Comments ───────────────────────────────────────────────────────────────────────────────────

alter table public.merchant_comments
  alter column link_id drop not null,
  alter column visit_id drop not null,
  alter column identified_as drop not null,
  add column recorded_by       uuid references public.analysts (id) on delete restrict,
  add column recorded_by_email text,
  add column recorded_at       timestamptz;

alter table public.merchant_comments
  add constraint comment_is_merchant_or_operator check (
    (recorded_by is null and link_id is not null and visit_id is not null and identified_as is not null)
    or (recorded_by is not null and link_id is null and visit_id is null and identified_as is null)
  );

/*
  An operator row says who and when, or it is not an operator row.

  `recorded_by` is the id an underwriter can chase; `recorded_by_email` is what every surface prints.
  Both, because the id is not readable and the email is not stable — an analyst's address can change,
  and a row must still say what it said when it was written (D-002).
*/
alter table public.merchant_comments
  add constraint comment_recorder_is_whole check (
    recorded_by is null
    or (length(btrim(coalesce(recorded_by_email, ''))) > 0 and recorded_at is not null)
  );

comment on column public.merchant_comments.recorded_by is
  'The analyst who recorded this on the merchant''s behalf, where the merchant did not write it '
  'themselves. Null on a merchant-written row (D-212).';
comment on column public.merchant_comments.identified_as is
  'The address the merchant declared. Null on an operator-recorded row — nobody declared one, and a '
  'plausible-looking address there would read as the merchant''s own statement.';

-- ── Attestations ───────────────────────────────────────────────────────────────────────────────

alter table public.merchant_attestations
  alter column link_id drop not null,
  alter column visit_id drop not null,
  alter column identified_as drop not null,
  add column recorded_by       uuid references public.analysts (id) on delete restrict,
  add column recorded_by_email text,
  add column recorded_at       timestamptz;

alter table public.merchant_attestations
  add constraint attestation_is_merchant_or_operator check (
    (recorded_by is null and link_id is not null and visit_id is not null and identified_as is not null)
    or (recorded_by is not null and link_id is null and visit_id is null and identified_as is null)
  );

alter table public.merchant_attestations
  add constraint attestation_recorder_is_whole check (
    recorded_by is null
    or (length(btrim(coalesce(recorded_by_email, ''))) > 0 and recorded_at is not null)
  );

create index merchant_comments_recorded_idx
  on public.merchant_comments (run_id) where recorded_by is not null;
create index merchant_attestations_recorded_idx
  on public.merchant_attestations (run_id) where recorded_by is not null;

/*
  ── Who may write one ──────────────────────────────────────────────────────────────────────────

  Copied from `response_nonresponses` (0045), which is the schema's existing operator-authored row on
  a merchant surface: **an analyst may insert under their own id and no other**, and the policy
  enforces it rather than the caller.

  `recorded_by = auth.uid()` is what makes the attribution worth printing. An operator who could
  write another analyst's id could put words in a colleague's mouth in a document that reaches an
  underwriter — and no amount of care in the frontend would be evidence that they had not.

  Insert only. Update and delete stay revoked: these tables are append-only, and a later answer is
  another row rather than an edit to this one (D-002). **A merchant answering the same question does
  not supersede an operator's** — both stand, with their own attributions and dates, because a
  merchant contradicting what the agent recorded is information an underwriter should see rather
  than something the system quietly resolves.
*/
create policy merchant_comments_operator_insert on public.merchant_comments
  for insert to authenticated
  with check (
    public.is_analyst()
    and recorded_by = auth.uid()
    and link_id is null
    and visit_id is null
  );

create policy merchant_attestations_operator_insert on public.merchant_attestations
  for insert to authenticated
  with check (
    public.is_analyst()
    and recorded_by = auth.uid()
    and link_id is null
    and visit_id is null
  );

grant insert on public.merchant_comments to authenticated;
grant insert on public.merchant_attestations to authenticated;

revoke update, delete on public.merchant_comments from authenticated, anon;
revoke update, delete on public.merchant_attestations from authenticated, anon;

/*
  ── Inheritance carries the recorder, not the merchant ─────────────────────────────────────────

  An operator-recorded answer inherits to a re-run like any other (D-204) and **stays the operator's**
  — it does not become the merchant's on the way across. `inherit_responses_for_link` copied
  `link_id` from the new link and `visit_id` from the source row unconditionally, which for an
  operator row would have produced a link with no visit: a constraint violation, and had it passed, a
  merchant answer nobody wrote.

  So the copy carries whichever half the source row had. The rest of the function is unchanged.
*/
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

  select coalesce(array_agg(distinct value->>'ruleId'), '{}')
    into v_rules
  from public.runs r,
       lateral jsonb_array_elements(coalesce(r.report->'strip', '[]'::jsonb)) as value
  where r.id = v_link.run_id;

  with latest as (
    select distinct on (a.question_id)
           a.question_id, a.outcome, a.body, a.identified_as, a.visit_id,
           a.recorded_by, a.recorded_by_email, a.recorded_at,
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
     recorded_by, recorded_by_email, recorded_at,
     inherited_from_run, originally_answered_at)
  select v_link.run_id,
         -- An operator row carries no link on the way across, exactly as it carried none originally.
         case when l.recorded_by is null then v_link.id else null end,
         l.question_id, l.visit_id, l.identified_as, l.outcome, l.body,
         l.recorded_by, l.recorded_by_email, l.recorded_at,
         l.source_run, l.first_at
  from latest l
  where not exists (
    select 1 from public.merchant_attestations existing
    where existing.run_id = v_link.run_id and existing.question_id = l.question_id
  );
  get diagnostics v_attestations = row_count;

  with latest as (
    select distinct on (c.rule_id, c.ordinal, c.subject)
           c.rule_id, c.ordinal, c.subject, c.body, c.identified_as, c.visit_id,
           c.recorded_by, c.recorded_by_email, c.recorded_at,
           c.run_id as source_run,
           coalesce(c.originally_answered_at, c.submitted_at) as first_at,
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
     recorded_by, recorded_by_email, recorded_at,
     inherited_from_run, originally_answered_at, commented_on)
  select v_link.run_id,
         case when l.recorded_by is null then v_link.id else null end,
         l.rule_id, l.ordinal, l.subject, l.visit_id, l.identified_as, l.body,
         l.recorded_by, l.recorded_by_email, l.recorded_at,
         l.source_run, l.first_at, l.observed_then
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
  'the run this link belongs to, marked with their provenance (D-204). An operator-recorded answer '
  'carries its recorder across and does not become the merchant''s (D-212).';

revoke all on function public.inherit_responses_for_link(uuid) from public, anon, authenticated;
