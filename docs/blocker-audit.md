# Blocker-tier audit — the eleven candidates

> **Status, 2026-08-28.** This is the audit **as found**, kept as the record of what was wrong.
> Three rulings and a repair followed it and parts of it are now historical:
>
> - **D-157** — PROD-005, PROD-008 and OFFS-002 **left the list**; they are `review_only` and a
>   blocker tier may not override hard constraint 4 by side effect. **The candidates are eight.**
> - **D-158** — PAY-001's open item in §1 is **closed**: the floor is the homepage footer and the
>   terms document, checked before any term is matched.
> - **D-159** — the plural blindness in §2 and the three false-decline matchers in §3 are
>   **repaired**, with two-sided fixtures. §2's table now reads *match* on every row.
>
> §4 (evidence sufficiency) and §5 (the two rulings the audit could not make) stand as written,
> except that §5's first item is what D-157 settled. The 54-rule matrix is in the appendix.

Run after the D-156 acquisition ruling was applied, so every statement below describes current
behaviour. Supersedes the brief in `docs/blocker-audit-brief.md`, which stays for the framing.

The candidates:

| | rule | subject | type | tier | layer |
|---|---|---|---|---|---|
| 1 | CATG-001 | needles or syringes | `url_pattern` | auto_fail | 0 |
| 2 | CATG-002 | alcohol wipes | `url_pattern` | auto_fail | 0 |
| 3 | CATG-003 | HCG or HGH | `url_pattern` | auto_fail | 0 |
| 4 | CATG-004 | tablets or pills | `url_pattern` | auto_fail | 0 |
| 5 | NAME-001 | therapeutic categories | `url_pattern` | auto_fail | 0 |
| 6 | PROD-005 | dosing information | `text_cooccurrence` | **review_only** | 2 |
| 7 | PROD-006 | pharmaceutical brand names | `text_match` | auto_fail | 2 |
| 8 | PROD-007 | route-of-administration labels | `text_match` | auto_fail | 2 |
| 9 | PROD-008 | disease claims | `text_match` | **review_only** | 2 |
| 10 | OFFS-002 | testimonials and outcome content | `dom_assert` | **review_only** | 2 |
| 11 | PAY-001 | peer-to-peer payment methods | `text_match` | auto_fail | 3 |

---

## The expect split — confirmed, with one qualification

**Your reading is correct.** Ten of the eleven carry an explicit `expect: "absent"`. The eleventh,
PROD-005, has no `expect` field at all: it is `text_cooccurrence`, whose violation is a
co-occurrence *found*, so `hits.length === 0` resolves to satisfied. It is absent-shaped by
construction rather than by declaration.

**So all eleven drift toward false clean. None drifts toward false decline.** No candidate can
auto-decline a merchant because our acquisition fell short.

That is the reassuring half, and it decides the question you asked it to decide — but only for one
of the two ways a rule can be wrong, and the audit found the other one live.

### The qualification that matters

`expect: absent` protects against **acquisition** failure. It does nothing about **matching**
failure, and the two are independent axes:

| | drifts toward | found in the eleven? |
|---|---|---|
| acquisition falls short | false clean (after D-156, `not_evaluable`) | closed |
| the matcher fails to recognise the subject | **false clean** | **open — see §2** |
| the matcher recognises the wrong thing | **false decline** | **open — see §3** |

An `expect: absent` rule whose matcher cannot see a plural is a false clean that no amount of
acquisition hardening reaches. And a rule that matches the wrong thing still declines wrongly,
`expect: absent` notwithstanding — PROD-008 fires on the FDA compliance disclaimer on every
storefront tested.

---

## 1 — Network sensitivity, per candidate (Q4)

After D-156. "Verdict varies" means the same storefront can produce different `pass`/`fail`
answers on different runs.

| rule | verdict varies with network? | what a shortfall now produces |
|---|---|---|
| CATG-001 | **no** | `not_evaluable` / `not_retrieved` when the URL surface is incomplete |
| CATG-002 | **no** | as above |
| CATG-003 | **no** | as above |
| CATG-004 | **no** | as above |
| NAME-001 | **no** | as above |
| PROD-005 | **no** | `not_evaluable` / `not_retrieved` when any sampled page failed to render |
| PROD-006 | **no** | as above |
| PROD-007 | **no** | as above |
| PROD-008 | **no** | as above |
| OFFS-002 | **no** | as above; a selector never evaluated is `not_evaluable`, not "none found" |
| PAY-001 | **partly — see below** | `not_evaluable` when no surface was read |

**Ten of eleven are now closed.** Before D-156 the same table read *yes* for the five
`url_pattern` rules (a partially fetched sitemap read as a clean scan) and *yes* for the five
Layer 2 rules (a partial sample was evaluated over the survivors).

**PAY-001 is the exception and it is not fully closed.** `checkPaymentTerms` requires at least one
surface to have been read, and returns `not_evaluable` when none was — that guard is correct. But
it does not distinguish *four* surfaces read from *one*. A run that reached the footer and failed
to reach the terms, shipping, FAQ and payment pages returns `pass` on the footer alone, and the
note names the surfaces read, so the shortfall is stated rather than hidden. Under D-156 that is
still a verdict on data not fully obtained.

It is not fixed here because the fix is not mechanical: the Layer 3 surfaces are *discovered*, not
enumerated, so "all of them" has no definition — a merchant with no FAQ and a merchant whose FAQ we
failed to reach are not distinguishable from the candidate list alone. Deciding what completeness
means for a discovered surface set is a business ruling, and it is the one thing this audit cannot
close on its own.

### GATE-002 and GATE-003 are not candidates, and that is worth noting

The two rules that prompted the question are not on the list of eleven. They are now the
best-guarded rules in the set — D-156 closed both — while the candidates that *are* on the list
were carrying the same defect unexamined.

---

## 2 — The matcher cannot see plurals (false clean, five candidates)

`findMatches` compares **token sequences**, not substrings: a path is split on separators and a
pattern matches only as an exact contiguous run of tokens. So `tablet` does not match `tablets`.

Driven against the real handler:

| rule | pattern | URL | result |
|---|---|---|---|
| CATG-001 | `syringe` | `/product/syringes-10pack/` | **miss** |
| CATG-001 | `needle` | `/product/needles/` | **miss** |
| CATG-002 | `alcohol-wipe` | `/product/alcohol-wipes/` | **miss** |
| CATG-002 | `prep-pad` | `/product/alcohol-prep-pads/` | **miss** |
| CATG-003 | `hcg` | `/product/hcg5000/` | **miss** (no separator, one token) |
| CATG-004 | `tablet` | `/product/mk-677-tablets/` | **miss** |
| CATG-004 | `pill` | `/product/rad-140-pills/` | **miss** |
| CATG-004 | `softgel` | `/product/60-softgels/` | **miss** |
| NAME-001 | `nootropic` | `/collections/nootropics/` | **miss** |

The singular is the *less* natural way to name a product page. "Alcohol wipes", "needles",
"tablets" are how these are sold, and every one of them passes.

**Present in real catalogues.** Across the 817 catalogue URLs in the four stored runs, 33 carry a
plural form of a CATG pattern, and `swisschems.is/product-category/nootropics/` is a live
`collections` URL that NAME-001's `nootropic` does not match. NAME-001 already fails swisschems on
another collection, so the outcome there is unchanged — but a merchant whose only offending
collection is `nootropics` passes.

This is the hard-constraint-9 shape in the `expect: absent` direction: **the check locates its
subject by one particular spelling and is blind to every instance written the other way.** It is
the same defect as PROD-005's `5mg`, in a different matcher, on five more candidates.

Not fixed here. Fixing it is a ruleset change and carries a decision number (CLAUDE.md conventions),
and widening a pattern list is exactly the kind of change that should not be made inside an audit.

---

## 3 — Matchers that recognise the wrong thing (false decline)

`expect: absent` does not protect against this, and two candidates carry it badly.

**PROD-008** — established in Phase 0 and unchanged. Substring matching with no word boundary, over
the whole rendered page. On the storefronts tested its matches were: the FDA compliance disclaimer
(*"not intended to diagnose, treat, cure or prevent any disease"* — four terms at once), `cure`
inside "se**cure** checkout", `condition` inside the footer's "Terms & Conditions", `therapeutic`
inside a citation title, and `heal` inside the product's own name "Healing Research Bundle". **It
fires on every peptide storefront tested, and the compliant disclaimer is its single largest hit
source.**

**OFFS-002** — `dom_assert`, selector `[class*=review], [class*=testimonial], [data-product-reviews]`,
`expect: absent`. Two problems in one selector. `[class*=review]` is a substring match on class
names, so it matches `class="preview"`, `class="review-policy-link"`, and any theme that uses the
token incidentally. And in the other direction it locates the subject by a *class name the merchant
chose*: a testimonial section built with `class="customer-stories"` is invisible. Constraint 9 in
both directions at once. It passed on all five validation storefronts, which given how common
review widgets are on WooCommerce is more likely a false clean than a clean catalogue.

**PROD-007** — `word_boundary: true`, so it avoids PROD-008's substring problem. But its terms are
`injectable`, `nasal spray`, `for injection`, `subcutaneous`, `intramuscular`, matched over the
whole page including research-literature summaries and citation titles. It **failed**
biotechpeptides on the Aug-23 run, and biotechpeptides' product pages carry paper abstracts. Whether
that fail is the merchant's copy or a cited paper's is not distinguishable from the finding, and it
is `auto_fail`.

**PROD-006** — the safest matcher of the eleven. Eight brand names, `word_boundary: true`, all
distinctive proper nouns (`Ozempic`, `Wegovy`, `Mounjaro`…). Low false-positive risk. Its exposure
is third-party content: a cited paper or a customer comment naming Ozempic would auto-fail. Passed
on four of five storefronts.

---

## 4 — Evidence sufficiency (Q3)

| rule | capture backing a finding | re-verifiable months later? |
|---|---|---|
| CATG-001–004, NAME-001 | the stored sitemap document, SHA-256, matched URLs | **yes** |
| PROD-005 | full-page screenshot + DOM hash; `matchedValue` is a **detokenised reconstruction**, not the merchant's text | page yes, quoted excerpt no |
| PROD-006, PROD-007, PROD-008 | full-page screenshot + DOM hash; `matchedValue` is a **list of term names**, not the sentences | page yes, the specific claim no |
| OFFS-002 | full-page screenshot + DOM hash; the selector match count | yes |
| PAY-001 | **none — `evidenceKey: ''`, `sourceSha256: ''`, `sourceUrl` is the first surface read, not the one the term was found on** | **no** |

PAY-001 remains the weakest and is unchanged since Phase 0. On swisschems its `fail` on `Zelle`
cites the homepage; the term was on `/payments/`, whose capture exists in the evidence set and is
not referenced. It is the only candidate that reaches `fail` with no capture at all.

---

## 5 — Two rulings this audit cannot make

**Three candidates are `tier: review_only`.** PROD-005, PROD-008 and OFFS-002 are marked
`review_only` in the rule set, and hard constraint 4 is explicit: *"Rules marked `review_only` go to
a human queue regardless of confidence… Severity never overrides this — see D-009."* A blocker tier
that auto-declines on any of the three collides head-on with that constraint and with D-009's rule
that state comes from two inputs only. Either the tier means something other than automatic decline
for these three, or the constraint is being amended — and that is a business ruling, not an
engineering one.

Worth noting which three they are: they are the three with the worst matchers in the set.

**PAY-001's surface completeness.** §1. What "all the surfaces" means for a discovered set needs
defining before the D-156 rule can be applied to it.

---

## 6 — Summary

| | |
|---|---|
| Can a candidate's verdict vary with network conditions? | **No, for ten of eleven.** PAY-001 partly — a verdict on one surface where four were sought |
| Does the finding distinguish our failure from merchant absence? | **Yes**, via `notEvaluableKind` — `not_retrieved` vs `not_exposed`. Correct on all eleven after D-156; GATE-003 was the one populating it wrongly and is fixed |
| Do all eleven drift toward false clean? | **Yes, on the acquisition axis.** Not on the matching axis: PROD-007, PROD-008 and OFFS-002 can decline wrongly |
| Ready to gate an automatic decline? | **Not as a set.** Five have a demonstrated plural blindness; three are `review_only` and cannot auto-fail under constraint 4; one (PAY-001) reaches `fail` with no capture |

The narrowest set that could gate a decline today, on this audit's evidence, is **PROD-006** —
distinctive terms, word boundaries, `auto_fail`, acquisition-guarded, evidence-backed — with its
third-party-content exposure stated. Every other candidate has at least one open item above.

---

# Appendix — the 54-rule matrix (D-159 sweep)

How every rule locates its subject, and whether that locator was form-dependent. Generated from
`rules/ruleset.json`; `wb` is `word_boundary`.

Counts: **26** repaired by D-159 · **11** `manual`, not evaluated by the crawl · **3** structural
(request outcome or resolved style, no term matching) · **14** `dom_assert` / `doc_parse` reviewed
individually below.

| rule | cat | type | tier | expect | wb | how it locates its subject | form-blindness |
|---|---|---|---|---|---|---|---|
| CATG-001 | catalog | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| CATG-002 | catalog | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| CATG-003 | catalog | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| CATG-004 | catalog | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| CATG-005 | catalog | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| CATG-006 | catalog | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| CATG-007 | catalog | `url_pattern` | review_only | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| COA-001 | coa | `dom_assert` | review_only | present | — | CSS selector / link text / region | SEE NOTES |
| COA-002 | coa | `doc_parse` | auto_fail | — | — | patterns over a fetched document | SEE NOTES |
| COA-003 | coa | `doc_parse` | auto_fail | — | — | patterns over a fetched document | SEE NOTES |
| COA-004 | coa | `doc_parse` | review_only | — | — | patterns over a fetched document | SEE NOTES |
| COA-005 | coa | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| COA-006 | coa | `doc_parse` | review_only | — | — | patterns over a fetched document | SEE NOTES |
| COMM-001 | comms | `text_cooccurrence` | review_only | — | — | alphanumeric-split token windows | fixed D-159 |
| COMM-002 | comms | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| COMM-003 | comms | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| DISC-001 | disclose | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| DISC-002 | disclose | `computed_style` | auto_fail | — | — | resolved style of located text | structural |
| DISC-003 | disclose | `dom_assert` | auto_fail | present | — | CSS selector / link text / region | SEE NOTES |
| FULF-001 | fulfil | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| FULF-002 | fulfil | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| FULF-003 | fulfil | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| FULF-004 | fulfil | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| FULF-005 | fulfil | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| GATE-001 | gate | `dom_assert` | review_only | present | — | CSS selector / link text / region | SEE NOTES |
| GATE-002 | gate | `http_probe` | auto_fail | status seen | — | request outcome per path | structural |
| GATE-003 | gate | `flow_probe` | auto_fail | stage reached | — | flow stage reached | structural |
| GATE-004 | gate | `dom_assert` | review_only | present | — | CSS selector / link text / region | SEE NOTES |
| GATE-005 | gate | `dom_assert` | review_only | present | — | CSS selector / link text / region | SEE NOTES |
| GATE-006 | gate | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| GATE-007 | gate | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| NAME-001 | naming | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| NAME-002 | naming | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| NAME-003 | naming | `text_match` | review_only | — | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| OFFS-001 | offsite | `url_pattern` | auto_fail | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| OFFS-002 | offsite | `dom_assert` | review_only | absent | — | CSS selector / link text / region | SEE NOTES |
| OFFS-003 | offsite | `dom_assert` | review_only | — | — | CSS selector / link text / region | SEE NOTES |
| OFFS-004 | offsite | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| OFFS-005 | offsite | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| OFFS-006 | offsite | `url_pattern` | review_only | absent | — | inflection-aware token sequence over the URL path | fixed D-159 |
| OFFS-007 | offsite | `dom_assert` | review_only | absent | — | CSS selector / link text / region | SEE NOTES |
| PAY-001 | payment | `text_match` | auto_fail | absent | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| PAY-002 | payment | `manual` | review_only | — | — | not evaluated by the crawl | n/a |
| PAY-003 | payment | `dom_assert` | review_only | present | — | CSS selector / link text / region | SEE NOTES |
| PROD-001 | product | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-002 | product | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-003 | product | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-004 | product | `text_match` | review_only | present | no | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-005 | product | `text_cooccurrence` | review_only | — | — | alphanumeric-split token windows | fixed D-159 |
| PROD-006 | product | `text_match` | auto_fail | absent | yes | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-007 | product | `text_match` | auto_fail | absent | yes | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-008 | product | `text_match` | review_only | absent | yes | term list over rendered sentences, scoped to claims | fixed D-159 |
| PROD-009 | product | `dom_assert` | review_only | absent | — | CSS selector / link text / region | SEE NOTES |
| PROD-010 | product | `text_match` | review_only | absent | yes | term list over rendered sentences, scoped to claims | fixed D-159 |

## The fourteen selector and document rules

None is in the blocker eight — OFFS-002 left the list under D-157 — and the sweep found no second
instance of the plural/unspaced defect in them, because none matches free text against a term list.
Two are worth naming:

**DISC-003** is `auto_fail`, `critical` and `expect: present`. It is the only rule in the set whose
degraded direction is a **false decline**: an under-rendered page makes a displayed disclaimer look
absent and the merchant fails for it. D-156 closed the acquisition half — a partial sample is now
`not_evaluable` — but a page that renders successfully and incompletely is not covered by anything.
It is the first candidate for the next sweep.

**COA-002 and COA-003** are `auto_fail` and depend on a certificate being fetched and parsed. They
carry no `expect`, so their degraded direction has to be read from the handler rather than the rule;
they were not examined in depth here and are the second candidate.

Everything else in the fourteen is `review_only` and cannot gate a decline.
