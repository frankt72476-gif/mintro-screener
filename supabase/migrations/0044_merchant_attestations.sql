-- ================================================================================================
-- 0044 — Merchant attestations (D-134)
-- ================================================================================================
--
-- Table 2 of the peptide requirements lists nineteen programme requirements a website says nothing
-- about: shipping destinations, support transcripts, ban lists, lab accreditation, prior
-- terminations. The questions live in `rules/ruleset.json` beside the rules. This is where the
-- answers land.
--
-- ## An answer is a statement, not an observation
--
-- "Yes, we require an adult signature" is the merchant's word. Mintro did not see it happen, and
-- nothing here is allowed to make it look as though it did. That is why this table carries no
-- state column, no score, and no verification field — those are the apparatus that would turn a
-- statement into a finding. The whole boundary is that answers render in their own section under a
-- heading that says who said it.
--
-- ## Three outcomes, and only two of them are rows
--
--   answered   — a row with a body
--   declined   — a row with no body
--   unanswered — no row
--
-- `declined` is stored rather than treated as silence because a merchant refusing to say whether
-- they ship to med-spas has told you something. `unanswered` is the absence of a row and is
-- derived when the report is assembled: storing it would mean writing a row for every question the
-- moment a link is issued, and then a merchant who never opened the report would be indistinguishable
-- from one who read every question and answered none.
--
-- ## No second channel
--
-- This reuses the comment link exactly as it stands (D-063): same token, same visit, same
-- self-declared identity, same expiry. `submit_merchant_attestation` is the sibling of
-- `submit_merchant_comment` and differs from it only in what it writes.

create table public.merchant_attestations (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  link_id       uuid not null references public.comment_links (id) on delete restrict,

  /*
    Which question, by its slug in the rule set.

    The pattern is the opposite of `merchant_comments.rule_id`, which requires `^[A-Z]+-[0-9]{3}$`.
    The two id spaces cannot collide, so no join and no report can quietly serve an attestation
    where a finding belongs. There is deliberately no foreign key to the rule set: it is a JSON
    file under version control, not a table, and mirroring it here would create a second copy to
    keep in step.
  */
  question_id   text not null check (question_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),

  -- Who was identified when this was written. Self-declared and unverified, per comment rather
  -- than per link, for the reason `merchant_comments` carries it the same way.
  visit_id      uuid not null references public.comment_visits (id) on delete restrict,
  identified_as text not null,

  outcome       text not null check (outcome in ('answered', 'declined')),

  -- Their words, verbatim. Never trimmed to a limit, never normalised, never moderated.
  body          text,

  submitted_at  timestamptz not null default now(),

  -- An answer has words; a declination does not. Without this, `outcome = 'answered'` with an
  -- empty body would render as an answered question with nothing in it, which reads as a defect in
  -- the report rather than as what it is.
  constraint merchant_attestations_body_matches_outcome check (
    (outcome = 'answered' and length(btrim(coalesce(body, ''))) > 0)
    or (outcome = 'declined' and body is null)
  )
);

comment on table public.merchant_attestations is
  'What a merchant stated about a requirement no crawl can observe. Verbatim, append-only, and never a finding.';
comment on column public.merchant_attestations.outcome is
  'answered or declined. Unanswered is the absence of a row — see D-134.';
comment on column public.merchant_attestations.body is
  'The merchant''s own words. Null exactly when the question was declined.';

alter table public.merchant_attestations enable row level security;

create policy merchant_attestations_select on public.merchant_attestations
  for select to authenticated using (public.is_analyst());

-- Writes arrive only through `submit_merchant_attestation`, which proves possession of the token.
revoke insert, update, delete on public.merchant_attestations from authenticated, anon;

create trigger merchant_attestations_is_append_only
  before update or delete on public.merchant_attestations
  for each row execute function public.reject_mutation();

create index merchant_attestations_run_idx
  on public.merchant_attestations (run_id, question_id);

-- ------------------------------------------------------------------------------------------------
-- Answering, with the token as the whole credential
-- ------------------------------------------------------------------------------------------------
--
-- `security definer`, no run id parameter, one answer for an unknown token and an expired one:
-- the same three properties `submit_merchant_comment` has, for the same reasons.
--
-- A revision is another row. Nothing is updated, so the record shows what was said and when it
-- changed — the append-only rule the rest of this schema is built on.

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
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.submit_merchant_attestation is
  'Records a merchant attestation verbatim. Append-only: a revision is another row. See D-134.';

grant execute on function public.submit_merchant_attestation(text, text, text, text, uuid)
  to anon, authenticated;
