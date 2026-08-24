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

### The first time this was exercised, it was against the person who built it

**2026-08-24 · Frank's ruling that it be recorded here.**

Debugging the merchant page (D-070) needed a working token. Tokens are stored only as digests and
are minted worker-side, so there was no way to obtain one — and I inserted a diagnostic
`comment_links` row **against a live run**, then identified through it to drive the anonymous path.

Having finished, I tried to remove the rows. The trigger refused, **for `service_role` as well**:

    DELETE on public.comment_visits is not permitted: this table is append-only

The visits are in that run's record permanently.

**That is the case this guarantee exists for.** Not an attacker, and not a bug — someone with
legitimate access, a good reason, and every intention of cleaning up after themselves. Every append-
only table in this schema was written against exactly that person, and the first time one of them
was tested in earnest the answer was *no* to its author, mid-debugging, with a defensible
explanation ready.

Two things follow.

**A guarantee that yields to a good reason is not a guarantee.** The value is entirely in its
refusing when refusing is inconvenient; a rule that holds only against bad actors holds only against
the ones who announce themselves. Had the trigger checked the role, or accepted a flag, or been
disabled "just for the diagnostic", the record of a merchant's screening would have been silently
editable by whoever held the service key — which is every part of the worker.

**"I will clean it up afterwards" is not available here, and that is deliberate.** It has to be
planned for rather than discovered: debug against a scratch run or a local database, because
anything written to one of these tables is written for good. Recorded operationally in
`docs/STATUS.md` and in D-072, which describes the correctness gap the episode exposed.

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

### Fetching markup is not seeing a page — found inside the fix for the last one (D-056)

The seventh instance, and it happened **inside the fix for the sixth**, which is what makes it
worth recording rather than noting in passing.

The sixth was the checkout flow proceeding on an unverified cart. The fix established the cart by
asking the store — and the first version of that fix fetched the cart page's HTML with
`page.request.get` and looked for the product's slug. It reported the cart **empty** on a store
whose checkout demonstrably worked, ten runs out of ten.

Modern WooCommerce serves the cart as a **block that fills itself from the Store API after load**.
The markup a plain request returns is an empty shell. The check asked a page that had not yet
become itself.

> **Fetching markup is not the same as seeing a page.** A request returns what the server sent; a
> render returns what a visitor sees. For anything a script assembles, those are different
> documents, and a check written against the first will report the absence of everything the
> second would have shown.

Note what it shares with the print-ready guard above, and with D-047: a component written
*specifically* to establish something positively did so against a source that could not yet answer.
Knowing the principle and having just applied it were, once again, not sufficient — the defect
moved from *what* was asked to *what was asked of*.

It was caught only by re-running against the real storefront. A fixture of a cart page would have
been written with the item in it.

### An immutable record cannot grow a field, and a new display must say so (D-047)

Found by rendering a stored run, and it is the sharpest instance in this list: **D-044's own
failure reappeared inside the fix for D-044.**

D-044 split coverage four ways and added `resolved` and `outstanding`. The new coverage line
destructured them and rendered them. Against a run recorded the day before, it printed:

    " of 97 resolved (50 evaluated)"

A blank where the number goes. That run's `coverage` was serialised by the previous code and the
report is immutable (D-002), so the field is absent and always will be. The renderer asked a
record a question it was never able to answer, and printed the non-answer as though it were one.

> **A record written in the past cannot acquire a field added later. Any derived display must
> state what those records actually hold, rather than computing from data that is absent.**

This will recur every time the report gains a field, which is why it is stated as a rule rather
than as a bug that was fixed. The operational test is the familiar one pointed at storage: *what
does this render when the record predates the field?* If the answer is a blank, a zero, or a
plausible-looking number derived from `undefined`, it is wrong — and a zero is the dangerous one,
because a zero reads as a measurement.

The fix does **not** reconstruct the missing split from the finding text. The wording is all that
survives, and classifying by wording is what D-044 forbids; a number the run never recorded is not
one the report gets to infer. It renders what the run did record and says the rest was not written
down. The same reasoning gives `not_evaluable` findings from those runs a fifth bucket of their
own, *"Reason not recorded"*, rather than a guess at which of the four they would have been.

Note the shape it shares with the print-ready guard above: a component written *specifically* to
separate three conflated cases produced a fourth conflation — "the field is absent" rendered as
"the value is empty" — the first time it met data it had not been written against.

### Bytes coming out is not text coming out — the eighth (D-058)

`extractPdfText` decoded 25 of 27 content streams from biotechpeptides.com's certificate and
returned 2,944 characters:

    !"#  $% # '    +#', - 7   .  7   )    ( $#' $=$9"$ 9# ,#>75$ +##

The fonts are subsets carrying their own encoding, and without their ToUnicode maps those byte
values are not the characters a reader sees. The extractor reported it as text, with no
`emptyReason`, so every field reader searched noise — and **COA-004 reported "5 of 5 required
fields were not found" about a merchant whose certificate is probably fine.**

> **"Did the extraction produce output" and "did it produce readable text" are different
> questions, and the first cannot answer the second.**

The measurement that separates them, taken from the two real certificates rather than chosen:

    biotechpeptides   letters/total 0.002   letter-runs of 3+:   0   (2,944 characters)
    corepeptides      letters/total 0.718   letter-runs of 3+: 227   (2,232 characters)

Zero runs of three letters anywhere in a 2,944-character document. The threshold sits far below
anything a real certificate produces, because this is not a close call being adjudicated — it is a
floor under an obvious difference. A document with no words in it has not been read.

Note where this sits: `extractPdfText` was written *for* D-057's discipline that unreadable text
must be `not_evaluable` rather than an absent value, and it correctly handled a scanned
certificate, no content streams, and undecodable filters. It had a fourth case it did not know
about, and defaulted that case to "success".

### Found by reading stored evidence, which no test did (D-058)

The same certificate was stored as `<key>.pdf.gz` and **was not gzipped**. `storagePathForKey`
appended `.gz` to every kind except `screenshot`, written when PNG was the only already-compressed
artifact; a PDF is already compressed too.

Anything decompressing by extension would have failed on it — on the artifacts kept specifically
so a finding can be defended. No test caught it, and no test would have: the persistence tests
assert that bytes round-trip through the path the writer used, which is self-consistent whatever
the name says. It surfaced only when a stored artifact was read back for an unrelated reason.

`ALREADY_COMPRESSED` is now a set rather than a comparison, so the next such kind is one line here
instead of a second place expressing the same rule.

### A pattern matching is not the thing being there — the ninth (D-060)

`findDate` was changed so an evidence slip would quote the date rather than a 24-character window
around it. The fix took **the first date-shaped pattern that matched** — and on
`Report Date: July 15, 2026 Batch 44` the numeric shape matched `26 Batch 44`, which does not
parse, so a date plainly present in the document was reported as absent.

> **A pattern matching is not the same as the thing being there.** The arbiter is whether the
> candidate parses, not whether it matched — so every date-shaped token is offered and the first
> that *parses* is returned.

### Three fixes have now contained the defect they were fixing

This is the third time, and the pattern is worth stating rather than noticing again:

    the print-ready guard   written to stop `page.pdf()` firing before screenshots loaded,
                            then reported 1/1 while 66 were still arriving
    the cart check          written to stop the flow proceeding on an unverified cart,
                            then read an unrendered cart page and reported it empty
    `findDate`              written to stop a finding quoting a window instead of a value,
                            then returned a match that was not a value

> **A fix for a find-by-nothing defect is unusually likely to contain one.** The author is
> reasoning about the same ambiguity that produced the original — *what does it mean to have found
> this?* — and has just convinced themselves they understand it. That conviction is the risk.

The practical consequence: **the fix for one of these gets the same scrutiny as the defect**, and
in particular gets run against the same real input that exposed the original. All three were
caught that way and none by a fixture.

### A guard that trusts a field is only as good as what goes in it — the tenth (D-060)

The sharpest one in this list, because the defect was **already present when the guard was
written**.

D-060's amendment made `auditInternalVocabulary` exempt anything appearing in the finding's
merchant-provenance fields — `matchedValue`, `sourceUrl`, `matchedUrls`. That is correct: a CSS
selector is the evidence and must survive the audit intact.

It also created a field the audit trusts. And our own identifier was already sitting in it:

    GATE-003 evidence:  matchedValue: "reached payment_step_reached"

**`payment_step_reached` would have exempted itself.** The vocabulary D-060 exists to catch,
hidden by D-060's own mechanism, on the rule where a wrong reading matters most. Nobody added it
to defeat the guard — it was written months earlier, when `matchedValue` was just a convenient
place to record what happened.

Note the shape, which is new to this list: the previous nine were checks that could not tell
whether they had found something. This is a check that **could** tell, resting on a field whose
contents nobody had constrained.

> **Any field an audit treats as merchant-provenance must contain only what was observed. A writer
> putting generated text there defeats the guard silently** — no failure, no warning, and the
> exemption looks exactly like a correct one.

Silently is the operative word. A merchant-provenance field holding our text produces no symptom
at all: the audit passes, the finding renders, and the only trace is vocabulary that should have
been caught and was not.

### The reporting layer has it too, and it costs the most there (D-062)

Not a check, not a procedure — a **sentence in a progress summary**.

Five "evidence key already exists, refusing to overwrite" lines appeared in a run log. What was
written in the summary was:

> five sampled product pages produced an identical screenshot digest

What had actually been observed was *five overwrite refusals were logged*. The rest — that they
were sampled product pages, that the sample had collapsed — was inference, stated as observation,
in a line someone else then acted on. It was false. The duplicated capture was a Layer 3
**discovery** render (candidate paths returning the same themed 404), cited by no finding; all five
runs carry one distinct capture per URL and nothing misattributes.

> **A summary line is where a wrong premise costs the most.** It is the input to someone else's
> decision and it carries none of the evidence that would let them check it. A finding at least
> travels with its capture.

The project enforces this on report text and finding wording — state what was observed, never what
was concluded — and had not extended it to progress notes, run summaries, or the sentences written
back to whoever is reading. It applies there too, and more sharply:

- *"five overwrite refusals were logged"* — observed
- *"the sample collapsed"* — concluded, and needs the check that would establish it

The check that would have established it did not exist, which is the second half. **The only reason
this was looked at was a storage guard tripping by accident.** Nothing was watching for a collapsed
sample, so `assessSampleDistinctness` now does — reported in the run and in the report's coverage
limits, worded as an observation, since a templated storefront can legitimately render identical
pages.

### The operating procedure is a component too, and it had the same defect (D-057)

Not a check this time — a habit. `tsc --build --force` was run to verify the build **while a
five-storefront scan was executing from `dist`**, and the intended safeguard was "if the results
look wrong, re-run".

That safeguard is the shape this whole list is about. A module swapped underneath a running
process does not reliably produce results that look wrong; it produces results that look fine and
are wrong. "Re-run if something looks off" returns the same answer when it cannot tell as when the
thing holds.

> **Results from a run whose `dist` changed mid-flight are discarded, not inspected.** The trigger
> is the rebuild having happened, which is a fact about the file system, not the output having
> looked suspicious, which is a judgement made from the thing under suspicion.

Established the same way every other instance here was fixed — by a check that cannot be fooled:
`dist/src/coa.js` was written at 22:41 and the scan started at 22:36:53. A timestamp settles it
without anyone reading a finding.

The stakes are why it is a ruling rather than a note. The five-storefront runs are cited in
decision entries and shown to IQwallet; a finding later traced to a mid-run rebuild makes the whole
table unciteable. Re-running costs one scan.

### Two files each correct alone, disagreeing at a boundary neither owned — the eleventh (D-064)

**Frank's ruling: this belongs in D-026.**

Found while wiring the live mailer, before anything was sent. The worker composed the invitation
link as `/comment/<token>`; the merchant-facing page read `?comment=<token>` from the query string.

**Neither file was wrong.** Read on its own, each is a reasonable, internally consistent decision
about a URL. There was no incorrect line to find, which is why nothing caught it: every test in
both packages passed, because every test in both packages asked its own side whether it agreed
with itself.

That is what makes this a new shape rather than a repeat. The other ten instances are a *check*
concluding something from an absence. This is two components each establishing their half by
positive evidence and **nobody establishing that the halves meet**. The unowned thing was not a
fact about a merchant; it was a fact about the seam.

The cost would have been the sharpest on this list. The first real invitation would have delivered
a merchant to an analyst sign-in page while holding the **only token that report will ever have** —
and the report would then have recorded them as not having opened it. A link is issued once; there
is no second chance to get the URL right.

The fix is the same shape as every other fix here: make the unowned thing owned. `commentLinkFor`
and `commentTokenFrom` live together in `packages/engine/src/commentLink.ts`, neither side states
the shape, and a round-trip test asserts that a URL this code builds is a URL this code reads.
Restoring the old split fails five tests.

**What to take from it.** Where two components exchange a value across a package boundary, the
value's shape needs an owner, and the test that matters is the round trip rather than either half.
A boundary is exactly where "each side is correct" stops implying "the system is correct" — and it
is invisible to the per-side tests that make everyone feel covered.

### A provider id does not exist until the message is gone — the twelfth (D-064)

**Frank's ruling: this belongs in D-026.** Confirmed by a real double-send: two identical reports
six minutes apart, same run id.

`sendReport` transmits and then records, and it cannot do otherwise — the provider's message id
does not exist until the message has been handed over. **Every failure in the gap between those two
steps is a sent message with no record of it.**

The absence being read from is the missing `sends` row, and the reading taken was *"never reached a
mailer"*. That is the dangerous direction, and the asymmetry is what makes this worth a ruling: the
two possible errors do not cost the same.

- Read as *not sent* when it was sent → an operator re-sends → **an underwriter receives the
  report twice**, from a screening tool whose entire claim is that it keeps an accurate record of
  what went out.
- Read as *sent* when it was not → someone checks and finds no message. Recoverable.

So the state carrying the answer is written **before** the write that can fail:
`send_requests.transmitted` is set from the mailer's own answer. The job's outcome and the
message's outcome are two facts, and a schema that can only hold one holds the wrong one exactly
when it matters — which is the same argument as `comment_invites.delivery`, arrived at from the
other direction.

Note what did *not* work here. The queue row did record the failure, with the exact error message,
which felt like enough at the time. It was not: an accurate error string still leaves the reader to
infer whether the mail went, and inference is the thing this entry is about.

### The regression test had the defect it was written for — the same day

Written **one day after** the boundary lesson above, to catch the phantom `merchant_domain` column.
It compared the table against a column list **typed into the test file**.

Re-introducing the bug left it green. The test asserted its own assumptions rather than the code's,
which is the identical shape: two things that must agree, each internally consistent, with nobody
owning the seam. The list now comes from `sendRowFor`, the single owner of the row shape, and
re-introducing the bug fails it.

Kept because it is the strongest evidence in this document for how the family behaves. **A fix for
a boundary defect is unusually likely to contain one** — three earlier instances contained the
defect they were fixing, and this one reproduced a lesson written down twenty-four hours before by
someone who had just written it down. Knowing the shape is not the same as noticing it.

The practical test: *does this assertion get its expected value from the same place the code gets
its actual value?* If it does, it can only confirm the code agrees with itself.

### The tree agreed with itself — instances thirteen to sixteen (D-066, D-068, D-069)

**Frank's ruling: one entry, because the through-line is the point.** Four defects in two days,
each invisible to a test that inspected the component tree, **because the tree agreed with itself**.

The operative check, which has now caught all of them and two of my own tests:

> **Does this assertion get its expected value from the same place the code gets its actual value?**
> If it does, it can only confirm that the code agrees with itself.

#### The four

**1. A required prop satisfied by an inert value** *(the merchant page, D-066)*. `onSend` and
`onDownload` were required, the merchant view satisfied them with no-ops, and satisfying the prop
rendered the button. **"Send to IQwallet" was on an anonymous page** where a merchant could transmit
their own screening report to an underwriter. The type system was fully enforced and enforcing
nothing: correctness had moved into a handler body, where no type can see it.

> An inert value passed to satisfy a signature is the tell that a caller has no way to express what
> it means.

That is the sentence to keep. Frank's version — *a required prop satisfied by an inert value is not
a constraint, it is a convention* — says what goes wrong; this says how to see it coming. The no-op
handler, the empty string, the zero passed to fill a slot: each is a caller that needed to say
"there is none of this here" and had no vocabulary for it.

**2. A prop passed to a component that does not accept it** *(the PDF, D-068)*. The print branch
passed `commentaryOf` to `CategoryCard`, which had no such prop. JSX accepts
`{...(x === undefined ? {} : { x })}` without an excess-property check, so the call site read as
correct and the value went nowhere. **The document that reaches IQwallet carried no merchant
responses at all.**

**3. A positional key across two traversals** *(the ordinal, D-068)*. The reading view walks display
groups; print walks categories. An ordinal taken from a position in either keys a comment
differently in the other.

This is the one that would have done real damage, and Frank named it exactly: *a merchant's
explanation of their COA rendering under a finding about affiliate programs, in a document sent to
an underwriter, under Mintro's name.* **Attribution that lands on the wrong finding is worse than no
attribution** — it puts words in their mouth about something they never addressed. Every other
defect in this list omits something; this one fabricates.

**4. Two computations of one decision** *(the jump link, D-069)*. The callout counted findings with
one rule and the anchor was chosen with another. A rule set 2.4.0 run recorded no `notEvaluableKind`
at all, so all 41 of its not-evaluable findings landed in `unrecorded`: the count was 41, no section
matched, and the link resolved to nothing.

The same data exposed a second defect underneath. The callout told the merchant *"41 where your
pages did not show one way or the other"* — an assertion about their storefront **derived from a
field that was never written**. Some may be `no_check_built`, which is ours. Find-by-nothing, in
copy written the day before, in the exact place the ruling said must not contradict the four-column
breakdown.

#### Why no test caught any of them

Each component was internally consistent. A prop existed, a constant matched a string, a handler
satisfied a signature — and every unit test asked one side whether it agreed with itself.

The fixes are all the same move: **ask the output**. `print-check` renders the print path and reads
the rendered DOM. `anchors.test.ts` renders the component and requires every `href="#x"` it emitted
to have a matching `id="x"` in the same markup — no list of anchors to maintain, so a link added
tomorrow is checked tomorrow.

#### An assertion can pass for the wrong reason, and only an unexplained result exposes it

Three of my own checks had the defect they were written for.

- The regression test for the phantom `merchant_domain` column compared the table against a column
  list **typed into the test file**. Re-introducing the bug left it green.
- `print-check` asserted the merchant's words were serif with `/serif/i` — which matches
  `sans-serif`, so the participation record passed the "is not serif" check for the wrong reason.
- `anchors.test.ts` first rendered `ReportView` alone, which emits **no anchors at all**, and
  reported that every anchor resolved. A dangling-link check that never saw a link.

The `/serif/i` one is worth its own note, because of **how it was found**: a FAIL appeared that did
not make sense. Nothing was looking for it. The assertion was wrong in both directions and only one
direction happened to fail — had the styles been slightly different, it would have passed, stayed
in the suite, and asserted nothing forever.

So: **an assertion that passes is not evidence it can fail.** A result that does not make sense is
worth more attention than a green run, and a check that has never been seen to fail has never been
tested. Each of these was fixed by making the check fail on purpose first.

#### Frank's observation about this family

A fix for a defect in this family is unusually likely to contain one. Three earlier instances
contained the defect they were fixing, and three of the four above were caught by checks that
themselves had it — one written twenty-four hours after the lesson, by someone who had just written
the lesson down. **Knowing the shape is not the same as noticing it.**

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

### Delivery

**Issuance is recorded.** `comment_links` carries who issued it, when, to what address, and when it
expires. That record is what makes *"the merchant was invited"* a fact rather than a recollection,
and it is precisely what separates `not_invited` from `unopened` in the report — without it the
distinction would rest on someone remembering whether an email went out.

**The token is generated where it can be handed to the mailer and never persisted.** 32 bytes of
`randomBytes`, base64url; the digest goes to the database and the token goes into the email.

**Thirty days.** Long enough that a merchant with other priorities is not shut out — a storefront
operator asked to review a compliance document will not always do it this week, and a link that
expires before they reach it produces `unopened`, which reads as a silence they chose. Short enough
that it is not a standing credential: a bearer token opening a merchant's screening report should
not sit in an inbox for a year.

**Re-issue adds a link; it never extends one.** Extending would erase when the first was sent, to
whom, and whether it was opened — the record the `not_invited` / `unopened` distinction rests on.
Comments reference the link they arrived through, so **re-issuing disturbs nothing already
submitted**, and a schema test asserts it: after a second link is issued, the comment count is
unchanged and both links open the report. "Did they ever open it" is the earliest opening across a
run's links.

The cost of being wrong in the short direction is therefore one email, not lost commentary.

### The merchant's page shows the evidence

It renders `ReportView` — the same component the analyst sees and the PDF prints. Screenshots,
matched text, the requirement column, the coverage breakdown.

That is the reason a web page was chosen over a marked-up PDF, so a page reduced to a list of
findings with boxes beneath them would be **the PDF with extra steps**: it would invite a response
to a sentence rather than to the screenshot the sentence describes. `commentBox` is the only thing
the merchant's view adds to the report.

The box has no placeholder. A placeholder is a suggestion about content, and this box suggests
nothing.

### The invitation

Reader-facing text, audited by `copy.test.ts` for directive language and internal vocabulary like
any other report copy. It describes what Mintro could not observe and invites their account of it;
it never tells them what to do about a finding.

    "The crawl could not reach a page listing your accepted payment methods."   description
    "Please publish your payment methods."                                      advice

It also never characterises the observations — no "issues", "problems" or "concerns", which are
readings IQwallet makes. A test asserts their absence.

Four things it states plainly, because a merchant receiving this has no context for any of them:
what happens to what they write (recorded exactly, shown as theirs, passed on unedited), that
nothing they write changes what was observed, that findings with no box are **Mintro's gaps rather
than theirs**, and that a fresh link keeps anything already written.

### Copy written for one audience becomes an assertion about the reader when it moves

**2026-08-23 · found while building the merchant page, and not on the list.**

`MerchantResponse` is written for an underwriter. It exists to say what a blank space means:
*"the merchant has not opened the report"*, *"identified themselves as X, and left no comment on
it"*. Every word of it is careful, and it was rendering **on the merchant's own page**, telling the
reader finding by finding that they had left no comment — on a page whose one rule is never to
imply that saying nothing is a failure (D-067).

The general form, which is why this sits in D-063 rather than in a commit message:

> **Copy written for one audience becomes an assertion about the reader when it moves to another.**
> A sentence *about* someone, read *by* that someone, is a different sentence.

Nothing was wrong with the words. They were correct, carefully hedged, and D-001-compliant in the
document they were written for. The defect was entirely in who was reading them, which no copy
audit can detect — `auditCopy` and `auditInternalVocabulary` both pass on that text, and should.

It reached the merchant page because that page reuses `ReportView`, which is the right decision:
one component means the merchant comments *while looking at the same evidence* IQwallet sees. Reuse
carries copy across audience boundaries silently, and the boundary is invisible in the component
tree.

**What to check when a component is reused for a second audience**: not whether its copy is
accurate, but whether any of it is *about* the new reader. Descriptions of delivery, of silence, of
what someone did or did not do — those are the sentences that change meaning when the subject
becomes the audience.

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

---

## D-044 — Three reasons a rule went unevaluated, not one
**2026-08-22 · Frank's ruling, corrected in discussion**

The report had one `not_evaluable` state and rendered every use of it identically. Three
unrelated facts were arriving in one pile, and the reader had no way to separate them:

| | What it means | Whose limitation |
|---|---|---|
| **No check built** | Mintro has not written this check | **Ours** |
| **Not reachable** | No crawl of a public website could answer it | Nobody's — it is the nature of the question |
| **Not exposed** | The check ran; the site did not carry what it looks for | The merchant's storefront |

### The correction that produced this

The sign-up and checkout findings were being read as uncrawlable. They are not. Those are
ordinary pages a browser loads. They are unevaluated because **the Layer 3 runner was never
built** — and the report presented that identically to "order records are server-side", which is
genuinely unanswerable from any website.

Reporting our own unbuilt work in the same words as a merchant's inherent invisibility overstates
what was screened and understates what Mintro owes. On the swisschems run it was 12 findings
described as though the site had withheld something.

### The numbers that were missing

    51 of 97 findings evaluable from this crawl · 10 need a surface no crawl reaches

Two numbers, 97 findings. **36 were unaccounted for** — present in the data, counted nowhere the
reader could see. `computeCoverage` had a `notObserved` field and no renderer printed it. Every
bucket is now printed, and `coverage.test.ts` asserts the parts sum to the total: a coverage line
whose numbers do not add up is worse than none, because it looks complete.

### A fourth bucket, found in the data

Classifying the 46 real `not_evaluable` findings turned up a fourth kind that is not a coverage
shortfall at all:

    12  no check built        Mintro's gap
    10  not reachable         the ten manual rules
    14  not exposed           looked for, not found on this storefront
    10  not applicable        the rule's subject is not on the page

"Capsule labelling" against a product that is not a capsule, or "proper chemical names" on a page
carrying none of the compounds the rule names. Nothing was missed and nothing is owed. Folding
these into "the site did not expose it" would have overstated the shortfall by ten — the same
error this decision exists to fix, one bucket further down.

It is recorded as its own kind and rendered as its own section.

### Resolved and outstanding, not one flat shortfall — Frank's ruling

**`not_applicable` is excluded from the shortfall and stays visible.**

The coverage line answers one question: *how much of the rule set could this crawl speak to?* A
rule whose subject is not present **has been fully resolved** — the honest answer is "does not
apply here", not "we could not tell". Leaving it among the shortfalls understates the tool and,
worse, makes the real gaps look smaller by comparison.

So the line is two halves, and the swisschems run reads:

    61 of 97 resolved (51 evaluated, 10 do not apply here)
     · 36 outstanding (12 not checked — Mintro has not built these yet,
                       10 need a surface no crawl reaches,
                       14 looked for and not found on the site)

All five buckets stay itemised, `unrecorded` included. `resolved + outstanding === total` is
asserted, as is the older bucket-by-bucket sum: two independent statements of the same closure,
because this is the line that looked complete while omitting 36 findings.

`resolved` and `outstanding` are computed in the engine beside the rest of coverage, not in the
renderer. A renderer that derived the split could get it wrong quietly, and the PDF and the screen
would then disagree about how much of the merchant was screened.

An unrecorded reason counts as **outstanding**: a run that never wrote down which kind applied
cannot be said to have resolved anything.

### The kind is declared, never inferred

`notEvaluable()` takes a required `kind`. No default: a default would be a guess made on behalf
of 29 call sites by whoever wrote the function, which is how the three got conflated in the first
place. Nothing pattern-matches the reason text to classify it — that would be locating the
subject by its wording (hard constraint 9), and every finding would silently reclassify the next
time someone rephrased a sentence.

Runs recorded before this carry no kind. They get a fifth bucket, *"Reason not recorded"*, and are
never guessed into one of the four. Those runs are immutable (D-002); the honest thing to tell a
reader is that the distinction was not recorded.

### Plain English, and it is not a separate concern

An underwriter was reading:

> no layer 3 runner has been built for check type 'dom_assert', so this rule was not examined

Every word of that is internal vocabulary. It now reads:

> Mintro has not built this check yet. It needs examining the page's fields, labels and controls,
> and nothing does that today — the merchant's site was not asked for it and withheld nothing.

**Plain does not mean vaguer.** The replacement names the work more specifically than the original
did, in terms of the merchant's website rather than this codebase's module layout. The last clause
is load-bearing: without it a reader who is told only that a rule "could not be evaluated" will
reasonably assume the site withheld something.

`INTERNAL_TERMS` and `auditInternalVocabulary` make this a build failure — check-type names, layer
numbers, and handler vocabulary. Kept as a separate list from `DIRECTIVE_TERMS` and asserted
disjoint, so a failure names the right constraint. `manual` is deliberately absent: it is an
ordinary English word as well as a check type.

The audit runs against a report assembled from the live rule set with no findings, so every rule
falls through the unrun path and the test cannot pass vacuously. Stored reports are audited too,
skipping findings with no kind — a pre-D-044 run has the old wording in an immutable record and
must not fail the build forever.

### Open question for Frank

Should `not_applicable` count against coverage at all? The line currently reads *"… · 10 do not
apply to these pages"*, which is honest but sits in a list of shortfalls. The alternative is to
exclude them from the total, so coverage reads against the rules that could have applied. That
changes what the headline number means and is a business decision.

---

## D-046 — Merchant explanation: a per-run link, and what it may never do
**2026-08-22 · Frank's ruling · scoping superseded by D-063**

> **Superseded in part.** D-063 widens commentary from bucket (b) to any finding. The link
> mechanism, the never-changes-a-state rule and the attribution requirement below all stand;
> only the bucket-(b)-only scoping is replaced. The reason for that scoping — that a merchant
> must not be asked to explain a check Mintro has not written — survives in D-063 as an
> exception rather than as the scope.

A free-text field per finding where a merchant, or their agent, responds to something **no crawl
can reach**. Called *Merchant explanation* — not "attestation", which is too legal, and not
"verification", which implies Mintro checked it.

### Bucket (b) only, enforced server-side

Offered on `not_reachable` findings and nowhere else. Asking a merchant to explain a check
**Mintro has not written** is indefensible, and until D-044 the system could not have told the two
apart. It can now: the kind is declared on the finding, so the restriction is a property of the
data rather than a rule someone remembers.

**The restriction is enforced where the response is accepted, not by which fields the form
renders.** A form that simply omits the other findings is a UI convention; a server that refuses
them is a guarantee. This is the same reasoning as the insert policy in `0014`.

### It never changes a finding's state

`not_evaluable` stays `not_evaluable`. The explanation appears beside the gap, visually distinct
from observed evidence, attributed as the merchant's own words with a timestamp.

This is what keeps D-001 intact. **We record what they said. We do not endorse it, and we do not
let it move a state.** A merchant explanation that could turn a gap into a pass would make Mintro
the party accepting the claim, which is IQwallet's decision to make.

### Delivery: a tokenised per-run link

A signed token, emailed to the merchant, scoped to one run and to that run's bucket-(b) findings.
It expires. No account, no password.

The two rejected options and why:

- **Analyst relays it.** Fails on attribution. The report would carry the merchant's words in the
  analyst's hand, and *"the merchant told us X"* through an intermediary is a materially weaker
  record than the merchant writing it.
- **Merchant accounts.** Makes Mintro a system merchants log into — a different product and a far
  larger surface than this needs.

### The three questions, answered

**Who is the merchant.** Whoever holds the link. Identity is not modelled beyond the token, and
the record says exactly what it can honestly claim: *received via the link issued for this run*.
Anything stronger would be an identity assertion the mechanism does not support — the same defect
as a session validated by the absence of a login form (D-026).

**Ownership.** It belongs to the **run**, and is frozen with it. A packing-slip explanation given
in August is not evidence about a January re-scan. Carrying it forward would make a stale
statement look current, which is the shape of nearly everything this project has had to fix.

**Revision.** Append-only, every version kept and visible with its timestamp (D-002). A merchant
may add; nothing is overwritten. If IQwallet has read version one, version one stays readable.

### Not built yet

Sequenced after the report presentation work and after Layer 3. It depends on bucket (b) being
structurally identifiable, which D-044 has now made true.

---

## D-047 — The report reads as a document, and the run library replaces the picker
**2026-08-22 · Frank's ruling**

Four changes to how the report presents itself. They are one decision because they trade against
each other, and the trade was measured rather than guessed.

### Each finding stated its observation three times

The note appeared in the row heading, in the Observed column of the requirement pair, and again
in the evidence slip. The clause appeared twice — quoted in Program requirement, then repeated as
*"Rule."* in the slip. A run with three real findings ran to 33 pages.

It is now stated **once**:

- **Observation** — the Observed column of the requirement pair. The row heading keeps it only
  while the row is closed, where it is a summary of something hidden. A `pass` has no requirement
  pair (D-041: a satisfied rule quoted back at the reader is noise), so for passes the row keeps it.
- **Clause** — the Program requirement column. The slip keeps it only for passes, for the same reason.
- **Not-evaluable reason** — the Not assessed column. The slip keeps the **requests attempted**,
  which nothing else carries and which hard constraint 3 requires of a `not_evaluable` finding.

The D-041 pairing is untouched. What was removed is repetition, not either half of the pair.

Verified against the real print path rather than asserted — the swisschems run, rendered:

    findings in the DOM      97      every finding, individually
    collapsed findings        0      nothing hidden in the export
    requirement blocks       69      = the non-pass findings
    row notes                28      = the passes, exactly
    slip notes                0      was one per finding
    rule refs                 0      was one per finding
    observation stated once per finding: 97 of 97

69 + 28 = 97. Every finding states its observation exactly once, and none states it twice.

### Capture size costs pages, and the cost is measured — do not re-litigate it blind

Both were asked for, and in the PDF they are in direct tension: there are 66 captures in a real
run, and a page has a cost the screen does not. Measured on the swisschems run:

    capture 148px / 180px cap, note stated three times     70 pages   (before)
    capture 148px / 180px cap, note stated once            47 pages
    capture 240px / 280px cap, note stated once            67 pages
    capture 360px / 520px cap, note stated once            85 pages

**Deduplication is worth 23 pages.** Spending part of it on a capture 62% wider leaves the export
at 67 pages — shorter than it was *and* more legible. Spending all of it would have made the PDF
longer than the document this set out to shorten.

The screen has no pagination cost, so it takes the larger capture: a column that grows to 520px
against a 460px cap, where the 148px thumbnail had made the one thing a reader needs to look at
the smallest element on the row.

**Anyone changing the print capture size should re-run the measurement, not estimate it.** The
numbers above came from `node apps/worker/dist/bin/report-pdf.js swisschems.is --out out`, which
prints the page count and the resolved-capture ratio for a real 97-finding run. The relationship
is not linear in the obvious way — 66 captures each gaining a little height crosses a great many
page boundaries at once.

### The screen matches the PDF because it was never a design difference

The PDF read better, and the cause was width and density, not styling — print sets
`max-width: none` while the screen was capped at 1120px, squeezing a two-column requirement pair
into what was left. The cap is now 1360px, and the requirement pair and capture sit side by side
as they do on paper. Same component throughout; no second rendering stack (ARCHITECTURE.md).

### The run picker is gone

The `<select>` of past runs is removed from the scan form. **That control is where the D-045 bug
lived**, and not incidentally: a dropdown shows one option at a time, so a selection that had
silently gone stale was indistinguishable from a current one and could not be compared against
the alternatives without opening it.

**Past reports** is now a real view — every run at once, sortable by merchant, by date and by
outcome, with nothing pre-selected. There is no selection state left to go stale.

`resolveRunSelection` went with it. It was a correct fix, tested, and it guarded a control that no
longer exists; leaving it would be dead code implying a picker that is gone. The half of D-045
that makes the behaviour correct — watching the request id — is untouched, and its tests remain.

Sorting is pure and tested. Ties break on domain then run id so the order is total: an unstable
sort would reshuffle rows between renders and make two runs of one merchant swap places under the
reader. A run that never finished sorts **last** under newest-first rather than first, since
treating "no date" as newest would bury the real runs beneath one that produced nothing.

**Recent requests** keeps five, each with a timestamp, each linking to the run it produced **by run
id** — never "the newest report for this merchant", which is the substitution D-045 was about and
which a convenience shortcut is the easiest place to reintroduce.

### A pre-D-044 report renders its own coverage honestly

Found by rendering a stored run rather than by review. The new coverage line read:

    " of 97 resolved (50 evaluated)"

A run recorded before D-044 has no `resolved` in its stored `coverage`, and never will — the
report is immutable (D-002). The blank was the D-044 defect reappearing in the fix for it.

Those reports now render what they actually recorded, and say the rest was not written down:

    50 of 97 evaluated · 47 not evaluated — this run was screened before Mintro separated
    the reasons, so which applies was not recorded

It does not reconstruct the split from the finding text. The wording is all that survives, and
classifying by wording is precisely what D-044 forbids. **A number the run never recorded is not
one this report gets to infer.**

---

## D-048 — Layer 3, stage 1: the sign-up form and the terms document
**2026-08-22 · built and validated against the five storefronts**

The first stage of the layer STATUS.md had never listed. Three rules move out of "Mintro has not
built this check" (D-044): GATE-004, GATE-005, GATE-007.

### Results, all five storefronts

    storefront                 GATE-004          GATE-005          GATE-007          unbuilt  resolved
    swisschems.is              n/a not_exposed   n/a not_exposed   REVIEW                  9     64/97
    peptidesciences.com        n/a not_exposed   n/a not_exposed   n/a not_exposed         9      4/53
    biotechpeptides.com        n/a not_exposed   n/a not_exposed   REVIEW                  9     69/97
    corepeptides.com           n/a not_exposed   n/a not_exposed   REVIEW                  9     71/97
    sportstechnologylabs.com   REVIEW            REVIEW            PASS                    9     73/97

GATE-002 `fail` and GATE-003 `pass` are unchanged on every storefront. Layer 3 runs before the
gate block, takes no part in it, and `layer3Rules` selects on surface — neither gate rule declares
one (D-039).

### Locating the form: by its password field, and only if it creates an account

A sign-up form is located by containing a password input. Every alternative — a heading, a URL, a
class name, the submit button's text — is prose the merchant chose, and a form found by matching
"Create account" is missed on a site that says "Join the lab" (hard constraint 9).

**That was not sufficient, and the real storefronts proved it.** The first draft took the largest
form carrying a password field. On a WooCommerce `/my-account/` page that is the **sign-in** form,
because "Remember me" makes it three controls to the register form's two. swisschems.is duly
reported:

> The sign-up form at https://swisschems.is/my-account/ carried 1 checkbox(es), none of them
> required: "Remember me"

An observation about a page nobody had looked at. The fix establishes account creation
**positively** (D-026), never by the absence of a sign-in marker:

- `autocomplete="new-password"` — the standard token for a password being created; sign-in fields
  carry `current-password`.
- two or more password fields — a password-and-confirm pair, which only account creation asks for.

Neither is merchant prose. A form matching neither is **not** assumed to be a registration form:
the finding is `not_evaluable`, naming the page that came closest and what was wrong with it.

Four of the five storefronts land there, and it is the correct answer —
`biotechpeptides.com/my-account/` serves exactly one `current-password` field and no
account-creation form at all.

### GATE-005 never returns `pass`, deliberately

It can establish structurally that a field exists and that it is required. It cannot establish
that a field *asks about research status* without reading its label — and a check that read labels
would miss every merchant who worded it differently, which is the population the rule exists to
find.

So it reports the form and a person decides. The finding distinguishes the cases that matter — a
required field beyond the account set, such a field present but optional (which is exactly what
the clause prohibits), or only account fields — and **names every field either way**, so a reader
sees what the form asked for rather than what this code recognised. Same posture as OFFS-006
(D-020).

The account-field baseline is deliberately **generous**, including `organization`. GATE-005
expects presence, so a narrow baseline would read an ordinary "Company" box as the research field
and produce a false `pass`; a generous one produces a review with the whole form quoted, which is
the safe direction for a rule a person resolves.

GATE-004 can pass, and the split is the point: **the structure decides whether a required checkbox
exists**, and wording only decides whether the finding passes or goes to a person. A merchant whose
required checkbox reads "I confirm I have read the conditions of sale" is surfaced with their own
wording, not missed.

### A redirect to the site root is not a terms document

Found on peptidesciences.com, which answers its terms candidates with a redirect to `/`. The first
draft accepted it — 200, and more than a few hundred characters — and GATE-007 reported:

> 5 of 5 required phrases were not observed: 'research use only', 'human consumption', 'diagnos',
> 'indemnif', 'qualified'

about the **homepage**. A review finding against a document nobody looked at is worse than no
finding, because it reads as a fact about the merchant's terms. A request that ended at the root
did not reach a terms document, whatever status it returned — `http_probe`'s redirect rule (D-026)
applied to a document fetch.

`terms` also had to join `RENDERED_SURFACES` in `checkTextMatch`; without it GATE-007 reported
`no_check_built` while the document sat fetched and unread. The four storefronts that do publish
terms return 9,500–13,900 characters, so the 400-character floor is a themed-404 guard and not a
measure of completeness.

### Discovery is not the same problem as location

Hard constraint 9 governs locating the *subject of a check*. Finding the sign-up *page* is a
different problem with no structural answer — a registration page is reached by a link or a
conventional path, and both are prose. So the worker tries a list of candidates and **records
every attempt and what it returned**; when none yields an account-creation form the result is
`not_evaluable` evidencing the attempts, never "the merchant has no sign-up form". That is hard
constraint 3 applied to a negative.

### Politeness

Every Layer 3 navigation goes through the same `Pacer` as the rest of the crawl, so a declared
`Crawl-delay` is honoured across the whole run rather than per layer (D-013). This stage adds up
to eight register candidates and seven terms candidates to an origin already being crawled, and
stops at the first that answers.

### What remains unbuilt

Nine rules, down from twelve:

    PAY-001, PAY-002, PAY-003    payment page          stage 2
    FULF-001                     shipping policy       stage 2
    COMM-001                     FAQ                   stage 2
    FULF-002                     checkout flow         stage 3
    COA-002, COA-003, COA-004    COA documents         stage 4

`not_exposed` on GATE-004 and GATE-005 for four storefronts is **not** a gap in Mintro. Those
sites do not publish an account-creation form the crawl can reach, and the finding says which page
came closest and what was on it.

---

## D-049 — Layer 3, stage 2: payment, shipping and FAQ
**2026-08-22 · built and validated against the five storefronts**

Five more rules leave the unbuilt bucket: PAY-001, PAY-002, PAY-003, FULF-001, COMM-001. Unbuilt
falls from nine to four.

### Results, all five storefronts

    storefront                 PAY-001           PAY-002           PAY-003   FULF-001          COMM-001
    swisschems.is              n/a not_exposed   n/a not_exposed   PASS      PASS              PASS
    peptidesciences.com        n/a not_exposed   n/a not_exposed   REVIEW    n/a not_exposed   n/a not_exposed
    biotechpeptides.com        n/a not_exposed   n/a not_exposed   PASS      REVIEW            n/a not_exposed
    corepeptides.com           n/a not_exposed   n/a not_exposed   PASS      REVIEW            n/a not_exposed
    sportstechnologylabs.com   n/a not_exposed   n/a not_exposed   REVIEW    n/a not_exposed   PASS

    storefront                 unbuilt  unreachable  not-exposed  n/a-applies  resolved
    swisschems.is                    4           10           16           12     67/97
    peptidesciences.com              4           10           34            0      5/53
    biotechpeptides.com              4           10           12           13     71/97
    corepeptides.com                 4           10           10           13     73/97
    sportstechnologylabs.com         4           10            8           14     75/97

GATE-002 and GATE-003 are unchanged on every storefront.

### Landing somewhere is not reaching checkout

The third instance of the same defect in two stages, and the one that would have done the most
damage.

swisschems.is answers `/checkout` with a redirect to `/shop/`; corepeptides.com's checkout control
goes to `/cart/`. The first draft reported both as "the checkout surface was read", and **PAY-001
then measured a product listing page for peer-to-peer payment terms** — an absence observed on a
page that was never the surface the rule names, on a `critical` `auto_fail` rule.

Established positively: the page is a checkout surface when its path names checkout, or when it
collects what checkout collects — `cc-number`, `cc-exp`, `street-address`, `postal-code`, a
payment container. Neither is merchant prose.

A compliant merchant gates checkout, so this returns "not reached" for them, and that is the
honest answer: you cannot observe which processor is used on a payment surface an anonymous
visitor is never shown. sportstechnologylabs.com is exactly this case — its checkout redirects to
`/my-account/`, which is the behaviour GATE-003 rewards.

### PAY-001: absence across half a surface is not absence

The rule declares `checkout_and_footer` — both — and is `critical`, `auto_fail`, `expect: absent`.
A `pass` states that these payment methods are not offered.

So a term observed on **either** surface fails the rule immediately; a positive observation stands
on its own and is not weakened by the other half being unread. Absence is the opposite: with
checkout unreached, this reports `not_evaluable`, naming the half that was read and why the other
was not. All five storefronts land there.

### PAY-002 never says no processor exists

Processors are recognised by the host their SDK loads from — `js.stripe.com`, `braintreegateway.com`
— which is structural, where a footer reading "Visa · Mastercard" is prose that can sit behind no
processor at all.

The list is necessarily partial, so "none recognised" is a statement about **this code's list**.
The finding names every third-party host the checkout page loaded from, so a processor not on the
list stays visible to the reader instead of being reported as absent (hard constraint 9, D-018).

### PAY-003 reads the footer, because that is what it declares

`linkTextFinding` scanned the whole page. PAY-003 declares `surface: footer` and expects presence,
so a "Returns" link in the header would have satisfied a rule about the footer — a wider search
producing a `pass` the declared surface does not support. Scope now follows the rule's declared
surface, and the finding names which was examined. OFFS-007 declares `homepage` and is unchanged.

### The gate rules keep their own flow

Layer 3 reads checkout with a **second, separate** run of the same shallow probe. Sharing one
observation would make a Layer 3 concern an input to GATE-003, which D-039 forbids. The cost is
one extra add-to-cart per scan, paced like every other request (D-013).

### Open question: PAY-001 may be unanswerable as specified

Checkout was unreachable anonymously on **all five** storefronts, and on a compliant merchant it
always will be — gating checkout is what GATE-002 and GATE-003 ask for. A rule whose surface
includes checkout therefore cannot resolve for precisely the merchants who comply.

That is a rule-set question, not an engine one. The options are to rescope PAY-001 to the footer
and any pre-login payment page, or to accept that it resolves only for merchants who do not gate.
Either is a business ruling and neither is taken here.

### What remains unbuilt

    FULF-002                     checkout flow, PO boxes    stage 3
    COA-002, COA-003, COA-004    COA documents              stage 4

---

## D-049 amendment — PAY-001 rescoped, and it immediately caught something
**2026-08-22 · Frank's ruling**

PAY-001's surface changes from `checkout_and_footer` to `footer_and_public_pages`: the footer
plus any payment or policy page reachable without an account. Rule set to 2.5.0.

**The rule was inverted, not merely unimplementable.** As written it resolved only for merchants
who *fail* GATE-002 and GATE-003 — a merchant who gates checkout, which is exactly what those
rules require, has no checkout an anonymous crawl can read. All five storefronts returned
`not_evaluable`. A rule that can only speak about non-compliant merchants cannot do its job.

**Peer-to-peer payment rails are advertised, not hidden.** A merchant taking Zelle says so where
customers can see it; the footer and the public policy pages are where that appears. A gated
checkout is not where it hides.

The finding names the surfaces examined and states that a checkout behind a sign-in was not among
them (D-018).

### It found one on the first run

    FAIL PAY-001: Observed on the payment or refund policy (https://swisschems.is/payments/):
    Zelle. 5 public surface(s) were read: the homepage footer, the terms document, the shipping
    policy, the FAQ, the payment or refund policy.

swisschems.is publishes a `/payments/` page offering Zelle. Under the old surface this was
`not_evaluable` on every run and would have stayed invisible. PAY-001 now resolves on four of the
five storefronts, having resolved on none.

**PAY-002 is left alone.** Detecting a processor genuinely needs the checkout page, and reporting
`not_exposed` for a merchant who correctly gates it is honest. Flagged for the N/A review as a
rule that may need the same treatment.

---

## D-050 — Findings that describe the same observation
**2026-08-22 · Frank's ruling**

GATE-002 failing while GATE-004 and GATE-005 find no reachable sign-up form is not two findings.
It is one fact seen from both ends: products served to anonymous visitors, **and** no reachable
way to create the account the program requires. A reader had to notice that unaided.

### The report shows the pair and says nothing about it

Two findings side by side under **"Findings that describe the same observation"**, each quoting
what it observed. No connector, no arrow, no summary line.

An earlier draft ended each entry with a sentence naming what the two had in common — *"both
concern whether an account is required"*. That is a small step and it is still Mintro saying what
the pair means. The whole posture is that we show and IQwallet concludes (D-001), and adjacency
conveys it without us saying it. The `SameObservationPair` type has nowhere to put a
characterisation, and a test asserts its field list so adding one has to confront this.

The heading is deliberately not "corroborating", which would assert that the findings support
each other. Whether they do is IQwallet's call.

### Declared in the rule set, never inferred

A `corroborates` field on the rule, listing rule ids. An engine that noticed findings "going
together" would start finding coincidences; each pair is a ruling with a decision number behind
it. `invariants.ts` requires that every named rule exists and that **the relation is declared on
both** — the report renders the pair on both findings, and which one a reader opens first is not
something the rule set gets to decide.

### Which findings may take part, and a correction to the ruling

`pass` never takes part: a satisfied rule needs no second angle.

The ruling as given was "both findings must be non-pass and **both actually evaluated**". Taken
literally that would have excluded the case this was built for — GATE-004 and GATE-005 are
`not_evaluable` on four of the five storefronts, because those merchants publish no reachable
account-creation form. The feature would never have fired on the pair that motivated it.

D-044's kinds draw the line the ruling intended:

- **`not_exposed` takes part.** The check ran, the site did not carry what it looks for, and the
  attempts are on the record. That is an observation about the merchant.
- **`no_check_built` never does.** A fact about Mintro. Pairing it would present our own unwritten
  check as corroborating something about their storefront.
- **`not_reachable` never does.** Nobody looked, so nothing was observed — the "significance from
  a double absence" the ruling was guarding against.
- **`not_applicable` never does.** The rule was resolved, not observed.

### Observed on the five storefronts

Pairs fire on swisschems.is and sportstechnologylabs.com — the two where GATE-002 fails — and on
neither of the three where it passes. Both cases are exactly the shape described: products public,
and either no reachable sign-up form (swisschems) or one lacking the acknowledgement and research
field (sportstechnologylabs).

---

## D-051 — Merchant screening accounts are authorized, with one condition
**2026-08-22 · Frank's ruling**

Merchants will either supply a screening account or permit Mintro to create one. **This supersedes
the blocked credential-authorization item in STATUS.md** — the question D-026 recorded as the
blocking one for assisted sign-in is answered.

### The condition, and why it is not a detail

"Permit us to create one" requires the **program terms to say so explicitly**, because creating an
account is not a passive act. Every merchant sign-up form this project has read asks the applicant
to affirm something — the terms checkbox GATE-004 looks for, the research-status field GATE-005
looks for. Creating an account means **Mintro affirming qualified-researcher status to the
merchant's own terms**, on Mintro's behalf, as a condition of screening them.

Blanket permission at onboarding does not cover that unless it says so. Frank is adding the
language.

**Until it exists, build against merchant-supplied credentials only. Do not create accounts.**

That is the state D-038 and D-039 already built for: a merchant deposits credentials, the worker
seals them, and an anonymous crawl escalates only where the sampled product pages come back
unserved. Nothing in that path creates anything.

---

## D-052 — A rule that resolves by lowering what it asks
**2026-08-22 · Frank's ruling, restated around the operative test**

PAY-002 becomes merchant-explanation-only. The reasoning generalises, and the generalisation is
the part worth keeping.

### The test

> **A rule that resolves by lowering what it asks is worse than one that reports it could not
> look.** PAY-001 was the opposite case — the surface was wrong, not the question. The test is
> whether a different surface answers *the same question*.

**Corollary:** some program requirements are not observable from a public surface, and the honest
response is to report the gap and collect the merchant's account of it — never to weaken the
check until it resolves.

### Applying it to PAY-002

Detecting a payment processor requires reaching checkout. A merchant who **correctly gates
checkout** — which is what GATE-002 and GATE-003 require — never shows one to an anonymous
visitor, so the rule could only ever speak about merchants non-compliant in some other way. All
five storefronts returned `not_exposed` at stage 2, and sportstechnologylabs.com is the clean
illustration: its checkout redirects to `/my-account/`, the behaviour GATE-003 rewards, and that
redirect is exactly what stops PAY-002 seeing anything.

The tempting alternative was to let PAY-002 read payment-method logos in the footer. That would
have made the rule resolve everywhere while answering a different question: a footer showing a
Visa mark says nothing about which processor sits behind it, or whether that processor conducts
KYC. The surface is reachable; it does not answer what the rule asks.

### Applying it to PAY-001, which went the other way

PAY-001 (D-049) failed the same test in the opposite direction and passed on rescoping.
`checkout_and_footer` made it resolvable only for merchants who *fail* GATE-002 and GATE-003.
Moving it to the footer and the public policy pages did **not** lower what it asks — peer-to-peer
rails are advertised, and asking where they are advertised is the same question asked of a surface
that can answer it. It caught Zelle on swisschems.is the first time it ran.

**FULF-002 (D-055) is this ruling one rule over**: answering it requires transacting against a
live business, and no reachable surface answers the question instead.

PAY-002 joins the merchant-explanation set. COA-005 has been there since the beginning for the
same reason, and COA-005 is also the reminder that this is not a counsel of despair — a rule can
sit in that set permanently and still be doing work, by keeping the gap visible instead of absent.

## D-053 — The merchant explanation workflow
**2026-08-22 · Frank's ruling · extends D-046**

Mintro sends the request to the agent or merchant, they complete and return it, Mintro forwards
the report to IQwallet.

    Mintro  ──request──▶  merchant / agent
    Mintro  ◀──response──  merchant / agent
    Mintro  ──report with explanations included──▶  IQwallet

### Mintro is both sender and recipient

The tokenised link (D-046) goes out from Mintro and responses land back in Mintro. **IQwallet is
not a party to the exchange.** They receive a report with explanations already in it.

That has a consequence worth stating: Mintro holds the merchant's words before IQwallet sees them,
and must pass them through unaltered. The explanation is recorded verbatim, attributed, and
timestamped — D-046 already forbids it changing a finding's state, and this adds that it must not
be summarised or excerpted on the way through either.

### A report may be sent with explanations outstanding

Sending is never blocked (D-001), and waiting for a merchant to reply is a blocking condition in
everything but name. So a report can go with requests unanswered.

**The report must therefore distinguish three states, not two:**

    requested and answered     the merchant's words, attributed and timestamped
    requested and unanswered   asked on <date>, no response at the time of sending
    never requested            no request was made

Collapsing the last two would let "we did not ask" read as "they did not answer", which is a
statement about the merchant derived from Mintro's own inaction. It is the same shape as D-044:
a gap of ours presented as a gap of theirs.

**This reason is a correction to the ruling, not a restatement of it.** The three states were
specified without it, and without it the third looks like bookkeeping — a nicety about request
tracking. It is not: it is D-044's distinction appearing in a new place, and the same argument
that separated "Mintro has not built this check" from "the site did not carry it" separates
"we did not ask" from "they did not answer".

### The request describes; it never instructs

The request tells the merchant **what Mintro could not observe**. It does not tell them what to do
about it, what to change, or what IQwallet expects — the same constraint the report itself is
under (hard constraint 7, D-001). "The crawl could not reach a page listing your accepted payment
methods" is a description. "Please publish your payment methods" is advice, and Mintro does not
give it.

### Not built

Sequenced after Layer 3. D-046 records the mechanism; this records the flow around it.

---

## D-054 — A surface must be established, not arrived at
**2026-08-22 · Frank's ruling**

One defect, found six times, in three mechanisms. Guidance was tried after the second and a
special case after the third; both failed. What remains is making the wrong thing
unrepresentable.

    1  a WooCommerce sign-in form read as the sign-up form — both carry a password field
    2  a redirect to `/` accepted as the terms document — 200, and plenty of text
    3  a redirect to `/shop/` accepted as the refund policy, after the fix for (2) rejected
       only the site root — a special case of the rule, not the rule
    4  a "Return to shop" cart link accepted as the refund policy, on link text alone
    5  `/shop/` accepted as the checkout surface, because the flow landed there
    6  `/shop/` reported by the checkout flow as "stopped at checkout, no payment field
       observed" — which made GATE-003 pass a merchant offering guest checkout

**(3) is the reason this is a type.** After (2) the general rule went into `ARCHITECTURE.md`; the
code got a narrow guard rejecting the site root. Each check located its own surface, so the fix
landed in one call site and the next surface began again from nothing.

### `Located<T>` has no variant carrying an unverified page

    type Located<T> =
      | { located: true;  value: T; url: string; how: string }
      | { located: false; reason: string; attempts: readonly FetchAttempt[] }

`how` is required, not optional. It records **what established this**, and a locator that cannot
name one has established nothing. A handler physically cannot receive a page nobody verified,
because there is no field to put it in.

`unreachable` carries its attempts, so hard constraint 3 holds by the shape of the type rather
than by each caller remembering to attach them.

### Every guard runs in the locator

`apps/worker/src/locate.ts` is the only place a surface is established, and it applies all four
guards together:

- the request ended at what it asked for — the general rule, not "not the root"
- the candidate's own path names the surface, so link text alone cannot select it
- the page rendered more than a themed 404's worth of content
- the surface's required positive signal is present

There is no code path from a candidate to a handler that skips one. Adding a surface means adding
a `SurfaceSpec`, not adding guards.

### Sequenced before stage 4 on purpose

`doc_parse` is where this is worst: a PDF fetch that accepts an HTML 404 would report an empty
certificate as fact, and a certificate is the document an underwriter is least able to check.

---

## D-055 — FULF-002 is not observable from a public surface
**2026-08-22 · Frank's ruling**

FULF-002 — "No PO boxes" — moves from `flow_probe` to `manual`, joining the ten rules the report
already reports as needing a surface no crawl reaches.

Answering it requires entering a PO box address at checkout and seeing whether the merchant
accepts it. That means **submitting data to a live business**, which the flow probe refuses on
principle: it fills nothing and submits nothing, because going further would be transacting
against a real store.

What a crawl *can* see is whether the checkout address form constrains destinations. That is a
fact about a form, not about fulfilment practice — a merchant may accept free-text addresses and
catch PO boxes in manual review, and a constrained form may still be bypassed. Reporting it as
FULF-002 would answer an easier question while appearing to answer the rule's.

It joins the merchant-explanation set, for the same reason the other ten are in it: the honest
response to a requirement no public surface exposes is to report the gap and record the
merchant's account of it.

**The adjacent observation is not built.** "The checkout address form constrains destinations" is
a different question and needs its own rule id and its own ruling — after the N/A picture has been
looked at whole.

---

## D-056 — The flow probe concluded from absence, and passed merchants who offer guest checkout
**2026-08-22 · the most consequential defect found in this project**

GATE-003 reported `fail` on one swisschems.is run and `pass` on the three either side. Two
immutable runs of one merchant would disagree and, under D-002, neither could be corrected.

### It was not flakiness, and it was not caused by stage 2

The gate flow alone, with no Layer 3 code in the path, over 12 runs:

    checkout               10        <- pass
    payment_step_reached    1        <- fail
    not_started             1

### The mechanism

WooCommerce adds to cart over **AJAX**. `clickFirst` returns when the click lands, and
`waitForLoadState('domcontentloaded')` resolves immediately afterwards because no navigation
happens. The flow reached `/checkout` with an empty cart; swisschems.is answers that with a
redirect to `/shop/`; no payment field on a product listing.

And then the part that made it a verdict: `runCheckoutFlow` returned `checkout` **from wherever
it was standing**. So a product listing was reported as *"it stopped at 'checkout'"*. GATE-003 is
`fail_if: payment_step_reached`, so that read as a **pass**.

> A `critical`, `auto_fail` rule — the rule asking whether anyone can buy without an account —
> passing roughly nine runs in ten on a merchant whose guest checkout reaches a card field.

The truth, with the cart confirmed populated: `/checkout/` serves `input[autocomplete="cc-number"]`
on **8 runs out of 8**. swisschems.is fails GATE-003.

### Two fixes, and the second is the general one

**The cart is established by asking the store.** Shopify's `/cart.js`, WooCommerce Blocks'
`/wp-json/wc/store/v1/cart`, or the *rendered* cart page linking to the product. Never inferred
from a click having landed.

The first attempt at this fetched the cart page's HTML and looked for the product slug — and
reported "empty" on a store whose checkout demonstrably worked, because modern WooCommerce serves
the cart as a block that fills itself after load. **Fetching the markup is not the same as seeing
the page**, which is the same lesson one layer down.

**The flow reports a stage only when it can establish where it stands.** A new stage,
`unestablished`, exists because the old code had no way to say it: a flow that navigated somewhere
it cannot identify has observed nothing about checkout, and `checkFlowProbe` turns it into
`not_evaluable` naming what was reached instead.

Frank's original instinct was to detect instability by repetition. That would have caught this one
incidentally; positive establishment catches the class, including the next race nobody has found.

After the fix, 8 runs of 8 report `payment_step_reached`. Stable, and correct.

### Quarantine: the first for a wrong conclusion, not unretrievable evidence

D-033 and D-034 quarantined runs whose **evidence could not be retrieved**. This quarantines runs
whose evidence was retrievable and whose **conclusion was wrong**. The distinction matters for
anyone reading `run_quarantine`: those runs are not incomplete, they are misleading.

The test is how the finding reasoned, not what it concluded:

- a `pass` reasoning from *"redirected to a sign-in page"* **stands** — a positive observation of
  where the flow ended
- a `pass` reasoning from *"it stopped at 'checkout'"* **does not** — a conclusion drawn from the
  absence of a payment field on a page that was never established as checkout

The annotation says what is actually known: the flow may not have reached checkout, so the finding
may not describe what it appears to describe. **It does not assert those merchants fail
GATE-003.** swisschems.is is known to, because it was verified directly; about the others nothing
is known, and the annotation says so.

---

## D-057 — Layer 3, stage 4: reading a certificate of analysis
**2026-08-22 · built and validated against the five storefronts**

COA-002, COA-003 and COA-004 leave the unbuilt bucket. Nothing remains in it.

### What these findings may claim

**They report what a certificate states. They never report that it is genuine.**

COA-005 is `manual` because accreditation and authenticity cannot be established from a PDF and
forged COAs are a known failure mode. No finding here may quietly answer the question COA-005
exists to leave open, so the wording is always *"the certificate states 99.2% purity"* and never
*"purity is 99.2%"*. Every passing finding carries the limit explicitly — "the assay was not
repeated", "not a verification that the test occurred".

### No PDF library, and that is a new decision rather than an old one

`ARCHITECTURE.md` rules out a PDF library for **producing** the report: the worker already has a
browser and `page.pdf()` is the whole mechanism. That ruling is about generation and says nothing
about reading, so extraction is decided here: Node's own `zlib`, and nothing else.

The trade is deliberate and its limit is the point. `extractPdfText` reads a **digitally
generated** PDF — uncompressed or Flate-compressed content streams, which is what a lab's
reporting software emits. It reads nothing from a **scanned** certificate, which is an image of a
page with no text objects in it.

### The limit is safe in the only direction that matters

COA-002 and COA-003 are `critical` and `auto_fail`. An extractor that quietly returned "no purity
found" for a scan would fail a merchant whose certificate states 99.2%.

So **text that could not be extracted is `not_evaluable`, never an absent value**, and
`extractPdfText` distinguishes the cases rather than returning an empty string for all of them:
no content streams, none decodable, or decoded streams carrying no text objects — the last being
what a scan looks like.

The same discipline runs through the field readers:

- A **date** is read next to a date label, not taken as the first date in the document. A COA
  carries an issue date, an expiry, a print date and often a batch date, and picking the first
  would report one of those as the test date.
- An **ambiguous numeric date is refused.** `03/04/2026` is March 4th to a US lab and April 3rd to
  a European one; on an `auto_fail` rule a month's error either way could fail a compliant
  merchant, so it is `not_evaluable` rather than a guess.
- A **purity** figure is read near a purity or assay label. A moisture or impurity percentage read
  as purity would fail a compliant certificate.
- A **field COA-004 names that this reader has no pattern for** is reported as unimplemented, not
  counted as absent — our gap presented as the merchant's is exactly D-044.

### Establishing that a certificate is a certificate

Sequenced after D-054 because this is where that defect would have been worst. A storefront
serving its themed 404 with `Content-Type: text/html` to a `.pdf` request has not served a
certificate, and a parser handed that HTML finds no purity and no date.

**A content type is a claim the server makes; the `%PDF` magic number is the document itself**, and
that is what is checked. A themed 404 declared `application/pdf` is still not a PDF, and a
certificate served as `application/octet-stream` still is.

### The body is stored, not only the hash

Hard constraint 3. The bytes go to the evidence store under a new `coa` artifact kind, with the
SHA-256 beside them — stored as fetched, since a PDF is already compressed and gzipping it again
buys nothing. A hash proves a document has not changed; only the document shows what it said.

### One finding per rule, not one per page

A `doc_parse` rule is about the certificate, not about a page. Running it through the per-page
path would report the same document five times and make one observation look like five.

---

## D-058 — COA-002 asks when the certificate was issued
**2026-08-22 · Frank's ruling · a reading of the program document**

### The ruling

The clause says COAs must be *"updated at minimum every 60 days"*. **Updated means the certificate
was issued, not when the sample was drawn.** A merchant publishing a certificate reported 22 July
has updated their documentation as of 22 July.

> **Note for whoever owns the program document: this is an interpretation of it.** If "updated" is
> read as the assay date rather than the report date, this reverses.

### The param is renamed, and that is not bookkeeping

`extract: test_date` became `extract: report_date`, and `DOC_EXTRACTS` with it. Leaving the param
named `test_date` while the reader accepted a report date would be **the reader quietly answering a
different question from the one the rule names** — the failure D-052 is about, and the failure the
reader's original refusal correctly avoided.

`COA_FIELDS` keeps `test_date` and is deliberately not renamed alongside it. COA-004 asks what a
certificate *identifies*, and the program document names a testing date among those; COA-002 asks
how recently the document was updated. Two questions, and now two names.

The label set follows: `Date Reported`, `Date of Issue`, `Report Date`. `Date Received` and
`Sampled` are excluded — accepting those would answer an easier question while appearing to answer
this one.

One detail worth keeping, because it cost a debugging cycle: the first label pattern used
`report\b`, and `\b` does not fall between "report" and "ed", so it failed on the exact label the
ruling is about. `report(?:ed)?`.

### Numeric dates, disambiguated by their own value

`7/22/2026` is parsed. `03/04/2026` is still refused.

The distinction is not a preference about lab conventions: **22 cannot be a month**, so the field
order is determined by the number itself. Where both components are 12 or under, no disambiguation
is defensible on a document whose originating lab is unknown, and COA-002 is `critical` `auto_fail`
— a month's error either way fails a compliant merchant.

This passes the D-052 test: the same question, read from the same document, with nothing lowered.
It is **not** a widening of the reader to whatever format one certificate happened to use, which
is why year-first and both day/month orderings are handled by the same rule rather than by cases.

---

## D-059 — One vocabulary for what a certificate link looks like
**2026-08-22 · Frank's ruling**

COA-001 read `text_or_href_contains` from the rule set; the certificate fetch carried its own
wider list. Two lists answering one question is D-034's shape, and they diverged exactly as that
predicts.

On swisschems.is, in a single run:

    COA-001  REVIEW  "Nothing matching any of 'coa', 'certificate of analysis' was observed"
                     — on all five sampled product pages
    the fetch         requested two certificate links it had found on those same pages

Both accurate to their own vocabulary. A reader could reconcile neither, and COA-001's finding is
misleading in the direction that matters: *"no certificate link observed"* reads as *"this merchant
publishes no COAs"*, when what is true is that they publish them under a label COA-001 did not
recognise.

**One list, declared where COA-001 already declares it**, read by both through
`coaLinkVocabulary`. Widening it is now a rule-set change carrying a decision number (D-025), and
it changes both answers together.

The list widens to include `lab report`, `test results` and `independent test` —
`docs/ARCHITECTURE.md` has recorded since M2 that swisschems links its certificates as
"Independent Test Results", and the narrower list is what made that a known gap rather than a
fixed one.

### Earlier runs asked a narrower question

Rule set to 2.9.0. **A merchant reported under 2.8.0 or earlier as linking no certificate may link
one the earlier vocabulary did not recognise.** Those runs are immutable (D-002) and say what they
said; the version stamped on each is what tells a reader which question was asked.

### The disagreement feature is not built, and the reason is recorded

This was a candidate for D-050's inverse — a report surfacing two findings that appear to
contradict each other, without Mintro resolving which is right. It is not built, and this case
disqualifies itself:

> COA-001 and the certificate fetch are **not two rules**. The fetch is machinery serving
> COA-002/003/004. Surfacing their disagreement as a finding would dress up an internal
> inconsistency as an observation about the merchant — the feature's first use would have
> laundered our own bug.

**A report that surfaces our own bugs as merchant findings is worse than one that surfaces
neither.** Build the mechanism only if a genuine rule-versus-rule contradiction survives the
shared vocabulary.

---

## D-060 — Internal vocabulary is caught by shape, not by a list
**2026-08-22 · Frank's ruling**

D-044 added `auditInternalVocabulary` to keep Mintro's vocabulary out of reader-facing text. It
was a **list**: check-type names, layer numbers, handler words. It missed `batch_lot` in COA-004's
note, because a rule's own field names are not check types.

> **A guard that catches check-type names and misses snake_case identifiers will keep letting
> internal vocabulary through in whatever form it next takes. The shape is the tell, not the
> specific list.**

`auditInternalVocabulary` now flags any lowercase snake_case token as well as the named terms.
URLs are stripped first — a merchant's `/wp-content/uploads/COA_BPC-157.pdf` is their text quoted
back, not our vocabulary leaking, and failures nobody can act on are how a guard gets weakened.
The pattern is lowercase-only for the same reason.

### It caught something on the first run that the list never would have

    GATE-003: "The 'add_to_cart_then_checkout' flow reached 'payment_step_reached',
               which this rule treats as a violation."

A flow name and a stage name, verbatim, in a document an underwriter reads to decide on a
merchant. Not check-type names, not layer numbers — the list had been extended once for D-044 and
did not cover them. **The same failure in a new spelling, which is the whole argument for matching
shape.**

It now reads:

    "Adding a product to the cart and going to checkout reached a payment form, which this
     rule treats as a violation."

COA-004 likewise names *"a batch or lot number"* rather than `batch_lot`, and a field the reader
has no pattern for is reported as **Mintro's** gap — *"Mintro does not yet look for a testing
date"* — never counted among what the merchant failed to provide (D-044).

### Amendment — the tell is provenance, not shape

Shape was wrong too, and on its second run it proved it. `auditInternalVocabulary` flagged
`et_pb_column`, `et_pb_module` and `et_pb_text_inner` in DISC-002's finding on two storefronts.

Those are **Divi theme class names — the merchant's markup**, quoted as the evidence for where the
disclaimer was found. **A CSS selector is the evidence.** Rewriting it would destroy the finding's
backing, and a guard that fires on legitimate evidence is one people learn to suppress.

> The same lesson one level up from the ruling itself: **a guard matching form rather than origin
> keeps catching the wrong things.** `snake_case` is a shape our identifiers happen to share with
> a WordPress theme's. What distinguishes them is not how they look but where they came from.

So the audit takes what the finding recorded as the merchant's — `matchedValue`, `sourceUrl`,
`matchedUrls`, the URLs of attempts — and exempts any identifier appearing there.
`quotedFromEvidence` reads only fields the `Evidence` type defines as theirs: `matchedValue` is
documented as *"what was matched, verbatim"*.

### The exemption surfaced a defect in what we put in that field

GATE-003's violation evidence carried `matchedValue: "reached payment_step_reached"` — **our own
identifier, in the field the audit now trusts to be the merchant's.** It would have exempted
itself.

That is a defect in the finding, not a reason to distrust the field, and the fix runs both ways: it
misstated what `matchedValue` is *and* it would have hidden the very vocabulary D-060 exists to
catch. It now carries what was observed on the merchant's page — the last step of the flow, naming
the payment selector that was seen.

Anywhere our text ends up in a merchant-provenance field, this audit will stop catching whatever it
contains. That is the shape to watch for next.

### What this does not do

It does not make the copy plain by itself. A sentence can be free of snake_case and still be
written for the person who built the check. The audit is a floor: it fails the build on a shape
that is definitely wrong **and cannot be traced to the merchant**, and leaves the rest to whoever
writes the sentence.

---

## D-063 — Merchant commentary, on any finding
**2026-08-23 · Frank's ruling · supersedes D-046's bucket-(b)-only scoping**

Mintro's report goes to the agent or merchant **before** IQwallet. The merchant may comment on any
finding — to close a not-evaluable, to add context, or to dispute it outright. The combined
document reaches IQwallet.

### The posture

> **Mintro is a news reporter, not a talking head with opinions.** Two sources, one document.
> IQwallet and the bank decide.

Liability for the merchant's claims sits with the merchant. That is *why* their words are recorded
verbatim, attributed, and never edited, summarised or answered on the way through — a paraphrase
would make the claim partly Mintro's.

This supersedes D-046, which offered commentary only on bucket (b). The reason for that narrowing
— that a merchant should not be asked to explain a check Mintro has not written — survives as an
exception rather than as the scope. See below.

### A web page, not a marked-up PDF

**A PDF is cheaper to build and more expensive to run.** Someone at Mintro would transcribe the
comments by hand on every screening, which reintroduces the attribution problem this whole
arrangement exists to solve: a merchant's words retyped by Mintro are no longer plainly theirs.

The web page also means the merchant comments **while looking at the evidence** — the capture, the
matched value, the requests attempted — rather than at a flattened document that has lost them.

### Scope, deliberately small

One tokenised link, one report, a free-form box per finding, submit. **No merchant accounts, no
dashboard, no history across runs.** Widening any of those is a new decision.

The interface is exactly a text box: **zero validation, zero moderation, no character limits, no
structure, and no Mintro commentary on their commentary.** A merchant writes whatever they want or
nothing. `body` has no length constraint and is stored exactly as typed, including whitespace and
line breaks.

### Four things behind the box

**1. Attribution, carried by four signals rather than one.** If a reader cannot tell Mintro's
observation from the merchant's response, both parties lose the protection this gives — Mintro
appears to endorse a claim it never made, and the merchant's account appears to be a finding.

    a separate container, after the evidence slip and never inside it
    a named source on every block — "Merchant response", never implied by position
    a visible quotation, set off the way a newspaper sets a source apart from its reporting
    a timestamp and a plain line: recorded as received, not verified by Mintro

The typeface differs too — serif against the report's sans — because colour alone fails a reader
who cannot see it, and in a printed PDF a coloured border reads as a table rule. Amber, not violet:
violet is Mintro's colour throughout, and the one thing this block must never look like is
something Mintro said.

**2. Append-only and timestamped (D-002).** A revision is another row; both stay readable with
their times. If IQwallet has read version one, version one stays readable. Enforced by a trigger,
because `service_role` bypasses RLS.

**3. Empty is not unanswered — and there are four states, not two.**

    not_invited   commentary was not offered on this finding
    unopened      a link was issued and the merchant never opened the report
    no_comment    they opened it and wrote nothing here
    commented     their words, with their times

Collapsing `unopened` into `no_comment` lets *"we asked and they never looked"* read as *"we asked
and they declined"* — a statement about the merchant derived from a fact about delivery.
Collapsing either into `not_invited` lets Mintro's own inaction read as theirs. Both are D-044's
shape in a new place, and all four render distinctly.

**4. A disputed finding does not change.** Their statement sits beside it. A genuine remediation is
answered by a re-scan producing a new run, never an edit to an old one — and nothing in
`0016_merchant_commentary.sql` can reach `runs` or `findings`, which a schema test asserts by
comparing the stored report before and after a dispute.

### Which findings are offered — with one pushback

Fail, review and not_evaluable. **Not clean passes**, as ruled: a merchant has nothing to gain by
disputing a rule they satisfied, and a box under every pass invites noise for no gain. Agreed.

**Excluded, on a pushback Frank accepted: a `not_evaluable` whose kind is `no_check_built` or
`not_retrieved`.** The original ruling — fail, review and not_evaluable — was too coarse, and the
reason is not a rule but an argument:

> **Offering the box is the asking.** D-046 ruled that a merchant must not be asked to explain a
> check Mintro has not written. D-063 widens *which findings* may be commented on; it does not
> touch *whose limitation a finding describes*, and those are independent questions. A comment box
> beneath our own unbuilt check asks a merchant to account for our gap, and its presence says we
> think they have something to answer for.

The report already names both as ours (D-044). A box beneath them would contradict that in the
same document — the reader is told in one line that Mintro has not built this, and invited in the
next to hear the merchant's explanation of it.

Neither is about the merchant:

- `no_check_built` — Mintro has not written this check. D-046 ruled that asking a merchant to
  explain a check we have not written is indefensible, and D-063 widening *which* findings may be
  commented on does not touch that reasoning. **Offering the box is the asking.**
- `not_retrieved` — our request failed. Inviting a merchant to account for our timeout invites them
  to answer for our infrastructure.

Both are already visible in the report as ours (D-044), and a box beneath them would imply
otherwise. `not_reachable`, `not_exposed` and `not_applicable` are offered: those are the ones a
merchant can actually close.

### The token

Stored only as a SHA-256, so a leaked database yields no working links — hard constraint 6's
property applied to a bearer token that opens a merchant's screening report. An unknown token and
an expired one return the same answer, so a bad token learns nothing about which it was.

The merchant is not a user of this system: no account, no password, no session. Two `security
definer` functions are the whole of what the link can do, and **neither accepts a run id** — a
caller without a token cannot name a run to read or write.

### Copy written for one audience becomes an assertion about the reader when it moves

**2026-08-23 · found while building the merchant page, and not on the list.**

`MerchantResponse` is written for an underwriter. It exists to say what a blank space means:
*"the merchant has not opened the report"*, *"identified themselves as X, and left no comment on
it"*. Every word of it is careful, and it was rendering **on the merchant's own page**, telling the
reader finding by finding that they had left no comment — on a page whose one rule is never to
imply that saying nothing is a failure (D-067).

The general form, which is why this sits in D-063 rather than in a commit message:

> **Copy written for one audience becomes an assertion about the reader when it moves to another.**
> A sentence *about* someone, read *by* that someone, is a different sentence.

Nothing was wrong with the words. They were correct, carefully hedged, and D-001-compliant in the
document they were written for. The defect was entirely in who was reading them, which no copy
audit can detect — `auditCopy` and `auditInternalVocabulary` both pass on that text, and should.

It reached the merchant page because that page reuses `ReportView`, which is the right decision:
one component means the merchant comments *while looking at the same evidence* IQwallet sees. Reuse
carries copy across audience boundaries silently, and the boundary is invisible in the component
tree.

**What to check when a component is reused for a second audience**: not whether its copy is
accurate, but whether any of it is *about* the new reader. Descriptions of delivery, of silence, of
what someone did or did not do — those are the sentences that change meaning when the subject
becomes the audience.

### Sending is never blocked

Outstanding commentary does not hold a report (D-001). The report shows which findings were open
for comment and unanswered, distinctly from a merchant who never opened it at all — which is what
the five states are for.

### The model change — one link, self-declared identity

**2026-08-23 · Frank's ruling · folded into D-063**

The first build assumed the recipient was the respondent. That is wrong about how these accounts
actually work, and six points replace it.

**1. One forwardable link per report.** Not per recipient. Mintro generally has no direct channel to
the merchant: the link goes to the agent, who either forwards it or answers on the merchant's
behalf. Both are legitimate, and per-recipient tokens would model a distinction that does not
survive contact with the first forwarded email.

So `comment_links.sent_to` records **where Mintro sent it, not who may use it**. That is still worth
recording — it is Mintro's own action, and it is what makes *"the merchant was invited"* a fact
rather than a recollection.

**2. Identify before commenting.** Whoever opens the link gives an email address before the box
becomes writable. One field, asked once.

**3. The visit is recorded either way.** Someone who identifies themselves and writes nothing is a
different fact from a report nobody opened, and both are different from a report opened by someone
who never said who they were. That last case is why `CommentaryState` has a fifth member,
`unidentified`: an anonymous opening supports neither *"they participated"* nor *"nobody looked"*,
and a state system that forces it into one of those is asserting something it does not know.

**4. Self-declared and unverified, said in those words.** No confirmation mail, no code, no check
that the address exists. Every rendering says **"identified themselves as"**, never "from", and the
report carries *Mintro has verified neither the response nor the address it was given under.*

Verification is **deliberately absent rather than missing**. Adding it would make Mintro the party
that established who spoke; this is a supporting document, not a legal instrument.

**5. Attribution is per comment, not per report.** The agent may answer the fulfilment findings and
the merchant the catalogue ones, through the same link. Each entry carries the address identified
when *it* was written, so a reader can tell which came from whom — and a later entry is an addition
rather than a correction that replaced anything (D-002).

**6. The PDF to IQwallet carries all of it.** Who identified themselves, when the report was opened,
when each response was written, and which invited findings were left unanswered. A screen that
shows a merchant's account and an export that drops it are two documents, and the export is the one
that decides anything. One reader — `readRunCommentary` — feeds both, because two queries written
months apart is how they come to disagree.

### The invitation is sent from the tool

**2026-08-23 · Frank's ruling**

> The link is sent from the tool, not copied by an analyst into their own email. Mintro holds the
> record of what was sent, to whom, and when, without reconstructing it later.

Implemented as a queue with the same shape as `scan_requests` and `pdf_requests` (D-035): the
analyst inserts an intent into `comment_invites` carrying **one field, the address**, and the worker
mints the token, stores the digest, composes, and sends.

The queue is not a convenience. **A browser that could write a `comment_links` row would have
computed the digest, which means the plaintext token existed in a browser** — and the property that
made storing only a digest worth doing is that the token lives in exactly two places, the email and
the merchant's address bar. So `comment_links` has *no* insert policy for `authenticated`, and
`apps/worker/test/schema/commentary.test.ts` pins that against real Postgres.

The analyst never sees the token either. They cannot send the link some other way, which is what
makes Mintro's record of the invitation complete rather than partial.

### An untransmitted invitation invited nobody

**2026-08-23 · amended the same day the gate lifted · Frank's ruling: it survives verification**

> The delivery field holds after verification, because a genuine send failure produces the same
> situation as an unsent one, and both must render as ours rather than as merchant silence.

This is the important half, and it is why the field is not scaffolding to remove now that
`gomintro.com` is verified and `RESEND_API_KEY` is set. **The dry run was never the only way to
end up with a link nobody received.** A provider rejection, a bounced domain, a suspended API key,
a mailbox that refused the message — each leaves exactly the same artifact: a `comment_links` row
whose token reached nobody.

If *"a link exists"* meant *"the merchant was invited"*, every one of those would render as **"the
merchant has not opened the report"** in front of the underwriter deciding their application. The
question the report has to answer is not *was the domain verified* but *did this reach them*, and
only the send's own outcome answers it.

So `comment_invites.delivery` is permanent, and `readRunCommentary` keeps requiring a job that says
a link went. The dry run was the first case, not the reason.

The original reasoning, which stands unchanged:

Resend had no verified sending domain, so a send was composed and not transmitted. This is the
D-044 defect waiting in the least visible place available: if the existence of a link row meant
*invited*, every finding in every report would render as **"the merchant has not opened the
report"** — Mintro's own gap presented as the merchant's silence.

So delivery is recorded as an outcome on the job row, `comment_invites.delivery`, and a finished job
is refused by the database unless it says which. `readRunCommentary` reports `issued: false` for a
run whose links were never transmitted, and the report states at the top that nothing reached them
and the blanks below are therefore not their silence.

Two related refusals, both the positive-evidence rule (D-026):

- A link with **no job row** is not assumed delivered. "No record says it failed" is not "a record
  says it went."
- A **failed commentary read** returns `null` and renders as *"these could not be read"* — never as
  an empty comment list. The obvious implementation, returning `not_invited` for every finding,
  renders nothing at all and would have made the failure invisible in the one document where a
  merchant's account matters most.

`mailersFor()` is the single place either sender is chosen, so verifying the domain and setting
`RESEND_API_KEY` turns the report send and the merchant invitation on **together** — two call sites
each reading the environment is how one of them stays dry-running after the gate lifts (D-034).

### Not settled here

Whether IQwallet wants the merchant-reviewed version or the raw findings sooner is their workflow,
and Frank owes them that conversation. **Built for the reviewed version.**

---

## D-064 — The Resend gate is lifted, and the send is wired
**2026-08-23 · Frank's ruling**

`gomintro.com` is verified in Resend and `RESEND_API_KEY` is set on Fly. Both sends go live.

### Sending was never a flag away

The "Send to IQwallet" button said *not connected* and that was accurate — nothing reached a
mailer. The email carries the rendered PDF, and the PDF is Playwright printing the report route,
which a browser cannot do. So lifting the gate meant **building the send path**, not enabling one:
`send_requests`, a worker handler, and the `sends` row it writes.

That makes four queues with one shape (D-035): scan, PDF, invitation, send.

### Real and dry-run stay separate implementations

Reaffirmed from M5. **Not a flag on one mailer.** A boolean that changes what a `send()` does is a
boolean someone reads the wrong way round once, and the cost of reading it wrong is a test message
recorded as a delivered report.

Selection is on `RESEND_API_KEY` being present, in `mailersFor()` — the single place either sender
is chosen, so the report send and the merchant invitation went live together rather than one of
them staying dry (D-034).

The distinction is only worth having if the record carries it, so **`sends.mailer` names the
implementation that handled each attempt**. Not nullable and with no default: every row from here
states what transmitted it. Existing rows read `unrecorded`, which is the truth about them —
backfilling `Resend` would be inventing a fact about mail that may never have been sent.

### Addresses are configuration

`MAIL_FROM` / `MAIL_REPLY_TO` for the IQwallet report, `INVITE_MAIL_FROM` / `INVITE_REPLY_TO` for
the merchant invitation, each falling back to the report's. Frank may want a different sender for
merchants than for underwriters — different audiences, one of whom has never heard of Mintro — and
that split now costs an environment variable rather than a commit.

`reports@gomintro.com` is the default, on the verified domain.

### A reply-to may be no-reply. The requirement moved into the copy

**2026-08-23 · Frank's ruling · overrides the guard proposed the same day**

I built a check refusing `no-reply@` in a reply-to. Frank overruled it and **kept the reasoning**,
which is the part that matters:

> An agent receiving this from a company they may not recognise will want to verify it is real. A
> no-reply address answers that with silence, the invitation goes unanswered, and the report
> renders it as merchant silence — the misattribution the delivery field exists to prevent,
> arriving through the email instead of the database. A named contact answers it without anyone
> maintaining a new inbox.

That is a better statement of the problem than the guard was. The guard protected the *channel*;
the risk is to the *answer*, and an unanswered invitation is indistinguishable in the database from
a merchant who chose not to reply. The email is simply a second route to the same misattribution
`comment_invites.delivery` was built to stop — which is why closing it matters as much.

`MAIL_REPLY_TO` and `INVITE_REPLY_TO` are now `no-reply@gomintro.com`. In exchange the invitation
carries:

> Questions about this request? Contact &lt;name&gt; at &lt;address&gt;.

**The requirement moved; it did not disappear**, and it fails the build the same way:

- `InvitationInput.contact` is **required**, so a call site without one does not compile. Making it
  required rather than optional is the whole point — an optional contact is a contact that is
  absent the first time someone adds a call site.
- `composeInvitation` throws on a blank name or address. A blank renders `Contact  at frank@…`,
  which reads as a template nobody filled in — worse than no line, in front of a reader already
  deciding whether to trust the sender.
- `copy.test.ts` asserts the line reaches the body a merchant actually reads.
- `addresses.test.ts` asserts **both ends**: that a no-reply address is now accepted, *and* that
  `composeInvitation` still refuses a missing contact. Deleting the guard without adding the
  replacement would otherwise leave every file green and the reasoning gone.

`INVITE_CONTACT_NAME` and `INVITE_CONTACT_EMAIL` have **no default** — a default would be a name
nobody agreed to put in front of merchants. Unset fails the invitation job and not the worker:
scans and report sends have nothing to do with it, and taking them down would be the wrong blast
radius.

What no check can establish is whether the named person actually answers. That stays Frank's.

### The first live send failed, and the failure was worth more than the send

Two defects, found by sending one real message and by no test.

**The insert named a column that has never existed.** `sends` has no `merchant_domain` — the domain
is reachable through `run_id` — and PostgREST refused the row. By then **the message had already
gone to Resend**, because `sendReport` transmits and then records: a provider's message id does not
exist until it has been asked for one.

**The queue row then said `failed`, which this document defines as *never reached a mailer*.** That
is the serious half. An operator reading it would re-send, and IQwallet would receive the report
twice. The job did fail; the message did not.

So `send_requests.transmitted` records what the provider did, set the moment it answers and before
the row is attempted — the same separation as `comment_invites.delivery`, for the same reason. The
job's outcome and the message's outcome are two facts, and a schema that can only hold one will
hold the wrong one exactly when it matters. A `done` job whose transmission contradicts its outcome
is refused by a check constraint.

**The regression test was wrong first, in the same shape.** It compared the table against a column
list typed into the test file, so re-introducing `merchant_domain` in `sendJob.ts` left it green —
a test asserting its own assumptions rather than the code's. The list now comes from `sendRowFor`,
the single owner of the row shape, and re-introducing the bug fails it.

That is the D-026 boundary lesson again, one day old: the seam between what the code writes and
what the table holds had no owner, and each side was correct alone.

### The subject line is the domain and nothing more

**2026-08-23 · Frank's ruling**

It carried the counts: `Screening report — shop.example — 3 failed, 7 for review`. They are gone.

> Counts in a subject line are a characterisation of the merchant travelling in the most-forwarded,
> least-contextual part of the message.

A subject line is read where nothing else is: a phone notification, a thread title in someone
else's inbox, a forward with the body collapsed. *"3 failed"* seen there is a verdict, and the
verdict is IQwallet's to reach rather than Mintro's to broadcast — the same discipline the report
copy keeps, applied to the one string that travels furthest from its context.

The body keeps the counts **with the coverage line beside them**, which is where a reader can weigh
them: three failures out of ninety-seven evaluable findings is a different fact from three out of
five, and a subject line cannot hold the difference.

**The cost, recorded so nobody re-adds it without knowing what it was traded for**: an underwriter
loses inbox-level triage. They must open the report to learn whether it needs them today. That is a
real loss, and it was accepted deliberately rather than overlooked.

### The IQwallet email gets the contact line too — my asymmetry argued the wrong way

I flagged the report send as a different case and did not extend the ruling: IQwallet knows who
Mintro is, so the "verify this is real" reasoning does not carry.

**Frank's correction, which is right:**

> IQwallet knowing who Mintro is removes the need to verify the *sender*, not the need to reach a
> *person*. An underwriter with a question about a capture is mid-decision on a merchant, and
> silence costs more there, not less.

The two audiences need the line for different reasons and the reason I identified was only the
invitation's. Reaching a person is the shared one, and it is the one the no-reply address takes
away from both. Same treatment: the line is required, the copy audit fails the build without it.

Worth noting how the error happened. I found a real asymmetry and then let it decide the question,
without asking whether the *other* reason for the requirement survived it. A difference between two
cases does not establish which way the difference cuts.

### A rejection is a recorded outcome, not a failure

A provider refusal finishes the job as **`done` with `outcome: 'rejected'`**, and writes its
`sends` row. `failed` is reserved for a job that never reached a mailer — a render that broke, a
run with no report.

Collapsing them would bury a provider refusal among infrastructure errors, and a refusal is
precisely what a dispute turns on. It is also the only half of the question a success-only log
could answer, which is why D-001 makes the log load-bearing rather than the email.

### The link shape had two owners, and they disagreed

Found while wiring this, before anything was sent. **Recorded as the eleventh D-026 instance** on
Frank's ruling — see D-026, where the reasoning about boundaries belongs.

In brief: the worker composed `/comment/<token>`, the page read `?comment=<token>`, neither file
was wrong alone, and the first invitation would have delivered a merchant to the analyst sign-in
screen holding the only token that report will ever have. The shape now lives in
`packages/engine/src/commentLink.ts` with a round-trip test.

The path form was kept over the query form. The token is a bearer credential and has to be in the
URL — that is what a link of this kind is — and a query string is the part of a URL that reaches
`Referer` headers, analytics and access logs by default.

### D-001 is untouched, and now enforced by the schema

Send is never blocked. The `send_requests` insert policy has **no condition on any outcome** —
not on fail counts, not on review counts, not on run status — and a schema test asserts that the
`with check` clause stays free of them. A database that refused to queue a send for a merchant with
failures would be making the determination this product exists not to make, and would leave a
record of Mintro having decided what IQwallet gets to see.

The dialog does wait on the worker's account of the attempt before saying "Sent". That is not a
gate on an outcome; it is a refusal to report a delivery that has not happened.

---

## D-065 — The contact line is a pointer, not a mailbox
**2026-08-23 · Frank's ruling · supersedes the named contact in D-064**

D-064 required the invitation to name a person and print their address. It now points the reader at
their existing Mintro contact instead, and carries no name or address at all.

> An agent verifying that an unexpected email is legitimate does so best by asking someone they
> already have a relationship with. **An address printed inside the same email they are suspicious
> of verifies nothing.**

That is a better statement of the problem than the version it replaces, and it is worth being
precise about why. The named contact was meant to answer *"is this real?"* — but a printed contact
carries no evidence toward that question, because a message designed to deceive would print one
too. The only thing that can answer it is a channel the reader already trusts, which by definition
is not inside this message. The line's job is to send them **out** of it.

It also removes a personal address from a document built to be forwarded (D-063), which the earlier
design would have published in every invitation Mintro ever sends.

### The wording

    Invitation:  Questions about this request, or want to confirm it is genuine?
                 Contact your usual point of contact at Mintro.

    IQwallet:    Questions about this report? Contact your usual point of contact at Mintro.

The invitation names the verification purpose out loud. An agent who has received something
unexpected from a company they may not recognise is *already* wondering whether it is real, and
saying so tells them that checking is the intended response rather than leaving them to choose
between trusting a stranger's email and ignoring it. Ignoring it is the outcome that costs the
merchant a voice in their own screening.

The IQwallet line drops that clause. They commissioned the screening and are expecting the report;
inviting them to verify a document they asked for would read as boilerplate at best.

### What did not change

**The build still fails without the line.** A message that leaves a reader no way to reach anyone
goes unanswered, and an unanswered invitation is later rendered as merchant silence — the
misattribution `comment_invites.delivery` exists to prevent, arriving through the email instead of
through the database.

What went away is the *configuration*: `INVITE_CONTACT_NAME` and `INVITE_CONTACT_EMAIL` are
deleted, along with `contactFor` and the required `contact` field. The line is copy, and it is
enforced as copy — `contactLine.ts` owns both strings and `copy.test.ts` asserts each reaches its
message.

The teeth are `isPointerContactLine`, which fails on any line containing `@`, plus an assertion
that the invitation body holds **no email address at all** once the token link is excluded. An
address is precisely what would creep back in, from someone reading "contact line" and reaching for
a mailbox.

### Not settled here

Whether "your usual point of contact at Mintro" reads correctly for a merchant who received the
invitation as a **forward** from their agent, and has no Mintro contact of their own. They would
sensibly ask the agent who forwarded it, which is the right answer and one the line does not say.
Left alone rather than lengthened on my own initiative — flagged for Frank.

---

## D-066 — Nothing on the merchant page acts on Mintro's behalf
**2026-08-23 · Frank's ruling · found in first use**

> The merchant view should render the report and the comment boxes and nothing that acts on
> Mintro's behalf.

*Send to IQwallet* and *Download PDF* were both rendered on the anonymous merchant page. The
mechanism, and why it is a D-026 instance rather than an oversight, is recorded there: a required
prop satisfied by an inert value is not a constraint.

Operator actions are now one optional `actions` group. The merchant route passes none, so none
exist — the correctness is in what the page **can hold**, not in what its handlers happen to do.

### The audit

Everything else interactive on that route is a filter chip or a disclosure toggle. Both are
read-only and both belong there: the page exists so a merchant can respond *while looking at the
evidence*, which means navigating it.

One further thing was removed for a related reason — see D-067 on `MerchantResponse`. It is not an
operator *action*, but it is operator-facing text, and it was narrating the reader's own silence
back at them.

---

## D-067 — The merchant page asks; the report is context
**2026-08-23 · Frank's ruling · found in first use**

> The commentary is buried, and the cause is that the page treats it as an optional annotation on a
> document. For the merchant it is the other way round: **the report is context, responding is the
> task.** Invert the hierarchy.

The diagnosis is the valuable part. The page was not badly laid out; it was laid out for the wrong
reader. It was the analyst's report with boxes added, and a merchant does not arrive to read a
document — they arrive because someone told them their storefront was screened.

### What changed

- A header stating what is being asked and how many findings are open, before anything else.
- The findings where nothing was observed **called out above the report**, with a jump link.
- Comment boxes styled as expected input: a solid edge and a filled ground, not a dashed outline
  on near-white. Dashes read as a placeholder or a drop target — the visual form of *"you probably
  will not use this"*.
- A placeholder question in each box, reversing an earlier rule against one. That rule was right
  for a blank box on an annotation surface and wrong here: an unlabelled empty box beside a
  compliance observation reads as a demand to justify yourself.

### The constraint, and where it lives

> Never imply an unanswered finding is a failure or an admission. A merchant may reasonably have
> nothing to add to a finding they accept. The framing is "this is your opportunity", never "you
> must account for this".

Carried in two places, deliberately: **"You can respond to any of them, or none"** in the header,
and **optional** on every box — the header states it once, the box states it where the decision is
actually made. Nothing on the page counts unanswered findings back at the reader.

`MerchantResponse` was removed from this route for the same reason. It is written for an
underwriter — it explains what a blank space means — and on this page it told the reader, finding
by finding, that they *left no comment on it*. Their own words are not lost: the box shows what
they have already written, above the space to add to it.

### "Did not show one way or the other", not "nothing could be observed"

I flagged a discrepancy: the callout counts only the three not-evaluable kinds a merchant can
close, but "nothing could be observed" is equally true of the two that are Mintro's own gaps, and a
merchant who noticed would have no way to resolve it.

Frank's phrasing fixes it rather than papering over it:

> The excluded ones are gaps in what Mintro checked, not in what the pages showed, so the phrasing
> no longer overlaps them. The four-column breakdown already labels ours as ours; **the callout must
> not contradict it.**

The count is derived from the same `invitesComment` predicate the boxes use, so the callout and the
section it points at cannot come to mean different sets.

### "The team reviewing your account"

On the page, not "the underwriting team" and never "IQwallet". A merchant may not know who IQwallet
is, and IQwallet is not their counterparty. **A merchant who does not know an underwriting team
exists should not have to infer one to understand the sentence.** The email keeps the fuller
phrasing, where the register suits it.

Dropped from the identify box: *"Mintro does not check it."* True, and it told the reader nothing
they could use while undercutting the ask at the moment it was made. The self-declared framing
belongs in the **report** — "identified themselves as", never "from" — where it informs an
underwriter's reading of a response rather than discouraging one.

### The box asks what they do, never whether they comply

**This is a hard constraint 7 matter, recorded so the stronger wording is not restored later as a
clarification.** Frank's own draft said *"explain how their site does or will comply"*; he overruled
it on my objection.

The box asks: *"How does your site handle this, now or in future?"*

Asking a merchant to state that they comply **solicits a compliance claim**. Mintro does not make
compliance determinations and does not collect or transmit them — a response saying *"we comply
with 4.2"* is a determination, sitting in Mintro's document, forwarded to an underwriter under
Mintro's name. The question as written asks what they do; the reader draws the conclusion. That is
the same division the whole report keeps, applied to the one field where the words are theirs.

### The email is short

Cut from 24 lines to 13. Kept: what this is, what they are asked to do, the link, the expiry, the
contact line. Everything else moved to the page, which carries it beside the evidence it is about.

The forwarding sentence stayed against that rule, and Frank confirmed the reason: **the agent
decides whether to forward before opening anything**, and knowing responses are attributed per
person changes that decision — they may answer some findings and pass the rest on rather than
answering on the merchant's behalf.

The subject became *"Your response to the screening report for &lt;domain&gt;"* — leading with what
is wanted rather than with what Mintro did, since this arrives unexpected from a company the reader
may not know.

---

## D-068 — The PDF carries the participation record
**2026-08-23 · completing D-063 point 6**

> The PDF to IQwallet carries all of it: who identified themselves, when they opened it, when each
> comment was entered, and which invited findings were left unanswered.

### It was carrying none of it

The print branch passed `commentaryOf` to `CategoryCard`, and **`CategoryCard` had no such prop**.
JSX accepts `{...(x === undefined ? {} : { x })}` without an excess-property check, so the call site
read as correct, the value went nowhere, and the exported document contained no merchant responses
at all. Every test passed, because the component tree was internally consistent with itself.

Two more of the same family were underneath it:

- **The ordinal was positional, and the two views traverse differently.** The reading view walks
  display groups; print walks categories. A comment keyed by position in one is keyed differently in
  the other, so a merchant could answer a finding and see the response attached to another — or to
  none. `ordinalsFor` now decides every ordinal once, from `groupReport`, and both views look it up
  by finding identity.
- **A `<details>` cannot be opened by a stylesheet.** The unanswered list was collapsed with its
  summary hidden in print, so the export would have held strictly less than the screen it claims to
  reproduce (D-042). It takes a prop.

### The check that would have caught it

`npm run print-check` renders the print path with commentary injected and asks the **rendered
document** what it says — all five commentary states, the attribution treatment, and the PDF
itself.

It reads the DOM rather than the PDF's text, and the reason is worth recording: `extractPdfText`
cannot decode the subset-embedded fonts Chromium writes. It was built to tell whether a *fetched*
document is readable prose (D-057), and pointing it at our own output returns a Caesar-shifted
alphabet. The DOM is what `page.pdf()` prints, so it is the authority on what the PDF contains.

**Nothing that inspected the component tree could have found this**, because the tree agreed with
itself. That is the same test the regression check for the phantom `merchant_domain` column failed:
*does this assertion get its expected value from the same place the code gets its actual value?*

### The participation record

Structured, not a sentence. "Which findings were left unanswered" is a list an underwriter reads
against the findings themselves, and prose would make them count.

Every line states a fact about delivery. A finding with no response is **unanswered** — never
"unaddressed", "ignored", "declined" or "unexplained", each of which is a reading of the merchant
(D-001). A merchant may reasonably have nothing to add to an observation they accept; the merchant
page therefore never counts silence back at them (D-067), and this gives an underwriter the count
and nothing more.

It is sans-serif and in the report's own palette, deliberately. This is **Mintro speaking** — our
record of what we sent and what came back — and it must not be mistaken for the merchant's words,
which keep the serif face and the amber rule. `print-check` asserts the two faces differ.

---

## D-069 — The callout, its count, and its anchor are one decision
**2026-08-23 · found in first use of the deployed merchant page**

"Jump to these" did nothing. Two defects, and the second is the worse one.

### The link resolved to nothing

The callout counted findings with one rule and the anchor was chosen with another. Frank's run was
rule set **2.4.0**, which recorded no `notEvaluableKind` at all: all 41 of its not-evaluable
findings fell in the `unrecorded` bucket, the count came out 41, no section matched the anchor's
bucket list, and no element carried the id.

Frank distinguished the two possible failures before I looked — an anchor that resolves to nothing,
and an anchor that resolves to something that cannot be scrolled to. It was the first. The second
was also latent: a section hidden by the filter cannot be scrolled to, so the merchant page now owns
the filter and the jump clears it before scrolling.

`grouping.ts` holds `nothingObservedCount`, `nothingObservedSection` and `NOTHING_OBSERVED_ID`, and
the callout renders **only when the section it points at exists**. That makes the pairing a property
of the code rather than of the data it happens to be given.

### The count was an assertion about the merchant, from a field nobody wrote

The more serious half. The callout said *"41 where your pages did not show one way or the other"*
about findings whose kind was **never recorded**. Nobody knows whose gap those are; some may be
`no_check_built`, which is Mintro's.

The four-column breakdown labels an unrecorded kind as neither theirs nor ours (D-044), and Frank's
own ruling on this callout was that it **must not contradict** that. It did — one day after the
ruling, in the copy written to satisfy it.

So the count includes only **positively recorded** merchant-surface kinds: `not_reachable`,
`not_exposed`, `not_applicable`. A finding whose kind was never written is counted nowhere and
claimed about nobody. On Frank's 2.4.0 run the callout now does not render at all, which is the
honest outcome — that run cannot say whose gaps those were.

### The check

`apps/web/test/anchors.test.ts` renders the callout and the report **together** and requires every
`href="#x"` in the output to have a matching `id="x"` in the same markup.

Not a comparison against the id constant: both sides would read the same string and neither would
know whether an element existed. Not a list of known anchors either — there is nothing to maintain,
so a link added tomorrow is checked tomorrow.

Recorded in D-026 with the other three, and with the two ways this test was wrong first.

---

## D-070 — Three concurrent opens per page load
**2026-08-24 · found by Frank in first real use of the response path**

> Entered a note, saved, refreshed → "This link cannot be opened / The report could not be loaded
> just now." Went back to the email, eventually got in, entered another note, refreshed → harder to
> get back in.

### Diagnosed before touched, on Frank's instruction

His reasoning ruled out the obvious answer before I looked: *intermittent and worsening is not the
signature of a lost session — that would fail consistently. And the message is the generic
read-failure path, not an auth path.* Both were right, and the second is the one that mattered: the
copy distinguishing "could not be read" from "not a valid link" (D-036) is what made the failure
diagnosable at all. A page that said *"this link is not valid"* would have sent me to the token.

He also named the trap: **a cookie would mask a resource leak that would later surface as merchant
responses silently failing to save.** That is exactly what a session would have done here.

Four questions, four answers:

- **What does the failing request return?** Sometimes HTTP 400, sometimes the transport refuses the
  stream (`ERR_HTTP2_SERVER_REFUSED_STREAM`). Never 401. Never 429.
- **Server or client?** Client. Eight consecutive server-side calls against a diagnostic token: all
  200, ~180 ms, identical 107 KB. No degradation, nothing accumulating.
- **Fresh browser?** Reproduces immediately, with no analyst session and no cookies. So it is
  **per page load** — not per token, not per client state.
- **Rate limited?** No. Nothing returned 429: not the anon key, not the RPC, not PostgREST.

### The cause

`anonymousClient()` built a **new `SupabaseClient` on every call**, and it is called from a render
body. `CommentPane`'s load effect is keyed on that client, so it refired on every render — three
times during mount — firing **three concurrent copies of a 107 KB RPC**.

Whichever resolved last set the page state. When a duplicate lost its HTTP/2 stream, the merchant
saw the read-failure message on a report that had loaded fine on another of the three.

That is the intermittency: **it is a race, so it is a coin toss.** And the worsening is the payload
growing with every comment — three concurrent larger responses trip the stream limit more often.

> A value handed to a hook dependency array **is** part of the interface.

`createClient` looks like a constructor and behaves like one; nothing about the call site suggests
that returning an equal-but-new object changes program behaviour. It changes it completely.

### The console had been saying so

Chrome printed **"Multiple GoTrueClient instances detected in the same browser context"** on every
load, including the ones that worked. supabase-js emits it precisely because a second instance
produces undefined behaviour, which is what this was.

**A warning nobody reads is a test nobody runs.** It cost a merchant-facing failure that took a
network trace to find, and it had been on the console the entire time.

### The guard

`apps/web/test/clientIdentity.test.ts` asserts reference equality across repeated calls — the
contract is the identity, so the identity is what is asserted. Reverting the singleton fails it.

Verified on the deployed page as well as in the suite: one request, one 200, and no further traffic
over twenty-five seconds. Before the fix the same probe showed three.

### Still open: whether identification should survive a refresh

**Not decided here.** Frank is right that a link valid for thirty days which loses your place on
refresh is not usable, and that is now a separate question rather than a bug — the report reloads
correctly, but identity is held in memory only, so a merchant must re-identify to write again.

The tension is real and is D-063's: *the next person to open this link on a shared machine is a
different person*, and every response is attributed to the address given when it was written. See
the note to Frank; it is his ruling to make.

---

## D-071 — Identity survives a refresh, and dies with the tab
**2026-08-24 · Frank's ruling · numbered 071, not 066**

> Frank asked for this as D-066. That number is taken (*Nothing on the merchant page acts on
> Mintro's behalf*), and rule 1 of this document is that identifiers are stable and never reused.
> Recorded here instead; say if it should be folded into another entry.

The report now reloads correctly (D-070), but identification was held in memory only, so a merchant
had to re-introduce themselves on every reload. **A link valid for thirty days that loses your place
on refresh is not usable**, and Frank's own test hit it twice.

`sessionStorage`. Survives a refresh — the actual complaint — and dies with the tab.

### Why not `localStorage`, in Frank's words

> Option 3 would let one person's address attach to another person's words on a shared machine, and
> attribution is the whole mechanism by which this document is useful to an underwriter — **that is
> a correctness question, not a friction one.**

The link is forwardable by design (D-063). A merchant and their agent may be at the same desk, and
every response is attributed to the address held when it was written. A stored address outliving the
person who gave it does not make the page more convenient; it makes the document wrong.

### A restore is not an arrival

The first constraint, and the reasoning for the choice made. **Restoring writes no
`comment_visits` row.** The stored visit id is reused, so anything written after a refresh binds to
the original visit.

A visit is a fact about someone arriving and saying who they are. A reload is neither. A row per
reload would tell an underwriter that someone identified themselves six times when they identified
themselves once and pressed F5 — inflating the participation record with an event that did not
happen, which is the failure this whole feature exists to avoid in the other direction.

**Changing the address does write a new visit**, because a new declaration is a new fact.

### The stored address is a convenience, never evidence

The second constraint, and the database already guarantees it: `submit_merchant_comment` reads
`identified_as` from the **visit row**, server-side. What a comment is attributed to is what the
database holds when it is written, never what a browser remembered.

So a merchant who changes their address mid-session has their later comments attributed to the
later address, automatically — and their earlier ones stay with the earlier address. Changing
forgets locally and **deletes nothing**: the visit happened, and what was written under it stays
attributed to it.

That required an affordance the page did not have. *"Someone else responding?"* — stated that way
rather than "log out", because nobody logged in, and the likeliest reason to press it is that the
agent has handed the laptop to the merchant. Which is the case the per-comment attribution model
exists for.

### A stored identity belongs to one report

Offered back only when the run matches. A tab is shared across whatever someone opens in it, and a
name given while reading one merchant's report must not appear on another's.

The server is stricter still: a visit must belong to **that exact link**, not merely that run. A
stored visit from a second invitation opened in the same tab is refused at submit time, and the page
clears it and asks again rather than looping. Nothing typed is lost — the box keeps its text on
failure.

### The second client is gone

`useAuth` ran before the merchant-route check, so the merchant page constructed the analyst's
Supabase client on every load. Harmless in itself, and it was the reason
*"Multiple GoTrueClient instances detected"* kept printing.

**A warning that is expected is one nobody will notice changing** — which is precisely how that line
survived two days of failures it was describing. `App` now routes to one of three applications
before any client exists, and the standing practice is in `docs/ARCHITECTURE.md`.

A comment beside the old check claimed it returned "before `useAuth` decides anything". It did not:
a hook cannot be skipped by a return below it. The comment described the intent and the code did
something else, which is worth noting on its own.

---

## D-072 — A visit through a link nobody sent is not participation
**2026-08-24 · found by making the mess it describes**

`readRunCommentary` filtered *links* by whether they were transmitted (D-064) and then read
**visits run-wide**. So an arrival through an untransmitted link appeared in the participation
record an underwriter reads.

The reasoning is D-064's, one level down. A visit is evidence the merchant participated. **If a link
was never transmitted, nobody legitimately holds its token** — so an arrival through it is not the
merchant, and listing it tells an underwriter that someone answered when nobody was asked.

### How it was found, which is the part worth keeping

Diagnosing D-070 needed a token, and tokens are stored only as digests and generated worker-side —
so I minted a diagnostic link straight into the database against a live run, and identified through
it as `diagnostic@gomintro.com` while driving the anonymous path.

Those rows are now **permanently** in that run's participation record. The append-only trigger
refused to delete them, **including for `service_role`**:

    DELETE on public.comment_visits is not permitted: this table is append-only

That is the guarantee doing exactly its job. The system would not let me tidy away evidence of my
own activity on a merchant's record, which is the property hard constraint 5 exists to have. It is
worth noting that the first time it bit, it bit the person who built it, for a reason that felt
entirely reasonable at the time.

**Disclosed rather than worked around.** The filter above is a genuine correctness fix and it also
happens to exclude my rows, which is exactly the shape of a rationalisation — so it is recorded that
way, and Frank can judge it. The diagnostic link has no `comment_invites` job, so it was never
transmitted, so it now falls outside the record on the same rule that would exclude a real
untransmitted link.

### The operational lesson

**Do not mint credentials against a live run to debug.** A diagnostic link should be issued against
a scratch run, or the debugging should happen against a local database. Anything written to an
append-only table is written for good, and "I will clean it up afterwards" is not available here by
design.

Frank's full-loop test starts from a fresh scan, so the run that reaches IQwallet is unaffected.

---

## D-073 — The corroboration block is removed
**2026-08-24 · Frank's ruling · reverses D-050**

*"Findings that describe the same observation"* is gone from the report.

### Why it was built, and why that reason has thinned

D-050 built it for the GATE-002 / GATE-004 case: two rules whose findings rest on the same
observation, where a reader seeing both might count one fact twice. That was a real problem when
the report had little else to orient a reader with.

Three things have been added since, each of which addresses a piece of what it was for:

- the **requirement column** (D-041), which states what each rule asks, so two findings on one
  observation now visibly answer different questions
- the **four-column coverage breakdown** (D-044), which accounts for every finding
- the **participation record** (D-063), which is where a reader now looks first for context

Against those, it has not earned its space. **0.2 pages measured**, which is not the point — the
point is that it is a fourth orienting device on a document that already has three, and each one a
reader has to learn costs more than its own height.

### It can come back

Recorded rather than deleted silently, because the case that justified it has not become wrong —
only less pressing. If a merchant produces a pairing that genuinely misleads, this returns.

**The engine keeps `pairSameObservation` and the `sameObservation` field.** Frank's ruling. The
pairing rule is the hard part and it is tested; the display was ten lines of JSX. Deleting tested
logic to remove ten lines means rebuilding and re-testing it if the block returns, and an unused
field costs nothing on paper.

### Why this is not inconsistent with deleting resolveRunSelection

Worth stating, because the two look alike and were decided the other way.

`resolveRunSelection` went when the run picker went (D-047), and that was right: **it existed only
for that control.** It selected a run from a dropdown's value, it had no other caller and no other
meaning, and keeping it would have been keeping a function about a thing that no longer existed —
which is also where the D-045 bug had lived.

`pairSameObservation` is not about the block. It answers *do these two findings rest on the same
observation?*, which is a question about the rule set, and it stays true whether or not anything
renders the answer. **The test is whether the logic has meaning without the control**, not whether
it currently has a caller.

---

## D-074 — The participation record names what was answered, not what was not
**2026-08-24 · Frank's ruling**

> A bare list of codes is a lookup table, not information — it tells an underwriter to go hunting.

It listed every unanswered finding by rule code, exhaustively. Two things wrong with that, and the
second is the one that matters.

**It was the wrong direction.** What a reader wants before weighing a response is *which
observations were addressed* — a handful of items on a 97-finding report. What was not addressed is
the other ninety-odd, and printing them is printing the report again in miniature.

**It was coded rather than named.** `GATE-002` means nothing without the document open at the right
page. It now reads *"Products hidden until an account exists"*, which can be read on its own.

The count of unanswered stays in the line above. **The count is the fact; the enumeration was the
lookup table.**

The header material is unchanged and was right: who identified themselves, when the report was first
opened, how many of the findings open for response were answered.

### Measured

The participation record went from **2.0 pages to 0.2**. Together with D-073 the export fell from
**51 pages to 48** without captures — the artifact Frank received was 76 with them.

`loop-check` was updated with it, and the cross-check kept its shape: every rule the merchant
commented on must be **named** in the list, the list must hold nothing else, and it must contain no
rule code at all. Matched against finding titles from the report and comment rows from the database
— still two independent sources.

---

## D-075 - Whitespace, measured the way D-047 was
**2026-08-24 - Frank's ruling - numbered 075, not 074**

> Frank asked for this as D-074. That number is taken (the participation record naming what was
> answered), and identifiers here are never reused. Same flag as D-071.

D-047 shortened this document by measuring rather than estimating, and its table of options is what
made the decision reviewable. Four legitimate additions have grown it since - the requirement
column, the four-column coverage breakdown, the participation record, and merchant response blocks.
**Accumulation, not regression.** The same method applies again.

### What was spent, and what it bought

Measured with `npm run page-budget`, swisschems at 97 findings. Layout-only figures exclude
captures, which the measuring browser is not served; the with-captures number is the artifact an
underwriter actually receives.

    D-047 settled at                                              67 pages
    + requirement column, coverage breakdown, participation
      record, merchant responses                                  76 pages   (before)

    - corroboration block removed (D-073)                        -0.2 pages of content
    - participation record: enumeration to named list (D-074)    -1.8 pages of content
    - finding rows may break across pages                          -4 pages
    - print-only spacing on requirement pairs and responses        -1 page
                                                                  59 pages   (after)

    layout only, for comparison:      51 -> 48 -> 44 -> 43 pages

**Seventeen pages, and no content removed.** No smaller type, no shorter text, and no change to
capture size - that trade was measured and settled at D-047 and is not re-litigated blind.

### The largest saving was a rule, not a section

`break-inside: avoid` on every finding row cost **12.8 pages, 27% of the printed document**. A row
that does not fit pushes to the next page and leaves the rest of the current one blank; that was a
small tax when a page held three findings, and it is paid ninety-seven times now that a page holds
twelve.

Two things still must not split, and they are **named rather than implied**:

- **the evidence slip**, so a capture is never separated from what it is evidence of
- **a finding carrying a merchant response**, so their words never land overleaf from the
  observation they answer

The second is Frank's, and the reasoning is the ordinal bug's (D-026, D-068): attribution that
appears against the wrong finding is worse than no attribution, and **layout can do that as surely
as data can.** A reader turning a page to a quotation with no observation above it has to work out
what it refers to, and may work it out wrong.

### Evidence slips are the largest component and were left alone

16.6 pages, the biggest single thing inside the findings - and **the one whose composition is
unmeasured**. How much is reserved space for captures against the captures themselves is not known,
because the measuring browser is not served evidence.

Reducing it on an assumption is exactly the trade D-047 ruled out. It needs measuring on a run with
evidence served; then it is a decision rather than a guess. **Left as a known gap, deliberately.**

### One run is the wrong unit for a rule

Frank's question, and it is the right one: every screening is shaped differently, so what does
measuring swisschems establish?

For finding *which rule was wrong*, one run was enough - and necessary. Without it the guess would
probably have landed on capture size. But the fix changes **generation rules**, not this document,
and a rule that behaves at 97 findings can misbehave at 12: a fixed block that is 3% of a long
report is 30% of a short one.

So `npm run compose-check` asserts a property rather than a fact:

> A printed report must not occupy materially more pages than its content fills.

Across five real storefronts, a synthetic short report and a synthetic long one:

    with break-inside: avoid on every row     27-30%   five of six informative shapes fail
    with it on slips and responses only       19-21%   all pass
    ceiling                                      26%   chosen to sit in the gap

A ceiling at 30% caught one shape in seven and would have read as noise. The number is set to
separate the two states, and **verified failing** by restoring the old rule.

Reports under 20 findings are **reported but not asserted**: the header, verdict, tick strip,
coverage and participation record are a fixed cost that dominates a short document, so its ratio
describes the preamble rather than the rules. Both the good and the bad rule measure ~25% there,
which is a check that cannot fail. Printed with the reason rather than skipped - *this number does
not tell you anything here* and *this number is fine* are different statements (D-036).

That is the difference between *we fixed this document* and *the document composes well at any
size*, which is what was actually being asked for.
