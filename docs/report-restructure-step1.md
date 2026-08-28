# Report restructure — step 1

What the spec asked for before anything is built: what coverage data a completed run actually
carries, and whether a structural cascade signal exists. Nothing built. Reference runs `c268f8d7`
(sportstechnologylabs, 36 pages) and `5b29036d` (comopeptides, 38 pages), both at rule set 3.1.0,
both PDFs read.

---

## 1 — Coverage data

### Carried in the stored report, structured

| field | `c268f8d7` | `5b29036d` |
|---|---|---|
| `coverage` | `total 62 · resolved 42 · evaluable 40 · outstanding 20 · notReachable 11 · notExposed 6 · notRetrieved 2 · notApplicable 2 · noCheckBuilt 1` | `total 66 · resolved 38 · evaluable 36 · outstanding 28 · notReachable 11 · notExposed 13 · notRetrieved 1 · notApplicable 2 · noCheckBuilt 3` |
| `obstruction` | `attempted 27 · unanswered 4 · rulesAffected 2` + the 4 URLs | `attempted 37 · unanswered 1 · rulesAffected 1` + 1 URL |
| `truncations` | `[]` | `[]` |
| `access` | `public · wall false · usedCredential false` + note | same |
| `counts` | `3 fail · 11 review · 26 pass · 22 not_evaluable` | `3 · 12 · 21 · 30` |
| `attestationQuestions` | 19 | 19 |
| `notChecked` | 1 | 1 |
| `blocking` | present (8 declared, 0 failed) | **absent** |
| also | `strip`, `sameObservation`, `politeness`, `rulesetVersion`, `rulesetEffective`, `platform`, `merchantName` | same |

### Derivable at render time, from what is stored

- **Sampled product pages — yes.** Distinct product-path `sourceUrl` values across all findings'
  evidence: **5** on both runs. Structural, no prose parsing.
- **Distinct URLs cited — yes**, 15 and 14. But this is *cited*, not *rendered*: a page the crawl
  loaded and no finding referenced does not appear. It is a floor, not a count, and should not be
  presented as one.

### Not available, and not derivable

- **Catalogue size — the "of 64".** This is the one the coverage line most needs and the one that
  is not there. `inScopeUrls.length` is interpolated into `url_pattern` note prose — *"64 URLs in
  scope 'products' were examined"* — and never reaches a structured field. `matchedUrls` carries
  the hits, never the denominator.
- **Which named surfaces were reached** (homepage / terms / FAQ / sign-up). Partly inferable from
  cited URLs when a surface *was* found; silent and ambiguous when one was not — a merchant with no
  FAQ and a failed FAQ fetch look identical, which is the distinction D-158 was written about.
- **The per-request `attempts` record.** `screen.ts` passes it to `assembleReport`, which consumes
  it to build `obstruction` and does not store it. Only the summary and the unanswered URLs survive.
- **Pages rendered**, as opposed to pages cited.

### The consequence for the coverage line

The spec's example is:

> Screened 5 of 64 product pages, plus the homepage, terms, FAQ and sign-up form.
> 4 of 27 page requests did not answer; 22 rules could not be evaluated as a result.

Half of it can be built from what exists and half cannot:

- **"5"** — yes, derivable.
- **"of 64"** — **no.** Requires storing the in-scope catalogue count on the report. That is an
  engine change, and spec constraint 1 says stop and report rather than make it. Flagged here for a
  ruling; until then the line says *"Screened 5 product pages"* and omits the denominator, which is
  the spec's own instruction — say less rather than estimate.
- **"plus the homepage, terms, FAQ and sign-up form"** — partly. Surfaces that were found can be
  named from their cited URLs; a surface that was not reached cannot be distinguished from one the
  merchant does not have.
- **"4 of 27 page requests did not answer"** — yes, `obstruction`.

### One correction to the spec, and it matters

**"22 rules could not be evaluated as a result" is wrong**, and wrong in the direction this project
guards hardest against. `obstruction.rulesAffected` is **2**, not 22. The 22 is total
`not_evaluable`, and it decomposes:

| bucket | n | whose fact this is |
|---|---|---|
| `not_reachable` | 11 | nobody's — no crawl of a website could answer these |
| `not_exposed` | 6 | the merchant's — looked for, not on the site |
| `not_retrieved` | **2** | **ours — this run could not fetch them** |
| `no_check_built` | 1 | Mintro's — not built yet |

Only the 2 are attributable to failed requests. Writing 22 there would tell an agent that our
network trouble cost them twenty-two rules, when it cost them two — the same conflation D-136
introduced `notEvaluableKind` to end and D-156 extended. Page 1 of the current PDF already words
this correctly: *"4 of 27 requests for a page did not answer. 2 rule(s) are unevaluated for that
reason, rather than for anything observed about the merchant."* The new line should keep that
split, not collapse it.

### Sample basis and the pass count

The spec requires passes and sample basis to appear together. Both halves exist **except the
denominator**: "26 passed, observed over 5 sampled product pages" is available now; "over 8% of the
catalogue" is not, for the reason above.

---

## 2 — Cascade signal

**Yes. Two, and they are different in kind. Neither is string matching.**

### Signal A — a shared failed retrieval, by evidence identity

Fingerprint each finding by `evidence[0].sourceUrl` plus its exact sorted `attempts` set (URL,
status, error). Findings with no attempts are excluded. Findings sharing a fingerprint descend from
one failed retrieval.

Run against both reference reports in full:

| run | groups found | members | root |
|---|---|---|---|
| `c268f8d7` | **1** | COA-006 `review`, COA-002 `n/e`, COA-003 `n/e`, COA-004 `n/e` | COA-006 — the only non-`not_evaluable` member |
| `5b29036d` | **1** | identical shape | COA-006 |

- **Zero false groups** across 62 and 66 findings.
- The root is unambiguous: exactly one member is not `not_evaluable`.
- **COA-005 is correctly excluded** — `not_reachable`, no attempts, genuinely unrelated.
- **COA-001 is correctly excluded** — `pass`, per-page screenshot evidence, a different identity.

This is the spec's *"shared upstream observation, shared failed retrieval"*, and it is exactly the
COA example the spec gives.

### Signal B — a declared subject dependency, `target_phrases_from`

Already in the rule set, already data. Two edges exist in the entire rule set:

```
DISC-002.params.target_phrases_from = DISC-001
DISC-003.params.target_phrases_from = DISC-001
```

That groups `{DISC-001, DISC-002, DISC-003}` — the spec's disclosure example, exactly. Observed on
both runs: DISC-001 `review`, DISC-002 `not_evaluable`, DISC-003 `fail`, all descending from one
observation, that the footer carries no disclaimer.

**Two caveats, both design-relevant:**

1. It declares *"my subject's wording comes from X"*, not *"I am a consequence of X"*. It aligns
   with the cascade here and is not a general consequence edge. If a third rule ever borrows
   phrases without being downstream, this would group it wrongly. Worth a rule-set comment when
   step 4 uses it.
2. **DISC-003 is the `fail`; DISC-001 is only a `review`.** Nesting the consequence under the
   declared parent would bury the most consequential finding in the group under a lesser one. The
   grouping is right; the *root selection* must be by state, not by the direction of the edge —
   render the worst state as the head and the others beneath it. That is an ordering decision for
   step 5 and I am flagging it now rather than discovering it there.

### Signal C — considered and rejected

`corroborates` (GATE-002 ↔ GATE-004, GATE-005). This is D-050's relation: *the same observation from
another angle*, mutual by invariant, already rendered as `sameObservation` pairs. It is a **peer**
relation, not parent/child. Using it as a cascade would nest two findings under a third that does
not cause them, and would misrepresent a relation the rule set already defines precisely.

### Coverage of the two signals

On both reference runs, every multi-rule cascade is caught: the COA group by A, the DISC group by B.
No cascade was found that neither catches.

That is two runs, so the claim is bounded: the signals fire where the structure is declared or the
retrieval is shared, and are silent otherwise. Silence leaves the findings flat, which is the
spec's required fallback.

### What is *not* a cascade, and must not be collapsed as one

`5b29036d` shows PROD-003 three times and NAME-003 three times with identical reasons. These look
like cascades under a naive reason-string grouping and are **the same rule evaluated per page** —
the dedup problem, step 3, not step 4. Both structural signals correctly decline to group them:
their evidence identities differ (different product pages), and neither declares a phrase edge.
This is the clearest argument against the string-matching approach the spec rules out: it would
have merged these.

---

## 3 — Two things the design should know before step 2

**Dedup alone will not reach the page target.** One-finding-per-rule collapses 62 → 54 findings on
`c268f8d7` and 66 → 54 on `5b29036d`. Eight and twelve removed. The 36 → ~12 page compression has
to come mostly from the evidence blocks — there are **42 and 46 SHA-256 panels** in the two
documents, one per finding-page pair, each full width — collapsing to compact disclosures, plus the
visual pass. Expect step 3 to remove findings and step 7 to remove pages.

**`5b29036d` has no `blocking` field**, because it predates D-161 and runs are immutable. So the
routing question in the spec's "two documents" section — decline notice when a blocking rule fails,
full report otherwise — cannot be answered for it. It must render as a full report and say the run
predates the flag, never as "no stopping condition failed", which would be a claim about the
merchant drawn from the age of the record. This is the D-044 pattern the spec's constraint 2
already names; noting that it bites immediately, on one of the two reference runs.

---

## Recommendation for step 2

Proceed. Both answers are firm:

- The coverage line is buildable except for the catalogue denominator, which needs a ruling on
  whether to store it (engine change) or to ship the line without it.
- Cascades have an honest structural signal — two of them — with the root selected by worst state
  rather than by edge direction.

Next free decision number is **D-162** (highest is D-161, confirmed).
