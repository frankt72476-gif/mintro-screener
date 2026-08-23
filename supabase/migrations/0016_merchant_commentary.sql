-- 0016 — merchant commentary (D-063)
--
-- Mintro's report goes to the agent or merchant before IQwallet. The merchant may comment on any
-- finding — to close a not-evaluable, to add context, or to dispute it outright. The combined
-- document reaches IQwallet, who decides.
--
-- Mintro is a news reporter, not a talking head with opinions. Two sources, one document.
-- Liability for the merchant's claims sits with the merchant, which is why their words are stored
-- verbatim, attributed, and never edited or summarised on the way through.
--
-- ## Nothing here changes a finding
--
-- A disputed finding stays exactly as it was recorded. The merchant's statement sits beside it.
-- A genuine remediation is answered by a re-scan producing a new run (D-002) — never by editing an
-- old one, and nothing in this file can reach `runs` or `findings`.
--
-- ## Scope
--
-- One tokenised link, one report, one free-form box per finding, submit. No merchant accounts, no
-- dashboard, no history across runs. Widening any of those is a new decision.

-- ---------------------------------------------------------------------------------------------
-- The link
-- ---------------------------------------------------------------------------------------------
--
-- One link per run. The token is never stored: only its SHA-256, so a leaked database does not
-- yield working links — the same property hard constraint 6 requires of credentials, applied to a
-- bearer token that opens a merchant's screening report.

create table public.comment_links (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.runs (id) on delete restrict,

  -- SHA-256 of the token, hex, from core Postgres `sha256()` rather than pgcrypto — one fewer
  -- extension to depend on, and the digest is the same either way. The token itself exists only
  -- in the link that was sent.
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),

  issued_at    timestamptz not null default now(),
  issued_by    uuid references public.analysts (id) on delete restrict,
  expires_at   timestamptz not null,

  /*
    When the merchant first opened the report.

    Null means they never did, and that is a different fact from opening it and writing nothing
    (D-063). Both render as no comment; the report has to tell them apart, because "we asked and
    they did not answer" and "we asked and they never looked" support different readings and
    neither may be presented as the other.

    Set once. A second visit does not move it — the question is whether they ever saw it.
  */
  first_opened_at timestamptz,

  /*
    Where Mintro sent it. **Not who may use it.**

    Mintro generally has no direct channel to the merchant: the link goes to the agent, who either
    forwards it or answers on the merchant's behalf. Both are acceptable — this is a supporting
    document, not a legal instrument — so there is **one link per report and it is forwardable**,
    with no per-recipient tokens.

    Recording where it was sent is still Mintro's action and still what makes "the merchant was
    invited" a fact rather than a recollection (D-063). Who actually arrived is a separate
    question, answered by `comment_visits`.
  */
  sent_to      text not null check (position('@' in sent_to) > 1),

  constraint expiry_after_issue check (expires_at > issued_at)
);

/*
  Several links per run, on purpose.

  An expired link is re-issued by adding another row, never by extending the old one. Extending
  would erase the record of the first invitation — when it was sent, to whom, and whether it was
  opened — and that record is the whole basis of the `not_invited` / `unopened` distinction.

  Comments reference the link they arrived through, so **re-issuing disturbs nothing already
  submitted**. "Did they ever open it" is the earliest opening across a run's links, which is a
  question with one answer whether there is one link or three.
*/
create index comment_links_run_idx on public.comment_links (run_id, issued_at desc);

comment on table public.comment_links is
  'Tokenised links letting a merchant comment on one run. The token is stored only as a SHA-256.';
comment on column public.comment_links.first_opened_at is
  'When the merchant first opened the report through this link. Null is "never opened", which is not the same as "opened and said nothing".';
comment on column public.comment_links.sent_to is
  'The address the link was sent to. Mintro''s action, recorded so that "invited" is a fact rather than a recollection.';

alter table public.comment_links enable row level security;

create policy comment_links_select on public.comment_links
  for select to authenticated using (public.is_analyst());

/*
  No insert policy, deliberately.

  A row here carries the SHA-256 of a token. **A browser that can write one has computed one**,
  which means the plaintext token existed in a browser — and the whole point of storing only the
  digest is that the token exists in exactly two places: the email, and the merchant's address bar.

  So issuing is not something the frontend does. The analyst enqueues an intent in
  `comment_invites`; the worker mints the token, writes this row, and hands the token straight to
  the mailer. The token never reaches the analyst either — they cannot forward it out of band,
  and Mintro's record of what was sent is therefore complete rather than partial (D-063).
*/

revoke insert, update, delete on public.comment_links from authenticated, anon;

/*
  `first_opened_at` is the only column that may ever change, and only from null.

  Everything else is append-only. A trigger rather than a policy because `service_role` bypasses
  RLS — the same reasoning as every other append-only guarantee here.
*/
create or replace function public.comment_link_open_once()
returns trigger
language plpgsql
as $$
begin
  if old.first_opened_at is not null and new.first_opened_at is distinct from old.first_opened_at then
    raise exception 'comment_links.first_opened_at is set once and never changed'
      using errcode = 'restrict_violation';
  end if;

  if (new.id, new.run_id, new.token_sha256, new.issued_at, new.expires_at)
     is distinct from (old.id, old.run_id, old.token_sha256, old.issued_at, old.expires_at) then
    raise exception 'comment_links is append-only apart from first_opened_at'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger comment_links_open_once
  before update on public.comment_links
  for each row execute function public.comment_link_open_once();

create trigger comment_links_no_delete
  before delete on public.comment_links
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------------------------
-- Who arrived
-- ---------------------------------------------------------------------------------------------
--
-- One forwardable link, so whoever lands says who they are before they can comment. The visit is
-- recorded **whether or not they go on to comment** — "someone identifying as X opened this on the
-- 14th and left no comment" is a materially better fact than a blank space, and IQwallet should be
-- able to see that the merchant side participated, and when, without asking.
--
-- ## Self-declared, and nothing verifies it
--
-- No confirmation mail, no code, no check that the address exists or belongs to anyone. The report
-- says **"identified themselves as"** and never presents the address as established — the same
-- discipline as "recorded as received, not verified by Mintro" on the comment itself.
--
-- Verification is deliberately absent rather than missing. Adding it would make Mintro the party
-- that established who spoke, which is a claim this document does not make and does not need: the
-- agent forwarding to the merchant is the expected case, and both answering is acceptable.

create table public.comment_visits (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid not null references public.comment_links (id) on delete restrict,
  run_id        uuid not null references public.runs (id) on delete restrict,

  -- What they typed. Stored as given; never checked against anything.
  identified_as text not null check (position('@' in identified_as) > 1),

  identified_at timestamptz not null default now()
);

comment on table public.comment_visits is
  'Who identified themselves on a comment link, and when. Self-declared and unverified by design (D-063).';
comment on column public.comment_visits.identified_as is
  'The address they typed. Mintro verifies nothing; the report says "identified themselves as".';

alter table public.comment_visits enable row level security;

create policy comment_visits_select on public.comment_visits
  for select to authenticated using (public.is_analyst());

revoke insert, update, delete on public.comment_visits from authenticated, anon;

create trigger comment_visits_is_append_only
  before update or delete on public.comment_visits
  for each row execute function public.reject_mutation();

create index comment_visits_run_idx on public.comment_visits (run_id, identified_at);

-- ---------------------------------------------------------------------------------------------
-- The comments
-- ---------------------------------------------------------------------------------------------
--
-- Append-only and timestamped (D-002). A merchant may add; nothing is overwritten. If IQwallet has
-- read version one, version one stays readable — so a revision is another row, and the report shows
-- both with their times.
--
-- `body` has no length limit, no format, and no validation. The interface is a text box: a merchant
-- writes whatever they want or nothing. Mintro does not moderate, summarise, or comment on their
-- comment.

create table public.merchant_comments (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  link_id       uuid not null references public.comment_links (id) on delete restrict,

  -- Which finding. `ordinal` distinguishes repeats of one rule across sampled pages; null means
  -- the rule produced a single finding.
  rule_id       text not null check (rule_id ~ '^[A-Z]+-[0-9]{3}$'),
  ordinal       integer,

  /*
    Who was identified when this was written.

    Attribution is per comment, not per link: several people may use one forwardable link — the
    agent answering some findings, the merchant others — and the report has to say which of them
    wrote which. Copied onto the row rather than read through `visit_id` alone so a comment carries
    its attribution even when read on its own.
  */
  visit_id      uuid not null references public.comment_visits (id) on delete restrict,
  identified_as text not null,

  -- The merchant's words, verbatim. Never trimmed to a limit, never normalised.
  body          text not null check (length(btrim(body)) > 0),

  submitted_at  timestamptz not null default now()
);

comment on table public.merchant_comments is
  'What a merchant wrote about a finding, verbatim and append-only. Never changes the finding it is about.';
comment on column public.merchant_comments.body is
  'The merchant''s own words. No length limit, no validation, no moderation — see D-063.';

alter table public.merchant_comments enable row level security;

create policy merchant_comments_select on public.merchant_comments
  for select to authenticated using (public.is_analyst());

-- Writes arrive only through `submit_merchant_comment`, which proves possession of the token.
revoke insert, update, delete on public.merchant_comments from authenticated, anon;

create trigger merchant_comments_is_append_only
  before update or delete on public.merchant_comments
  for each row execute function public.reject_mutation();

create index merchant_comments_run_idx on public.merchant_comments (run_id, rule_id);

-- ---------------------------------------------------------------------------------------------
-- Opening a report with a token
-- ---------------------------------------------------------------------------------------------
--
-- The merchant is not a user of this system: no account, no password, no session. What they have
-- is a link. These two functions are the whole of what that link can do, and they are the only
-- path by which an unauthenticated caller reaches anything here.
--
-- `security definer` so an anonymous caller can execute them, with the token as the entire
-- credential. Neither function accepts a run id — a caller who does not hold a token cannot name
-- a run to read or write.

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

  -- One answer for "no such token" and "expired": a caller holding a bad token learns nothing
  -- about which it was.
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

  -- Records that they looked. Set once; a second visit does not move it (see the column comment).
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
    )
  );
end;
$$;

comment on function public.open_report_for_comment is
  'Opens a run''s report for a holder of its comment token, and records that it was opened. The token is the entire credential.';

/*
  Identifying yourself.

  Called before the first comment, and recorded whether or not one follows. Nothing is verified —
  see the table comment. Returns the visit id, which the caller passes back when it writes.
*/
create or replace function public.identify_for_comment(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.comment_links;
  v_id   uuid;
begin
  select * into v_link
  from public.comment_links
  where token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_link.id is null or v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'this link is not valid');
  end if;

  if position('@' in coalesce(p_email, '')) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'an email address is needed before commenting');
  end if;

  insert into public.comment_visits (link_id, run_id, identified_as)
  values (v_link.id, v_link.run_id, btrim(p_email))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'visitId', v_id, 'identifiedAs', btrim(p_email));
end;
$$;

comment on function public.identify_for_comment is
  'Records who says they are looking at a report, whether or not they comment. Self-declared and unverified (D-063).';

/*
  Submitting a comment.

  Inserts. Never updates: a revision is another row, and both stay readable with their times
  (D-002). The body is stored exactly as written.
*/
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
  v_id    uuid;
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

  insert into public.merchant_comments (run_id, link_id, visit_id, identified_as, rule_id, ordinal, body)
  values (v_link.run_id, v_link.id, v_visit.id, v_visit.identified_as, p_rule_id, p_ordinal, p_body)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.submit_merchant_comment is
  'Records a merchant comment verbatim against one finding. Append-only: a revision is another row.';

grant execute on function public.open_report_for_comment(text) to anon, authenticated;
grant execute on function public.identify_for_comment(text, text) to anon, authenticated;
grant execute on function public.submit_merchant_comment(text, text, integer, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The analyst-side control: inviting is a job, not a form submission
-- ---------------------------------------------------------------------------------------------
--
-- Frank's ruling: **the link is sent from the tool, not copied by an analyst into their own
-- email.** Mintro holds the record of what was sent, to whom, and when, without reconstructing it
-- later from someone's sent folder.
--
-- That ruling has a consequence the frontend cannot satisfy on its own. If the browser minted the
-- token it would hold the plaintext, and "Mintro sent this" would become "Mintro generated
-- something an analyst may or may not have pasted somewhere". So the analyst enqueues an intent
-- and the worker does the issuing — the same shape as `scan_requests` and `pdf_requests`, for the
-- reason D-035 gives: a second job mechanism with its own semantics is a second thing to get
-- wrong.
--
-- The analyst supplies one thing, the address. Everything that makes the invitation an invitation
-- — the token, its digest, the expiry, the composed text, the transmission — happens worker-side.

create table public.comment_invites (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete restrict,
  requested_by  uuid not null references public.analysts (id) on delete restrict,

  -- Where to send it. Not who may use it: the link is forwardable, and this records Mintro's
  -- action rather than constraining the merchant's (D-063).
  send_to       text not null check (position('@' in send_to) > 1),

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),

  -- The link this job produced. The token is not here and is not anywhere.
  --
  -- The row is written before the send is attempted, because the digest has to be stored before
  -- the token can be in anyone's inbox. If the send then fails, the link survives as a working
  -- token that **nobody holds** — inert, since the plaintext was discarded with the job.
  link_id       uuid references public.comment_links (id) on delete restrict,

  /*
    What carried it — and why this is not cosmetic.

    Resend's sending domain is not verified yet, so a send today is composed and not transmitted.
    A link that exists but never left the building would otherwise render as `unopened`, and
    `unopened` reads as *the merchant did not look*. That is Mintro's gap presented as the
    merchant's silence — D-044 exactly, in the one place it would be least visible.

    It lives here rather than on `comment_links` because it is an outcome, and `comment_links` is
    append-only but for `first_opened_at`. A second mutable column there would weaken the
    guarantee that makes the invitation record trustworthy at all.

    `dry_run` means **nobody was invited**, whatever the existence of a link row suggests.
  */
  delivery      text check (delivery in ('resend', 'dry_run')),
  error         text,

  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- The same two refusals as the other two queues. A finished job that says nothing about what
  -- happened is the shape every defect in this project has taken.
  constraint finished_invites_have_a_link check (
    status <> 'done' or (link_id is not null and delivery is not null)
  ),
  constraint failed_invites_say_why check (
    status <> 'failed' or error is not null
  )
);

comment on column public.comment_invites.delivery is
  'Whether the invitation was transmitted or only composed. ''dry_run'' means nobody was invited — the report must not present it as merchant silence.';
comment on table public.comment_invites is
  'Queue of merchant invitations. The analyst supplies an address; the worker mints the token, stores its digest, and sends. The token never reaches a browser.';

alter table public.comment_invites enable row level security;

create policy comment_invites_select on public.comment_invites
  for select to authenticated
  using (public.is_analyst());

create policy comment_invites_insert on public.comment_invites
  for insert to authenticated
  with check (public.is_analyst() and requested_by = auth.uid() and status = 'queued');

revoke update, delete on public.comment_invites from authenticated, anon;

create index comment_invites_queue_idx on public.comment_invites (status, created_at);
create index comment_invites_run_idx on public.comment_invites (run_id, created_at desc);
