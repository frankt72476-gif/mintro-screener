-- 0015 — runs whose GATE-003 concluded from absence
--
-- The first quarantine for a **wrong conclusion** rather than unretrievable evidence, and the
-- distinction matters to anyone reading `run_quarantine`. D-033 and D-034 froze runs whose
-- evidence could not be resolved: those runs are incomplete. These runs are complete, their
-- evidence retrievable, and their GATE-003 finding may say something that was never observed.
--
-- ## What was wrong
--
-- `runCheckoutFlow` returned the stage `checkout` from wherever it happened to be standing. On a
-- store whose empty-cart `/checkout` redirects elsewhere — swisschems.is answers with `/shop/` —
-- the flow reported a product listing as "it stopped at 'checkout'". GATE-003 is
-- `fail_if: payment_step_reached`, so no payment field meant **pass**.
--
-- The cart was the cause: WooCommerce adds over AJAX, and the flow proceeded on the strength of
-- a click having landed. Verified after the fix: with the cart confirmed populated, swisschems.is
-- serves `input[autocomplete="cc-number"]` at `/checkout/` on 8 runs out of 8. It fails GATE-003.
--
-- ## The test, and what the annotation may claim
--
-- How the finding *reasoned*, not what it concluded:
--
--   * a `pass` reasoning from "redirected to a sign-in page" stands. That is a positive
--     observation of where the flow ended, and the fix does not change it.
--   * a `pass` reasoning from "it stopped at 'checkout'" does not. The payment field was absent
--     from a page never established as checkout.
--
-- The annotation says the finding **may not describe what it appears to describe**. It does not
-- assert these merchants fail GATE-003 — swisschems.is is known to because it was verified
-- directly, and about the others nothing is known. Asserting a failure here would repeat the
-- original defect with the sign reversed (D-056).
--
-- Re-scanning any of these produces a new, immutable run with the fix in place (D-002). Nothing
-- here edits a run: `run_quarantine` is a separate statement about one, and its append-only
-- trigger from 0012 still applies.

insert into public.run_quarantine (run_id, reason)
select r.id,
       'GATE-003 on this run concluded from the absence of a payment field on a page that was '
       || 'never established as a checkout page (D-056). The scripted flow proceeded before the '
       || 'cart was confirmed to hold an item, so it could reach a redirect target rather than '
       || 'checkout and report "stopped at checkout". This finding may not describe what it '
       || 'appears to describe. It is not known from this run whether the merchant offers guest '
       || 'checkout; re-scanning produces a new run with the flow corrected.'
from public.runs r
where r.status = 'complete'
  and r.report is not null
  -- The GATE-003 finding, wherever it sits in the stored report.
  and exists (
    select 1
    from jsonb_array_elements(r.report -> 'categories') as category,
         jsonb_array_elements(category -> 'findings') as finding
    where finding ->> 'ruleId' = 'GATE-003'
      and finding ->> 'state' = 'pass'
      -- Reasoned from absence. A pass that names the sign-in redirect is a positive observation
      -- and is deliberately not matched.
      and finding ->> 'note' like '%stopped at ''checkout''%'
  )
on conflict (run_id) do nothing;

comment on table public.run_quarantine is
  'Runs whose findings are known to be unreliable — evidence that cannot be retrieved (D-033, D-034), or a conclusion drawn from absence (D-056). An annotation on an immutable run, never an edit of one.';
