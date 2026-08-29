# Status

Where the Mintro Screener stands as of **24 August 2026**. Written for someone who has never seen
this repository.

---

## Where this stands right now

The screening loop is **complete and confirmed end to end against a real merchant**. A run was
scanned, an invitation sent, responses written and attributed, the report rendered and delivered,
and the received document verified against what the merchant actually did.

| | State |
|---|---|
| **Layer 3** | Complete. The unbuilt column reads **zero** on all five storefronts — every rule in the set now has a check that runs, or a recorded reason why it cannot. |
| **Merchant commentary** | Built and verified (D-063). One forwardable link per report, self-declared identity, per-comment attribution, five distinguishable commentary states. |
| **Live sending** | Working for both messages. The IQwallet report with its PDF, and the merchant invitation, select through one `mailersFor()` (D-064). |
| **The full loop** | Confirmed on run `5527b180` (swisschems, 97 findings): scan, invite, respond, send, receive. `npm run loop-check -- <run-id>` re-verifies any run. |
| **Documents Check** | **M0 through M6 built and verified live against the test project.** Extraction, ingest, the check engine (38 checks in four families), persistence, the report, the PDF, send-to-agent, and package creation. Migrations `0019`–`0034`. The three creation answers accept **not known yet** and are recorded on the package (D-129, `0034`) — applied to production 2026-08-24, frontend deployed behind it, verified 13/13. Eight items are carried rather than done — see below; the last is a correctness question about the default document set rather than a build task. |
| **Retention** | **P0 through P7 built** (D-130, D-132). The clock starts, the gate refuses, the export is queued and built and reconciled against the database, verification checks every member, the purge is planned and refused before it is ever run, and a purged package's report says so in the masthead. Migrations `0035`–`0043`, all on production; the panel is live. The staged archive is discarded on a verified copy and swept from the bucket after a day, and the download link is nulled once it lapses. **Nobody holds `purge_approver`, so no purge can be approved**, and the executor has never run outside a dry run. |

### Expect one thing to look wrong on any run screened before 2026-08-29

The four states are rendered as **Not met · Needs a look · Met · Not observed** (D-175). The
identifiers in the data are unchanged — `fail`, `review`, `pass`, `not_evaluable` — and only the
strings a reader sees moved.

**A run written before that change keeps its old verdict sentence**, because `verdict` is composed
at assembly and stored, and runs are immutable (D-002). So an older report shows the new badges
around a verdict band still reading *"3 rule(s) were observed to fail … 11 finding(s) are queued for
review"*. All seven reference runs are in this state.

That is correct, not a rendering fault, and it must not be fixed by rewriting stored verdicts — a
run records what was observed and how it was described at the time. It resolves for each merchant on
their next scan.

### What "verified" means here, because it is not the usual thing

Not that the tests pass. The checks compare **two independent sources**: what the merchant did, read
as database rows, against what the delivered document says, read from the rendered output. Neither
is derived from the other or from the code that built the report.

That discipline came out of four defects in two days, all invisible to tests that inspected the
code because the code agreed with itself (D-026). The question worth carrying forward:

> **Does this assertion get its expected value from the same place the code gets its actual value?**

Three of the checks written that week had the defect they were written for. Each was fixed by being
made to fail on purpose first.

### The tools a newcomer will want

    npm run loop-check -- <run-id>    did the sent document carry what the merchant did?
    npm run print-check -- <run-id>   do all five commentary states render, with attribution intact?
    npm run compose-check             does the document compose well at any report size?
    npm run page-budget -- <run-id>   what does one document cost, by section?

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
| 3 | `docs/DECISIONS.md` | Rulings D-001 to D-116, dated, with reasoning. Long, and it is why the code looks the way it does. **Read D-026 whatever else you skip** — it catalogues sixteen instances of one defect family and is the most useful thing in the file. D-076 to D-116 are Documents Check and can wait until you work on it. |
| 4 | `rules/ruleset.json` | 53 rules. The single source of truth. Data, not code. |
| 5 | `packages/ruleset/src/` | The loader and validator. Start at `schema.ts`, then `invariants.ts`. |
| 6 | `packages/engine/src/` | Crawl layers and check handlers. Start at `findings.ts` — it is where a state is decided. |
| 7 | `demo/index.html` | The design specification for the report (D-004). Open it in a browser. |
| 8 | `docs/CHECK-INVENTORY.md`, `docs/EXTRACTION-SURVEY.md` | Documents Check only, and only when you start it. The inventory is the accepted design (D-102); the survey is what was measured in `mintro-intake-lite` and is why several of those decisions went the way they did. |

Then run it:

    npm install
    npm run check                          # typecheck + 975 tests
    npm run validate                       # validate the rule set, exit 1 if malformed
    npm run scan-full -- --report-dir ./reports --evidence-dir ./evidence https://example.com
    npm run web                            # the report, reading those runs
    npm run pdf -- <run-id>                # the PDF, printed from the same component

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

### M9 — Merchant-supplied screening accounts · `apps/worker/src/auth`, `packages/engine/src/sealed.ts`

A merchant hands over a demo login; an analyst enters it; the worker uses it to reach product
pages behind the wall. **Authorized** (D-039). Mintro creating its own accounts on merchant sites
remains blocked, and is a different question.

**The browser seals; only the worker can open.** A key pair, public half in the bundle where being
public is the point, private half a Fly secret. So the analyst who types a merchant's password is
not a party who can retrieve it, and neither is the database. There is no "view credential"
anywhere, and that is a property rather than a missing feature.

**Losing the private key is unrecoverable, deliberately.** A recovery path is a second route to
plaintext. Re-asking a merchant costs an email. Do not add escrow as a convenience (D-038).

**A credential widens what is visible; it never narrows what is reported.** GATE-002 and GATE-003
are decided by `runGateRules`, whose API has no parameter that could carry a session. Enforced at
three levels: the signature, a rule-set test that fails if `unauthenticated: true` is removed, and
a test asserting a credentialed run matches a public one — paired with one showing the same
merchant probed *with* a session is auto-failed, so the first is discriminating rather than
vacuous.

**Access mode is detected, not chosen** (D-040). Every crawl starts anonymous; a stored merchant
login is applied only if the sampled product pages come back unserved, and kept only if it changed
what was served. The database pins `scan_requests.mode = 'public'` on insert, so a scan beginning
anonymous is a schema property rather than a convention. The report states what it could reach.

**Sign-in is email and password**, with magic link kept as a secondary route. A link is unusable
when presenting from a machine that is not signed in to the analyst's mail. Still no signup form:
this changed how someone authenticates, not who is allowed in.

**PDF is a queued job.** `pdf_requests`, same shape as the scan queue. The container builds
`apps/web` because the PDF is `page.pdf()` against the report route — the same component the
analyst sees, so the export cannot drift from the report.

**Send is disabled and says why.** Nothing reaches a mailer; a button that appeared to succeed
would report a send that did not happen. It re-enables on what the worker reports, not a flag.

**Side effect worth expecting:** wiring the gate runner into `screenStorefront` means GATE-002 and
GATE-003 are evaluated for the first time. Until now both came back `not_evaluable` in every run,
because nothing called the probe handlers. The five storefronts' numbers below predate that.

### The report · `apps/web/src/components/ReportView.tsx`

**Every finding shows what was observed beside what the program requires** (D-041), quoted
verbatim from the rule's `clause`. Deliberately not a corrective-actions column: remediation
advice would make Mintro a party to the compliance determination and create reliance. Quoting the
standard gives the merchant everything they need to act while Mintro states a fact and cites a
source.

The two columns are audited to different standards — the observation for directive language, the
requirement for being byte-identical. A whitespace-only difference fails.

**The reading view is ordered by state** (D-042): failures first with full evidence, then review,
then a compact pass summary, then not-evaluable with reasons. Repeated findings of one rule are
grouped — **except failures, which never collapse**, because a failure on one page and the same
failure on five are different facts and a collapsed row presents them identically.

Grouping is presentation only. The PDF keeps the category structure and every finding
individually; a grouped export would quietly hold less than the run produced.

---

## Documents Check — M0 through M6

Built and verified live against the **test project** (`mintro-screener-test`), never against
production. An analyst opens a package, uploads documents, the worker reads them, the engine checks
them, and the report goes to an agent as a PDF.

| Milestone | What it is | Verified live |
|---|---|---|
| **M0** | `packages/extraction` — bytes in, provenanced values out. AcroForm first, per-page routing, vision for scanned pages. No confidence anywhere (D-088). | Fixture-based; one real Anthropic call at M5 — 2,364 in / 144 out, $0.00925. |
| **M1** | Data model, ingest, the rasterizer (D-108), calendar-month coverage (D-113), the upload page. | 8/8 against live Supabase, including that no unauthenticated path returns document bytes. |
| **M3** | The check engine, families A and B, and persistence. Findings are append-only under a trigger, not RLS — `service_role` bypasses RLS. | D-002 proven: a re-run creates a new run and leaves the prior run's findings byte-identical. |
| **M4** | Families C and D — twenty cross-document checks and six derived figures. The two-source rule (D-098) binds every family C check except C-14. | 94 findings across nine document types; every planted discrepancy found. |
| **M5** | The report as a pure function of a run (D-085), the stale-run gate (D-117), the PDF, and send-to-agent with its queue. | 20-page PDF printed from the report route, queued by an operator and drained by the polling worker. |
| **M6** | Package creation and document-set composition in one flow (D-128) — merchant, the three D-081 answers, the prechecked set adjusted, created through two `security definer` functions. | 10/10 as a signed-in analyst: all three origins in the database, a removal recorded, a named instance labelled, checks run and the report sent. |

### What is enforced rather than remembered

Worth knowing before changing anything here, because several of these look like conventions and are
not:

- **Four states, always.** A check that could not run returns `not_evaluable` with a **named reason
  the check itself declares** — the constructor refuses an undeclared one, and the database refuses
  a `not_evaluable` row without a reason.
- **No finding text may assert a determination.** Audited at construction and thrown on. The report
  audits every string it renders, not only finding notes.
- **Tier is computed, never declared** (D-116) — the weaker of the documents actually read, and
  `null` where a finding rests on none.
- **A run records what it read** (D-123) and **who it rendered under** (D-126). Without those the
  report is a function of the run *and the clock*, and D-085 is unachievable rather than unenforced.
- **Runs, findings and sends are append-only**, by trigger. Verified against `service_role`.

---

## Documents Check — carried, not done

None of this is finished work. Each item is either a decision taken, a measurement not made, or an
input the system has not been given — except the last, which is a correction: this file described
production's state wrongly, and the row now says what is actually there.

| Carried | Decision | What it actually means |
|---|---|---|
| **HEIC** | D-127 | **Deferred indefinitely**, not pending verification. The conversion path exists behind a port, unwired. A HEIC upload resolves to `unsupported` with a reason — recorded and chaseable (D-092), so an operator asks for a resend. Reopening needs evidence merchants send HEIC *and* a file whose bytes begin with `ftyp`; two samples have already turned out to be JPEGs. |
| **A rotated ID is a silent failure** | — | **Nothing distinguishes a bad read from a sideways page.** A photograph taken in landscape extracts as poorly as an unreadable one, and both surface as thin or absent values with no signal that orientation was the cause. An operator sees a document that "did not read well" and has no reason to suspect it would read perfectly rotated 90°. |
| **`MATERIAL_GAP` = 0.2** | D-122 | **Unmeasured.** It decides `pass` against `review` on every family D derived-versus-stated finding. Both figures and the derivation render either way, so it hides nothing — but it is a judgement, and it must be set from real packages or not at all. Do not tune it against the verification package; that fits it to numbers this repository invented. |
| **A-05's `fail` branch is unreachable** | D-117 | Extraction can read a signature *date* and cannot locate a signature *block*, so every input reaches `signature_block_not_located`. The check stays declared `fail / pass` because the ruleset describes what a check is, not what extraction currently supports. Closing it needs signature-block location in `packages/extraction`. |
| **C-20, D-05, D-06** | §6 | **Deferred by design**, and the engine filters to `v1` before any handler sees them. C-20 (owner residential address) because people move and an ID is stale often enough to be noise; D-05 and D-06 because nobody has agreed to ship them. |
| **Section numbering skips 04** | — | Cosmetic, inherited from the mockup, which numbers `01 / 02 / 03 / 05`. The report uses `02 / 03 / 04 / 05`, which is self-consistent and agrees with the mockup on `05`. Nothing depends on it. |
| **Production is at `0025`, and already holds data** | D-097 | **An earlier version of this line was wrong** and said production had `0001`–`0018` with nothing ever written. It has `0001`–`0025` — every M1 table — and one package (`processor_key` "verification", opened 2026-08-24T15:59Z), nine slots, three documents, four document versions, five upload rows and one object in the `documents` bucket. **Under D-097 none of it can be removed.** `0026`–`0034` were all applied on 2026-08-24. `0034` was applied **before** the frontend deploy, deliberately: it drops the old function signatures, so migration-first breaks package creation for one Netlify build while frontend-first would have broken the package page entirely — the new `select` names columns that would not yet exist, and PostgREST rejects an unknown column. Break a write nobody uses, not every read. Of the applied set, `0026` is the only one that touches existing production rows, rewriting nine `origin='template'` values to `'required'` (D-121), which is irreversible and loses which of them were conditional. |

### Retention — P0 through P5, and what each proves

Frank's ruling (D-130): at 180 days a package surfaces as a candidate for deletion; an operator
exports it, verifies the export, and only then are the bodies purged. Findings, run history, the
send log and slot states stay forever. Only a purge approver may approve.

It extends D-097 rather than reversing it, and the distinction is mechanical: **the bodies are
objects in a bucket, the record is rows in Postgres, and a purge deletes objects and inserts rows.**
No append-only trigger was relaxed, and there is no `purged_at` on `document_versions`.

| | What it built | What it proves |
|---|---|---|
| **P0** `0035` | The retention clock | `retention_started_at` had existed since `0019` and was set by **nothing** — not the trigger, not any function, only two lines in a test. Every policy measured from it never fired, and the schema looked identical to one that worked. Also corrected `create_document_package` from an unruled `365` to D-084's `30`. |
| **P1** `0036` | The gate | Export → verify → approve → purge, four functions that will not run out of order. The counts are computed **by the database** and a disagreement is refused; the digest binding reuses D-117 so an approval cannot outlive the package state it was given for. |
| **P2** | The export builder | The first code in this system that reads a document body back out of storage — write-only since M1. Refuses to produce a partial export, and is checked by **reconciling against a database query** rather than against its own manifest. |
| **P3** `0037` | Verification | Every member hashed against the manifest, not only the archive. Hop 1 is measured; hop 2 is an attestation in its own table, in its own words, and `approve_package_purge` does not read it. A declared hash records and does not open the gate. |
| **P4** `0038` `0039` | The executor and the panel | Targets derived from the approval, never an argument. Reconciles against a **listing of the bucket**, and refuses on anything it cannot account for. Dry run first, and it stays. |
| **P5** | Report rendering | A purged package's report says so in the masthead, with a count, a date and the export to look in. A pre-purge report is byte-identical to one built before the field existed. |
| **P6** `0040` `0041` | The export queue and the wired controls | The panel could show exports and could not take one. An operator queues, the worker builds, the archive is fetched through a signed link and verified member by member on the operator's machine. Found by deployment: a module nothing imports is not built (D-131), and `authenticated` cannot download from the documents bucket. |
| **P7** `0043` | Staged-copy hygiene | The export left a second full copy of every document body in the bucket and a bearer URL in a row that is never deleted. Both are bounded now. The sweep keys on the **bucket**, because an export interrupted after the upload leaves an archive no row points at — invisible to every design that starts from the request table. |

**Three findings changed the design rather than being worked around.**

*Every uploaded file exists in storage twice.* The browser stages at `{packageId}/staging/{uuid}`
and nothing has ever removed it, so one copy appears in no column. A purge driven from
`document_versions.storage_key` would have deleted the copy it knew about, left the staged one
holding the same licence images, and reported success — liability reduced on paper and not in fact.

*`authenticated` cannot list the documents bucket, and gets `[]` with no error.* The silent shape
from the earlier grant audit, in Storage rather than PostgREST, pointed at a deletion planner. A
browser-side dry run would find nothing unexpected in a bucket full of files and report a clean
plan: most confident when most blind. That is why the job is in the worker.

*A purged report used to regenerate byte-identically.* The report reads no body, so before P5 a
purge left a page that looked complete and rested on nothing retrievable — D-097's *chain that
resolves to nothing*, one level up. There was no broken page to prevent; there was a perfect-looking
one.

### A module nothing imports is not built

`apps/web/src/lib/exportVerification.ts` was written, typechecked, unit-tested, reviewed and
committed, and shipped in a bundle containing **none of it**. Nothing in the app imported it, so
Vite removed it — a milestone reported as built, absent from production, green the whole way.

The project's habit of breaking the code and watching a test go red cannot see this, because **the
test suite is itself a caller**. Deleting the module turns its tests red; deleting the only path to
it from the app turns nothing red, because there is no such path to delete.

It also hid a second failure: `verifyExportArchive` was exported from the engine's Node entry and
not its browser entry, so the bundler could not resolve it — and the build did not fail, because the
importing module had already been tree-shaken away. One orphan concealed a broken package export.

Two guards, D-131:

- `apps/web/test/reachability.test.ts` walks the import graph from `main.tsx` and fails on any
  unreachable source file. The allowlist is empty and belongs that way.
- `apps/web/test/bundledControls.test.ts` builds the app and reads the output, checking every
  control's copy and every RPC name is in the emitted JavaScript. It **builds rather than skipping**
  when `dist` is absent — a test that skips passes in exactly the situation it exists to check.

### Retention — carried, not done

Two of the three items P6 left are closed by D-132 and struck through below. What is left is the
picker, the originals, D-097's unbuilt regime, and the flag nobody holds.

| Carried | What it actually means |
|---|---|
| ~~**The staged archive is a second full copy, and its removal is manual**~~ | **Closed by D-132 (`0043`).** A matched `read_back` or `reupload` asks for the staged copy to go — evidence rather than a timer — and never a `declared` hash or a mismatch. An hourly sweep keyed on the **bucket** removes anything under `exports/` older than 24 hours, which is the only thing that reaches an export interrupted after the upload: `running`, no `storage_key`, a full archive no row points at. One was found in the test project by listing. |
| ~~**The download link is a bearer credential with a two-hour life**~~ | **Closed by D-132 (`0043`).** The row records `download_issued_at`; the sweep nulls the URL once it lapses. Not on consumption — fetching a signed URL tells the database nothing, and inferring it from a verification row misses the operator who downloads and does not verify. The finished-row freeze is relaxed **null-only**: a link may be cleared, never repointed. |
| ~~**`finished_exports_are_fetchable` is `NOT VALID`**~~ | **Validated in `0042`, on both databases.** The test project's leftover rows were discarded through the real path first — the archives removed, the rows recording that they went — so validation had nothing to except. Worth carrying forward as a lesson rather than a gap: a row that violates a `NOT VALID` constraint **cannot be repaired one column at a time**, because the check runs against the finished row on every update. Setting `discard_requested_at` alone was refused; both discard columns had to move in one statement. |
| **The partial-failure window is closed; recovery is resumption, not retry** | `begin_package_purge` names every object before any deletion, so a crash leaves a row saying what was going. It is **not automatic**: a new approval is taken and the plan reads the intent rows through `alreadyPurged`. Nothing retries on its own, and nothing should — an unattended retry of a deletion is the wrong thing to automate. |
| **The send-job seam is a source-level guard** | That `documentsSendJob` passes retention into `buildDocumentsReport` is checked as *text*. Dropping the argument is observable only for a **purged** package, and producing one in a unit test means writing the purge machinery — so a behavioural test of that line would be a test of everything else. **The weakest thing in P5**, and a one-word deletion would leave every purged package's report claiming its documents are still held, in a PDF that goes to an underwriter. |
| **`showSaveFilePicker` itself is unexercised** | Browser-only, and not drivable from a test. The logic above it is unit-tested against a fake whose disk contents differ from what was written — the assertion that matters, since hashing the in-memory buffer would pass every other test and prove nothing. P6 put the call in the deployed bundle and a test now proves it is there; **nobody has clicked it**. The same is true of every control on the panel: they are in the bundle, their data paths resolve against production, and no signed-in operator has driven one. |
| **Converted originals are unit-tested only** | No package in the test project has a `original_storage_key`, so the HEIC-arrives-JPEG-is-stored pair (D-104) has never been exported or reconciled against real bytes. The code paths exist and are covered by fakes. |
| **D-097's restricted-access regime is still unbuilt** | `document_retrievals` has a table, a policy and an append-only trigger, and **has never had a row**. No package has ever been archived, and there is no path that serves a document body to anyone. So today bodies are **neither restricted nor purged** — P0 built the clock and deliberately nothing else, so this ruling does not imply a regime that is not there. |
| **Nobody holds `purge_approver`** | The column defaults to `false` and no analyst has it, so `approve_package_purge` refuses everyone. This is the correct resting state and it stays until Frank names the moment. The executor has run only as a dry run, on scratch packages, and has never removed an object. |

### What D-129 left carried### What D-129 left carried

**Only entity type can be confirmed from a document.** The panel shows what the application says
and offers a button; it never applies the value (D-129). But it can only do that for entity type —
domicile is not an extracted field at all. Nothing in `packages/extraction/src/vocabulary.ts` reads
it, and inferring it from a formation state or from the presence of a W-8BEN would be a derivation
nobody has ruled on. So **US domicile is answered by a person or it is not answered**, and a package
whose operator never answers it carries both tax forms indefinitely. That is the correct outcome
under D-129 and it is also a nag nobody has been asked to live with yet.

**`predicate_inputs_not_extracted` is now a misnomer.** It is B-05's `not_evaluable` reason and it
reads as though extraction was supposed to supply these answers. D-129 rules the opposite: an
extracted value is evidence about the answer and never the answer. The key is rule *data*, so
renaming it is a decision-numbered change to `rules/documents.checks.json` and it would move a
vocabulary that stored findings already use. Left alone deliberately; the note the check emits says
"is not recorded", which is accurate.

**`has_existing_processor` is a column nothing writes.** The question was removed entirely (D-129)
and no predicate reads it, so it is null on every package. It is kept rather than dropped because
the template's `predicate_inputs` still admits it and a future conditional could use it — and
because B-05 now reports only on the answers a set's conditionals actually turn on, a permanently
null column costs nothing. If it is still empty in six months, that is the argument for dropping it.

### A revoked grant is loud; the silent shape is a grant that was never revoked

Stated because the first account of the `set_slot_state` defect got it backwards, and the wrong
version is the one that would have sent somebody looking in the wrong place.

The upload page called PostgREST `update` on `slots` from M1 until D-129. It never worked. But
`update` was **revoked** from `authenticated`, and a revoked grant raises `42501 permission denied
for table slots` — an error supabase-js returns and the page already displayed. The defect was a
visible failure on a path nobody had walked, not a write that vanished.

The genuinely silent shape is the other one:

| | What the client sees |
|---|---|
| **Grant revoked** | `42501 permission denied` in `error`. Loud. |
| **Grant present, no RLS policy for that command** | `204 No Content`, zero rows matched, `error` is null. **Indistinguishable from success.** |

The second is reachable in Supabase because its bootstrap grants `authenticated` everything on
`public` by default — so a table is in the dangerous shape unless a migration explicitly revokes.

**Audited against production, and nothing is in that shape.** `authenticated` holds seven
privileges in total, all `INSERT`, all with a matching policy: `comment_invites`,
`credential_deposits`, `document_send_requests`, `document_uploads`, `pdf_requests`,
`scan_requests`, `send_requests`. **No `UPDATE` or `DELETE` grant on any table.** Every browser
write is one of those seven inserts, and an insert is never silent either — an RLS violation on
insert raises rather than filtering.

The thing to keep checking is not the code but the migrations: **a new table with no explicit
`revoke` inherits the default grant**, and the first `.update()` written against it would be the
first silent write this system has had. The `revoke` line belongs in the same migration as the
`create table`, which is where every existing one is.

### The default set has not been validated against what a processor actually asks for

**This is the item that decides whether any of the above is useful**, and it is last because it is
the only one that cannot be closed by writing code.

Not a missing input. **There is no per-processor requirement set and none is owed** (D-128): one
default set, prechecked at creation, and the operator adds or removes per package. That is the
design, and the flow that does it is built.

What is open is a question about the default itself. `rules/documents.templates.json` holds twenty
slots with their counts, coverage rules and D-081 conditionals, and it was **drafted from a
screenshot of a requirements list**. Nobody has checked it against what a processor actually asks
for — whether three months of statements is right rather than six, whether proof of domain belongs
in the default at all, whether the conditionals cover the entity types that turn up.

The operator can adjust any of it per package, which softens this considerably: a wrong default is
a wrong starting point, not a wrong outcome, and a removal is recorded rather than silent (0033).
It does not remove it. A default nobody has checked is the set every package starts from, and an
operator adjusting the same slot on every package is a template problem being solved by hand — the
kind of thing that stays invisible precisely because the workaround works.

So: a correctness question about one file, answerable by one person who knows what is actually
required, and cheap to fix when they do. The template is data (hard constraint 1), the loader
refuses a malformed one, and changing it touches no code.

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
| **Mintro creating merchant accounts** | Whether Mintro may create its own accounts on merchant sites — agreeing to terms under an identity we chose, without the merchant's knowledge. Still blocked. **Merchant-supplied logins are authorized and built** (D-039); the two are deliberately separate rulings. |
| **Session authorization** | Whether Mintro may hold merchant sessions established by a *person* rather than by stored credentials. This blocks **assisted sign-in**, designed in full in `apps/worker/src/auth/assisted.ts` and deliberately unimplemented. |
| ~~**Resend domain verification**~~ | **Done, 2026-08-23.** `gomintro.com` verified, `RESEND_API_KEY` set on Fly. Both sends live and verified against a real recipient — see below. |

Assisted sign-in additionally needs two smaller decisions recorded in its own file: which machine
an analyst uses, and whether a hosted browser vendor is acceptable for a live handoff.

### Live-send verification, 2026-08-23

Both paths exercised against a real recipient, and the results read from the received mail and the
database rather than from the API's answer.

| | Result |
|---|---|
| Report send, accepted | `sends.resend_id` = a real Resend UUID, `mailer` = `Resend`, 60-page 6.3 MB PDF attached and stored |
| Report send, rejected | Forced with an unverified `from`. **A `sends` row was still written** — `resend_id` null, `outcome` `rejected`, provider's 403 captured (D-001) |
| Merchant invitation | **Not yet run.** Blocked on `INVITE_CONTACT_NAME` / `INVITE_CONTACT_EMAIL` |

The first attempt failed and produced the most useful finding of the exercise — see D-064, *"The
first live send failed, and the failure was worth more than the send"*. A message went to Resend
and its `sends` row did not get written, leaving a queue row reading `failed`, which this codebase
defines as *never reached a mailer*. **One test report reached the recipient with no `sends` row
behind it.** `send_requests.transmitted` now separates the two facts.

### An untransmitted invitation must never read as merchant silence

Worth stating separately, because it is the one place the dry run could do real harm. A merchant
invitation that is composed and not transmitted **invited nobody**. If the tool treated the
existence of a link as an invitation, every finding would render as *"the merchant has not opened
the report"* — Mintro's unverified sending domain presented as the merchant's silence, in front of
the underwriter deciding their application.

So delivery is an outcome on the job row (`comment_invites.delivery`), the database refuses a
finished job that does not say which, and a run whose links were never transmitted reports
`issued: false` with a note at the top of the report saying so. **This holds after the gate lifts**
— it is not scaffolding to remove when Resend is verified, since a genuine send failure produces
the same situation.

### Do not mint credentials against a live run to debug

Diagnosing the merchant page needed a working token, and tokens exist only as digests. A diagnostic
`comment_links` row was inserted against a live run — and the visits made through it are now
**permanently** in that run's participation record, because the append-only trigger refuses a
delete even from `service_role` (D-072).

That is the guarantee working. It also means debugging against a real run leaves marks that cannot
be removed. Use a scratch run, or a local database.

### The token never reaches a browser

The analyst-side control queues an intent (`comment_invites`, one field: the address) and the worker
mints the token. `comment_links` has no insert policy for `authenticated` and a schema test pins
that. If this is ever loosened, the digest stops being worth storing — a browser that can write the
digest computed it, so the plaintext was in a browser.

---

## Open, and what each waits on

Carried forward deliberately. Nothing here is forgotten work — each is a decision that has been
taken or a measurement that has not been made, and each says which.

| Open | Decision | Waits on |
|---|---|---|
| **Documents Check — the default set is unvalidated** | D-128 | **A correctness question, not a missing input.** There is no per-processor requirement set and none is owed; one default, adjustable per package. What nobody has checked is whether the default itself matches what a processor asks for. See *Documents Check — carried, not done* above. |
| **Rule set page** | scoped, deferred | Scoped and deliberately held behind Layer 3, which is now complete — so this is unblocked and awaiting a decision to start rather than a dependency. |
| **Multi-vertical rule sets** | scoping only | Scoping exists; nothing is built. The rule set is already data rather than code (hard constraint 1), so a second vertical is a data and validation question, not an engine one. |
| **Evidence slip composition** | D-075 | **Unmeasured.** 16.6 pages, the largest component of the printed report, and how much is reserved space versus the captures themselves is not known — the measuring browser is not served evidence. Needs a run measured with evidence served. Reducing the largest thing in the document on an assumption is the trade D-047 ruled out. |
| **PDF byte-level verification** | known limit | `loop-check` reads the rendered DOM, which is what `page.pdf()` prints and the honest authority on content. It does **not** read the PDF's bytes: `extractPdfText` cannot decode Chromium's subset-embedded fonts (D-057) and returns a shifted alphabet on our own output. Proving the file on disk says what the page said needs a real PDF parser, and is a separate decision. |
| **NAME-003 — proper names for non-peptide compounds** | D-137 | **Two inputs, neither of which exists.** The map holds two peptides; the catalogues seen are largely SARMs and SARM-adjacent compounds. Extending it needs (1) a ruling that the programme's naming clause reaches non-peptides at all — the programme document never mentions them — and (2) authoritative proper names from a specimen rather than from memory (D-118). Frank's ruling 2026-08-26: **do not extend the map on either.** Until then the rule reports `no_check_built` per page, which names Mintro as the limitation and counts as outstanding rather than resolved. |
| **`report_date` and the program document** | D-041, and the questions section below | `report_date` was renamed on an *interpretation* of the program document rather than a ruling from its owner. That and the other open questions are listed under **Questions for whoever owns the program document** — they are answerable only by that person, not by reading the rules harder. |

Frank has signed off on the screening loop. Documents Check is built through M6 and verified
against the test project; what remains is listed above as carried rather than open, because none
of it is waiting on a decision nobody has taken.

---

## Deferred

| Deferred | Decision | Note |
|---|---|---|
| **M6 — scheduled re-scans and diff** | D-002 | Deferred, not cancelled. Re-running a merchant already produces a new immutable run; evidence keys are run-scoped and never overwrite. Adding this later is a scheduler plus a diff view, not a data migration. |
| **`doc_parse` COA parsing** | — | COA-002, COA-003 and COA-004 report `not_evaluable` naming the gap. A COA rule silently passing because nobody wrote the parser would be a false pass. |
| **`doc_parse` `max`** | — | Only `min` exists, because only `min` appears in the data. Adding an upper bound is a one-line schema change when a rule needs one. |
| **COA authenticity** | `ARCHITECTURE.md` | COA-005 is a `manual` rule. Forged COAs are a known failure mode and accreditation cannot be verified from a PDF; an independent assay is the only real control. |
| **OFFS-003 bio-link inspection** | — | Social links are collected; where each leads is not examined. The finding says so. |

---

## Layer 3 — complete, built one stage at a time

**Complete as of 2026-08-24. The unbuilt column reads zero on all five storefronts.**

Until 2026-08-22 it appeared in no list here. It was not blocked and not deferred; it was never
written down, and the report described it in the same words it used for genuinely uncrawlable
surfaces (D-044). Thirteen rules — a quarter of the rule set — produced `not_evaluable` for this
reason alone, and every one of them is an ordinary page a browser loads.

Every rule in the set now has a check that runs, or a recorded reason it cannot. The stage table
below is kept as built rather than as planned: it is the record of what each stage established, and
several of the rulings in `docs/DECISIONS.md` only make sense beside it.

| Stage | Surface | Rules | Status |
|---|---|---|---|
| 1 | Sign-up form | GATE-004, GATE-005 | built, D-048 |
| 1 | Terms page | GATE-007 | built, D-048 |
| 2 | Payment page | PAY-001, PAY-003 | built, D-049 · PAY-002 now `manual` (D-052) |
| 2 | Shipping policy | FULF-001 | built, D-049 |
| 2 | FAQ | COMM-001 | built, D-049 |
| 3 | Checkout | FULF-002 | not built — `manual` (D-055) |
| 4 | COA documents | COA-002, COA-003, COA-004 | built, D-057 |

Each stage is validated against all five storefronts before the next begins, and the results table
goes in its decision entry.

GATE-003 never needed this layer: it runs through the Layer 2 flow probe, which is why every
report carries a real verdict for guest checkout. It is also decided by `runGateRules` from
requests carrying no session, and Layer 3 takes no part in that (D-039).

`doc_parse` is scoped separately and sequenced last. It is not a page check — it fetches a
document and reads it — and **what it can honestly conclude is narrower**: it may report what a
certificate states, never that the certificate is genuine. D-026 already records that a forged
COA is a known failure mode, and COA-005 stays `manual` regardless.

### Never rebuild while a scan is running

`tsc --build --force` rewrites the `dist` files a running scan is executing from. Node loads a
module once, so what is already loaded is unaffected — but anything loaded lazily afterwards comes
from the new build, and a run can end up spanning two versions of the code.

**Results from a run whose `dist` changed mid-flight are discarded, not inspected.**

The reason that rule is absolute rather than a judgement call: a swapped module does not reliably
produce results that look wrong. It produces results that look fine and are wrong. "Re-run if
something looks off" is a check that returns the same answer when it cannot tell as when the thing
holds — the D-026 shape, applied to our own operating procedure rather than to a handler.

The five-storefront runs are the ones cited in decision entries and shown to IQwallet. A finding
later traced to a mid-run rebuild makes the whole table unciteable, and re-running costs one
scan's time.

    while a scan is running:  no `npm run typecheck`, no `npm run build`, no `tsc --build`
    after any of those:       re-run the scan; do not read the results of the interrupted one

### This rule was broken by its own author, two hours after writing it

Worth recording precisely, because the circumstances are the argument.

It was broken during a **fix** — the vocabulary audit was failing, each attempt needed a rebuild to
test, and a five-storefront regeneration was running in the background. It was broken on the run
whose output Frank reads. And it was broken by the person who had written the rule that same
evening, having just recorded that "re-run if something looks off" is not a control.

Those are exactly the conditions the rule exists for. Nobody rebuilds mid-scan when nothing is
urgent.

> **A rule that only holds when nothing is urgent is not a control.**

The break was caught by checking file timestamps rather than by noticing anything wrong with the
output — which is the only way it *could* have been caught, since a run spanning two builds
produces results that look ordinary.

### Enforcing it instead of remembering it

Three options, cheapest first. **None is built**; the ruling on which is worth the machinery has
not been made.

**1. The scan refuses to start if it cannot pin its own build.** At startup the worker records the
newest mtime under `dist`; before writing each report it re-reads it, and aborts if it changed.
Cheap, needs no new files, and fails loudly at the moment the damage occurs rather than after.
Does not prevent the rebuild — it prevents the *result* from being kept, which is the thing that
matters.

**2. A lock file.** The scan writes `.scan-running` and the build refuses while it exists. Prevents
the rebuild outright, and blocks the build rather than the scan — which is the right way round,
since a scan takes ten minutes and a build takes ten seconds. Costs a stale-lock problem: a killed
scan leaves the lock behind and the next build fails for a reason that has nothing to do with it.

**3. Copy `dist` at scan start and run from the copy.** Makes the run genuinely immune. Most
robust, most machinery, and it changes how the worker is invoked everywhere including on Fly.

Option 1 is the closest fit to how everything else here works: it does not stop the mistake, it
stops the mistake producing a citable result — the same posture as reporting `not_evaluable`
rather than guessing.



### Validation against the five storefronts is not a nicety

**Six instances of one defect have been found by running against real sites. Zero were found by
the fixture suite.** The sixth had been silently passing merchants for the entire life of the flow
probe: GATE-003, `critical` and `auto_fail`, reporting a product listing as "stopped at checkout,
no payment field observed" and calling that a pass (D-056).

The reason is structural, not a gap in how the fixtures were written.

> A fixture proves a handler does what it says **on input we constructed**. Only a real site
> reveals that the input was never what we thought.

Every one of the six had the same shape: a real page that superficially matched. A sign-in form
carrying a password field. A redirect target returning 200 with thousands of characters of text.
A cart widget's "Return to shop" link. A product listing the checkout flow happened to land on.
None is malformed, none is adversarial, and each satisfies a check's stated condition while not
being the thing the check is about. A fixture author writing that page would write it as the
document they had in mind — encoding the same assumption the check makes, and confirming it.

**So a new check is not finished when its fixtures pass.** It is finished when it has run against
all five storefronts and its output has been read line by line. Fixtures stop a check regressing;
only real pages establish that it was right to begin with.

### The fixture suite cannot find this class of defect

Both defects stage 1 produced were found by running against the five real storefronts, and
**neither could have been caught by a fixture**. The shape is always the same: *a real page that
superficially matches*.

- A WooCommerce `/my-account/` page carries a sign-in form with a password field and a "Remember
  me" checkbox. It matched "a form containing a password input" perfectly, and was reported as the
  sign-up form.
- A terms-page request answered with a redirect to `/` returns HTTP 200 and several thousand
  characters of real text. It matched "a page that loaded and has content", and was measured for
  the five clauses GATE-007 requires.

A fixture is written from what the author expects the page to look like, so it encodes the same
assumption the check does and confirms it. Neither of these pages is malformed or adversarial —
each is an ordinary page that satisfies a check's stated condition while not being the thing the
check is about.

**So a new check is not finished when its fixtures pass.** It is finished when it has been run
against all five storefronts and its output read line by line. Fixtures keep a check from
regressing; only real pages establish that it was right to begin with. Both stage-1 defects were
`not_evaluable` vs. a confident wrong answer, and both produced findings that read as facts about
the merchant.

### What stage 1 established that is worth carrying forward

A sign-up form is located by its password field, and is only treated as a sign-up form on
**positive** evidence that it creates an account — `autocomplete="new-password"`, or a second
password field to confirm one. Four of the five storefronts serve a sign-in form at
`/my-account/` and no account-creation form at all; before that check, the sign-in form was being
read and reported as the sign-up form.

---

## A certificate link that resolves and serves something else

**Three of the five storefronts publish COA links that return 200 and serve something that is not
a certificate.** This is the substantive result of Layer 3 and the clearest example of what this
tool exists to surface.

    swisschems.is             /independent-test-results/   200   130,126 bytes   text/html
    sportstechnologylabs.com  /coas/                       200   574,294 bytes   text/html
                              4 further links              200   ~52-74 KB each  image/webp

sportstechnologylabs publishes its certificates as **`.webp` images served from a CDN**. A customer
clicking through sees something that looks like a certificate. Nothing machine-readable is served
and nothing in it can be checked.

> **A 404 is visibly broken to anyone who clicks it. A 200 serving an image looks live** — to a
> customer, to the merchant checking their own site, and until D-058 to us.

That is a better observation than "no COA published", and it was invisible while both were reported
in the same sentence. Every attempt is now on the finding with its status, byte count and content
type, and the three cases land in different buckets: a missing link and a broken link are the
merchant's, a failed request is ours.

A fourth state exists and is not a failure of the merchant's: biotechpeptides publishes a real PDF
whose fonts carry their own encoding with no character map. It is fetched, stored and hashed, and
the report says we could not read it — not that it lacks fields.

---

## Questions for whoever owns the program document

Readings of the program text, not engineering choices. Each changes what a rule asks, and each
reverses if the document's owner reads it the other way.

| Question | Current reading | Where |
|---|---|---|
| "COAs must be updated at minimum every 60 days" — updated when? | The certificate was **issued**, not when the sample was drawn. A merchant publishing a certificate reported 22 July has updated their documentation as of 22 July. | D-058 |
| Capsule and reconstitution labelling on products that are neither | Settled: the rule does not apply, and that is a resolved outcome rather than a coverage gap. | D-044 |

On the first: COA-002 extracts `report_date`, and the param was renamed from `test_date` so the
rule names what it reads. The same certificate can carry a sampling date, a testing date, a report
date and an expiry, days or weeks apart. **If "updated" means the assay rather than the report, the
reading reverses and the reader must change with it** — the rename exists so that change is one
place, not a search through finding copy.

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

Two further limits are properties of what the crawl can see, and each finding states them:

- **`content`-scoped rules are only as accurate as product classification.** Where the catalogue
  was not identified, `content` approaches "every URL", so every such finding names the population
  it examined (D-023, required).
- **A slug indicates topic, not claim.** OFFS-006 surfaces candidates for a human and is
  permanently `review_only`; only someone reading the article can tell rigorous chemistry from a
  dosing guide (D-020).

### Keeping the document short is a check, not a habit

`npm run compose-check` asserts that a printed report does not occupy materially more pages than
its content fills, across five real storefronts and two synthetic shapes. A document printing well
beyond its content height means something is forcing page breaks it should not - which is what
`break-inside: avoid` on every finding row was doing, at 27% of the printed document (D-075).

`npm run page-budget -- <run-id>` measures one run by section and separates content from air. That
is the tool for finding *which* rule is wrong once `compose-check` says one is.

**Do not raise the ceiling to make `compose-check` pass.** It is set to separate two measured
states rather than to sit above today's number, and it was verified failing before being trusted.

### What `loop-check` does and does not tell you

`npm run loop-check -- <run-id>` answers one question: **did the document IQwallet received carry
what the merchant actually did?** Their words verbatim, the attribution treatment, the participation
record, and an unanswered list cross-checked in both directions against the comments in the
database.

It is built so the two sources are independent — expected values from SQL rows, actual values from
the rendered document, neither derived from the other or from the code that built the report. It
caught its own first mistake that way, and the fix is the practice: **when a check needs to know a
rule the code applies, derive it independently from the data rather than asking the code what it
decided.**

**It reads the rendered DOM, not the bytes of the PDF.** `extractPdfText` cannot decode the
subset-embedded fonts Chromium writes — it exists to judge *fetched* documents (D-057) and returns a
shifted alphabet on our own output. The DOM is what `page.pdf()` prints, so it is the honest
authority on content; the stored artifact is checked only for what it can answer, that it exists and
its size.

**A PDF text layer is not being built.** If a check on the sent bytes themselves is ever needed —
proving the file on disk says what the page said — that is a separate piece of work with a real PDF
parser, and it should be decided as one rather than grown out of this.

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
