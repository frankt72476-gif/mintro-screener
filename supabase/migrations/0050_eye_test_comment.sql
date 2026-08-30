-- 0050 — the merchant's reply to the eye test (D-203)
--
-- The eye test is Mintro's impression of how a storefront presents itself (D-196). A merchant
-- reading it will want to answer it, and that answer is likely the most useful single thing in the
-- package — *"the Fire Sale banner was a two-day promotion and is gone"* tells an underwriter
-- something no rule and no verdict row could.
--
-- ## Why a column and not a reserved rule id
--
-- The obvious move is to write `'eye-test'` into `merchant_comments.rule_id` and be done. **The
-- column will not take it**, and it is right not to:
--
--     rule_id text not null check (rule_id ~ '^[A-Z]+-[0-9]{3}$')
--
-- `'eye-test'` fails that pattern. The shapes that pass — `EYE-000`, say — are worse than the
-- failure: a value in that column *is* a rule id everywhere in this schema and in every reader
-- above it, and a reserved one would be indistinguishable from a real rule by anything except
-- knowing the magic string. `merchant_comments_run_idx` is on `(run_id, rule_id)`; the report groups
-- comments by rule; `commentaryFor` looks a finding up by its id. All of that would silently pick up
-- a row that is not about a finding at all.
--
-- So the subject gets its own column, nullable, and a row says which kind of thing it is about by
-- which column is filled. The constraint makes that exclusive rather than conventional.
--
-- ## The vocabulary is closed
--
-- `subject` is not free text. One value today, and a check constraint rather than a lookup table —
-- adding a second subject should be a migration somebody reviews, not a string a caller invents. A
-- comment stored under a subject nobody defined is a merchant's words in a document with no place to
-- render them.

alter table public.merchant_comments
  alter column rule_id drop not null;

alter table public.merchant_comments
  add column subject text check (subject in ('eye-test'));

comment on column public.merchant_comments.subject is
  'What this comment is about when it is not about a finding. Closed vocabulary; ''eye-test'' is the '
  'merchant''s reply to Mintro''s read of the storefront (D-203).';
comment on column public.merchant_comments.rule_id is
  'Which finding, or null where the comment is about a `subject` instead. Exactly one is set.';

/*
  Exactly one, never both and never neither.

  A row with both would be a comment the report could render twice, in two places, saying different
  things about what it answers. A row with neither is a merchant's words with nothing to attach them
  to — which is worse than losing them, because the document would carry a quotation it could not
  place.
*/
alter table public.merchant_comments
  add constraint merchant_comment_is_about_one_thing
  check ((rule_id is null) <> (subject is null));

create index merchant_comments_subject_idx
  on public.merchant_comments (run_id, subject)
  where subject is not null;

/*
  One write path, not two.

  `submit_merchant_comment` gains `p_subject` with a default rather than gaining a sibling function.
  Every guard it makes — the token, the expiry, the visit, the empty body, and D-147's "unchanged is
  not a write" — has to hold identically for a subject comment, and two functions is two copies of
  that free to drift (D-035's argument about a second job mechanism, applied to a second write path).

  The default keeps every existing five-argument call resolving unchanged.

  **This body is 0045's, not 0016's.** The first draft of this migration rebuilt the function from
  the original and silently dropped the autosave dedupe added in D-147, which four schema tests
  caught. A `create or replace` that reconstructs a function from an old copy discards every
  amendment made since; the safe move is to start from what is deployed.
*/
drop function if exists public.submit_merchant_comment(text, text, integer, text, uuid);

create or replace function public.submit_merchant_comment(
  p_token    text,
  p_rule_id  text,
  p_ordinal  integer,
  p_body     text,
  p_visit_id uuid,
  p_subject  text default null
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

  -- Said here as well as in the constraint, so a caller gets a sentence rather than a violation.
  if (p_rule_id is null) = (p_subject is null) then
    return jsonb_build_object('ok', false, 'reason', 'a comment is about a finding or a subject, not both');
  end if;

  /*
    The last thing this identity stored about this finding — or about this subject (D-203).

    Matched on the folded address rather than on `visit_id`: a merchant who refreshes and
    re-identifies under the same address is the same person continuing the same response, and keying
    on the visit would make their next autosave look like a new draft.

    `is not distinct from` on both keys, so a subject row matches other subject rows and never a
    finding row. The eye test has one box per run per author, so the ordinal plays no part in it.
  */
  select * into v_last
  from public.merchant_comments
  where run_id = v_link.run_id
    and rule_id is not distinct from p_rule_id
    and subject is not distinct from p_subject
    and ordinal is not distinct from p_ordinal
    and lower(btrim(identified_as)) = lower(btrim(v_visit.identified_as))
  order by submitted_at desc, id desc
  limit 1;

  if v_last.id is not null and v_last.body = p_body then
    -- Unchanged. Nothing is written, and the stored time is read back — which is what "Saved" here
    -- honestly refers to (D-147).
    return jsonb_build_object('ok', true, 'id', v_last.id, 'savedAt', v_last.submitted_at, 'wrote', false);
  end if;

  insert into public.merchant_comments
    (run_id, link_id, visit_id, identified_as, rule_id, ordinal, body, subject)
  values
    (v_link.run_id, v_link.id, v_visit.id, v_visit.identified_as, p_rule_id, p_ordinal, p_body, p_subject)
  returning id, submitted_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'id', v_id, 'savedAt', v_at, 'wrote', true);
end;
$$;

comment on function public.submit_merchant_comment is
  'Records a merchant comment verbatim against one finding, or against a reserved subject such as '
  'the eye test. Append-only: a revision is another row, and a repeat of the last body is no row '
  'at all (D-147, D-203).';

grant execute on function public.submit_merchant_comment(text, text, integer, text, uuid, text)
  to anon, authenticated;
