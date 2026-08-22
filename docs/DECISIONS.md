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

### The canonical example: the guard defeated by the shape it guards against

At M5 a print-ready signal was written **specifically** to stop `page.pdf()` firing before
screenshots load, because a PDF printed too early captures them as empty frames — evidence loss
that looks like a rendering quirk. It worked: 66/66.

At M7 the report began rendering synchronously, and that same signal started reporting **`1/1`** —
the brand lockup — while 66 screenshots were still arriving. It checked once, found the images it
could see, and declared ready. **Asked before it could tell, and answered anyway.**

This is the one to remember, because it is not a subtle instance:

> The check written specifically to prevent capturing empty frames was itself defeated by the
> same shape it existed to guard against.

Knowing the principle, having just applied it, and having written the guard were all insufficient.
The defect returned through a change to *when* the code ran, not to what it did.

**This is a permanent discipline, not a bug fixed once.** Every guard is itself a component that
can be asked before it can tell. The operational test applies to guards as much as to checks: ask
what it returns when it cannot tell, and if that is the same as when the thing holds, it is
wrong.

### A redirect away is not the path being served — the same family

`http_probe` treats a request that ended somewhere other than the path asked for as *not served*,
whatever status the destination returned.

A merchant who gates their catalogue answers an anonymous `/collections/all` with a redirect to
the login form. The browser follows it and the login page returns **200**. Before this,
compliant gating and no gating at all were indistinguishable, and the testbed — which gates
correctly — was auto-failed for doing the right thing. The redirect is now reported, because
"redirected to /account/login" is the observation that the gate works.

### The same family in the frontend, found much later (D-045)

Every instance above is backend — a crawler, a probe, a storage guard — and that is presumably
why nobody looked at the browser for two milestones.

The report selector resynced its value only while that value was `''`. So it returned the same
answer when it held a run the analyst had deliberately chosen as when it held a default captured
before the list changed and now naming a superseded run. **It could not tell "this selection is
current" from "I cannot tell whether it is current", and answered anyway.** A completed scan left
it pointing at the previous run of the same merchant, and Open report opened that one.

The operational test finds it in one question, and the question is not backend-specific: *what
does this return when it cannot tell?* Component state is as capable of answering when it cannot
tell as a session check is. `chosen` and `current` are now separate inputs so the two cases are
distinguishable, in a pure function with tests.

One thing this instance adds that the others do not. The backend cases were invisible because a
precondition never appears in a finding's text. This one was invisible because **two different
runs rendered as the same string** — same merchant, same counts, date truncated to the day. The
state was wrong *and* the presentation could not show it, and only the second is what made
careful looking useless. When a control names a record, ask whether its label can distinguish two
records the user might plausibly hold.

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

---

## D-029 — The analyst's covering note is audited, warned on, and never blocked
**2026-08-21 · business owner**

The analyst's covering note is checked for directive language as it is composed. The analyst is
shown what tripped it and may send anyway. Both the flagged terms and their decision are recorded
in the `sends` row.

**Why this surface and not another.** It is the highest-risk copy remaining in the product. Every
other string is generated by us and audited in tests; this one is written by a person, and it
sits in the most-read part of the email. An analyst writing *"recommend declining"* puts a Mintro
determination in front of IQwallet and undoes the posture every other surface maintains — the
verdict banner, the finding notes, the covering email body, all of which were rewritten to
describe rather than instruct.

**Warn, do not block.** D-001 says send is never blocked, and that applies here without
exception: a screener that refused to transmit a report because of its covering note would be
making the determination it exists to avoid making. The Send button stays enabled. Its label
changes to *"Send as written"* when the note is flagged, which is a prompt rather than a barrier.

**The record is what the warning buys.** The `sends` row carries the note verbatim, the terms
flagged, and whether a human saw the warning and proceeded:

    note                     "Recommend declining this merchant."
    noteFlagged              ["recommend"]
    noteWarningAcknowledged  true

Nothing is prevented; something is now visible. A pattern of flagged notes sent anyway is a fact
somebody can act on, and it could not be seen before.

**Audited at send time, not only at compose time.** The modal is one caller. A scripted send or a
future API is another, and the record has to be honest either way — a note that never passed
through the warning still shows its flagged terms, with `noteWarningAcknowledged: false` because
nobody saw one.

**One list, three consumers.** The vocabulary lives in `packages/engine/src/copy.ts` and is used
by the compose-time warning in the browser, the send-time record in the worker, and the copy
audit in the tests. Adopting it immediately made the audit stricter than the private copy the
test had been carrying, which is the argument for sharing it in one line.

Bare `must` is deliberately excluded: rule clauses quote the program document and legitimately
say what a merchant must do. That exception is upheld by a test asserting every rendered clause
is byte-identical to the rule set.

---

## D-030 — Persistence and auth, and why they shipped together
**2026-08-21 · business owner**

Migrations for the documented data model, RLS on every table in the same migration that creates
it, and invite-only analyst auth. Auth is in scope now because **RLS policies are far harder to
add to populated tables than to empty ones** — and getting it wrong on a populated table means a
window in which merchant evidence was readable.

### RLS decides reads; triggers decide changes

`service_role` carries `BYPASSRLS`. The worker's key ignores every policy in
`supabase/migrations/`, which means row-level security cannot enforce append-only against the
process that writes the evidence.

So hard constraint 5 and D-002 are enforced by **triggers and primary keys**, which are not
bypassed:

| Guarantee | Mechanism |
|---|---|
| Evidence never overwritten | `evidence.key` primary key + `upsert: false` on the storage write |
| Evidence, findings, sends never change | `before update or delete` triggers that raise |
| A finished run is frozen | trigger rejecting any update once `finished_at` is set |

The run trigger is deliberately precise rather than blanket: a run is mutable while in progress —
it has to be, to be finished — and immutable from the moment it completes. That is exactly what
D-002 says.

### `analysts` — a correction to the specification, not a deviation from it

**The instruction specified invite-only via Supabase's dashboard signup toggle. That was
corrected in the build, and the correction was accepted.** Recorded here as a correction rather
than a deviation, because the distinction matters for anyone reading this later.

A dashboard toggle is a **setting**, not a **control**:

| | Dashboard toggle | `is_analyst()` |
|---|---|---|
| Version-controlled | no | yes — a migration |
| Reviewable | no | yes — in a diff |
| Testable | no | yes |
| If bypassed | one click, fails **open** | requires a migration |

The failure mode is what decides it. If the signup toggle is ever flipped — deliberately, or by
someone debugging something unrelated — policies gating on `auth.role() = 'authenticated'` would
let anyone who signed up read every merchant's evidence, silently and immediately. Gating on
`public.is_analyst()` means bypassing access control is a migration rather than a click.

`docs/ARCHITECTURE.md` documents a *minimum* data model, so adding a table to it is within what
that document anticipates.

Every policy gates on `public.is_analyst()`, which requires an active row in `analysts`.
Membership is granted by insert, not by signing up, and revoked by setting `active = false` —
which keeps the account so the `sends` records naming that analyst stay intact.

### No passwords anywhere

Sign-in is a magic link (`signInWithOtp`, `shouldCreateUser: false`). There is no password to
store, reset, phish or leak, and no signup form for anyone to find. An uninvited address receives
no email at all.

### The PDF path had to change, and the change is not a second stack

The report route is now behind auth, which broke the M5 PDF pipeline.

Putting an analyst session into a headless browser to print a document was the wrong shape — a
long-lived credential in a process that exists to render one file. Instead the worker, which
already holds the assembled report and can mint signed URLs with the service key, **hands both to
the page**.

This is the same `ReportView` fed from an object rather than a fetch. What `ARCHITECTURE.md` rules
out is a second *template*, because two templates drift; one component with two data sources
cannot say two different things.

### The readiness check was wrong in the code written to prevent it

Injecting the report made it render synchronously, and the print-ready signal — which existed
precisely to stop `page.pdf()` firing before captures load — began reporting **`1/1`**: the brand
lockup, while 66 screenshots were still arriving.

That is D-026 again, inside its own countermeasure: a check that reports ready when it cannot yet
tell. Fixed the same way — require positive evidence of the state being asserted. The signal now
waits for the image count to stop changing *and* every image to settle. Back to **66/66**.

### The service key never reaches the browser

The frontend gets the project URL and the anon key. The anon key is not a secret; it is an
identifier that RLS constrains. `createWorkerSupabase` throws if `VITE_SUPABASE_SERVICE_KEY` is
set at all, and `apps/worker/test/migrations.test.ts` fails if any `VITE_` variable in
`.env.example` looks like a secret — because that mistake looks entirely ordinary in a diff and
publishes a credential.

### Migration of the existing runs

`npm run migrate-supabase` is a **dry run by default**. It writes to a store that refuses to be
overwritten, so getting it wrong is not recoverable by re-running with different arguments.
Digests are recomputed from the bytes on disk rather than copied from the report: if a local file
has been altered since the run, the migrated record should describe the file that actually exists.

---

## D-031 — "Already done" must mean complete, not present
**2026-08-21 · business owner**

The first migration into Supabase failed partway: the bucket did not yet exist, every artifact
upload failed, and five runs were left with a row, no findings, no evidence and no report.

Every retry then reported **"already migrated"** and skipped them — permanently. Runs are never
deleted (D-002), so there was no way back.

### Two defects, and the second is the one that matters

**1. The migration was not atomic.** Storage writes and Postgres writes cannot share a
transaction, so a partial write was always possible. What was missing was not atomicity — it is
not available — but a survivable failure:

- A failure now marks the run `failed` rather than leaving it in `running` indefinitely. A run
  abandoned mid-write looked exactly like one still in progress, which is how five of them sat
  unnoticed.
- `finished_at` stays null on failure, so the immutability trigger still permits writes and the
  run can be **resumed**. Freezing a broken run would make it unrepairable, and since it can never
  be deleted, resume is the only way out.
- Every write is idempotent: artifacts collide on their key, evidence rows on their primary key,
  findings on a new `(run_id, ordinal)` index (migration 0009). Re-running fills gaps and changes
  nothing already there.

**2. The idempotency check tested existence rather than completeness.** This is the D-026 shape
again, this time in a migration:

> It returned "already done" when it could not distinguish done from half-done.

A guard that cannot tell must not answer. The check now asks whether the run is *complete* —
status, `finished_at`, a stored report, the expected number of findings, and a row for every
evidence key the report cites.

### The two scripts disagreed, and neither was right

`migrate-to-supabase` reported **5/5 present**. `verify-supabase` reported **0 complete runs**.
Same database. Each had implemented its own idea of "present": one asked whether a row existed,
the other whether `status = 'complete'`.

The definition now lives in `apps/worker/src/store/completeness.ts` and both read it — the same
reasoning as the shared directive-term list in D-029. Two implementations of one concept will
diverge, and the moment they do, one of them is lying.

The definition is **intrinsic**: it evaluates from the database alone, with no reference to local
files, so it answers identically for a run migrated today and one migrated months ago.

### Reporting success on the absence of an exception

The migration counted a run as successful because `persistRun` had not thrown. It now
re-assesses after writing and counts the run only if it is complete. Not throwing is not the same
as having worked, and the gap between those two is exactly where this failure lived.

### Recovery

`--repair` resumes runs left in this state. It is deliberately **not** the default: resuming
writes into a partially written run, and that should be an explicit instruction rather than
something a routine re-run does by itself. Without it, an incomplete run is reported and skipped
with its problems named.

---

## D-032 — Test DML against a real schema, not only the DDL as text
**2026-08-21 · business owner**

Three defects reached the project through a green 438-test suite:

| Defect | Layer |
|---|---|
| `0008`'s bucket guard passed, uploads still failed with "Bucket not found" | storage API |
| The idempotency check tested existence, not completeness (D-031) | query-result logic |
| `ON CONFLICT (run_id, ordinal)` could not infer a partial index | DML against the schema |

`apps/worker/test/migrations.test.ts` reads the migrations **as text** and asserts the DDL is
well-formed. Nothing executed any of it. The suite asserted the shape of the schema and nothing
about working with it.

### Three tiers, because no one tier catches all three

**Tier 1 — PGlite, in `npm run check`.** Postgres compiled to WASM, in process, no Docker. It
applies the *actual migration files*, so a migration that would fail against Postgres fails here.
Catches `ON CONFLICT` inference, trigger firing, constraints, uniqueness scoping, resumed writes.

Two of its tests exist to prove the tier has teeth: they demonstrate that a partial unique index
**cannot** be inferred without its predicate, and that nulls are distinct in a unique index. Both
reproduce the defect's own shape. *A suite that only passes against the fixed schema shows the fix
works; these show the harness would have caught it.*

**Tier 2 — the Supabase local stack. Needs Docker, which the development machine does not have.**
The only tier that exercises `supabase-js → PostgREST → SQL`, which is where this bug was
*generated*, and the only one that can test RLS as `anon` or storage `upsert: false`. Written and
gated on `SUPABASE_TEST_URL`, pointed at test-specific variables so it can never run against the
production project by accident. **Stated as unrunnable here rather than quietly skipped** — a tier
nobody can run is not coverage.

**Tier 3 — preflight.** `0008` asserted the bucket at *migration* time; the failure happened at
*upload* time and nothing re-checked in between. A guard that runs once, long before the thing it
guards, is not guarding it. The migration now probes immediately before its first write, and
refuses to start if the bucket is unreachable or the index is not inferable.

### The index: total, not partial

`0009` made the index partial "so rows predating this column do not block it". There were none,
and it cost two things:

1. **PostgREST cannot target it.** Its `on_conflict` parameter accepts column names and has no
   syntax for a predicate. A partial unique index is *unreachable* through the client this code
   uses — not awkward, unreachable.
2. **A nullable ordinal weakened the guarantee it existed to provide**, since Postgres treats
   nulls as distinct in a unique index. Two findings with a null ordinal would both insert.

`0010` makes the column `NOT NULL` and the index total. The fix removes the reason a predicate was
needed rather than teaching the client a clause it cannot express.

### The error message

"there is no unique or exclusion constraint matching the ON CONFLICT specification" named neither
the expected index nor the cause, and cost a round trip. It now states what was expected, the
query to check it with, and what the answer means — the same discipline as the env-var and
bucket-name errors.

---

## D-033 — Close a run last, and only after verifying it
**2026-08-21 · business owner**

`persistRun` wrote evidence, wrote findings, closed the run, and verified afterwards. Closing sets
`finished_at`, and the trigger in `0004_runs.sql` refuses every later write.

All five runs were frozen while their findings cited captures that had no evidence row. They
cannot be completed, because the run is immutable. They cannot be deleted, because runs are never
deleted (D-002). Stuck by design.

**The trigger is right. Closing an unverified run was wrong.** Closing a run *is* the assertion
that it is complete, so it can never precede the evidence for that assertion. `finishRun` is now
the last step and runs only after the check passes; a failure leaves the run open and repairable.

### The check had to take the report as an argument

The obvious form — `if ((await assessRun(supabase, runId)).complete) await finishRun(...)` — is
wrong, and wrong in the way this project keeps being wrong. `assessRun` derives what a run should
contain from the report it reads back. Before `finishRun` there is no stored report. Asked early
it finds nothing, expects nothing, reports nothing missing, and **passes vacuously**.

That is D-026 one layer up: a check whose own subject had not been established. The contents check
now takes the report the writer already holds. `assessContents` is the shared definition;
`assessRun` reads the report back and delegates to it, so a reader and a writer still cannot
disagree (D-031).

### No escape hatch for the five

Weakening D-002 to salvage test data is the wrong trade — the guarantee is worth more than the
runs. They stay as `complete` with incomplete contents: honest history, costing nothing.

---

## D-034 — `evidence.key` is the artifact key, not the storage path
**2026-08-21 · found while fixing D-033**

Every finding cites `artifact.key`. The writer recorded `storagePathFor(artifact)`, which appends
`.gz` to gzipped text. So every robots.txt and sitemap capture was filed under a name no finding
referenced. The rows existed, the objects existed, and nothing could join them.

`0006` had documented the column as the key all along. The writer drifted from its own schema.

**Screenshots hid it for four milestones.** Their key and path are the same string, so every
capture a person actually looks at resolved correctly. The invisible half was the documentary
evidence behind hard constraint 3 — L0 findings, where the artifact body *is* the finding.

Three changes:

1. The row records `artifact.key`. Where the bytes sit is derived by `storagePathForKey()`, in one
   place, because two call sites spelling the rule out separately is how they diverged.
2. An empty `evidenceKey` is stored as null. A finding that retained no capture is not making a
   citation; `''` would be a citation of something that cannot exist.
3. `0011` adds a foreign key from `findings.evidence_key` to `evidence.key`. Hard constraint 3 was
   being enforced by application code that had the same blind spot as the writer. It is now a
   schema property.

The constraint is `NOT VALID`: it binds every row written from now on and does not re-check the
five frozen runs, which cannot be repaired. Validating it would have required deleting them.

It covers the primary citation. A finding's full `evidence` array may cite several, and those are
checked by `assessContents` before the run is allowed to close.

---

## D-035 — Delete the migration path; prove the real one
**2026-08-21 · business owner**

`migrate-to-supabase.ts` read local reports and reconstructed the rows a run would have written.
It was the **only caller of `persistRun`** — the path every real scan would use had never once
completed successfully, and the script itself had never completed successfully either.

That is the sixth defect's real cause. A second write path that nothing exercises is not a
fallback; it is an untested duplicate of the thing that matters, and it is where four of the six
defects were found.

The script is deleted. `npm run scan-supabase` writes through the ordinary scan path: preflight
before the browser starts, `persistRun` after the report is assembled, and a read-back from the
database rather than a success reported from the writer's own return value.

Re-scanning produces clean runs *and* exercises the production path. The migration produced
neither.

Preserving the original five runs was never the goal — they were test data. `evidence/` and
`reports/` on disk still hold what those scans captured.

### On the pattern

Six defects in one sequence, all the same shape: the bucket guard that checked at migration time
and not at upload time; the idempotency check that tested existence rather than completeness;
`ON CONFLICT` against an index it could not infer; a run closed before it was verified; evidence
filed under a name findings did not use; and a write path nothing had ever run.

Every one is *a verdict resting on a surface that was never established* — the same sentence as
hard constraint 9 and D-014, which the rule engine has been disciplined about since M1. The
storage layer had no equivalent discipline until now.

The Tier 1/2/3 harness (D-032) addresses the SQL layer. This addresses the other half: there is
one write path, and the way it gets exercised is by using it.

---

## D-036 — A failed read is not an empty database
**2026-08-21 · found on the first real use of the write path**

corepeptides wrote all 17 artifacts, all 17 evidence rows and all 97 findings, and was refused
anyway. `readContents` destructured only `count` and `data` from its own queries, discarded both
`error`s, and coalesced with `?? 0` and `?? []`. A transient failure on the evidence select
therefore produced **an empty database**, and the check reported every cited key as having no row.

The number in the output — 11 — was the count of keys that report *cites*. Nothing was missing.

**The reader could not tell "nothing is there" from "I could not look", and answered as though it
could.** That is the sequence's own shape pointing the other way: a false failure rather than a
false pass. The safe direction, and still not a check. A guard that condemns on a network blip
teaches people to ignore it, which costs exactly what a guard that passes on a blip costs.

Both reads now throw, and the object check distinguishes "object not found" from "the storage API
did not answer". A run that cannot be assessed is marked `failed` with `finished_at` null — open,
resumable, and not asserting anything about itself.

### The check was also weaker than it looked

It compared **cited** keys. A report names only the captures its findings reference — 10 or 11 of
17 for a typical run. DOM snapshots and unreferenced sitemap pages were never verified, so
"the counts match" and "nothing was dropped" were genuinely different claims.

The writer holds the full key list, so it passes it, exactly as it passes the report (D-033). A
reader assessing a stored run has no such list and gets the weaker check honestly, rather than a
denominator inferred from something that does not carry one.

**Checked against real data before fixing:** all five new runs compared artifact-by-artifact
between disk, evidence rows and bucket objects. 17/17, 17/17, 17/17, 17/17, 3/3, nothing dropped,
nothing extra — including corepeptides.

### `resume-run`, and what it deliberately will not do

`persistRun` leaves an unverifiable run open so it can be finished later; nothing could finish one.
`npm run resume-run` verifies and closes. It carries **no artifact bodies** and cannot re-upload a
capture: reconstructing artifacts from disk is what the deleted migration script did and where
D-034 came from. It reads the evidence directory for the key list only, so its check is as strong
as the writer's.

If a capture is genuinely absent it says which and stops. The answer to a genuinely incomplete run
is a fresh scan producing a new immutable run — not a repair that guesses at what the crawler saw.
There is still exactly one path that writes captures, and it is `scan-supabase` (D-035).

---

## D-037 — M8: deploy, and how a scan gets triggered
**2026-08-21 · business owner**

Priority is a working demo, not completeness. Merchant credential entry, Resend domain
verification and COA parsing are out of scope.

### The queue is a table and a poller

An analyst writes a row to `scan_requests`; the worker on Fly claims it, screens the storefront,
and records the run it produced. No job service, no dashboard — the build order does not include
one, and what a demo needs is for a scan to start from somewhere other than one laptop.

**The request is not the run.** A request records that someone asked; a run records what was
observed. They answer to different rules: a request can be retried or abandoned, and a run is
immutable once finished (D-002). Collapsing them would turn queue bookkeeping into edits of a
screening record.

Two check constraints refuse the state every defect in the M7 sequence took — a finished request
that says nothing about what happened. `done` requires a run; `failed` requires a reason. The
database will not store a silent success.

Claiming is a compare-and-swap, not a lock: read the oldest queued row, then update it
*conditioned on it still being queued*. Safe for any number of machines, no advisory locks, no
RPC. A claim older than fifteen minutes is reclaimed, because a machine can die mid-scan and a
request stuck in `running` forever is a scan that silently never happens.

### One crawl path

`bin/scan.ts` and `bin/worker.ts` both call `src/screen.ts`. The queue worker does not have its
own crawl. D-035 is three weeks old and its lesson was that a second path nobody runs is where
defects live; a worker that crawls *slightly* differently from the command everyone tests with is
that mistake with a job table attached.

### Quarantine is a row, not a file

Five runs are frozen with findings citing captures that cannot be resolved (D-033, D-034). From
the outside they are indistinguishable from good runs: status `complete`, full report, findings
that render. A demo viewer must not read them as ordinary results.

The fact moves from `supabase/quarantined-runs.json` into `public.run_quarantine`, because the
frontend needs it as much as the verification script does and two copies of one fact is D-034
again. It is marked in the run list *and* at the top of the report — someone choosing a run needs
to know before they open it.

**It is an annotation, not a revision.** The run row, its findings and its report are untouched;
what is added is a separate statement that its evidence is incomplete. D-002 forbids revising
what a run claimed, not recording that its evidence is incomplete. The table is append-only by
trigger, since a notice that could be quietly withdrawn would be worth nothing.

The notice states the observation and stops — no instruction, no recommendation, and it does not
say the findings are wrong (D-001). Nor does it filter: the run stays in the list and the report
renders in full. Hiding it would be a kind of editing.

### Deployment

`docs/DEPLOY.md` is now a runbook rather than a shape, written for someone who has not used Fly.
Two steps are worth naming because missing either produces a working-looking app that does
nothing:

1. **Supabase auth URL configuration.** A magic link points wherever Supabase has recorded, so a
   link generated for `localhost` is useless in a demo.
2. **Two steps to invite an analyst.** `auth.users` is not enough; every policy gates on a row in
   `public.analysts`. Someone who completes the first and not the second signs in successfully and
   sees nothing, which is correct and looks broken.

The Docker build was corrected in three places found by reading rather than by running: `npm ci`
needs every workspace manifest including the frontend's; the build must target the worker project
rather than the root, which would pull React into a crawl container; and `.dockerignore` did not
exist, so `fly deploy` would have uploaded `node_modules` and every stored capture. **The image
has not been built — there is no Docker on the development machine.** Same honesty as Tier 2 in
D-032: stated, not skipped.

---

## D-038 — Constraint 6 states a property, not a mechanism
**2026-08-21 · business owner**

> **Credentials must never be recoverable from the database alone.**

The original wording was *"credentials go in a vault, never in Postgres columns"*. Taken literally
it would have forced the weaker design.

Supabase Vault is the option in this stack literally named "vault", and it decrypts through the
same `service_role` connection the worker already holds. One leaked service key yields plaintext.
Ciphertext in a Postgres column, sealed to a key that exists only in the Fly runtime, requires
**two independent compromises** — the database and the deployment.

Constraint 6 exists to prevent a database breach yielding credentials. The design that breaks its
letter satisfies its purpose better than the one that matches its wording. So the constraint now
states the purpose.

### The mechanism it selected

A key pair. The public half is compiled into the frontend as `VITE_CREDENTIAL_PUBLIC_KEY`, where
being public is the entire point; the private half is a Fly secret.

Hybrid, because RSA-OAEP at 2048 bits holds 190 bytes: a fresh AES-256-GCM key per envelope, the
payload under AES, the key under RSA. A scheme that works until the payload grows is a scheme that
fails in production, and a session blob is kilobytes.

Written once, in `packages/engine/src/sealed.ts`, using **WebCrypto rather than `node:crypto`** so
the browser and the worker run literally the same code. A format with two implementations agrees
until it does not, and this project has already paid for that (D-034) — there the thing that
diverged was an evidence key; here it would be a merchant's password.

### The asymmetry is the feature, not the algorithm

The browser can seal and cannot open. So an analyst who types a merchant's password is not a party
who can retrieve it, and neither is the database, nor Supabase, nor anyone with a dump. **The
number of parties who can read a merchant's password is one, and it is a machine.**

There is no "view credential" anywhere in the application. That is a property, not a missing
feature, and the entry screen says so — otherwise someone treats it as a password manager.

### Losing the key is unrecoverable, deliberately

`npm run make-credential-key` prints both halves once and stores neither. Losing the private half
makes every stored credential permanently unreadable.

That is the design working. **A recovery path is a second route to plaintext**, which is precisely
what the two-key arrangement is paying to avoid. Re-asking a merchant costs an email. Nobody should
later add escrow as a convenience — this paragraph exists so that doing so is a decision to
overturn rather than a gap to fill.

### What is stored where

| | |
|---|---|
| `credential_deposits` | sealed envelope from the browser, drained and **deleted** by the worker |
| `vault_entries` | sealed credentials and sessions, keyed by vault path |
| `credential_access` | reference, action, purpose, outcome. Never values. Append-only by trigger |
| `credentials` | unchanged: a `vault_ref` and nothing that could hold a secret |

The deposit is deleted rather than marked consumed: a consumed deposit is a second copy of a
credential for no purpose, and the right number of copies is one. A deposit that *cannot be opened*
is left in place and reported — deleting the only copy of something we failed to read is
unrecoverable, and "I could not open this" is not "the merchant supplied nothing" (D-036).

Sessions are sealed identically. A Playwright `storageState` is a bearer token for a merchant
account and is not less sensitive than the password that produced it.

---

## D-039 — Merchant-supplied logins are authorized; Mintro creating accounts is not
**2026-08-21 · Frank's ruling**

A merchant handing us a demo account so their product pages can be read is **authorized**.

Mintro creating its own accounts on merchant sites **remains blocked**, and is a different
question: it involves agreeing to terms on someone else's site, under an identity we chose,
without the merchant's knowledge. The first is a merchant granting access to their own property.
Recorded separately so the two do not get conflated when the wider question is settled.

### A credential widens what is visible. It never narrows what is reported.

GATE-002 (products hidden until an account exists) and GATE-003 (guest checkout disabled) ask what
an **anonymous visitor** can reach. Both are `critical` and `auto_fail`. Both mean the opposite of
themselves if the request carries a session — a gated merchant's catalogue answers 200 once you are
signed in, and that reads as a merchant selling openly to anyone.

The ruling was that this be **enforced, not emergent**. Three mechanisms, at three levels:

1. **`runGateRules` has no parameter that could carry a session.** Its dependency is an
   `AnonymousAccess` with two callbacks taking a path list and a product URL. A caller holding an
   authenticated context cannot pass it in, and no future edit can add one without changing a
   signature a test watches.
2. **`packages/ruleset/test/anonymous-probes.test.ts`** fails the build if `unauthenticated: true`
   is removed from either rule, or if either is downgraded from `critical` / `auto_fail`. This
   cannot live in the runner: the runner decides its scope *from* that flag, so a rule that lost it
   would simply stop being covered — silently, which is the failure.
3. **`apps/worker/test/gate.test.ts`** asserts a credentialed run produces findings identical to a
   public one and — because a test comparing two identical things proves nothing — also asserts
   that the *same compliant merchant* probed **with** a session is auto-failed. That second test is
   what makes the first discriminating.

A signed-in scan fails rather than silently falling back to a public crawl. A run that quietly lost
its session would report gated pages as unobservable and attribute that to the merchant's
configuration: a false observation about a real merchant.

Not every probe rule is a gate rule. FULF-002 probes checkout address validation, which on a gated
merchant is only observable while signed in, so it inherits the run session (D-017). It is pinned
by the same test in the other direction — nobody should "fix" it by adding the flag.

### A side effect worth naming

Wiring `runGateRules` into `screenStorefront` means GATE-002 and GATE-003 are **evaluated for the
first time**. Until now both came back `not_evaluable` in every run, because nothing called the
probe handlers. Expect the five storefronts' numbers to move.

---

## D-040 — Access mode is detected, not chosen
**2026-08-21 · business owner · first use**

The three-way access picker is removed. The analyst chooses nothing.

    crawl anonymous
      → product pages served?          that is the answer
      → refused, credential stored?    use it, for those pages
      → refused, no credential?        report not_evaluable, and say coverage would widen

Asking was redundant: the tool already detects the platform and already knows when it has hit a
login wall. And a picker invites the wrong answer — which produces a report whose coverage does
not match what was actually possible, without anyone noticing that is what happened.

### The wall is located structurally

`assessWall` asks one question of each sampled page: **did the request end at the URL we asked
for, with a success status?** Not "does the final URL look like a login page" — that finds every
merchant who words their login the way we expected and misses the rest (hard constraint 9, D-014).
The same rule `http_probe` already applies to GATE-002, for the same reason.

Two boundaries worth stating:

- **A partly gated catalogue is not a wall.** Some merchants gate a subset; escalating there would
  be using a merchant's own account to read pages they chose to gate for everyone.
- **No product pages is not a wall.** That is a catalogue we never found — a different problem
  with a different answer, and treating it as a wall would send the run hunting a credential to
  fix a discovery failure.

### A credential is kept only if it changed what was served

After re-rendering with a session, the run compares. If the pages that were refused anonymously
are still refused, the public crawl stands and the report says `public`. A credential that widened
nothing has widened nothing, and reporting `screening_account` on the strength of having *tried*
would overstate what the run saw — the same false-coverage shape as reporting an unobservable rule
as passing.

### D-039 is untouched, and now enforced in a fourth place

The unauthenticated probe still runs first and still decides GATE-002 and GATE-003. Three things
keep that true under auto-detection:

1. `runGateRules` still has no parameter that could carry a session, and is still called with an
   anonymous access built from a fresh context.
2. The **homepage** is rendered anonymously too, always. The footer disclosure rules describe what
   a customer sees; reading them signed in would answer a different question. Escalation reaches
   the product sample and nothing else.
3. `scan_requests`' insert policy now **pins `mode = 'public'`**. A requester cannot ask for a
   credentialed scan at all; the worker rewrites the column afterwards to record what happened.
   Every scan begins anonymous as a schema property rather than a convention.

`scan_requests.mode` therefore changes meaning: it was a request and is now an outcome.

### The report says what it could reach

`ScreeningReport.access` carries the mode, whether a wall was met, whether a credential got past
it, and a sentence. Shown at the top of the report only when a wall was met — on an ordinary
public crawl the coverage line already says everything there is to say.

It is descriptive, like the rest of the report. *"Coverage of those rules would be wider with a
merchant-supplied login"* is an observation about this run. *"Obtain a screening account"* would be
an instruction, and D-001 is the difference.

---

## Three defects from first use, fixed alongside

**Navigation did nothing from a report.** The rail changed `pane` while the scan pane was still
showing a report, so "Site check" appeared inert. Navigating to a pane now means going to that
pane, not to whatever it was last showing.

**Download PDF did nothing.** The M5 pipeline works, but it is `page.pdf()` driven by Playwright
and a browser cannot reach it. It is now a queued job with the same shape as a scan — `pdf_requests`,
the same compare-and-swap claim, the same two constraints refusing a finished job that says nothing
about what happened. The file lands in the evidence bucket keyed by *request* rather than run, so a
second render does not collide with the first (D-002), and the browser downloads it through the
same signed-URL path every capture uses.

Nothing is reported as downloaded until the worker says the file exists and a URL for it comes
back. The old toast fired immediately and said "Downloaded" when nothing had been produced at all.

**This is why the container now builds the frontend.** The PDF is the same React component the
analyst sees — ARCHITECTURE.md rules out a second rendering stack precisely so the export and the
report cannot say different things — so `apps/web` is part of the image. It costs build time. The
alternative is a second template that drifts, and the thing that would drift is a compliance
document.

**Send to IQwallet looked like it worked.** It never reached a mailer: the send path runs in the
worker and is not wired, and the sending domain is unverified. The button showed a success toast.

It is now disabled with the reason on the button itself. Not a change of the D-001 rule that
sending is never blocked by an *outcome* — this is not an outcome, it is that there is no path. A
`VITE_SEND_ENABLED` flag was considered and rejected: the frontend cannot observe whether
`RESEND_API_KEY` is set, so the flag would be a claim rather than an observation, and this project
has spent long enough on verdicts resting on surfaces that were never established. When sending is
wired it becomes a queued job like the PDF, and the button re-enables on what the worker reports.

---

## D-041 — Requirement restatement, not corrective actions
**2026-08-21 · Frank's ruling**

Each finding shows what was observed beside what the program requires:

    Observed             "For research use only."
    Program requirement  "For research and laboratory use only. Not for human or
                          animal consumption."

### The alternative was considered and rejected

A suggested-corrective-actions column was on the table. Telling a merchant how to fix a finding is
**remediation advice**, which makes Mintro a party to the compliance determination and creates
reliance. This system reports observations; IQwallet decides.

Quoting the standard beside the observation gives the merchant everything they need to act while
Mintro states a fact and cites a source. The information is the same; the act is not.

### Verbatim is the whole guarantee

The requirement is the rule's `clause`, byte-identical. Not trimmed, not sentence-cased, not
shortened with an ellipsis. **An exact quotation is Mintro citing the standard; a paraphrase would
be Mintro characterising it.**

This is why `DIRECTIVE_TERMS` has always excluded bare "must" — clauses say "Guest checkout must
be disabled", and rewriting them to avoid imperatives would misquote the document the merchant is
screened against. The M5 clause exception was the same reasoning applied to a smaller surface.

So the two columns are audited to **different standards**, deliberately:

| Column | Checked for |
|---|---|
| Observed | directive language — it is Mintro's own words |
| Program requirement | being byte-identical to the clause — it is not ours to word |

`auditRequirement()` enforces both, and a whitespace-only difference fails: it looks harmless and
is still not a quotation.

### Where it appears

`fail` and `review` show the pair. `not_evaluable` shows the requirement beside the reason it
could not be assessed — the standard still applies to a rule the crawl could not observe, and
saying so is the honest form of hard constraint 2.

`pass` shows nothing. A satisfied rule quoted back at the reader carries no tension between the
two columns and is noise.

### The framing is the headings

"Observed" and "Program requirement" are both nouns and neither addresses the reader. The
identical two pieces of text under "Required action" or "How to fix" would be an instruction
without a word of the content changing — which is why the headings are a constant in the engine
(`REQUIREMENT_HEADINGS`) rather than strings typed into a component, and why a test asserts they
contain no verb of instruction.

---

## D-042 — The report reads as a report
**2026-08-21 · Frank's ruling**

97 findings rendered as a flat wall. This is where D-022 — raised at M3, never implemented —
finally gets built.

### Failures never collapse

A critical failure on one product page and the same failure on all five are **different facts
about a merchant**, and a collapsed row presents them identically. The one it flatters is the
merchant with five. IQwallet needs to see which it is, so `fail` groups stay expanded regardless
of count.

`pass` and `not_evaluable` collapse freely — five identical passes carry nothing the count does
not. `review` collapses with the count prominent, because a human examines each one and the count
is how many examinations that is.

A group of one never collapses in any state: hiding a single finding behind a disclosure costs a
click and gains nothing.

### Shape before detail

Failures first with full evidence, then review, then a compact pass summary, then not-evaluable
with reasons. A reader who stops after the first section has read the part that decides anything.
Rule-set ordering is preserved *inside* each section, so the report still reads the way the rules
do. The tick strip and coverage line are unchanged.

### Presentation only, and that is load-bearing

Grouping runs in the reading view and nowhere else. `print` bypasses it entirely: the PDF keeps
the category structure and every finding individually. **A grouped export would be a document that
quietly held less than the run produced**, and it is the export that reaches an underwriter.

Verified against the real print path rather than asserted — the swisschems run, rendered:

    findings in the DOM      97      every finding, individually
    collapsed findings        0      nothing hidden in the export
    category cards           10      print keeps the category structure
    group cards               0      grouping bypassed entirely
    requirement blocks       69      = 4 fail + 18 review + 47 not_evaluable
    captures resolved     66/66

69 is exactly the report's `fail + review + not_evaluable`, which is the D-041 rule holding in the
document rather than only in the component. The PDF grew from 45 pages to 70 — the requirement
column is real, printed, and part of what gets sent.

`demo/index.html` remains the visual language (D-004). This extends it for real data volume; the
cards, chips, tick strip and evidence slips are unchanged.

---

## D-045 — The report that opens is the run that request produced
**2026-08-22 · Frank's ruling, from a defect on the deployed site**

Entering a URL and pressing Run scan showed an **existing report for that merchant** instead of
the scan just requested.

### What it actually was

Neither of the two candidates raised. The form was not matching on merchant, and the UI was not
navigating anywhere on submit. Diagnosed against the live system:

    scan_requests          1 row, 21 hours old, done, worker claimed it in 1s
    fly logs               worker polling continuously; no request seen in that window
    reproduced live        queued a scan, worker claimed it in 0.35s, run 12 completed
    then Open report       RUN 895056af — the *previous* swisschems run, from 20:45 the day before

`ScanInput` seeded its run selection from `available[0]` at mount, and resynced only while the
value was `''`. Once set it never moved. When the scan finished and the list refreshed with the
new run at its head, the selector still named whichever run had been newest when the page loaded,
and Open report loaded that one.

### Watching the request id is the part that makes this correct

"Open the newest run" would have fixed the observed symptom and remained wrong. Two analysts
screening different merchants at once, or a re-scan finishing while an earlier one is still
running, and the newest run belongs to someone else's request — the same wrong-report failure,
now with a merchant mismatch and no reason for anyone to suspect it.

So the insert returns the id of the row it created, and the UI follows **that row**:

- `request()` returns `{ ok: true, id }`. An insert that reports success without an id is reported
  as a failure, because the only thing a caller could do with it is fall back to "newest".
- `get(id)` reads that one request. Not a page of recent ones filtered down — with two analysts
  scanning, the request being followed may not be on the page at all.
- A `null` from `get` is *could not read*, and the watcher keeps waiting. It is never read as
  finished or gone.
- `done` with no `run_id` — which `finished_requests_say_what_happened` in `0012` forbids — is
  reported, not repaired by opening something else.

The pane now moves input → queued/running for that request → the report it produced, which is the
flow `demo/index.html` always described (D-004). The progress card shows the worker's own progress
line and nothing more; the demo's seven crawl layers are not populated because the worker does not
report them, and inventing them would be a progress display that was mostly decoration.

### The invisibility came from the label, not the state

A stale selection is a bug. A stale selection that renders identically to the fresh one is an
undetectable bug, and that is what the label did:

    swisschems.is — 5 failed, 18 for review — 2026-08-22     ← the run from 00:45
    swisschems.is — 5 failed, 18 for review — 2026-08-22     ← the run from 22:00

Rendered to the day, two runs of one merchant on one day are the same string — and re-scanning a
merchant is a *normal* operation (D-002), so that collision is the ordinary case rather than an
edge one. The counts match too, because a merchant that has not changed between scans produces
the same counts; the date was the only field that could have separated them, and it was truncated.

**Timestamps in the run labels are part of the fix, not cosmetic.** Nothing on screen distinguished
the wrong report from the right one, so the defect could survive any amount of careful looking.

### The default follows, the choice is kept

`resolveRunSelection` in `apps/web/src/lib/runs.ts`, pure and tested:

- untouched, the selection is a default and follows the head of the list;
- once the analyst picks a run, that choice stands, and is replaced only if the run leaves the
  list, where leaving it would point the button at nothing;
- an empty list changes nothing, because an empty list is as often a failed read as it is no runs
  (D-036).

### Limitation, stated rather than hidden

One watched request per browser. Queueing a second scan moves the watch to it; the first still
appears in Recent requests and its report is opened from the selector. Runs are immutable and
nothing is lost — but the automatic open follows the most recent request only.
