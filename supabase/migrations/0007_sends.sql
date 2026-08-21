-- 0007 — sends
--
-- D-001: send is never blocked by an outcome. Because of that, this table is the only record of
-- what went out and when — which makes it load-bearing rather than incidental.
--
-- It records rejections as well as acceptances. "We tried to send and the provider refused it" is
-- precisely the fact a dispute turns on, and a log of successes only answers the easy half.

create table public.sends (
  id                        uuid primary key default gen_random_uuid(),
  run_id                    uuid not null references public.runs (id) on delete restrict,
  to_email                  text not null,
  resend_id                 text,
  sent_at                   timestamptz not null default now(),

  -- Who triggered it. Kept both as a reference and as the email at the time, because an analyst
  -- may later be deactivated and the record must still say who sent it.
  sent_by                   uuid references public.analysts (id) on delete set null,
  sent_by_email             text not null,

  outcome                   text not null check (outcome in ('accepted', 'rejected')),
  error                     text,
  attachment_bytes          integer not null default 0,

  -- D-029: the analyst's covering note, what the audit flagged in it, and whether they were shown
  -- the warning and sent anyway. Nothing was prevented; this is what makes it visible.
  note                      text not null default '',
  note_flagged              text[] not null default '{}',
  note_warning_acknowledged boolean not null default false,

  created_at                timestamptz not null default now(),

  constraint accepted_sends_have_a_provider_id check (
    outcome <> 'accepted' or resend_id is not null
  )
);

comment on table public.sends is
  'Every send attempt, accepted or rejected. The only record of what went out (D-001).';
comment on column public.sends.note_flagged is
  'Directive language found in the covering note at send time (D-029). Empty when clean.';

alter table public.sends enable row level security;

create policy sends_select on public.sends
  for select to authenticated
  using (public.is_analyst());

revoke insert, update, delete on public.sends from authenticated, anon;

-- A send record is a fact about something that already happened.
create trigger sends_are_append_only
  before update or delete on public.sends
  for each row execute function public.reject_mutation();

create index sends_run_idx on public.sends (run_id, sent_at desc);
create index sends_flagged_idx on public.sends (sent_at desc) where cardinality(note_flagged) > 0;
