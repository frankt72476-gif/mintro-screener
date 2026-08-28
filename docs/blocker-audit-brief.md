# Blocker-tier audit — brief

**Status: queued. Not started.** This file holds the questions the audit must answer and the
groundwork already done, so none of it is re-derived when the audit runs.

**Blocked on one input:** the eleven blocker candidates are not named anywhere in this repository.
Three are known from the Phase 0 brief — PROD-005, PROD-008, PAY-001. The other eight need to be
supplied before the audit can be run per-rule. Everything below is written to be answerable
whichever eleven they are.

---

## Q1–Q3 — carried from Phase 0

Answered for the three known candidates in `docs/eyetest-phase0-findings.md` §3: how each locates
its subject, what would cause a false positive, and whether the evidence supports re-verification.
Not repeated here.

---

## Q4 — Can the result vary with network conditions rather than with what the storefront shows?

**Added 2026-08-28, prompted by the A/B verification in `868bcce`.**

### What prompted it

Run `5506488a` (sportstechnologylabs, throttled) produced GATE-002 and GATE-003 results differing
from **both** the Aug-23 baseline and the post-change re-run — on rules that were not modified.

| | GATE-002 | GATE-003 |
|---|---|---|
| Aug-23 baseline, ruleset 2.9.0 | `fail` | `pass` |
| Run 5506488a, 2026-08-28 (throttled) | `not_evaluable` | `not_evaluable` |
| Post-change re-run, same afternoon | `fail` | `pass` |

Same storefront, same rule set, three runs, two different answers. The difference was network
conditions. `5506488a`'s own notes say so: *"none of the 3 probed path(s) answered"* and
*"page.goto: Timeout 20000ms exceeded"*.

**A rule whose outcome depends on how the site behaved that afternoon cannot gate an automatic
decline.** That is the question, and it must be answered for each of the eleven.

### The audit must report, per candidate

1. Can a network failure change the **verdict** (`pass` ↔ `fail`), or does it only degrade to
   `not_evaluable`?
2. If the verdict can change, **in which direction** does degraded observation drift — toward a
   false clearance or a false decline?
3. Where the subject was not reached because a request failed, does the finding **distinguish that
   from the subject being absent** — in the `state`, in `notEvaluableKind`, or only in prose?

---

## Groundwork already done

### Finding 1 — GATE-002 returns `pass` from a partial probe failure

Driven against the real handler with the real path list:

| scenario | state |
|---|---|
| all three answered; `/shop` serves 200 (the true observation) | **fail** |
| `/shop` timed out, the other two answered 404 | **pass** |
| all three timed out (what 5506488a got) | `not_evaluable` / `not_retrieved` |

`checkHttpProbe` guards the *total* failure case and not the *partial* one: `unreachable.length ===
results.length` returns `not_evaluable`, but one surviving 404 is enough to proceed, and the path
that would have carried the violation is simply missing from `served`. The prose is honest — *"1
further path(s) could not be reached and were not examined"* — but **the state is `pass` on a
`critical` `auto_fail` rule**, arrived at because a request failed.

This is worse than the case that prompted the question. A `not_evaluable` is visible; a `pass`
sourced from a timeout is not.

### Finding 2 — GATE-003 returns `pass` when the payment-marker lookup times out

| scenario | state |
|---|---|
| card field seen | **fail** |
| card-field lookup timed out → count 0 → "checkout, no payment field" | **pass** |
| redirected to sign-in | pass |
| `goto` timed out | `not_evaluable` / `not_retrieved` |

`runCheckoutFlow` reads each payment marker with a fallback of `0`, so a lookup that does not
answer is indistinguishable from a marker that is not there. The flow then reports `checkout`, and
`fail_if: payment_step_reached` is not met, so the rule is satisfied.

This path predates D-153 — the fallback was `.catch(() => 0)` — but D-153 widened it: a timeout now
also resolves to `0` where it previously hung. The bound was the right change and this is the cost
of it, stated rather than left to be discovered.

### Finding 3 — `notEvaluableKind` exists and GATE-003 populates it wrongly

D-136 introduced the distinction the question asks about, and it is machine-readable:
`not_retrieved` (our request failed) versus `not_exposed` (the merchant did not present it). It
reaches the report and drives the `coverage` counts.

GATE-002 uses it correctly. **GATE-003 does not.** `checkFlowProbe` classifies on
`observation.error !== undefined`, and `runCheckoutFlow` sets `error` for merchant-side outcomes as
well as browser failures:

| observation | truth | recorded kind |
|---|---|---|
| `goto` timed out | our request failed | `not_retrieved` ✓ |
| cart stayed empty after add-to-cart | **a fact about the storefront** | `not_retrieved` ✗ |
| flow ended somewhere unrecognisable | **a fact about the storefront** | `not_retrieved` ✗ |

Observed in production: run `5b29036d` (comopeptides) recorded GATE-003 as `not_retrieved` with the
reason *"the add-to-cart control was clicked but the cart remained empty"* — a merchant property
filed as our failure. That is D-136's conflation running in the opposite direction, and it means
GATE-003's kind carries almost no information: nearly every non-verdict outcome lands on
`not_retrieved`.

The handler's own reasoning is sound — it refuses to classify by pattern-matching the reason
string, per hard constraint 9. The defect is in the producer: `FlowObservation.error` is one field
carrying two different kinds of thing.

**So the answer to the second half of the question, for GATE-003 as it stands: the finding
distinguishes them in prose and mis-distinguishes them in the field a machine would read.** The
`state` is `not_evaluable` either way, which is what was observed.

### Finding 4 — every auto_fail rule is verdict-sensitive, and they do not all drift the same way

The blocker tier will be drawn from the 16 `auto_fail` rules. None of them is `manual`, so every one
depends on something being successfully fetched or rendered.

| drift under degraded observation | rules |
|---|---|
| **toward `pass`** — false clearance | CATG-001/002/003/004, GATE-002, GATE-003, NAME-001, NAME-002, OFFS-001, PAY-001, PROD-006, PROD-007 (**12**) |
| **toward `fail`** — false decline | DISC-003 (**1**) |
| depends on the artifact | COA-002, COA-003, DISC-002 (**3**) |

The split follows `expect`. A rule whose violation is *something observed* (`expect: absent`, a
status seen, a stage reached) reads a failed observation as clean. A rule whose violation is
*something missing* (`expect: present`) reads it as a breach.

**DISC-003 is the one to look at hardest.** It is `critical`, `auto_fail`, and asks for a
disclaimer to be present on sampled product pages. An under-render — a page that loaded but whose
content had not arrived when extraction ran — makes the disclaimer absent, and the rule fails a
merchant who displays it. That is the only candidate in the pool that can decline automatically
because of our own network conditions.

### Mechanism, by check type — for whichever eleven are chosen

| type | n | what the verdict rests on |
|---|---|---|
| `text_match` | 15 | rendered text; an under-render makes `expect: absent` pass |
| `manual` | 11 | nothing — not evaluated by the crawl, so network-independent |
| `dom_assert` | 10 | rendered DOM; an under-render makes a selector match zero |
| `url_pattern` | 9 | the Layer 0 sitemap fetch; a **partial** fetch shrinks the URL list, and `expect: absent` then passes |
| `doc_parse` | 4 | the COA fetch completing |
| `text_cooccurrence` | 2 | rendered text; an under-render removes the co-occurrence |
| `http_probe` | 1 | request outcomes — **demonstrated verdict flip** |
| `flow_probe` | 1 | request outcomes — **demonstrated verdict flip** |
| `computed_style` | 1 | live layout measurement |

`url_pattern` deserves a note it does not currently get. `checkUrlPattern` guards `!layer0.usable`
and a zero-length in-scope list, both to `not_evaluable`. It does **not** guard a partially fetched
sitemap set: `maxSitemaps` is 40 and a fetch that fails leaves a shorter `urls` list that still
looks usable. A prohibited URL in a sitemap that did not load produces a clean `pass`. Layer 0 does
record the truncation in `report.truncations`, but nothing joins that to the findings it affects —
so the report contains both the pass and the reason to doubt it, in two places, with no link.

Its zero-length guard also files as `not_exposed`, which says *the merchant listed nothing*. When
the cause was a failed sitemap fetch, that is the same conflation as Finding 3.

---

## What the audit still has to do

- Get the list of eleven.
- Answer Q1–Q3 for the eight not yet examined.
- Answer Q4 per candidate using the classification above, and confirm the drift direction against
  each rule's actual `expect` rather than its type.
- Decide what a blocker tier does when a candidate's finding is `not_evaluable` — the states are
  four, and "cannot gate a decline" needs a defined behaviour, not an absence of one.

Nothing above has been fixed. Findings 1–3 are defects; whether they are fixed before or as part of
the blocker tier is a decision for that work.
