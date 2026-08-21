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

## D-010 — Closed param schemas, and the case that proved them
**2026-08-20 · reserved · 2026-08-21 · empirical record added**

The number was reserved and skipped: the catalogue-scope decision below was drafted as D-010
before the ruling assigned it D-011. It is used now to record something the closed-schema
decision earned.

**The argument, made abstractly at M0.** `params` schemas are closed — an unrecognised key is a
load error. The case for it was that a misspelt param would otherwise load fine, match nothing,
and report `pass`. That was reasoning about a hypothetical.

**The case, observed at M2.** A schema check caught two rules that its own author's audit had
missed.

The D-014 audit reviewed every handler for rules that locate their subject by its compliant
form. It named DISC-003 as dangerous. It did not notice that DISC-003 had **no matcher at all** —
no `signals`, no `selector`, nothing — so the rule matched nothing and, being `expect: present`
and `auto_fail`, failed every merchant scanned.

The fix added a schema rule: a `dom_assert` declaring `expect` must also declare something to
recognise its subject by. That check immediately reported **two further rules** — GATE-005 and
PAY-002 — that the same audit had passed over. Both turned out to be legitimate (they recognise
their subjects via `prefer_types` and `detect`, which the first draft of the check omitted), so
the schema was corrected rather than the rules. But the schema found them, and a careful manual
review of the same file had not.

**What this establishes.** A schema check is not a stricter version of reading the rules
carefully. It is a different instrument, and it catches a class of defect that attention does
not — including in the work of the person who wrote the audit. Every argument for loosening a
param schema should be weighed against that.

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

---

## D-018 — A clean `expect: absent` result is worded to the surface examined
**2026-08-21 · business owner**

A `pass` on any `expect: absent` rule must state what was actually searched. It may never be
worded as a universal claim about the merchant.

    not this:  "No testimonials were observed."
    this:      "No elements matching '[class*=review], [class*=testimonial]' were observed.
                Content of this kind presented in other markup was not examined."

**Reasoning.** OFFS-002 looks for testimonials by review-widget markup. A merchant whose
testimonials sit in `class="customer-stories"` is invisible to it, and the honest report of that
search is not "there are none" — it is "none of this kind of markup was found". Stating what was
searched and what was not is more informative than declining to report, which is why this is a
wording discipline rather than a blanket `not_evaluable`.

It is the same failure as D-011 and D-016 expressed in copy rather than in logic: a claim
reaching further than the surface that was established. The triage axis in
`docs/ARCHITECTURE.md` is where this belongs in a reviewer's head.

**Applies to every `expect: absent` rule.** Audited at M3:

| Handler | Rules | Wording |
|---|---|---|
| `url_pattern` | NAME-001/002, CATG-001–004, OFFS-001 | already scoped — names the URL count and the scope examined |
| `dom_assert` selector | OFFS-002 | scoped — names the selector and says other markup was not examined |
| `dom_assert` signals/links | PROD-009 | already scoped — names the page and the terms searched |
| `text_cooccurrence` | PROD-005, COMM-001 | **widened at M3** — now names the surface and the window |
| `text_match` terms | PROD-006/007/008/010, PAY-001 | **widened at M3** — was "4 terms were checked; none was observed", which named neither the surface nor the limits of the search |

**This is a reporting rule, not a state rule.** The state is still `pass` — the check ran and
observed nothing prohibited. What changes is that the report says how far the observation
reaches, so a reader is never left to assume it reached further than it did.

---

## D-019 — GATE-001 recognises more ways of asking someone's age
**2026-08-21 · business owner**

GATE-001's `signals` gain `"21 or older"`, `"over 21"`, `"over the age of 21"`, `"of legal age"`
and `"21 years"`.

**This widens the vocabulary only.** D-016's structural requirement is untouched: the gate is
still located as an interstitial — a dialog, a modal, a viewport-covering overlay — and the
signal is matched *inside* it. A merchant whose homepage says "serving researchers over 21 years"
in body copy still does not pass, because there is no interstitial to find it in.

**Reasoning.** The narrowness was never in the handler. A gate reading "Please confirm you are 21
or older" was located correctly and then judged against a four-phrase vocabulary that did not
include the way most sites actually word it. That is rule data, so the fix is in
`ruleset.json` — which is why it was flagged at M2 rather than patched in the engine.

---

## D-020 — OFFS-006, editorial content on therapeutic topics
**2026-08-21 · business owner**

A new rule. Layer 0, `url_pattern`, `major`, **`review_only`**, scope `content`.

> Off-site human-use claims will be used against the seller even if the website has proper
> disclaimers. Every social media post must follow the same rules as product pages.

**What it recovers.** D-011 narrowed the CATG rules to product URLs because CATG-003 was
auto-failing merchants on 27 editorial articles about growth-hormone research. That decision was
right — an article is not an offer to sell, and the finding it produced was false. But the
underlying observation was real and was left unfiled: a peptide storefront publishing
"GHRP-2 and CJC-1295 blend: growth hormone deficiency and fat metabolism" is doing something a
reviewer should see. D-011 declined to file it under catalog composition. This files it under
off-site presence, where it belongs.

**`review_only` is permanent.** Not a starting position pending confidence.

> A slug indicates **topic**, not **claim**. Only a human reading the article can tell rigorous
> chemistry from a dosing guide.

This rule surfaces candidates. It never renders a verdict, and no amount of tuning would make a
URL slug capable of distinguishing the two. Anyone proposing to promote it to `auto_fail` is
proposing that the engine judge prose it has not read.

**Finding wording** follows D-018: *"N of M content URLs have slugs indicating therapeutic-topic
subject matter … The content of these pages was not examined."* Never "prohibited claims found".

### The scope vocabulary change this required

`scope: "pages"` matched **zero URLs** on all five storefronts scanned — it recognises only a
`/pages/` or `/page/` path segment, and none of them use one. A `pages`-scoped OFFS-006 would
have been `not_evaluable` everywhere, missing precisely the case it was written for.

So `content` was added to `URL_SCOPES`, defined **negatively**: a URL that is not a product, not
a collection, and not site machinery (cart, checkout, account, feed, `wp-json`, tag and author
archives, policy pages). Editorial content has no path segment in common across platforms —
Shopify puts it under `/pages/` and `/blogs/`, WordPress storefronts serve it from the root
beside everything else — so a segment-matching scope cannot reach it.

**The consequence to hold in mind:** `content` is only as accurate as product classification.
Where the catalogue was not identified, `content` approaches "every URL", and the rule's finding
says how many URLs it examined so the reach is visible.

`OFFS-001` (affiliate program, scope `pages`) has the same problem and returns `not_evaluable` on
every storefront scanned. It is **not** changed here — that is a separate ruling.

---

## D-021 — CATG-004 covers tablets and pills, not capsules
**2026-08-20 · architect's reading · 2026-08-21 · confirmed by the business owner**

CATG-004's clause reads "Tablets or pills prohibited. Capsules may be sold if exclusively for
research use and properly labeled." `auto_fail` stands. CATG-006 continues to handle capsule
labelling.

**Recorded late, and that is the point of recording it.** The rule as shipped carried a clause
quoting the source document's capsule sentence while its patterns targeted `tablet`, `pill`,
`softgel` and `lozenge` — plus a note reading "OPEN QUESTION: source document describes capsules
in two places with differing wording. Confirm before enforcing." The clause was rewritten on the
architect's reading at M0, on 2026-08-20, and the change went into `ruleset.json` and the M0
report but **never into this file**. It has now been confirmed by the business owner.

There is no CATG-004 note in D-009 to amend; D-009 is the tier-and-severity ruling and never
mentioned it. The gap was that this decision had no number at all.

**Reasoning.** Capsules are not tablets for this program. A rule whose clause and patterns
described different things was a documentation defect, not a business contradiction — the
patterns were always right.

---

## D-022 — Not used

Number skipped when D-023 through D-025 were assigned. Left unused rather than renumbering
decisions that may already have been cited.

---

## D-023 — The `content` scope, and what a negative definition obliges
**2026-08-21 · business owner · code change approved**

`content` joins `URL_SCOPES`: a URL that is not a product, not a collection, and not site
machinery (cart, checkout, account, feed, `wp-json`, tag and author archives, policy pages).

**Why it has to be defined negatively.** Editorial content shares no path segment across
platforms. Shopify puts it under `/pages/` and `/blogs/`; WordPress storefronts serve it from the
root beside everything else. Nothing segment-based can reach both, and the evidence was
unambiguous — `scope: "pages"` matched **zero URLs on all five storefronts scanned**. A negative
definition is not a shortcut here; it is the only workable one.

### The dependency, stated because it does not go away

**`content` is only as accurate as product classification.** Where the catalogue was not
identified, `content` approaches "every URL". On corepeptides.com it is 141 URLs *after* Layer 1
identifies 104 products; at Layer 0 alone it would have been all 248.

This is the same family as D-011 — a scope resting on a surface that may not have been
established — and it does not have a clean fix, because the whole point is to catch what
classification missed.

**The mitigation is required, not optional.** Any rule scoped to a negatively-defined scope
**must state the count it examined** in its finding:

    "32 of 192 content URLs have slugs indicating therapeutic-topic subject matter …"

A reader can then see the denominator and judge how much of the site the scope actually
resolved. A finding that named matches without naming the population would let a scope covering
everything read exactly like a scope covering the right thing. This rule applies to every scope
defined by exclusion, present and future — see `docs/ARCHITECTURE.md`.

---

## D-024 — OFFS-001 moves to scope `content`
**2026-08-21 · business owner**

OFFS-001 (No affiliate program) changes from `scope: "pages"` to `scope: "content"`.

**Reasoning.** Identical defect to the one D-020 uncovered, in a rule that matters more: OFFS-001
is `critical` and `auto_fail`, and it returned `not_evaluable` on **every one of the five
storefronts scanned** because `scope: "pages"` matched nothing anywhere. A critical rule that
cannot see any surface is not a strict rule; it is an absent one.

swisschems.is carries a visible "Affiliate Program" link in its footer navigation that the rule,
as scoped, could not see. Same defect, same fix.

---

## D-025 — A ruleset.json change carries a decision number in the same commit
**2026-08-21 · business owner · process**

Any change to `rules/ruleset.json` — a clause, a pattern, a tier, a scope, a new rule — is
recorded in this file, with a number, in the commit that makes the change.

**What prompted it.** CATG-004's clause was rewritten at M0 on a ruling. The change reached
`ruleset.json` and the milestone report and never reached this file. It sat undocumented through
M1, M2 and M3, and surfaced only when a later ruling referred to a note in D-009 that did not
exist. Recorded eventually as D-021, five days and four milestones late.

**Why it matters.** A ruling that reaches the data but not this log is unreviewable six months
out. The rule set is the single source of truth for what is checked; this file is the single
source of truth for *why*. A merchant disputing a finding is disputing a judgement, and a
judgement with no recorded reasoning cannot be defended — which is the failure this log exists
to prevent.

Recorded in `CLAUDE.md` § Conventions.

---

## D-026 — Authenticated crawling: session handling and its safety properties
**2026-08-21 · architect's rulings, built against a local testbed only**

M4 builds scripted login for Shopify and WooCommerce. Four rulings were made in the building and
each exists because the alternative fails silently.

### A session is valid only on positive evidence

**This is the most consequential defect found in the project so far**, and the ruling it produced
is larger than the bug.

Session revalidation asks *"is the signed-in marker present?"*, never *"is a login form absent?"*.
The first draft asked the second question and returned "valid" for a **404** — no signed-in
marker and no password field, and the absence of both was read as the presence of a session.

A run proceeding logged-out while reporting as authenticated **inverts the meaning of every
GATE-002 and GATE-003 finding it produces** — the rules whose entire question is what a session
changes. Nothing in the report would look wrong.

**The generalisation, recorded in `docs/ARCHITECTURE.md`:**

> Constraint 9 applies to any component that establishes a precondition for findings, not only to
> check handlers. Preconditions must be established by positive evidence of the state they
> assert, never by absence of its contradiction.

A precondition is anything a finding silently depends on: that a session is live, that a page
rendered, that a footer was located, that the catalogue was identified. None appears in the
finding's text, which is precisely why getting one wrong is invisible.

### A redirect away is not the path being served — the same family

`http_probe` treats a request that ended somewhere other than the path asked for as *not served*,
whatever status the destination returned.

A merchant who gates their catalogue answers an anonymous `/collections/all` with a redirect to
the login form. The browser follows it and the login page returns **200**. Before this,
compliant gating and no gating at all were indistinguishable, and the testbed — which gates
correctly — was auto-failed for doing the right thing. The redirect is now reported, because
"redirected to /account/login" is the observation that the gate works.

### GATE-002 and GATE-003 are pairs, and only the pinned half is the finding

Both rules carry `unauthenticated: true`, so the unauthenticated probe is the finding. The
authenticated run is the **contrast** that gives it meaning: it establishes the catalogue exists
and is reachable with an account, which is what separates "gated" from "broken or empty". The
contrast is never reported as a second finding under the same rule id.

### Nothing that reaches a report can carry a credential

`SessionDescriptor` — the type that travels into findings, reports, PDFs and emails — has fields
for a mode, an origin, a **vault reference**, a timestamp and a platform. It has nowhere to put a
password. The guarantee is structural rather than remembered, and a test asserts the field list
so that adding one has to confront this.

Storage follows hard constraint 6: AES-256-GCM at rest with a fresh IV per write, keyed from
`VAULT_TOKEN` supplied by the runtime environment and never a file in the repo; every access
logged with its purpose and outcome; the log asserted never to contain a credential. A Playwright
`storageState` is a bearer token for the merchant's account and is encrypted identically to the
password that produced it.

### What is not built

**Assisted sign-in is designed, not implemented** (`apps/worker/src/auth/assisted.ts`). It is the
fallback for Magento, BigCommerce, bespoke platforms and heavily customised themes. The design is
recorded there in full; three decisions block building it, and the blocking one is whether Mintro
is authorised to hold merchant sessions established by a person rather than by stored
credentials.

**No account exists on any real merchant site.** Everything here was built and proven against
`apps/testbed`, a local storefront serving Shopify-style and WooCommerce-style login forms and a
gated catalogue. The credential-authorization question is unsettled and nothing in M4 depends on
settling it.

---

## D-027 — OFFS-007, affiliate program by link text
**2026-08-21 · business owner**

A new rule. Layer 1, `dom_assert`, **`critical`**, **`review_only`**, surface `homepage`,
`link_text_contains: ["affiliate", "ambassador", "referral program", "partner program"]`,
`expect: absent`.

**Why OFFS-001 cannot cover this.** D-024 rescoped OFFS-001 to `content` and it immediately
caught sportstechnologylabs.com on `/affiliate-area/`, `/affiliate-login/` and
`/affiliate-registration/`. It did not catch swisschems.is, and could not have:

> swisschems.is links **"Affiliate Program"** and **"Affiliate Login"** from its footer. Both
> point at `/` and `/login`. No affiliate page appears in its sitemap.

The programme is visible to a person reading the page and invisible to every `url_pattern` rule,
because the signal is in the link text and not in any URL. The two rules are complements: one
matches where the URL says it, one matches where the label does.

**`critical` but `review_only`, and the split is the point.** The severity matches OFFS-001 —
an affiliate programme is the same finding whichever way it is discovered. The tier does not,
because the *evidence* is weaker:

- A dedicated `/affiliate-registration/` URL is a programme. Little else produces that path.
- A nav label reading "Affiliate Program" may be a programme, a page explaining there is no
  programme, or a link to somebody else's. Only a person opening it can tell.

Auto-failing on a label would be judging a destination that was never visited — the same defect
as D-011 and D-020 in a new place. This rule surfaces the candidate; a human resolves it.

**Finding wording** follows D-018: it names how many links were examined, quotes the matching
text with its destination, and states that *"the visible text of these links was examined; their
destinations were not followed."*

### Do not harmonise `critical` with `review_only`

`sev` and `tier` answer different questions and are **orthogonal by D-009**:

    sev   how bad the violation is, if it is real
    tier  how confident the detection is that it is real

An affiliate programme is `critical` either way — the severity is a property of the violation,
not of how it was spotted. But a nav label pointing at `/` is weaker evidence than a dedicated
URL: it could be a stale link, a theme default, or a dead page.

**That this pairing appears nowhere else in the rule set reflects the rule set, not a schema
error.** It is the first rule whose detection method is materially weaker than its subject is
serious, and it will not be the last.

**Do not promote OFFS-007 to `auto_fail`.** That would auto-fail a merchant on link text whose
destination was never followed — a verdict on a page nobody opened. OFFS-001 is the `auto_fail`
half of this pair and it earns that by matching a URL that is hard to produce accidentally.

---

## D-028 — PDF and send
**2026-08-21 · architect's rulings, built against a dry-run mailer**

### The PDF is the report route, printed

`page.pdf()` against the same React component the analyst sees, rendered in print mode. No second
template, no PDF library. `docs/ARCHITECTURE.md` rules this out for one reason: two templates
would eventually say different things about the same run, and the PDF is the artifact that
travels.

**The export collapses nothing.** Every finding is expanded, every evidence slip visible. A PDF
that hid a finding behind a closed disclosure would be a different document from the one on
screen while claiming to be the same. Note that finding *grouping* was never built — the
question was raised at M3 and left open, so there is nothing to collapse; if grouping is added
later it is presentation only and must not reach the export.

**The print stylesheet removes chrome, never content**: the rail, the action buttons, the filter
chips. Nothing that carries an observation is hidden.

### The PDF waits for its captures

`page.pdf()` fires only after the page sets `data-print-ready`, which it does once every image
has settled. Printing on navigation would capture screenshots as empty frames — a PDF quietly
missing the captures D-012 requires it to show. The page also reports how many resolved
(`data-print-images`), so the worker checks rather than assumes; the swisschems run reports
**66/66**.

This is the same failure family as D-026: a precondition that, when unmet, produces a document
indistinguishable from a correct one.

### On white, the lockup; on violet, the glyph

The PDF header uses `mintro-lockup-full.png`. D-007 reserves the glyph for the deep violet rail,
where the lockup's own violet tile reads as a mismatched rectangle. This is the other context
that ruling names.

### Sending is never blocked, so the log carries the weight

No confirmation interstitial, no supervisor override, and no code path that inspects the fail
count before sending (D-001). A test sends reports with 0 and 16 failures and asserts identical
behaviour.

Because sending is never blocked, **the `sends` log is the only record of what went out and
when**. It therefore records **rejections as well as acceptances** — "we tried to send and the
provider refused" is precisely the fact a dispute turns on, and a log of successes only answers
the easy half of the question. Fields per the data model: run id, recipient, Resend message id,
timestamp, who triggered it, plus the outcome and the attachment size.

### The dry-run mailer is a different implementation, not a flag

Until the sending domain is verified, `createDryRunMailer` composes the message and transmits
nothing. It is a separate implementation rather than a boolean on the real one so that a test
send cannot be mistaken for a delivered report — its `description` says what it is and that
string goes into the run record.

### The copy audit covers the email, not just the findings

`apps/worker/test/copy.test.ts` audits every generated string across all five real runs —
verdicts, finding notes, not-evaluable reasons, the subject line and the covering email — for
directive language.

The email is the surface most at risk. A covering note is the most natural place to write
"please review" and the least likely place anyone inspects for a compliance problem.

**Rule clauses are the deliberate exception.** A clause quotes the program document — "Guest
checkout must be disabled" — and is source material, not Mintro's characterisation. Rewriting
them to avoid imperatives would misquote the rules the merchant is being screened against. A test
asserts every rendered clause is byte-identical to the rule set.

**The analyst's note is passed through unaudited.** That is recorded rather than fixed: whether
an analyst may write a directive in the covering note is a business question, not a code one.
