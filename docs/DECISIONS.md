# Decisions

Business rulings, dated, with the reasoning. Claude Code: treat these as binding. If a
decision looks wrong for what you're building, raise it — don't route around it.

---

## D-001 — Send is never blocked
**2026-08-20 · business owner**

IQwallet sees every report regardless of outcome. The Send button is always enabled. No
confirmation interstitial, no "are you sure", no supervisor override flow.

**Reasoning.** Mintro's role is triage and evidence, not gatekeeping. A tool that blocks a
send is making a determination, and we have been explicit throughout that determinations
are IQwallet's. Blocking would also create a record of Mintro deciding what IQwallet does
and does not get to see, which is exactly the wrong artifact to have in a dispute.

**Follow-on: the verdict banner is now descriptive, not directive.** It was "DO NOT
FORWARD". That was a recommendation, which contradicted the posture. It now states counts
and the most consequential failures as facts, with no instruction attached. Apply this to
all report copy — findings describe what was observed, never what should happen next.

An analyst may still choose to work with a merchant before sending. That's a workflow
decision they make outside the tool, not a state the tool enforces.

---

## D-002 — No scheduled re-scans in v1
**2026-08-20 · business owner**

Do not build a scheduler, a diff engine, or new-finding alerts. M6 in `CLAUDE.md` is
deferred, not cancelled.

**Reasoning.** The product is a pre-underwriting screen. Continuous monitoring is a
different product with a different buyer, and building it now would spread the team across
two problems before either works.

**What must still be true.** Re-running the same merchant is a normal operation and must
produce a **new immutable run**, never an update to an existing one:

- `runs` rows are append-only. Nothing in application code updates or deletes a completed run.
- Every run stamps `started_at`, `finished_at`, `ruleset_version`, and `mode`.
- Evidence keys are unique per run. A second scan never overwrites the first scan's
  screenshots — that would destroy the record of what the site looked like at the time.
- The merchant view lists runs in reverse chronological order. Comparison between runs is
  something a human does by reading two reports.

This costs nothing now and means adding scheduled re-scans later is a scheduler plus a
diff view, not a data migration.

---

## D-003 — Logo pending
**2026-08-20**

A replacement mark is coming from the business owner. Until it lands, `demo/index.html`
uses a CSS-drawn placeholder in the sidebar (`.brand-tile` / `.brand-word`).

When the file arrives: SVG preferred, single asset at `apps/web/src/assets/logo.svg`,
referenced from one place. Do not scatter the mark across components — the sidebar, the
PDF header, and the Resend email template all pull from the same source.

Needs to work in three contexts: on the deep violet sidebar, on white in the PDF header,
and at ~24px in the email. If the supplied mark only works on one of those, say so rather
than scaling it down and hoping.

---

## D-004 — The demo is not deployed
**2026-08-20 · business owner**

No Netlify site for `demo/index.html`. No Track A. Do not spend time on hosting it.

**What the demo is still for.** It stays in the repo as the **design specification for M3**.
The layout, the four-state system, the evidence slip, the tick strip, the filter behaviour
and the report copy are all settled and were reviewed. When building the React frontend,
port it faithfully rather than reinterpreting it — redesigning from scratch would repeat
work that is already done and would likely lose the parts that were deliberate (the
not-evaluable state, the descriptive-not-directive copy).

Open it locally in a browser when you need to see intended behaviour.

---

## D-005 — Infrastructure confirmed
**2026-08-20 · business owner**

Supabase and Fly.io are both already in use at Mintro. Fly is now the worker host; drop
Railway from consideration. Netlify remains the frontend host.

---

## D-006 — Playwright confirmed (architect's ruling)
**2026-08-20**

Playwright for the crawl worker. Full rationale in `docs/ARCHITECTURE.md`. Short version:
`storageState` is the authenticated-session handoff the whole gated-site design rests on,
tracing/HAR/screenshot are exactly our three evidence artifacts, and `page.pdf()` means the
report PDF needs no second rendering stack. Puppeteer, Selenium and fetch-based scraping
were each rejected for specific reasons — read them before proposing a swap.

---

## D-007 — Logo assets landed
**2026-08-20 · business owner supplied PNG**

Source is a 1024px PNG lockup: bright purple mark plus white wordmark on a deep violet
rounded tile, with the "i" dot in orange. Derived assets are in `brand/`.

    mintro-lockup-full.png   trimmed lockup, 985x704
    mintro-lockup-160/80/40  height-constrained exports
    mintro-mark-512/180/64   square app icon, glyph on a clean tile
    mintro-glyph.png         mark alone, alpha-masked, transparent background
    favicon-64 / favicon-32

**Known limitation, needs resolving.** The supplied file is raster, and the lockup's own
violet tile sits very close to the app sidebar violet — placed there it reads as a slightly
mismatched rectangle rather than a logo. Two consequences:

- On the **deep violet sidebar**, use `mintro-glyph.png` beside white wordmark text. Do not
  use the tiled lockup.
- On **white** (PDF header, Resend email), the tiled lockup is correct.

Ask the designer for the **SVG source**, ideally with a transparent-background variant and a
white knockout. Everything in `brand/` was extracted from a flattened raster and will not
scale cleanly past its exported sizes. This is a five-minute request to whoever made the
original and it removes a whole class of future asset problems.

---

## D-008 — The rule set is the source of truth for its own field names
**2026-08-20 · architect's ruling**

The tier field is named `tier` in `rules/ruleset.json`. `CLAUDE.md` hard constraint 4
previously called it `auto_tier`. There is no `auto_tier` field and there never was.
`CLAUDE.md` has been corrected.

**Reasoning.** Hard constraint 1 makes `rules/ruleset.json` the single source of truth. That
applies to the shape of the data, not only its contents. When prose and data disagree about
a field name, the data is right by definition and the prose is a bug — fix the prose.

**Follow-on: `categories[].prefix` added.** Rule IDs use a prefix that is not the category
id (`GATE`/`gate`, `DISC`/`disclose`, `CATG`/`catalog`, `FULF`/`fulfil`, `OFFS`/`offsite`,
`PAY`/`payment`, `COMM`/`comms`). That mapping was real but undeclared, which meant
validating it would have required hardcoding the table in the engine. It is now a `prefix`
field on each entry in the `categories` block, and the loader validates prefix-matches-
category from that data. The same rule applies to anything else the engine needs to know
about the rule set: declare it in the data, do not encode it in code.

---

## D-009 — State is determined by tier alone; severity is presentation
**2026-08-20 · business owner**

The four states are produced by exactly two inputs — whether the check observed a violation,
and the rule's `tier`.

    violation + tier auto_fail      -> fail
    violation + tier review_only    -> review
    no violation                    -> pass
    check could not run             -> not_evaluable

`sev` (`critical` / `major` / `minor`) **never affects state.** It drives ordering within the
report and nothing else. A `critical` rule with `tier: review_only` produces `review`, not
`fail`. Severity must never escalate a `review_only` finding to `fail` under any circumstance.

**Reasoning.** Severity says how much a finding matters if it is real. Tier says how confident
the check is that it is real. Collapsing the two lets a high-stakes-but-ambiguous check —
exactly the dosing and abbreviation cases hard constraint 4 exists to protect — auto-fail a
merchant on a guess. Those are the checks where false positives live, and a false `fail` on a
critical rule is the most expensive error the tool can make.

Note the fourth line: a check that could not run is `not_evaluable`, never `pass`. This
restates hard constraint 2 and is not negotiable.

---

## D-010 — Not used

Number reserved and skipped. The catalogue-scope decision below was drafted as D-010 before
the ruling assigned it D-011; the number is left unused rather than renumbering a decision
that may already have been cited.

---

## D-011 — Catalogue rules match product URLs, not every URL
**2026-08-20 · business owner**

CATG-001 through CATG-004 change from `scope: "all"` to `scope: "products"`.

**What prompted it.** The first Layer 0 run against five real storefronts auto-failed two
merchants on CATG-003 (No HCG or HGH, `critical`, `auto_fail`). Of the 27 matching URLs across
those two merchants, **none were product URLs** — every one was an editorial article:

    /ghrp-2-and-cjc-1295-blend-growth-hormone-deficiency-and-fat-metabolism/
    /sermorelin-ipamorelin-blend-potential-analogues-of-growth-hormone/

On biotechpeptides.com this is conclusive rather than inferred: its products sit under
`/product/`, 89 of them were classified as such, and none of the 21 matches was among them.

**Reasoning.** CATG-003 prohibits *selling* HCG/HGH. An article about growth-hormone research
is not an offer to sell. The matched strings are real, but the finding they generate —
"prohibited product", with a blog post as its evidence — is false, and a false finding of that
shape discredits the whole report.

The observation underlying those matches is not worthless; it is filed under the wrong rule.
Editorial content that reads as human-use promotion is a real signal, and the Layer 2 text
checks are where it belongs.

**Alternatives rejected.** Downgrading CATG-003 to `review_only` would suppress a *correct*
critical failure — swisschems.is `/product/hcg-5000-iu/` is HCG offered for sale — in order to
fix a miscategorised one. Teaching the engine to classify editorial content would put
rule-adjacent knowledge into code, which is what hard constraint 1 exists to prevent.

**The general principle.** Where a clause prohibits selling something, the rule's scope is the
selling surface. `scope: "all"` means every URL and should be used only where the clause really
does reach the whole site.

**What the re-scan showed: this removed false passes, not only false failures.**

The change was framed as trading recall for precision. The re-scan showed that framing was
wrong, and the correction matters more than the ruling.

On corepeptides.com the counts went from `1 fail · 3 pass · 3 not_evaluable` to
`0 fail · 0 pass · 7 not_evaluable`. Losing the false failure was expected. Losing all three
passes was not, and those passes were the more serious defect:

> CATG-001, CATG-002 and CATG-004 had reported `pass` — "no needles or syringes", "no alcohol
> wipes", "no tablets or pills" — against a merchant whose **catalogue the crawler had never
> identified**. Not one of its 248 URLs classified as a product. Those rules were asserting the
> absence of prohibited items within a scope that was never established.

That is a false `pass` on a `critical` / `auto_fail` rule: the worst output this system can
produce, and precisely what hard constraint 2 exists to prevent.

**The general lesson.** Both defects — the false failures and the false passes — came from the
same root cause: **evaluating a rule against a scope that was never established.** Matching
`scope: "all"` over an undifferentiated URL list produces confident findings in both
directions, and neither is supported. A rule may only report on a surface the crawl actually
identified. Where the surface was not established, the answer is `not_evaluable`, whichever
direction the evidence appears to point.

**Cost.** On storefronts whose products sit at root-level permalinks — corepeptides.com among
the five scanned — no URL classifies as a product, and the CATG rules now return
`not_evaluable`. That is hard constraint 2 behaving correctly: the catalogue was not observed,
so nothing is claimed about it.

It also makes **Layer 1 shop-structure discovery a priority input for M2**. A rendered homepage
reveals the catalogue structure that a sitemap alone does not, and it is what closes this gap.

---

## D-012 — Evidence is appropriate to the surface, and the artifact is stored, not hashed
**2026-08-20 · business owner**

Hard constraint 3 required a full-page screenshot and DOM snapshot hash on every non-`pass`
finding. Layer 0 has neither — there is no rendered page at that moment — so the constraint as
written would have made every Layer 0 finding `not_evaluable` and the layer pointless. The
constraint is amended rather than worked around.

**Evidence by kind.** Every finding names its evidence kind explicitly, so the report shows what
was actually captured instead of leaving a reader to assume:

| Kind | Findings | Capture required |
|---|---|---|
| `rendered_page` | L1 and above | full-page screenshot, DOM snapshot hash, source URL, matched value, UTC timestamp |
| `document` | L0 | stored artifact body, its SHA-256, source URL, UTC timestamp, matched pattern, matched URLs |

**Never synthesize a visual capture that did not occur.** A finding may not claim a screenshot
it does not have. Where the capture its kind requires could not be made, the finding is
`not_evaluable`.

### The artifact body is stored, not just its hash

This overrules the earlier instruction to keep a digest alone.

**Reasoning.** A hash proves a document did not change; it does not let anyone read what the
document said. In a dispute, "we hold a SHA-256 of a sitemap we no longer have" is a receipt for
evidence, not evidence. Storing the body makes the exact observation reproducible: this is the
document the merchant's server served, this is the URL in it, this is the pattern that matched.

The SHA-256 is kept alongside the body — that is what proves the stored artifact is the one
fetched.

**Requirements.**

- Store robots.txt and **every sitemap fetched in the run**, including followed index children —
  not only the documents that produced a match. A `pass` needs the same backing as a failure.
- A 200 response that turns out not to be a sitemap is stored too. That document is the evidence
  of why a rule was not evaluable.
- Gzip on write. These are text and compress heavily; the storage cost is negligible.
- Append-only, private bucket, keyed per run. A re-scan never overwrites an earlier run's
  capture (D-002, hard constraint 5).
- A `not_evaluable` finding must evidence *why* it could not be evaluated: the requests
  attempted and what each returned. The peptidesciences.com case is the worked example — store
  the robots.txt body served, the fact that it declared no sitemap, and each of the three
  well-known paths tried with its status.

**Where this is implemented.** `packages/engine/src/findings.ts` defines `EvidenceKind` and
`EvidenceArtifact`; `discover.ts` retains and gzips; `packages/engine/test/evidence.test.ts`
asserts each requirement above, including the peptidesciences shape.

---

## D-013 — Crawl-delay is honoured, capped at five seconds
**2026-08-20 · business owner**

The screener honours `Crawl-delay` in robots.txt. This applies to the Playwright worker from
M2 onward, not only to Layer 0 fetches.

**Reasoning.** The merchant applied to the program. We screen at their request, under program
terms. We are not an adversarial crawler and should not behave as one — a tool that ignores a
site's stated crawl preferences while collecting evidence for an underwriting decision is
holding itself to a lower standard than it is measuring the merchant against.

It is also self-protective. Hammering an origin invites IP blocking, and bot detection is
already a known M2 risk — `docs/ARCHITECTURE.md` budgets for switching to a hosted browser
vendor with residential proxies and treats it as likely rather than hypothetical. Getting
blocked mid-screen turns a run into a `not_evaluable` report.

**The cap.** Five seconds. A merchant declaring more than that is clamped to five, and the run
records that we clamped along with the value declared.

    declared <= 5s     honour it
    declared >  5s     wait 5s, record the clamp and the declared value
    not declared       no delay

Never silently ignore a declared delay, and never silently obey an unbounded one. A merchant
declaring `Crawl-delay: 3600` would otherwise stall a run for an hour or, worse, have the delay
quietly dropped — and which of those happened must be visible in the run record either way.

**Retrofitting politeness after being blocked is worse than building it in**, which is why this
lands with the first browser code rather than after the first block.

---

## D-014 — Never locate a subject by its compliant form
**2026-08-20 · business owner · standing principle**

> A check that locates its subject by matching the compliant form is blind to every
> non-compliant instance. Locate the subject structurally — position, role, selector, semantic
> region — then evaluate compliance. Never use the compliant wording as the finder.

Added to `CLAUDE.md` as hard constraint 9.

**Where this came from.** DISC-002 measures whether the footer disclaimer is legible. It located
the disclaimer by matching the *required wording* from DISC-001. Against swisschems.is it found
nothing and reported `not_evaluable` — while the merchant's footer carried:

> FDA Disclaimer: All products are for laboratory developmental research USE ONLY. Not for
> human consumption.

rendered at a contrast ratio of **2.94:1**, well under the rule's 4.5:1 threshold. The rule was
blind in exactly the case it exists to catch: a merchant whose disclaimer is worded slightly
differently and rendered illegibly. Locating by resemblance rather than by required wording
turned that into a correct `fail`.

**Why it generalises.** The bug is not about disclaimers. Any check that says "find the thing
that looks compliant, then check whether it is compliant" has already excluded the answer. The
finder must be independent of the property being tested.

**Both failure directions are real**, and which one you get depends on `expect`:

| `expect` | Failing to locate reads as | Result |
|---|---|---|
| `absent` | the thing is not there | false `pass` — nobody looks again |
| `present` | the thing is missing | false `fail`, or a review queue full of compliant merchants |

**When the subject cannot be located structurally**, say so. `not_evaluable` is the honest
output of a search known to be partial; a verdict is not.

---

## D-015 — A rule declares its own subject
**2026-08-20 · business owner**

`computed_style` params gain a required `target_phrases_from`, naming the rule whose wording
identifies the element being measured. DISC-002 now carries `"target_phrases_from": "DISC-001"`.

**Reasoning.** DISC-002 carried thresholds — font size, contrast, visibility — but nothing saying
*what* to measure. Its subject is the footer disclaimer, which a different rule defines. The
engine was inferring the link. A `critical` / `auto_fail` rule inferring its own subject is a
coupling that lives in code where it cannot be reviewed, and hard constraint 1 says that
knowledge belongs in the data.

**A dangling reference fails loudly.** The loader validates that the referenced rule exists and
that a rule does not reference itself. Both are load errors naming the rule, because the
alternative is a critical check silently measuring nothing — the false-pass class again, arriving
through a typo in a rule id. Fixtures: `dangling-target-rule`, `self-referencing-target`,
`computed-style-no-target`.

**The phrases locate by resemblance, never by requiring the compliant form** — hard constraint 9
and D-014.

---

## D-016 — A GATE-001 pass means an age gate exists
**2026-08-20 · business owner**

GATE-001 requires its signal to appear inside an entry interstitial. The rule now resolves:

    gate found, signal inside it     -> pass    an age gate exists
    signal on the page, no gate      -> review  the words appear; nothing blocks entry
    interstitial with no age signal  -> review  something blocks entry, but not an age gate
    no signal anywhere               -> review  no age affirmation observed

**This changes what a GATE-001 pass asserts.** It previously meant "the string `21+` occurs
somewhere in the markup". It now means "an interstitial was observed and it carries age
affirmation language". A merchant whose homepage says "Trusted for 21+ years of peptide
research" no longer passes.

**Reasoning.** The old behaviour is the same false-pass class as reporting a clean catalogue
without having identified the catalogue (D-011): a verdict resting on a surface that was never
established. The rule is `review_only`, so nothing auto-fails either way — but a `pass` is a
positive assertion that an analyst will rely on, and it has to be true.

**The gate is located structurally** — `dialog`, `role=dialog`, age-gate class or id, or a
viewport-covering overlay — then the signal is matched inside it. That ordering is hard
constraint 9: a gate reading "Please confirm your age" is still *found*, and is then judged on
the rule's declared signal vocabulary.

**Known narrowness, in the data not the engine.** GATE-001's `signals` are
`["age-gate", "age-verify", "21+", "are you 21"]`. A gate reading "Please confirm you are 21 or
older" is located but not recognised, and returns `review`. Broadening that vocabulary is a
change to `ruleset.json`; it is flagged rather than made.

---

## D-017 — Polite mitigations before hosted browsers
**2026-08-20 · business owner**

peptidesciences.com returned **HTTP 403** to the Layer 1 render. We do not switch to a hosted
browser vendor over it.

**Reasoning.** One merchant in five is not a pattern, and it is the same operator that declared
no sitemap — a site configured to be difficult to read is one data point about that site, not
evidence that our approach is wrong.

**Mitigations applied first**, all of them polite rather than evasive:

- a realistic browser user-agent, with the screener still named in it and a contact URL
- standard desktop viewport, locale and timezone
- `accept-language` and the other headers a real browser sends
- `Crawl-delay` honoured before the first request, not after it (D-013)

This is not stealth. The identity remains declared and a merchant inspecting their logs can see
who we are and reach us. We are not trying to defeat bot detection; we are trying not to look
like something worth blocking.

**If it still blocks, that is a finding.** `not_evaluable`, with the 403 screenshot and DOM
already captured as the evidence of why — which the worker does today.

**Escalation trigger.** Move to a hosted browser vendor (Browserbase, Steel — see
`docs/ARCHITECTURE.md`) when **a second or third merchant blocks** after these mitigations. One
is a site; three is our approach.
