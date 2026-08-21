# Status

Where the Mintro Screener stands as of **21 August 2026**. Written for someone who has never seen
this repository.

---

## What this is, in one paragraph

An analyst enters a merchant storefront URL. The system crawls the public surface — sitemap, then
homepage, then a sample of product pages — checks what it finds against the RUO peptide program
rule set, and produces a report with a verbatim capture behind every finding. The report goes to
IQwallet, who makes the approval decision.

**We do not make compliance determinations.** Every finding is an observation with a capture
attached: "this page displays a Weight Loss collection, here is the screenshot." Never "this
merchant is non-compliant." That distinction is legal, not stylistic, and it is enforced in code
and in tests, not just in style guidance.

---

## Read these, in this order

A new engineer should be useful after the first three.

| # | Read | Why |
|---|---|---|
| 1 | `CLAUDE.md` | The brief and the nine hard constraints. Constraints 1, 2 and 9 explain most of the design. |
| 2 | `docs/ARCHITECTURE.md` | Stack rulings with rationale, the check-type table, and the **triage axis** — read that section twice. |
| 3 | `docs/DECISIONS.md` | 29 rulings (D-001 to D-029, D-022 unused), dated, with reasoning. Long, but it is why the code looks the way it does. |
| 4 | `rules/ruleset.json` | 53 rules. The single source of truth. Data, not code. |
| 5 | `packages/ruleset/src/` | The loader and validator. Start at `schema.ts`, then `invariants.ts`. |
| 6 | `packages/engine/src/` | Crawl layers and check handlers. Start at `findings.ts` — it is where a state is decided. |
| 7 | `demo/index.html` | The design specification for the report (D-004). Open it in a browser. |

Then run it:

    npm install
    npm run check                          # typecheck + 419 tests
    npm run validate                       # validate the rule set, exit 1 if malformed
    npm run scan-full -- --report-dir ./reports --evidence-dir ./evidence https://example.com
    npm run web                            # the report, reading those runs
    npm run pdf -- example.com             # the PDF, printed from the same component

---

## The three ideas that explain most of the code

**1. Rules are data.** `rules/ruleset.json` is the source of truth. Adding a rule never touches
the engine. The engine's vocabulary — check types, scopes, surfaces — is code, because each term
needs a handler. The line is in `packages/ruleset/src/vocabulary.ts`.

**2. Four states, and `not_evaluable` is not `pass`.** A rule that could not be observed returns
`not_evaluable`. A false `pass` is the worst output this system can produce, because it is
indistinguishable from a clean merchant and nobody looks at it again.

**3. State comes from `tier` alone.** `sev` orders the report and never reaches a verdict
(D-009). `auto_fail` + violation → `fail`. `review_only` + violation → `review`. Severity never
escalates a review into a failure.

### The failure this project keeps rediscovering

Four separate defects, one shape: **a verdict resting on a surface that was never established.**

| | What happened |
|---|---|
| **D-011** | CATG rules reported "no needles, no wipes, no tablets" against a catalogue the crawler had never identified. Three false passes on critical rules. |
| **D-014** | DISC-002 located the disclaimer by its *compliant wording*, so a merchant whose disclaimer was worded differently and rendered at 2.94:1 contrast came back `not_evaluable`. |
| **D-016** | GATE-001 reported an age gate because `21+` appeared somewhere in the markup, with no interstitial on the page. |
| **D-026** | Session revalidation asked "is a login form absent?" and returned **valid for a 404** — a run crawling logged-out while reporting as authenticated. |

The rule that came out of it, now hard constraint 9 and a standing section in
`docs/ARCHITECTURE.md`:

> Never locate a subject by its compliant form. Locate it structurally, then evaluate compliance.
> This governs **preconditions** as much as checks: preconditions must be established by positive
> evidence of the state they assert, never by absence of its contradiction.

**The operational test when adding anything:** ask what your component returns when it *cannot
tell*. If that is the same as when the thing holds, it is wrong.

### The same failure, seven times, in the storage layer

The rule engine has been disciplined about the shape above since M1. The storage layer was not,
and getting five runs into Supabase produced seven consecutive defects with **the same shape and
one common cause**.

| | What happened |
|---|---|
| **Bucket guard** | `0008` asserted the evidence bucket at *migration* time. The failure arrived at *upload* time and nothing re-checked in between. |
| **Existence vs completeness** | The idempotency check asked whether a run *row* existed and answered "already migrated" for runs with no findings and no evidence (D-031). |
| **`ON CONFLICT` inference** | `upsert({onConflict: 'run_id,ordinal'})` could not infer a partial index, and PostgREST has no syntax for the predicate (D-032). |
| **Close before verify** | The run was closed and then verified. Five runs froze permanently with findings citing captures that had no row (D-033). |
| **Key vs storage path** | `evidence.key` recorded the storage path while findings cite the artifact key, so no gzipped capture could be joined to the finding citing it (D-034). |
| **An unexercised write path** | `persistRun`'s only caller was a migration script. The path every real scan would use had never once completed (D-035). |
| **A failed read read as empty** | `readContents` discarded the `error` from its own queries, so a transient fault produced an empty database and condemned a run that had written everything (D-036). |

Every one is *a verdict resting on a surface that was never established*. Two of them — the bucket
guard and close-before-verify — are literally the D-026 sentence: a check that ran before its own
subject existed. The seventh points the other way and is worth naming for that: it produced a
false **failure**, not a false pass. That is the survivable direction, and it is the same defect.

**All of them reached Frank through a green suite**, because nothing executed SQL against the actual
schema and nothing ran the write path end to end. The suite asserted the DDL was well-formed and
said nothing about working with it.

Two things close that, and neither is sufficient alone:

- **`apps/worker/test/schema/`** — three tiers, real Postgres in Tier 1 via PGlite (D-032). This
  covers the SQL layer: `ON CONFLICT`, triggers, constraints, the resumed write.
- **One write path, exercised by using it** (D-035). The migration script is deleted. A run
  reaches Supabase through `npm run scan-supabase` or it does not reach Supabase. `npm run
  resume-run` finishes a run that was written but never closed; it verifies and closes, and
  deliberately cannot re-upload a capture.

The seventh defect is the evidence that the second point works: it surfaced on the **first real
use** of the write path, which four milestones of testing had never once exercised.

The five original runs are still in the project, closed and incomplete. They are not repairable —
runs are immutable once finished (D-002) — and they are left in place deliberately as history.

---

## What is built

### M0 — Rule set loader and validator · `packages/ruleset`

Zod schema derived from the rule set, closed per-check-type param schemas, cross-field
invariants, and a CLI that exits 1 on a malformed rule set.

**Proved:** a schema check catches what careful reading does not. At M2 it found two rules
(GATE-005, PAY-002) that the author's own audit had passed over — recorded in D-010 as the
empirical case for closed schemas.

### M1 — Layer 0 crawler · `packages/engine`

robots.txt, sitemap.xml, URL slug matching. No browser. Token matching, not substring — NAME-002
is `auto_fail` and its patterns include `mass`, `lean`, `bulk`, so `/products/massage-oil` would
otherwise fail a merchant on a coincidence.

**Proved:** hard constraint 2 on a real site. peptidesciences.com serves robots.txt declaring no
sitemap and 404s the well-known paths → 7 `not_evaluable`, 0 `pass`.

### M2 — Playwright worker, Layers 1 and 2 · `apps/worker`

Fly-ready container on the official Playwright image. Homepage render, footer computed-style
checks, shop-structure discovery fed back into the Layer 0 classifier, then product-page sampling
by suspicion score computed from Layer 0 slugs — never random, never analyst-chosen, and
deterministic so two runs on one merchant are comparable.

**Proved:** the feedback loop. corepeptides.com Layer 0 alone produced `0 fail · 0 pass ·
7 not_evaluable` — its sitemap lists 248 URLs with nothing marking which are products. A rendered
homepage yielded 104 product links, which made five Layer 0 rules evaluable that a sitemap alone
could not answer.

### M3 — The report · `apps/web`

React + Vite, ported faithfully from `demo/index.html` (D-004). Four-state system, tick strip,
evidence slip, filter chips, computed coverage line.

**Proved:** evidence kinds render distinctly (D-012). On the swisschems run, rendered findings
load their screenshots, documentary findings show the stored artifact and its hash, and every
`not_evaluable` finding displays the stored reason it could not be evaluated. Neither kind is
ever drawn as the other, and the PDF of that run resolved **66/66** screenshots.

### M4 — Authenticated crawling · `apps/worker/src/auth`

Platform detection, scripted Shopify and WooCommerce login, `storageState` encrypted at rest
(AES-256-GCM, vault-referenced, every access logged), session reuse → revalidation → re-login →
only then a human. Unlocks GATE-002 and GATE-003.

**Proved:** against `apps/testbed`, a local storefront. Session reuse, stale-session detection and
re-login all work; GATE-002 passes unauthenticated with the catalogue reachable when signed in;
GATE-003 passes unauthenticated with the signed-in flow reaching the payment step.

### M5 — PDF and send · `apps/worker/src/pdf.ts`, `send.ts`

`page.pdf()` against the report route — the same React component, no second rendering stack.
Resend integration, and the `sends` log.

**Proved:** swisschems.is → 45 pages, **66/66 screenshots resolved**, 5.43 MB, 3.0s. The copy
audit passes across all five real runs.

### M7 — Persistence and auth · `apps/worker/src/store`, `supabase/migrations`

Eleven migrations. RLS is declared in the same file as the table it protects, so a new table
cannot be added without a policy in the diff. **RLS decides reads; triggers decide changes** —
`service_role` carries `BYPASSRLS`, so an append-only guarantee expressed as a policy would not
hold against the process doing the writing.

`persistRun` is the one write path, reached by `npm run scan-supabase`. It writes merchant, run,
evidence, findings, **verifies, and only then closes the run** — closing is what makes the row
immutable, so it cannot precede the evidence that the run is complete (D-033). A failure leaves
the run open and resumable.

Verification lives in one place, `store/completeness.ts`, and takes the report as an argument so
it can run before the report is stored (D-033). Three tiers of schema testing back it, described
in `apps/worker/test/schema/README.md`.

**Standing:** the frontend gets URL + anon key only; nothing prefixed `VITE_` carries a secret.
Credentials hold vault references, never secrets. Evidence is private and reached through
short-expiry signed URLs minted on demand.

### M8 — Deployed · `docs/DEPLOY.md`, `apps/worker/bin/worker.ts`

Netlify for the frontend, Fly for the worker, Supabase for everything else. `docs/DEPLOY.md` is a
runbook — every command, in order, written for someone who has not used Fly.

**Scans start from the UI.** An analyst writes a row to `scan_requests`; the worker claims it,
screens the storefront, records the run. No job service and no dashboard: the smallest thing that
lets a scan begin somewhere other than one laptop. Claiming is a compare-and-swap, so more than
one machine is safe; a stale claim is reclaimed after fifteen minutes.

**One crawl path.** `bin/scan.ts` and `bin/worker.ts` both call `src/screen.ts`. The worker does
not have its own crawl (D-035).

**Quarantined runs are marked.** `public.run_quarantine` (0012), read by the frontend, the worker
and `verify-supabase` alike. Shown in the run list and at the top of the report, with the reason.
It states the observation and stops — no instruction (D-001) — and it does not filter: the run
stays in the list and renders in full.

**Not verified here:** the container image has never been built. There is no Docker on the
development machine, same gap as Tier 2 in D-032. The Dockerfile was corrected by reading —
missing workspace manifests, a build that would have pulled React into a crawl container, and no
`.dockerignore` at all.

---

## The five storefronts, as they stand today

Scanned 21 August 2026, rule set v2.4.0, public crawl.

| Storefront | fail | review | pass | n/e | Failing rules |
|---|---|---|---|---|---|
| swisschems.is | 4 | 18 | 28 | 47 | DISC-002, NAME-001, NAME-002, CATG-003 |
| sportstechnologylabs.com | 3 | 5 | 46 | 43 | DISC-003, NAME-002, **OFFS-001** |
| biotechpeptides.com | 2 | 15 | 37 | 43 | PROD-007, NAME-002 |
| corepeptides.com | 1 | 17 | 37 | 42 | NAME-002 |
| peptidesciences.com | 0 | 1 | 2 | 50 | — |

Counts are findings, not rules: Layer 2 evaluates product-surface rules once per sampled page, so
four merchants produce 97 findings from 53 rules. peptidesciences produces 53 because it has no
sitemap, so no product pages were sampled and nothing multiplied.

**Findings worth knowing about:**

- **swisschems DISC-002** is the flagship catch. Its disclaimer is worded differently from the
  program text and renders at **2.94:1** against its background, under the 4.5:1 threshold. It was
  invisible until D-014 changed how the rule locates its subject. The same merchant also sells
  HCG (CATG-003) and runs a "Longevity Research" category (NAME-001).
- **NAME-002 fails four of five** on marketing terms in product names — `blend`, `stack`, `glow`.
  It is the most frequently triggered `auto_fail` rule in the set.
- **sportstechnologylabs fails DISC-003**: no text resembling the required disclaimer in the
  footer of any of the five sampled product pages.
- **peptidesciences returned 403** to the first browser render. Polite mitigations (realistic UA,
  standard viewport, `accept-language`, `Crawl-delay` honoured) took it to 200. Its low coverage
  is its own configuration, not a screener failure — and the report says so.
- **OFFS-001 and OFFS-007 are complements.** sportstechnologylabs is caught by both, the same
  three affiliate pages found once by URL and once by link text. swisschems is caught only by
  OFFS-007, because its affiliate links point at `/` with nothing in the sitemap.

---

## Blocked

Nothing below is a technical problem. Each waits on a decision.

| Blocked on | What it is |
|---|---|
| **Credential authorization** | Whether Mintro may hold merchant screening credentials and create screening accounts. **No account exists on any real merchant site.** All of M4 was built against `apps/testbed`. M9 narrows this to *merchant-supplied* demo logins, which is a different question from Mintro creating its own accounts — see the M9 proposal in this file's successor discussion. |
| **Session authorization** | Whether Mintro may hold merchant sessions established by a *person* rather than by stored credentials. This blocks **assisted sign-in**, designed in full in `apps/worker/src/auth/assisted.ts` and deliberately unimplemented. |
| **Resend domain verification** | SPF and DKIM on the sending domain. Until then `createDryRunMailer` composes and transmits nothing — a separate implementation, not a flag, so a test send cannot be mistaken for a delivered report. |

Assisted sign-in additionally needs two smaller decisions recorded in its own file: which machine
an analyst uses, and whether a hosted browser vendor is acceptable for a live handoff.

---

## Deferred

| Deferred | Decision | Note |
|---|---|---|
| **M6 — scheduled re-scans and diff** | D-002 | Deferred, not cancelled. Re-running a merchant already produces a new immutable run; evidence keys are run-scoped and never overwrite. Adding this later is a scheduler plus a diff view, not a data migration. |
| **Documents Check** | `CLAUDE.md` | Later phase. Nav item and route are stubbed in `apps/web`; the pane describes the scope and does nothing. |
| **`doc_parse` COA parsing** | — | COA-002, COA-003 and COA-004 report `not_evaluable` naming the gap. A COA rule silently passing because nobody wrote the parser would be a false pass. |
| **`doc_parse` `max`** | — | Only `min` exists, because only `min` appears in the data. Adding an upper bound is a one-line schema change when a rule needs one. |
| **COA authenticity** | `ARCHITECTURE.md` | COA-005 is a `manual` rule. Forged COAs are a known failure mode and accreditation cannot be verified from a PDF; an independent assay is the only real control. |
| **Finding grouping in the report** | — | Layer 2 produces one finding per rule *per sampled page*, so CATG-005 yields five near-identical rows. Grouping was raised at M3 and left open. If added it is presentation only and must not reach the PDF export (D-028). |
| **OFFS-003 bio-link inspection** | — | Social links are collected; where each leads is not examined. The finding says so. |

---

## Known coverage limits

These are **non-goals**, and the report states them rather than implying coverage. Ten `manual`
rules exist precisely to keep them visible instead of silently absent — each appears in every
report as `not_evaluable` with the reason the rule set itself gives.

| Not covered | Rules | Why |
|---|---|---|
| Support channel content | COMM-002 | Email, chat, phone and DMs are not reachable by crawl. Sampled transcript review or mystery shopping only. |
| Packing slips | FULF-004 | Physical document. Requires a test order or merchant attestation. |
| Ban list maintenance | FULF-005 | Internal record. Requires merchant attestation. |
| Social post content | OFFS-004 | Post-level review needs platform API access or a commercial listening tool. |
| Shipping destinations | FULF-003 | Adult-signature carrier configuration is not visible from a storefront. |
| Order-record storage | GATE-006 | Server-side. Requires merchant attestation. |
| Staff conduct and training | COMM-003 | Internal training. Requires merchant attestation. |
| Monthly social audits | OFFS-005 | Internal process. Requires merchant attestation. |
| Risk-monitoring plugin | PAY-004 | Program requirement, not regulatory. Confirm at onboarding; keep separate from FDA-derived findings. |

Two further limits are properties of what the crawl can see, and each finding states them:

- **`content`-scoped rules are only as accurate as product classification.** Where the catalogue
  was not identified, `content` approaches "every URL", so every such finding names the population
  it examined (D-023, required).
- **A slug indicates topic, not claim.** OFFS-006 surfaces candidates for a human and is
  permanently `review_only`; only someone reading the article can tell rigorous chemistry from a
  dosing guide (D-020).

---

## Repository layout

    rules/ruleset.json      53 rules. Single source of truth.
    packages/ruleset        Loader, schema, invariants. One parser, node + browser entries.
    packages/engine         Crawl layers, check handlers, report assembly. Pure; no browser.
    apps/worker             Playwright, auth, probes, PDF, send. The only browser driver.
    apps/web                React report. Ported from demo/index.html.
    apps/testbed            Local storefront for developing authenticated crawling.
    fixtures/ruleset        1 valid + 28 deliberately malformed rule sets.
    demo/index.html         The design specification (D-004). Not deployed.
    docs/                   ARCHITECTURE (technical), DECISIONS (business), DEPLOY, this file.

**Handlers are pure.** Given a page context and rule params they return a finding; side effects
happen in the runner. That is why every check is tested against fixtures rather than live sites —
a screener whose findings end up in a dispute cannot be tested only by pointing it at a real
store.

---

## If you change one thing, know this

- **Changing `rules/ruleset.json` requires a decision number in the same commit** (D-025). A
  ruling that reaches the data but not `docs/DECISIONS.md` is unreviewable six months out.
- **`npm run check` runs typecheck *and* tests** for a reason. Some guarantees are enforced only
  by `tsc` — `Rule` being a real discriminated union is one, and it was broken once with all tests
  passing.
- **Do not promote a `review_only` rule to `auto_fail`** without reading its decision. OFFS-006
  and OFFS-007 are permanently review-only, and D-020 and D-027 say why.
- **Evidence is append-only.** Nothing in application code overwrites or deletes a completed run's
  captures (hard constraint 5, D-002).
- **There is one path into Supabase, and `finishRun` is the last thing it does.** Do not add a
  second writer, and do not move the completeness check after the close — D-033 and D-035 say what
  that cost. A run is closed only once it has been verified, because closing it says it is done.
