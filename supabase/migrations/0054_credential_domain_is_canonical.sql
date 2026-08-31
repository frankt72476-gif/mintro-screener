-- ================================================================================================
-- 0054 — a storefront's credential has one key, and `www` is not part of it
-- ================================================================================================
--
-- `www.merchant.com` and `merchant.com` are one storefront and were two vault keys.
--
--   the deposit  folded whatever an analyst typed into the credential modal — a field D-185 made
--                editable, so it need not be the URL in the scan form
--   the lookup   folded `new URL(request.url).hostname`
--
-- Both folded correctly. They were folding **different strings**, and neither could tell.
--
-- The failure points the wrong way, which is what makes it worth a migration rather than a note.
-- `vault.open` answering nothing is indistinguishable from nothing having been deposited, and the
-- run reports it in D-185's exact words for that other case — *"no screening account is stored for
-- this merchant"*. A credential the merchant did supply is reported as one they never supplied,
-- and whoever holds the relationship is sent to ask them for it again. Same shape as D-036: a
-- control that cannot tell *"there is nothing here"* from *"I looked in the wrong place"*.
--
-- `canonicalMerchantDomain` now folds the label, in one function both the browser and the worker
-- import — for the reason `sealed.ts` is one function (D-038, D-034): a format with two
-- implementations agrees until it does not, and what would diverge here is which merchant a
-- screening account belongs to.
--
-- ## Why the stored rows have to move with it
--
-- Without this file the code change is a regression rather than a fix. A credential deposited today
-- for `www.merchant.com` sits at `merchants/www.merchant.com/credentials`; after the fold the crawl
-- looks at `merchants/merchant.com/credentials` and finds nothing — the same false "never supplied"
-- as before, now caused by us. Real storefronts are commonly typed with the label (comopeptides is
-- `www.comopeptides.com`), so this is the likely case rather than the exotic one.
--
-- ## Neither table is append-only, and both say so
--
-- `vault_entries` — *"Deliberately NOT append-only. Sessions are rewritten as they are
-- re-established and cleared when they go stale"* (0013). `credential_state` — *"Not append-only,
-- deliberately. Unlike `credential_access` this is current state rather than an audit trail"*
-- (0048). D-002 and hard constraints 5 and 8 name runs, findings and evidence. None of those is
-- here: no run row is touched, no `runs.merchant_id` is repointed, and no evidence exists in either
-- table. This is the same reasoning D-150 recorded for folding `merchants.domain` in place.
--
-- `credential_access` is untouched. It is the audit trail, it is append-only by trigger, and a
-- migration that rewrote history to match a new key would be destroying the record of what actually
-- happened under the old one.
--
-- `credential_deposits` needs nothing. Pending envelopes are drained through `vaultRefFor`, which
-- now folds, so they land canonical on their own.
--
-- ## Nothing is destroyed, and that is the collision rule
--
-- A row moves **only** where its canonical target does not already exist. Where a storefront has
-- entries under both forms, the canonical one is what the crawl now reads and the labelled one is
-- left exactly where it is — orphaned but intact.
--
-- Deleting it would be the tidier outcome and it is not available. There is no recovery for a
-- credential (D-038): the private key is the only reader, nobody in this application can compare
-- the two values, and *"I could not tell which of these is current"* is not grounds for destroying
-- one of them. An orphaned row costs storage. The other mistake costs an email to a merchant and
-- is unrecoverable.
--
-- Idempotent: re-running moves nothing, because after the first pass no row's path still carries
-- the label.

-- ------------------------------------------------------------------------------------------------
-- The fold, as SQL
-- ------------------------------------------------------------------------------------------------
--
-- Mirrors `canonicalMerchantDomain` exactly, including its bound: the label is stripped only where
-- what remains is still a domain, so `www.com` keeps its own name rather than becoming `com`.
--
-- `immutable` so it can be used in the predicates below and read as a pure function of its input.

create or replace function public.canonical_merchant_domain(p_domain text)
returns text
language sql
immutable
as $$
  select case
    when p_domain like 'www.%'
     and substring(p_domain from 5) ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
    then substring(p_domain from 5)
    else p_domain
  end;
$$;

comment on function public.canonical_merchant_domain(text) is
  'Folds a leading www. where the remainder is still a domain. Mirrors canonicalMerchantDomain in @mintro/engine (0054).';

revoke all on function public.canonical_merchant_domain(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- vault_entries
-- ------------------------------------------------------------------------------------------------
--
-- Paths are `merchants/<domain>/credentials` and `merchants/<domain>/session`. Only the domain
-- segment moves; the suffix is carried across untouched.

update public.vault_entries as v
set path = 'merchants/'
        || public.canonical_merchant_domain(split_part(v.path, '/', 2))
        || '/'
        || split_part(v.path, '/', 3)
where v.path like 'merchants/www.%/%'
  and public.canonical_merchant_domain(split_part(v.path, '/', 2)) <> split_part(v.path, '/', 2)
  -- Nothing is overwritten and nothing is deleted. A storefront holding both forms keeps both.
  and not exists (
    select 1
    from public.vault_entries as existing
    where existing.path = 'merchants/'
                       || public.canonical_merchant_domain(split_part(v.path, '/', 2))
                       || '/'
                       || split_part(v.path, '/', 3)
  );

-- ------------------------------------------------------------------------------------------------
-- credential_state
-- ------------------------------------------------------------------------------------------------
--
-- Keyed the same way for the same reason: the card reads this table for the domain in the scan
-- form while the crawl opens the vault for the hostname in the queued URL. If the two folded
-- differently the card would say a login is stored for a storefront the crawl reports has none —
-- two surfaces disagreeing about one merchant, which is the confusion D-185 built it to end.

update public.credential_state as c
set merchant_domain = public.canonical_merchant_domain(c.merchant_domain)
where c.merchant_domain like 'www.%'
  and public.canonical_merchant_domain(c.merchant_domain) <> c.merchant_domain
  and not exists (
    select 1
    from public.credential_state as existing
    where existing.merchant_domain = public.canonical_merchant_domain(c.merchant_domain)
  );

-- ------------------------------------------------------------------------------------------------
-- No policy changes
-- ------------------------------------------------------------------------------------------------
--
-- Stated because it is the thing to check when reading a migration that touches these tables.
-- `vault_entries` still has no policy of any kind and `revoke all` still stands. `credential_state`
-- still offers `select` to analysts and nothing else. `credential_deposits` still refuses `select`
-- to everyone but the worker. Nothing here grants, and nothing here relaxes.
