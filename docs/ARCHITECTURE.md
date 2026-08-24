# Architecture — decided

These are rulings, not options. Rationale is included so you can tell when a ruling has
stopped applying. If you think one has, raise it; don't route around it.

## The constraint that shapes everything

The screener drives a real browser. Playwright needs Chromium, a filesystem, and 60–120
seconds per run. Netlify Functions are short-lived Lambdas without a browser binary and
with a hard timeout well under what a crawl needs.

**Therefore the browser work does not run on Netlify.** Frontend and worker are separate
deployments. Any proposal that puts crawling in a Netlify Function is rejected up front.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + Tailwind, deployed to Netlify | Static build, instant deploys, matches the settled design in `demo/` |
| Database, auth, storage | Supabase | Postgres + row-level security + S3-compatible storage for screenshots, in one service. Avoids building auth. |
| Crawl worker | Node + Playwright on Fly.io | Long-running container, Chromium available, no timeout ceiling. Fly confirmed by the business owner. |
| Job queue | Postgres table + `FOR UPDATE SKIP LOCKED` polling | At this volume Redis is a dependency we don't need. Revisit past ~50 concurrent runs. |
| Email | Resend | Already on the account |
| PDF | Playwright `page.pdf()` against an authenticated report route | The worker already has a browser. Adding a PDF library duplicates it. |

### Notes on specific rulings

**Supabase over a hand-rolled API.** The screener holds merchant credentials and evidence
that may end up in a dispute. Row-level security and audit logging out of the box are worth
more than the flexibility of a custom backend.

**PDF via the existing browser.** The report is already an HTML route. Rendering it to PDF
in the worker means the PDF and the web report can never drift apart. Do not add Puppeteer,
wkhtmltopdf, or a React-PDF layer.

**Playwright over the alternatives.** This is not a preference. The design depends on three
things Playwright gives us directly:

- `storageState` — export an authenticated session to JSON and load it into a fresh browser
  context. This *is* the auth handoff for gated merchants. Puppeteer has no equivalent
  ergonomics; you end up hand-managing cookie jars.
- Tracing, HAR capture, and full-page screenshots as first-class APIs. Our evidence
  requirement is exactly these three artifacts. Anywhere else it's bolt-on.
- `page.pdf()` — the report PDF, with no second rendering stack.

Also: an official Docker image with Chromium and its system libraries preinstalled, which
matters on Fly where you own the container. Auto-waiting removes most of the flaky-selector
class of bugs that plague Selenium suites.

Rejected: **Puppeteer** (Chromium-only, weaker session and tracing story), **Selenium**
(heavier, older API, no built-in tracing), **Cheerio or plain fetch** (no JavaScript
execution — a Shopify storefront returns a shell with no footer and no product data, so
checks would fail for the wrong reason). Playwright's own footprint is a ~400MB container
image; that is the real cost and it is acceptable on Fly.

**Hosted browser vendors (Browserbase, Steel) are the fallback, not the default.** Start with
self-hosted Playwright. If merchant sites start challenging datacenter IPs, switch — those
vendors bundle residential proxies and stealth. Budget for this; treat it as likely, not
hypothetical. Test against five real storefronts during M2 so you find out early.

## Data model (minimum)

```
merchants        id, legal_name, domain, platform, created_at
credentials      merchant_id, vault_ref, last_used_at        -- never the secret itself
runs             id, merchant_id, started_at, finished_at, mode, ruleset_version, status
findings         id, run_id, rule_id, state, note, source_url,
                 matched_value, evidence_key, captured_at
evidence         key, run_id, kind(screenshot|dom|har), sha256, bytes, created_at
sends            id, run_id, to_email, resend_id, sent_at, sent_by
```

`runs.ruleset_version` is not optional. A finding is meaningless without knowing which
version of the rules produced it, and the rules will change.

## Check types

The engine implements handlers for these. Rules select one. Adding a rule uses an existing
handler; adding a handler is a code change and needs review.

| Type | What it does |
|---|---|
| `url_pattern` | Match sitemap URLs against patterns (Layer 0, no browser) |
| `http_probe` | Fetch a path unauthenticated, assert on status or redirect |
| `dom_assert` | Selector presence, absence, or attribute value on a rendered page |
| `text_match` | Regex or term list against rendered text, word-boundary aware |
| `text_cooccurrence` | Two term classes within N tokens — used for dosing detection |
| `computed_style` | Rendered font-size, contrast ratio, visibility, collapsed ancestors |
| `doc_parse` | Fetch a linked PDF (COA), extract fields, assert on them |
| `flow_probe` | Multi-step interaction — add to cart, reach checkout |
| `manual` | Always returns `not_evaluable`. Documents the gap in the report. |

## Crawl layering

Short-circuit on a critical failure. Most merchants never reach Layer 2.

- **L0** robots.txt, sitemap.xml, search index. No browser. ~5s.
- **L1** Homepage rendered. Gate, footer, payment badges, social links. ~20s.
- **L2** 3–5 product pages, chosen by suspicion score from L0 slugs — never at random,
  and never left to an analyst to pick. ~40s.
- **L3** Policy pages, FAQ, checkout probe.

## Non-goals

Not in scope, and the report must say so rather than implying coverage: support channel
content, packing slips, ban list maintenance, COA authenticity, shipping destinations,
social post content, staff conduct.

## Handler requirements carried forward

Rulings made before the handler was written, recorded so they are not rediscovered by
shipping something noisy or misleading. Each names the rule or check type it binds.

### Session mode must appear in the evidence

`http_probe` and `flow_probe` both take an optional `unauthenticated` param. Absence means
**inherit the run's session mode** — it is not a synonym for "unauthenticated".

Because the meaning of these probes depends on session state, **the runner must record the
session mode actually used in each finding's evidence.** "GATE-002 returned 200 for
/collections/all" says opposite things depending on whether the request carried a merchant
session, and a report that does not say which is not evidence of anything.

This is the same failure class as an unvalidated param key: a silent default that changes what
a finding means. Validation refuses to let a param be silently ignored; this refuses to let
session state be silently assumed.

### PROD-002 matches only inside the labelled region

PROD-002 (molecular formula) carries both a `pattern` and `labels: ["molecular formula"]`. The
pattern `\b(?:[A-Z][a-z]?\d{0,3}){3,}\b` matches a great deal of ordinary capitalised text —
run against free page text it will fill the review queue with headings and product names.

**The handler must apply the pattern only within the region identified by `labels`, never to
the whole page.** `labels` is a scoping instruction, not a hint. The general form: where a
`text_match` rule carries both `labels` and a `pattern`, the labels bound where the pattern is
allowed to match.

This matters beyond one rule. Rules that reach human review are the ones whose accuracy
decides whether analysts trust the tool; a noisy review queue is not a cosmetic problem.

## The triage axis — check this first when adding a rule

**Absent + cannot-locate reads as clean.** That is the silent false-pass signature, and it is the
defect this project keeps rediscovering under different names. Before writing or reviewing any
rule, work out which row it sits in:

| `expect` | If the check fails to locate its subject | Result | Who notices |
|---|---|---|---|
| `absent` | reads as "the thing is not there" | **false `pass`** | **nobody** |
| `present` | reads as "the thing is missing" | false `fail`, or review-queue noise | a human, eventually |

The asymmetry is the whole point. A false `fail` reaches a person who can correct it. A false
`pass` is indistinguishable from a clean merchant and is never looked at again.

Every occurrence so far has been the same shape — **a verdict resting on a surface that was
never established**:

- **D-011** — CATG rules reported "no needles, no wipes, no tablets" against a catalogue the
  crawler had never identified. Three false passes on `critical` / `auto_fail` rules.
- **D-014** — DISC-002 located the disclaimer by its compliant wording, so a merchant whose
  disclaimer was worded differently and rendered at 2.94:1 contrast came back `not_evaluable`.
- **D-016** — GATE-001 reported an age gate because the string `21+` appeared somewhere in the
  markup, with no interstitial anywhere on the page.
- **D-018** — a clean `expect: absent` result worded as a universal claim, when only one kind of
  markup had actually been searched.

The rule that follows from all four: **a check may only report on a surface it established it
could see.** Where it could not, the answer is `not_evaluable`, whichever direction the partial
evidence appears to point.

## Negatively-defined scopes must state their denominator

A scope defined by exclusion — `content` is the first, meaning "not a product, not a collection,
not site machinery" — is only as accurate as the classifications it excludes. Where the catalogue
was not identified, `content` approaches "every URL".

**Therefore any rule scoped to one must state the population it examined in its finding:**

    "32 of 192 content URLs have slugs indicating therapeutic-topic subject matter …"

Without the denominator, a scope that resolved to the whole site reads exactly like a scope that
resolved to the right part of it. With it, a reader can see how much of the site the scope
actually distinguished and weigh the finding accordingly.

This is required, not stylistic (D-023). It applies to every scope defined by exclusion, present
and future.

## RLS decides reads. Triggers decide changes.

Not a stylistic split. **Row-level security structurally cannot enforce hard constraint 5**, and
the reason is worth stating rather than leaving to be rediscovered.

`service_role` — the key the worker uses — carries `BYPASSRLS`. Every policy in
`supabase/migrations/` is invisible to it. That is by design: the worker must write rows an
analyst may never write, so it needs to be outside the policy system.

But the process that writes the evidence is precisely the process constraint 5 constrains:

> Evidence storage is append-only. Screenshots and DOM snapshots are never overwritten or deleted
> by application code.

An RLS policy forbidding `UPDATE` on `evidence` would be enforced against the browser, which never
had write access anyway, and ignored by the worker, which is the only thing that could overwrite
a capture. The guarantee would read as watertight and protect against nobody.

### The trigger must refuse the person with a good reason

This stopped being theoretical on 2026-08-24. Debugging the merchant page needed a working token,
and tokens exist only as digests, so a diagnostic `comment_links` row went into a **live run** and
was identified through. Cleaning up afterwards was not possible: the trigger refused the delete,
**for `service_role` too**, and the rows are in that run's record permanently (D-002, D-072).

That is the case these triggers exist for. **Not an attacker** — someone with legitimate access, a
real reason, and every intention of tidying up after themselves.

> **A guarantee that yields to a good reason is not a guarantee**, and a rule that holds only
> against bad actors holds only against the ones who announce themselves.

Which is why none of these triggers take a role check, an override flag, or a "just this once"
escape. Every one of those would have been used that day, by the person who wrote them, with a
defensible explanation ready — and after that the record of a merchant's screening would be
editable by anything holding the service key, which is every part of the worker.

The practical consequence has to be planned for rather than discovered: **debug against a scratch
run or a local database**, because anything written to one of these tables is written for good.

So the split is:

| Question | Enforced by | Applies to |
|---|---|---|
| Who may **read** this? | RLS policies gating on `public.is_analyst()` | `anon`, `authenticated` |
| What may **change**? | `BEFORE UPDATE OR DELETE` triggers, primary keys, `upsert: false` | everyone, including `service_role` |

Triggers are not bypassed by `BYPASSRLS`. Neither is a primary key. That is what makes them the
only place an append-only guarantee can actually live in this architecture.

**The general form:** when a constraint governs what a *privileged* process may do, it cannot be
enforced by a mechanism that privileged process bypasses. Ask which principal the rule is really
aimed at before choosing where to enforce it — and if the answer is "us", a policy is the wrong
instrument.

The one deliberate exception is `runs`, where the trigger is precise rather than blanket: a run is
mutable while in progress, because it has to be finished, and frozen from the moment `finished_at`
is set. That is exactly the boundary D-002 draws.

## Constraint 9 governs preconditions, not just checks

**Hard constraint 9 applies to any component that establishes a precondition for findings, not
only to check handlers.**

The session layer asked *"is a login form absent?"* — find-by-nothing — so a **404 read as a valid
session**. A run proceeding logged-out while reporting as authenticated inverts every GATE-002
and GATE-003 finding it produces, since those rules' entire question is what a session changes.

> **Preconditions must be established by positive evidence of the state they assert, never by
> absence of its contradiction.**

A precondition is anything a finding silently depends on being true: that a session is live, that
a page rendered, that a footer was located, that the catalogue was identified. None of these
appears in a finding's text, which is exactly why getting one wrong is invisible — the finding
looks the same whether the precondition held or not.

Two instances, same family, both found by running against a real target rather than by review:

- **The session check.** Absence of a login form was read as presence of a session. Fixed by
  requiring the signed-in marker positively; a non-success status is decisive on its own.
- **The redirect-to-login probe.** A merchant who gates their catalogue answers an anonymous
  request with a redirect to the login form; the browser follows it and the login page returns
  200. Compliant gating and no gating were **indistinguishable**, and a correctly-gating testbed
  was auto-failed for gating correctly. Fixed by treating a request that ended elsewhere as not
  served, and reporting the redirect as the observation that the gate works.

When adding anything that a finding depends on, ask what the component returns when it cannot
tell. If the answer is the same as when the precondition holds, it is wrong.

### It reaches the storage layer too

The rule engine has been disciplined about this since M1. The storage layer was not, and it cost
six defects in one sequence (STATUS.md lists them). Two are the same sentence as the session check:

- **The bucket guard** asserted the evidence bucket at migration time. The uploads happened later.
  A guard that runs once, long before the thing it guards, is not guarding it. Preflight now runs
  immediately before the first write, against the project being written to.
- **Closing a run before verifying it.** Closing sets `finished_at`, and the trigger in
  `0004_runs.sql` then refuses every write — so closing *is* the assertion that a run is complete,
  and an assertion of completeness can never precede the evidence for it. Five runs froze
  permanently incomplete. `finishRun` is now the last step and runs only after the check passes
  (D-033).

The completeness check had the same problem inside its own fix. `assessRun` derives what a run
should contain from the report it reads back, and before `finishRun` there is no stored report —
so calling it before the close finds nothing, expects nothing, and passes vacuously. The check
takes the report as an argument for exactly this reason.

A third instance points the other way and is worth keeping in view, because it is easy to mistake
for a different kind of bug. `readContents` discarded the `error` from its own queries, so a
transient read failure became *an empty database* and condemned a run that had written everything
(D-036). Same defect, opposite sign: the reader could not tell "nothing is there" from "I could
not look".

A false failure is the survivable direction, and it is still not a check. A guard that condemns on
a network blip gets ignored, which costs what a guard that passes on a blip costs.

**The operational test extends unchanged, and runs in both directions:** ask what the guard reports
when the thing it guards has not happened yet, and what it reports when it could not see.

### And the frontend, where nobody had looked

The report selector resynced only while its value was `''`, so it answered identically whether it
held a deliberate choice or a default that had gone stale — and a finished scan left it naming the
previous run of the same merchant (D-045). Component state answers when it cannot tell exactly as
readily as a session check does; the constraint is about components that establish preconditions,
and "which run is on screen" is one.

A third instance arrived with the fix for the first, and is the one to carry forward. The
coverage line rewritten by D-044 destructured fields D-044 had just added, and rendered a **blank
number** against a run recorded the day before — an immutable report (D-002) whose stored coverage
could not contain them (D-047).

> A record written in the past cannot acquire a field added later. Any derived display must state
> what those records actually hold, rather than computing from data that is absent.

Ask what a display renders when the record predates the field. A blank, a zero, or a plausible
number derived from `undefined` are all wrong, and the zero is the dangerous one — a zero reads as
a measurement. This recurs every time the report gains a field.

It also adds a second axis. The backend instances were invisible because a precondition never
appears in a finding's text. This one was invisible because two different runs **rendered as the
same string** — same merchant, same counts, timestamp truncated to the day. So the test gains a
presentation half: when a control names a record, ask whether its label can distinguish two
records the user might plausibly hold. If it cannot, a wrong selection is not merely possible but
unobservable.

### A destination's status says nothing about whether what you asked for exists

Stated generally because **every fetch-a-document check inherits it**, and `doc_parse` inherits it
next.

`http_probe` already treats a request that ended somewhere other than the path asked for as *not
served*, whatever status the destination returned (D-026). The same rule governs fetching a
document, and it had to be learned twice: peptidesciences.com answers every terms-page candidate
with a redirect to `/`, the first draft of the terms fetch accepted it — HTTP 200, plenty of text
— and GATE-007 reported *"5 of 5 required phrases were not observed"* about the **homepage**
(D-048).

> **A request that did not end at the document you asked for did not reach that document. Status,
> length, and content type say nothing about it. Establish what came back positively, or report
> that nothing did.**

The failure is worse than an ordinary wrong answer, because the finding it produces is *plausible*:
a terms document genuinely missing all five required clauses looks exactly like a homepage
measured against them. Nothing in the report distinguishes them unless the fetch does.

What "positively" means depends on the document:

- **A page fetch** — the final URL still names a path, not the site root. A themed 404 is caught
  by the same question asked of its content, not by its status.
- **A PDF or a COA** (stage 4) — the response is actually that content type and parses as it.
  A storefront serving its 404 page with `Content-Type: text/html` to a `.pdf` request has not
  served a certificate, and a parser handed HTML must say so rather than reporting an empty
  certificate.

The operational test is the constraint-9 one pointed at fetching: ask what the check reports when
the document was never reached. If that is the same as what it reports for a document that was
reached and found wanting, it is wrong.

## Evidence fields carry what was observed, and nothing else

A constraint, not a convention, because a guard now depends on it.

`auditInternalVocabulary` exempts anything appearing in a finding's merchant-provenance fields —
`matchedValue`, `sourceUrl`, `matchedUrls`, the URLs of attempts — so that a Divi theme's
`et_pb_column`, quoted as the evidence for where a disclaimer was found, survives the audit intact
(D-060). A CSS selector is the evidence.

That makes those fields load-bearing:

> **Any field the audit treats as merchant-provenance must contain only what was observed. A
> writer putting generated text there defeats the guard silently** — the audit passes, the finding
> renders, and nothing marks the exemption as wrong.

It had already been broken before the guard existed. GATE-003 recorded
`matchedValue: "reached payment_step_reached"` — our stage identifier in a field documented as
*"what was matched, verbatim"* — which would have exempted itself from the audit built to catch it.

### Deferred: a `Captured` type, and the design question that defers it

The same question the locator answered for surfaces (D-054) — make the wrong value
unrepresentable. `matchedValue: string` accepts any string, so nothing distinguishes a captured one
from a composed one. A `Captured` type, producible only by the code that reads a page, a document
or a response, would mean a handler cannot put generated prose there because it has no way to make
one.

**It is deferred, and the reason is not cost.**

    // today: any string, provenance by convention
    readonly matchedValue?: string;

    // proposed: only what a reader produced
    readonly matchedValue?: Captured;

**Some composition is legitimate, and a type that forbade it would forbid legitimate evidence.**
DISC-002's matched value is `selector=… font-size=… color=… background=… contrast=…`, assembled by
us from values read off the page. That is the finding's whole backing. A `Captured` that only
accepted a single verbatim string would make DISC-002 unable to record what it measured, and the
handler would route around the type — which is worse than the convention, because it looks
enforced.

So the design question, stated rather than left implicit:

> **What API lets a captured value be composed from other captured values, refuses free text, and
> is pleasant enough that nobody works around it?**

A tagged template whose literal parts are rejected and whose interpolations must be `Captured` is
the obvious shape, and it is not obviously usable — every handler that builds a matched value today
would have to be rewritten against it, and an API people dislike gets bypassed with a cast.

**Until that API is designed, the honest position is a written constraint plus review**, which is
what the section above is. This is deferred with a question outstanding, not a gap left open:
the constraint is real and enforced by reading, and the enforcement is a design problem nobody has
solved here yet.

## D-014 audit — checks that locate by compliant form

Every implemented and pending handler, reviewed against hard constraint 9. Ordered by
consequence, not by rule number.

### Fixed

**DISC-002** (`computed_style`, critical, auto_fail) — located the disclaimer by the required
wording. Blind to any merchant whose disclaimer was worded differently, which is the case the
rule exists to catch. Now locates by resemblance (`textSimilarity.ts`) and the subject is
declared in data (D-015). Caught on swisschems.is: a real disclaimer at 2.94:1 contrast that had
been reported `not_evaluable`.

### Must be built correctly — not yet implemented

**OFFS-002** (`dom_assert`, critical, `expect: absent`) — the worst instance remaining.
Locates testimonials by `[class*=review], [class*=testimonial], [data-product-reviews]`. A
merchant whose testimonials sit in `class="customer-stories"` or `class="results"` is invisible,
and invisibility reads as `pass` — "no testimonials observed" on a critical rule.

There is no reliable structural marker for a testimonial. Therefore: where the selector matches
nothing, this rule may **not** report `pass` on the general claim. Either report `not_evaluable`,
or word the finding to the scope actually searched ("no review-widget markup was observed"),
never "no testimonials". Do not let it assert more than it looked for.

**DISC-003** (`dom_assert`, critical, auto_fail, `expect: present`, `threshold: all`) — the
mirror image, and dangerous in the opposite direction. If it locates the per-page disclaimer by
the required wording, a merchant whose disclaimer is worded differently **auto-fails on every
sampled page**. It must use the same resemblance locator as DISC-002, not verbatim matching.

### Same shape, safe direction — noted, not urgent

All are `expect: present`, so failure to locate produces a review rather than a false pass. Each
still generates avoidable noise in the human queue.

- **COA-001** — finds the COA link by `text_or_href_contains: ["coa", "certificate of
  analysis"]`. A COA linked as "Independent Test Results" (swisschems.is uses exactly that
  wording in its footer) or "Lab Report" is missed, and a compliant merchant is queued for review.
- **PROD-002 / PROD-003 / PROD-004** — locate a spec field by its label (`molecular weight`,
  `storage`, `store at`). A page rendering `MW: 1419.5 g/mol` without the spelt-out label is
  reported as missing it.
- **GATE-001** — finds the age gate by a fixed signal vocabulary. A gate reading "Please confirm
  you are of legal age" is missed. See D-016, which tightens the opposite problem.

### Compliant

- **`url_pattern` scope classification** — locates by path structure and by URLs observed on a
  rendered page, never by whether the slug looks compliant. This is what D-011 fixed.
- **Footer region location** — `<footer>`, `[role=contentinfo]`, then class fallback; failure to
  locate yields `not_evaluable`, not a verdict.
- **Shop structure discovery** — schema.org `Product`, cart forms, product-card markup. Failure
  to locate yields `not_evaluable` for the affected scope.
- **OFFS-003** — collects social links by platform domain. Collection only; asserts nothing about
  compliance, and its note already states that off-site content was not examined.

## A dependency's warning about our own misuse is a defect report

**Standing practice, from D-070.**

Chrome printed **"Multiple GoTrueClient instances detected in the same browser context"** on every
load of the merchant page, including the loads that worked, for two days. supabase-js emits that
line precisely because a second instance *produces undefined behaviour* — which is exactly what was
happening: a client rebuilt on every render, a React effect keyed on its identity, and three
concurrent copies of the same request racing to set the page state.

It took a network trace to find. It had been on the console the whole time.

> **A warning nobody reads is a test nobody runs.**

So the practice:

- A console warning from a dependency **about our own usage** is a defect report, not noise. The
  library author wrote it because they know a failure mode we are currently in.
- **The response is a test, not a dismissal.** Not a filter, not a suppression comment, not "known
  and benign". Something that fails when the misuse returns — `clientIdentity.test.ts` asserts the
  anon client is one instance, because the identity *is* the contract.
- **An expected warning is worse than a loud one.** A line everybody reads past is a line nobody
  notices changing, so the goal is a clean console rather than a familiar one. That is why the
  merchant route no longer constructs the analyst client at all: it was harmless in itself and it
  was keeping that warning alive.

This is the same discipline the rest of the project applies to `not_evaluable`: a signal that
something could not be established is worth nothing if it renders identically to everything else.
