-- ================================================================================================
-- 0046 — merchants.domain is folded, and the table says so (D-150)
-- ================================================================================================
--
-- `merchants.domain` is the crawl's identity for a merchant, and it had two writers that disagreed
-- about its shape.
--
--   the crawl        `new URL(url).host` — the WHATWG parser lowercases the host, always
--   the package form `domain.trim()` — whatever an analyst typed
--
-- `ensure_merchant` looked the domain up with `where domain = trim(p_domain)`, and `domain` carries
-- a plain case-sensitive `unique`. So typing `Shop.Example` for a storefront already stored as
-- `shop.example` found nothing, inserted, and was **not** refused by the constraint.
--
-- The result is a merchant split in two: their Site Check runs hang off one row and their Documents
-- Check package off another, with nothing joining them. Reproduced against the real migrations
-- before this was written; `apps/worker/test/schema/merchantDomain.test.ts` reproduces it still, by
-- failing if this migration is removed.
--
-- ## Folded at write, and stated as a constraint
--
-- Two changes, and the second is the one that lasts. Normalising in `ensure_merchant` fixes the
-- writer that was wrong. The check constraint fixes **every writer**, including the ones nobody has
-- written yet — which is the difference between a bug fixed and an invariant held.
--
-- `credential_deposits.merchant_domain` has carried exactly this constraint since 0013. The one
-- place the rule was written down is the one place it held, and that is the whole argument for
-- writing it down here too.
--
-- ## No rows change
--
-- Surveyed before writing this: seven rows, every one already lowercase, no pair colliding under a
-- fold. Every one of them came from the crawl, which had it right. Nothing is rewritten, nothing is
-- merged, and no `runs.merchant_id` is repointed — so nothing here touches a run, and D-002 is not
-- in play. Had two rows collided, merging them would have meant repointing runs at a different
-- merchant, which **is** a write to a run and would have needed a ruling first.

-- ------------------------------------------------------------------------------------------------
-- The invariant
-- ------------------------------------------------------------------------------------------------
--
-- Deliberately the same expression as `credential_deposits.merchant_domain`, character for
-- character. Two spellings of one rule is how the two writers came to disagree in the first place.
--
-- It rejects an uppercase letter rather than folding one, because this constraint is the backstop:
-- anything reaching it unfolded is a writer that has not been taught, and silently accepting it
-- would leave that writer undiscovered.

alter table public.merchants
  add constraint merchants_domain_is_folded
  check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$');

comment on column public.merchants.domain is
  'The storefront host, lowercase. The crawl writes new URL(url).host; every other writer folds to match (D-150).';

-- ------------------------------------------------------------------------------------------------
-- The writer that was wrong
-- ------------------------------------------------------------------------------------------------
--
-- Unchanged but for the folding: same signature, same DBA rule, same synthesised placeholder for a
-- documents package with no storefront.
--
-- Note that only the three-argument form exists — 0034 dropped 0033's two-argument version — so
-- this is the one live definition and 0033's body is dead text kept for the record.

create or replace function public.ensure_merchant(
  p_legal_name text,
  p_domain     text default null,
  p_dba        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_dba    text := nullif(trim(coalesce(p_dba, '')), '');
  -- Folded once, here, and used for both the lookup and the insert. Computing it twice is how the
  -- two came to differ in the first place.
  v_domain text := nullif(lower(trim(coalesce(p_domain, ''))), '');
begin
  if not public.is_analyst() then
    raise exception 'only an active analyst may create a merchant';
  end if;
  if coalesce(trim(p_legal_name), '') = '' then
    raise exception 'a merchant needs a legal name';
  end if;

  if v_domain is not null then
    select id into v_id from public.merchants where domain = v_domain;
    if v_id is not null then
      -- Fill a blank, never overwrite. A DBA already on the row was typed by somebody who had the
      -- merchant in front of them; a later form filled in from memory does not get to replace it.
      update public.merchants set dba = v_dba where id = v_id and dba is null and v_dba is not null;
      return v_id;
    end if;
  end if;

  insert into public.merchants (legal_name, domain, dba)
  values (
    trim(p_legal_name),
    /*
      A documents package may have no storefront, so one is synthesised rather than left blank: a
      placeholder that is visibly a placeholder beats an empty string that reads as a real value.

      Lowercase by construction — `gen_random_uuid()` renders lowercase hex — so it satisfies the
      constraint above without needing to know about it.
    */
    coalesce(v_domain, 'no-domain.' || replace(gen_random_uuid()::text, '-', '') || '.invalid'),
    v_dba
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_merchant(text, text, text) from public, anon;
grant execute on function public.ensure_merchant(text, text, text) to authenticated;
