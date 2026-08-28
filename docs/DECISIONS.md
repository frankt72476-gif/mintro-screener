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

---

## D-076 — A check names its method, not its subject
**2026-08-24 · Frank's ruling**

> Not "EIN verified". "EIN consistent across application, EIN letter, W-9."

The report also carries an explicit section naming what was **not** externally verified.

**"Verified" is a claim about the world; "consistent" is a claim about three pieces of paper.**
What we did was compare documents the merchant gave us. If all three say the same wrong number, a
consistency check passes and nothing about reality has been established. An underwriter reading
"EIN verified" reasonably infers someone queried the IRS. Nobody did, and nothing in this system
ever will.

This is constraint 7 arriving earlier than usual. The body copy of a finding can be scrupulous and
the name still does the misleading, because **a name is the part that gets skimmed** — it appears in
the run summary, the tick strip, the PDF contents page, the email subject. It travels further than
the finding it belongs to and arrives without its qualifications.

**The not-externally-verified section is the other half, and it is not optional.** Silence is not a
boundary. A reader cannot tell from an absent claim whether the IRS was checked and matched or never
consulted; both render as nothing. Stating the boundary is the same instrument as the architecture's
non-goals list — coverage a reader might reasonably assume must be denied explicitly rather than
merely not asserted (D-018).

---

## D-077 — Two completeness models, and field completeness is not one of them
**2026-08-24 · Frank's ruling**

**Package completeness** is required document slots present. It is countable, and it is a real state.

**Field completeness is not a completeness concept.** A blank field on a source document yields
`not_evaluable` with a stated reason. Never `fail`.

**Because we cannot see intent.** A blank "DBA name" might mean the form was abandoned half-finished
or that the business has no DBA. Both produce identical bytes on the page. Reporting `fail` asserts
we know which, and we do not — precisely the assertion constraint 2 forbids. Note which direction it
fails in, too: the merchant who correctly leaves the field blank because they have no DBA is the one
who gets marked incomplete.

**The exception is narrow, and it is structural rather than interpretive.** Where the same form makes
a field conditionally required by other answers *on that form* — "Do you use a third-party
fulfillment center? ☑ Yes" with the company-name field beneath it empty — the document contradicts
itself. That contradiction is observable on the page without inferring anything about why. The
evidence is the two fields together, and it is a finding about the document, not about the merchant.

**The boundary has to hold at "same form."** A field our template wants, blank on their form, is a
slot — package completeness, D-078's states. Only the form's own internal logic qualifies. Widening
this to "a field any reasonable application would require" would re-import the guesswork the rule
exists to exclude.

**Downstream consequence, stated because it constrains the extractor.** A `null` cannot carry a
reason. An extraction schema that returns null for every unfilled field has destroyed the
distinction this decision depends on, at the only point where it existed. See the D-086 amendment.

---

## D-078 — Five slot states, and three of them are not "missing"
**2026-08-24 · Frank's ruling**
**Amended by D-107 — there are six. `missing` is unchanged.**

`satisfied`, `not_provided`, `waived`, `superseded`, `missing`. **`missing` is the unresolved default
and the only state meaning "chase this."**

These are different facts and they read differently to an underwriter:

- **`not_provided`** — the requirement stands and the document does not exist. A startup has no
  processing statements. Nobody removed the requirement; it cannot be met.
- **`waived`** — the requirement was removed. A person decided it does not apply, and that person is
  accountable for the decision.
- **`superseded`** — a newer version replaced it. The slot is satisfied and the history is part of the
  record (D-091's supersedes chain).
- **`missing`** — nobody has said anything yet.

**Collapsing these into have-it / don't-have-it makes "we asked and it does not exist" indistinguishable
from "we forgot to ask."** The first is finished work. The second is an open task. An underwriter
weighing a package needs to know which, and merging the states removes the information at the point
it is recorded, where no downstream care recovers it.

**`missing` as the default is the load-bearing part.** A new slot starts unresolved and stays on the
chase list until someone acts on it. A default of `not_provided` or `waived` would let a slot resolve
itself by never being touched — constraint 9's shape exactly: a state meaning *we have not
established this* must never render as a state meaning *settled*.

---

## D-079 — Waiver and not-provided reasons come from enumerations
**2026-08-24 · Frank's ruling**

Fixed enumerations. Not free text.

**A reason typed by a person is not reproducible.** D-085 makes the report a pure function of a run;
free text makes it a function of a run plus whoever happened to be typing. Two analysts over
identical evidence produce different documents, and there is then nothing to assert about the report
at all.

**Enumerated reasons are countable across packages.** "Waived — covered by parent entity filing"
appearing forty times is a template problem worth finding. Nobody finds that pattern in prose.

**And free text is where determinations get in.** A box labelled "reason" invites *"this looks fine to
me"* — a compliance conclusion, in Mintro's document, forwarded under Mintro's name (constraint 7,
D-067). An enumeration cannot express one, which is a property of the control rather than a matter of
discipline.

**What must still be true.** An enumeration that does not fit gets picked around, and a wrong-but-close
option is worse than a missing one. A reason with no matching value is a signal to extend the list
under a decision number (D-025), never to add a free-text escape hatch.

---

## D-080 — Slots carry a count and a coverage window, not one slot per period
**2026-08-24 · Frank's ruling**

> "Bank Statement, count 3, most recent 3 consecutive periods ending within N days" — not Month 1 /
> Month 2 / Month 3.

Periods are read off the document.

**Three ways the per-period model fails, all of them ordinary:**

- **Merchants combine periods into one PDF.** Per-period slots then face one file that satisfies three
  slots, or two empty slots beside one holding everything.
- **Billing cycles are not calendar months.** A statement running the 12th to the 11th does not belong
  to "Month 2", and forcing it there makes the slot label a lie about the document in it.
- **Continuity and recency cannot be expressed at all.** Three statements from last year fill Month 1,
  2 and 3 exactly as well as three recent ones. Consecutiveness has no representation in the model —
  **the property that matters most is the one the structure cannot hold.**

A count plus a window states the requirement as what it actually is: *this many, covering this span,
ending this recently.*

**Periods are read off the document**, not from the upload date and not from the filename. That makes
the coverage window a claim about what the documents say, so it needs provenance like any other value
(D-087) — and where a period cannot be read, the slot is `not_evaluable` rather than assumed from
whatever order the files arrived in.

---

## D-081 — Conditionals fire on structural impossibility only
**2026-08-24 · Frank's ruling**

**Further amended by D-129 — see below.** A conditional whose predicate is unanswered does not
resolve: the slot is offered rather than removed, because impossibility must be established, not
assumed.

**Amended by D-128 — see below.** The three questions still remove structurally impossible slots
outright; everything else in the set is now adjustable by the operator per package.

A sole proprietorship has no Articles of Incorporation. A domestic entity files W-9, not W-8BEN. A
for-profit has no 501(c) letter. **A document that is merely absent stays in the template and is
resolved explicitly.**

Package creation asks three questions that drive this: **entity type**, **existing processor yes/no**,
**US-domiciled yes/no**.

**The two ways to remove a slot look identical downstream and are not the same thing.** "Cannot exist"
is a fact about the entity type. "Does not have one" is a fact about this merchant today, and it
belongs in the record as `not_provided` with a reason (D-078, D-079), so an underwriter can see it was
asked and answered.

**A template that quietly drops slots produces a shorter checklist that looks complete.** That is the
silent false-pass signature in a new setting: the absence of a slot reads as nothing to chase, and
nobody audits a list for the items that were never on it.

**Processing Statements is the worked example.** It is default-on for every package including
startups. A startup has no statements — but "startup" is not structural impossibility; plenty of new
merchants have processing history under another entity. So the slot stays and resolves via
`not_provided`. The report then says *we asked, and there are none*, instead of never mentioning
processing history at all.

**Three questions, and adding a fourth needs an argument.** Each must map to a genuine structural
impossibility. A question that merely predicts what a merchant probably has is a question that will
drop slots it should have kept.

---

## D-082 — Every slot is examined or collected_only
**2026-08-24 · Frank's ruling**

Collected-only documents report as **"present, not examined."**

**Otherwise an underwriter cannot tell whether a document was read.** A slot showing `satisfied` with
no findings against it could mean it was examined and clean, or filed and never opened. Same
rendering, opposite meanings — the presentation half of constraint 9, and the same defect D-047 found
in a control that could not distinguish two records a user might plausibly hold.

**It also protects the checks that did run.** Findings on examined documents carry more weight when it
is visible which documents were in scope. Without the distinction, a clean report is ambiguous across
its whole surface rather than at the specific places where nothing was looked at.

The specific per-slot assignment is **deferred to the check inventory**. Recorded now because the
field has to exist from the start: retrofitting it would leave every slot created before it ambiguous,
and there is no way to backfill a fact about what was done.

---

## D-083 — A report is pinned to a run; sending is an event
**2026-08-24 · Frank's ruling**

A report belongs to a run, not to a package. **Sending is a logged event, not a state transition.** A
sent report never changes. New documents produce a new run and a new report. Every report after the
first carries a diff against the last sent report: slots newly satisfied, findings resolved, findings
newly appeared.

**This is D-002 for Documents Check.** A report that changes after it was sent means the copy in an
underwriter's inbox and the copy in our database disagree, and the disagreement is invisible from
both ends.

**Sending as an event rather than a state is what makes a second send ordinary.** A state transition
implies a report is sent once; a second send is then either forbidden or an edit to the first. As an
event, each send records what was sent and when, and there may be five of them.

**The diff is what makes report five readable.** Without it the recipient re-reads forty slots to find
the three that moved. It is computed between two immutable runs — a derived view, never stored
mutable state, so it cannot drift from the reports it summarizes.

**"Findings resolved" is a statement about two runs, not about a merchant fixing something.** A finding
present in run 1 and absent in run 2 is what we observed. Why it is absent is not ours to say
(constraint 7), and the wording must not quietly award credit.

---

## D-084 — Retention: 30 days, configurable, restarting on reopen
**2026-08-24 · Frank's ruling**

**Further amended by D-130 — see below.** The 30-day figure is reaffirmed as the open→restricted
boundary, `create_document_package`'s unruled 365 is corrected to it, and a separate 180-day purge
candidacy is added. The clock this ruling depends on was never started by anything but a test.
**Superseded in part by D-097 — see below.**

30 days after a package is submitted or cancelled. **Configurable rather than constant.** The clock
restarts on reopen. Operator notice at day 23. At archival, purge document binaries and retain the
findings ledger, extracted field metadata and run history indefinitely.

**These are the most sensitive artifacts the system will ever hold** — SSNs, bank account and routing
numbers, tax IDs, photographs of government ID. The exposure of holding them is continuous; their
value collapses once the package is decided. Retention is the only control that *reduces* that
exposure rather than fencing it.

**Configurable, because 30 days is a starting position.** A constant would need a code change to move.
This is a policy dial, and it is deliberately unlike the guarantees in constraint 5, which are
unmovable on purpose.

**The clock restarts on reopen** because a reopened package is live work, and deleting its documents
mid-review would be a data-loss bug wearing a policy's clothes.

**Day 23 gives seven days' warning**, and it is a notice rather than a hold. A deletion that waits for
someone to acknowledge it never runs.

**What survives is what keeps the record defensible**: what was observed, from which document version,
at which page, with the verbatim snippet (D-087). The ledger outlives the binaries.

### Superseded in part — the purge is withdrawn, see D-097

The tension flagged here was ruled on the same day. **The binary purge is withdrawn** (D-097).
Document bodies are retained, and nothing in a package is deleted by application code.

**What survives from this entry:** the 30-day clock, its configurability, the restart on reopen, and
the day-23 operator notice. What they govern has changed — the boundary at 30 days is now between
open and restricted access, not between existence and deletion, and the day-23 notice announces that
access change rather than an impending purge.

**What does not survive:** the purge itself, and the sentence above that says the ledger outlives the
binaries. The binaries outlive everything.

The paragraphs above are left standing as written. This entry reasoned from a real privacy exposure,
reached a defensible-sounding answer, and paid for it with the thing constraint 3 exists to protect.
The file is more useful showing that than showing a decision that was always right.

---

## D-085 — No analyst annotation on findings
**2026-08-24 · Frank's ruling**

**Amended by D-130 — see below.** *Same run in, byte-identical report out* now holds only within a
purge state: a purged package's report is a function of the run **and** of whether its bodies are
still retrievable.

> Same run in, byte-identical report out.

The report is machine output. Internal notes may exist on the package and do not render.

**An annotated finding is a Mintro opinion attached to a Mintro observation, in a document forwarded to
an underwriter.** That is a determination however carefully it is hedged, and determinations are
IQwallet's (constraint 7, D-001, D-067). There is no phrasing that makes an analyst's gloss on a
finding into an observation.

**The purity requirement is also what makes the report testable.** "Same run in, byte-identical report
out" is a property something can assert. Every check in the D-036 family depends on being able to
regenerate a report and compare it. Annotation makes a report a function of a run *plus an editing
history*, and there is then nothing left to check.

**It also protects the merchant-response channel.** Merchant words render because they are the
merchant's and are attributed as such (D-063, D-067). Analyst words rendering in the same document
would be indistinguishable in weight from the merchant's and attributable to nobody the underwriter
can question.

Analysts need somewhere to think, and internal notes are legitimate. They attach to the package, never
to a finding, and they never render.

---

## D-086 — No reuse of the mintro-intake-lite text harvester
**2026-08-24 · Frank's ruling**

Three independent disqualifiers. Each one is sufficient on its own.

**1 — No provenance below document level.** The candidate record is
`{value, source_type, source_document_request_id, source_file_url, extracted_at, confidence,
source_filename, matched_label}`. No page, no location, no snippet. `matched_label` looks like
provenance and is not — it holds the label string the scraper matched on, which is a fact about the
scraper. Measured instance: `matched_label: "Merchant Name"` against `value: "Merchant Address"`, a
wrong pairing preserved faithfully with no way to see where either came from. D-087 makes such a value
not a candidate at all.

**2 — It derives its own configuration by reading its own source.** `deriveStrictValidatedFieldKeys`
calls `Function.prototype.toString()` on `isFieldValueValid` and regex-matches `field === "..."` out of
the resulting text to build its validation key set. Observed: 29 keys, `sane = true`. Any bundler,
minifier, transpiler, or refactor to a lookup table changes that source text — and the failure is
silent by design, disabling vision escalation rather than raising. **Code that reads its own source
cannot be relocated.** That is not a defect to repair on arrival; it is a property of the design, and
the property is "does not move."

**3 — The field vocabulary is that app's catalog.** Candidate keys are `document_requests.title`
strings: `"who was your last processor/bank?"`, `"owner 1 ownership %"`. Adopting the harvester adopts
the merchant-application form it was written to fill, and our field names become theirs.

**Rebuilding costs less than retrofitting**, and this is a measurement rather than a preference. The
harvester is ~500 lines of label-adjacency scraping declared inside a ~1,700-line function inside a
44,908-line file, exporting nothing. Lifting it is not a move; it is a rewrite that carries the
original's assumptions across intact. And what it produces when it is working correctly is the subject
of D-088.

---

## D-087 — No candidate without provenance
**2026-08-24 · Frank's ruling**

Every extracted value carries **document version, page, location within the page, and a verbatim
snippet**. An extraction that cannot supply these is **not a low-confidence candidate — it is not a
candidate.**

**This is constraint 3 reaching the extractor.** A finding carries the capture its kind requires, and
for a documentary finding the capture is what the document said and where it said it. A value without
that backing is an assertion, and constraint 3's answer to an unbacked assertion is `not_evaluable`,
never a bare claim.

**The strictness is the mechanism, not emphasis.** "Low confidence" is a dial, and dials get turned
when a release is late. Making unprovenanced values *not candidates* means nothing downstream has to
decide how much provenance is enough, and there is no threshold available to relax. Same instrument as
constraint 4's review tier: a category, not a score (D-009).

### What per-page rasterization settles, and what it does not

D-095 makes page attribution a property of the request rather than a claim by the model, which settles
**document version and page**. It does not settle **location within the page** or **the snippet** — a
vision call over a rendered page returns values, not coordinates, unless the schema and prompt require
them.

**Per-page routing is necessary for this decision and not sufficient**, and mistaking it for sufficient
is the most likely way this gets violated: the page number will be present, the record will look
provenanced, and two of the four required elements will be missing. Where the location and snippet
cannot be produced, the extraction is not a candidate — the same as if the page were unknown.

D-089's form-field path is the one place all four arrive without effort: a value read from an AcroForm
field carries its field name, its page, and its widget rectangle directly.

---

## D-088 — Confidence never gates a state, and nothing auto-applies
**2026-08-24 · Frank's ruling**

There is no auto-apply concept in Documents Check.

### The measurement

The surveyed app's own committed fixture: a four-page merchant processing application carrying **67
filled AcroForm fields**. Extracted text: the blank template. The harvest returned

    business_legal_name  =  "Merchant Address"           0.90
    dba_name             =  "(Doing Business As) Name"   0.94
    bank_name            =  ", Fresno, CA."              0.94

— the last a fragment of an ISO disclosure line. **The true values are absent from the extracted text
entirely.** That app's auto-apply threshold is 0.90; the `dba_name` value clears every gate including
the noise filter, and would be written into the record with no human seeing it.

The confidence was 0.92 adjusted for *how the match was shaped* — same line or next line, generic
label or specific. **It never looked at the value.** It cannot be evidence about correctness because
it is not computed from anything that could be wrong.

### Why this is worse for a consistency check than for a form-filler

A wrong pre-filled form field is one wrong field, and the next human to look at it may catch it.
Documents Check **compares documents**. Two documents run through one extractor with one blind spot
fail the same way — an application and a W-9 both yielding a label fragment where the legal name
belongs produce **agreement**.

The check then reports "consistent across two documents," and the agreement is an artifact of the
extractor rather than a property of the paperwork.

> **Manufactured corroboration reported as a clean result is the worst output this feature can
> produce.** Not a wrong value — a wrong value has a chance of looking wrong. Two independent-looking
> sources appearing to confirm each other invites acceptance.

It is D-011's shape with an extra hazard, and the surveyed app reached the same conclusion from the
other direction: it discards a text harvest when a document escalates to vision, because junk sitting
beside real values from a second extractor "is precisely the shape a reconciler reads as
CORROBORATION."

**Consistent with D-009: confidence, like severity, does not touch state.** A model's self-reported
confidence may be recorded as an observation about the extraction. It may not decide anything.

---

## D-089 — Read the form fields first, and dispatch on magic bytes
**2026-08-24 · Frank's ruling**

AcroForm fields are read **before** text extraction is attempted. File type comes from **magic bytes**,
never from the filename extension.

**Form fields first, because the values are already structured and nothing was reading them.** The
measured case: 67 filled AcroForm fields present in the file, and the text layer holding the blank
template. `pdf-lib` reads those fields and is already a dependency in the surveyed app — used only
ever to *write* them, never once to read an upload.

**Form field names are provenance for free.** A value from a field named `"BusinessCorporate Name as
shown on your Income Tax Return"` arrives with its own label, its own page, and its own coordinates
from the widget rectangle. No adjacency guessing, no model, no inference. On a filled application this
is the strongest provenance available anywhere in the pipeline and the cheapest to obtain — it is the
one path that satisfies all four of D-087's elements without asking anything of a model.

**Magic bytes, because extension is merchant-supplied metadata about content.** The surveyed app
dispatches on `path.extname`: a PDF saved as `.txt` is skipped, an HTML error page saved as `.pdf`
reaches the PDF parser and throws, a `.heic` from an iPhone is dropped without a record. Trusting the
extension is establishing the content from something adjacent to it rather than from the content —
constraint 9's error in miniature. It also feeds D-092: a wrong extension is one of the routes by
which a file reaches no outcome at all.

---

## D-090 — Text density per page, separators stripped, routing per page
**2026-08-24 · Frank's ruling**
**Reasoning corrected — see below.**

Measure text density **per page**, with page-separator artifacts stripped. Route **per page**.

**Why stripped.** Measured: `pdf-parse`'s default page joiner appends `-- N of M --` after every page's
text. A pure-image PDF therefore measures **12 characters at one page, 26 at two, 149 at ten**, against
the surveyed app's 20-character floor — so its documented "image-only PDFs route to vision" rule fires
**only on single-page files**. Every longer scan is classified as having a text layer on the strength
of the parser's own furniture.

> A threshold that is measuring its own tooling's output is measuring nothing.

Note how it fails: the error **scales with page count**. It is correct on the one-page document and
wrong on everything larger, which is the worst possible direction — it degrades exactly as documents
get longer and more consequential.

**Why per page.** Hybrid documents are the ordinary case rather than the edge: a typed application with
a photographed page inserted, a signature page scanned back in, a bank letter appended to a form. **A
per-document routing decision must pick one answer for a file that has two**, and is therefore wrong
about part of every hybrid it meets.

Per page the question is also stable in a way the aggregate is not: a page with no text has no text,
regardless of how many other pages the file contains.

### Corrected reasoning — the separators are not in the PDF

**The ruling stands unchanged. The mechanism above describes a defect this stack does not inherit.**

`-- N of M --` is `pdf-parse`'s `pageJoiner`, appended by the library after each page's text. It was
never PDF content. Measured while building M0: read through pdfjs directly, **an image-only page
returns zero text items**. The 12 / 26 / 149 characters cited above are the surveyed app's tooling
describing itself, and no reader we use produces them.

So the specific inflation that broke the surveyed app's threshold cannot happen here at all, and a
reader coming to this entry cold would otherwise go looking for separators to strip and find none.

**What survives the library change is the reasoning that was underneath it:**

> Count only glyphs the document is making a claim with.

A scanner that stamps `Page 3 of 12` onto an otherwise blank scan reproduces the same failure from a
different source — a page that is an image, measured as a page with text, because something wrote a
number on it. That is not a `pdf-parse` artifact and no change of library removes it. Stripping runs
for that reason rather than for the one originally given, and `stampedScanPdf` is the fixture that
holds it.

**A second correction, and it matters more than the first.** The obvious regression test for this
ruling does not test it. A *pure*-image PDF measures zero glyphs whether you total the document or
read it page by page, so it passes under both designs — verified by reverting the M0 extractor to an
aggregate threshold, which left every image-only assertion green. The case that discriminates is a
scan whose **first page carries a text header** and whose remaining pages are images: aggregated,
the header licenses the text route for the whole file and pages 2–n come back empty, which is
indistinguishable from pages that had nothing on them.

The general form is the one this project keeps relearning: **ask what the assertion does when the
thing it guards is broken, and check by breaking it.** An assertion that passes either way is not
evidence about the design it appears to be defending.

---

## D-091 — SHA-256 on ingest; the hash is document identity
**2026-08-24 · Frank's ruling**

Every file is hashed on arrival. The content hash **is** the document's identity — it drives
deduplication and the supersedes chain D-002 requires.

**Filenames are not identity.** The same statement arrives as `scan.pdf`, `Scan 1 (2).pdf` and
`bank feb.pdf`; three unrelated documents arrive as `document.pdf` three times over. Content is what a
document is, and it is the only thing about a document that cannot be restated.

**Deduplication matters because merchants re-send.** The surveyed app has two rows pointing at one
stored object and needed a URL-prefix normalizer to notice they were the same file — path comparison
standing in for identity, which works until a second code path writes the path differently.

**The supersedes chain is the D-002 half.** A replacement is a new document; the old one is not
overwritten. The slot moves to `superseded` (D-078) and both records remain, joined by the chain. Runs
stay immutable, and a report issued last week keeps pointing at the bytes it actually read.

One value doing three jobs, none of them extra work: identity here, the evidence record's integrity
proof under constraint 3, and the cache key in D-096.

---

## D-092 — Silent skip is prohibited
**2026-08-24 · Frank's ruling**

Every ingested file resolves to a **recorded outcome**. Nothing is marked processed without a
**persisted result**.

### What was observed

The surveyed app stamps `extracted_at` — the mark that removes a document from scope — in three cases
where nothing was extracted:

- **unsupported file types**, reached by an `else { continue; }` that records no error at all
- **escalation nominees that lost** the one-per-invocation contest
- **harvests that produced zero candidates**

All three are then filtered out of every subsequent run and never looked at again. The per-document
diagnostic record that would explain any of it exists only in one HTTP response body and is never
persisted.

### Why this is the D-026 shape

A document nobody could read and a document read and found empty become the same thing: a slot with
nothing in it and no record of why. **The failure is in the direction nobody checks** — a missing
finding does not appear anywhere to be questioned, and the run reports as complete. Nothing
distinguishes a thorough read of a clean document from a file that was never opened.

### Two rules, and the second is the one that gets broken

1. **Every file gets an outcome.** Not an absence of error — an outcome, named and stored.
2. **The outcome is persisted before the file is marked done**, and a file is never marked done on the
   strength of having been *attempted*.

The surveyed app knew the second rule for candidates and says so in its own ordering comment — write
results, then stamp, because a crash between them costs redundant work while the reverse costs the
harvest permanently. It then lost the rule in exactly the cases where there were no results to write.

**The permitted outcomes are states this project already has.** A file that could not be read is
`not_evaluable` with the attempts evidenced (constraint 3). A file type we do not handle is a recorded
outcome naming the type, not a `continue`. D-096's terminal failure state is the bounded-retry case of
this same rule.

---

## D-093 — Vision extraction is approved; metered model calls are not vendor spend
**2026-08-24 · Frank's ruling**

> References resolved the same day: D-076 through D-092 were ruled in this session and inserted
> above, after D-093 through D-096 had already been written — a sequencing error, recorded here
> rather than tidied away.

Documents Check may call the Anthropic API to read documents. This is approved for the release.

**The no-budget constraint was about data vendors, and this is not one.** A data vendor is a new
commercial relationship — contract, procurement, a recurring line nobody has agreed to. Metered
model calls run on an account Mintro already holds and already pays. The two were never the same
category; treating them as one would refuse a capability on the strength of a rule aimed at
something else.

**Without it there is no observation to report.** There is no OCR in this stack and none is being
added. A photographed owner ID, a phone snap of a voided check, a scanned EIN letter — none has a
text layer. Nothing reads them. This is not "extraction is worse for photo-native documents"; it is
that nothing happens at all.

Follow that through the four states. A rule that cannot be observed returns `not_evaluable`
(constraint 2), and a `not_evaluable` finding must evidence why. So a Documents Check without vision
does not fail loudly or cheaply — it produces a correct, well-evidenced report that says *we could
not read this document* for every merchant who photographed their paperwork, which the survey's
working log identifies as the highest-frequency real case. The EIN consistency check and the
bank-detail consistency check are comparisons; with one side unreadable they have nothing to compare
and return `not_evaluable` too. Two of the checks the phase exists for, dark, on the merchants most
likely to need screening.

**What is actually dangerous about metered calls is repetition, not unit price.** The surveyed app
has no budget guard, no spend ceiling, and one documented failure mode — a document whose call times
out is never marked done, so it is re-read and re-charged on every subsequent run, indefinitely. The
unit cost was never the problem there. The unbounded loop was.

So this approval is not standalone. It holds because D-095 bounds what a call reads and D-096 bounds
how many times the same bytes can be read. **Approved with those two, not before them.**

---

## D-094 — Extraction is a queued job on the worker, never a serverless function
**2026-08-24 · Frank's ruling**

Document extraction runs on the Fly worker, through the existing Postgres job queue. It does not run
in a Netlify function, and none of the surveyed app's pacing constraints are inherited.

**Three of that app's oddest rules are not extraction decisions.** They are shapes pressed into it
by a ~26s serverless proxy cap, and the code says so in its own comments:

- a **12-second budget** for the whole document loop, derived in-comment from the proxy cap minus the
  worst-case retry chain
- a **four-document ceiling per click**, which is that budget divided by the measured ~3.5s per
  document — an eight-document package therefore needs two clicks *by design*
- **one vision escalation per invocation**, to keep a single request inside the same envelope

Read as extraction policy these are bizarre. Read as timeout accounting they are sensible. We deploy
the worker on Fly precisely so we do not have to do timeout accounting — the same ruling the
architecture already makes for the crawler, applied to the second long-running workload rather than
rediscovered for it.

**The cap is not merely awkward; it manufactures a false clean.** The survey measured what the
one-escalation rule does when several documents need vision in the same run: the losers commit an
empty result, record no error, are marked processed, and drop out of scope permanently. A document
nothing could read is indistinguishable from a document that was read and held nothing — produced by
a timeout, not by anything about the document. That is the D-026 signature, and inheriting the cap
would inherit it.

**So the rules here are the absence of those rules.** No wall-clock budget on the loop. No cap on how
many documents may reach the model in one execution. No package that requires a human to click again
to finish. A run reads every document it was given, or it fails visibly with the failure recorded.

**What must still be true.** Extraction produces results attached to a run, and a run stays immutable
(D-002, constraint 8). Re-reading a merchant's documents creates a new run; it never edits an old
one. The worker already needs a real process and a filesystem for D-095's rasterization, which is a
second reason this work cannot live in a Lambda even if the clock allowed it.

---

## D-095 — Rasterize per page; a whole-PDF call has no page to attribute to
**2026-08-24 · Frank's ruling**

Pages are rasterized and sent to the vision model individually. A PDF is never sent whole as a
document block.

**A whole-PDF call destroys page attribution before the model answers.** The surveyed app sends the
file as a single `document` block, the vendor rasterizes server-side, and what comes back is a flat
object of field values. There is nowhere for a page number to come from. Not because the schema
forgot one — because by the time the model replies, the only party who knew which page anything was
on was the vendor's renderer, and it does not report.

The only recovery is to ask the model where it saw each value. **That is not provenance; it is the
model attesting to its own provenance.** It is a claim we would be transcribing into a report as
though it were a capture, and it fails D-087 for exactly the reason D-087 exists.

Per page, the page number is a property of the *request*. The caller knows it before the model
answers and the model cannot be wrong about it. The capture is the rasterized page; the attribution
is the fact that we sent that page. This is constraint 9's rule in a different setting — establish
the surface structurally, rather than deriving it from the thing being measured.

**A per-page decision also cannot fail the way a whole-document threshold failed.** The surveyed
app decides text-layer-versus-vision by measuring the *whole file's* extracted text against a
20-character floor. The survey measured what that does to a pure-image scan: the PDF library's own
per-page separators (`-- 1 of 4 --`) are text, so a scan with no readable content at all measures 12
characters at one page, 26 at two, 149 at ten. Only a single-page scan is ever recognised as
textless. Every longer scan is classified as having a text layer, on the strength of the parser's
own furniture.

Asked per page the question has no such failure: a page with no text has no text, whatever the rest
of the file contains. It also answers correctly for the ordinary mixed document — a typed
application with one photographed page inserted — where any whole-file verdict must be wrong about
part of it.

**With D-090, per-page is not the expensive option.** Only pages that need vision incur a call. A
twelve-page application with two photographed inserts costs two calls, against one call carrying
twelve rendered pages of tokens.

**The cost of this ruling, recorded so it is not rediscovered.** A page-scoped read cannot see across
a page break. A label at the foot of page 3 whose value sits at the head of page 4, or a table
spanning both, will not be read as one thing. That is a real loss and it is accepted, because of
which direction it fails in: the page-scoped read does not find the value, and not finding a value
produces `not_evaluable`, not a wrong one. If a class of document turns out to straddle breaks
routinely, this ruling is the thing to revisit — not the evidence requirement it exists to serve.

---

## D-096 — Results are cached on content; attempts are bounded and terminate
**2026-08-24 · Frank's ruling**

Extraction results are cached on `(sha256, extractor_version)` per D-091. Extraction attempts on a
single document are bounded, and exhausting the bound produces a recorded terminal failure.

### Why the cache is a correctness requirement, not an optimisation

Documents Check re-runs whenever a merchant sends anything. On the fourth upload round, three
rounds' worth of documents are unchanged, already read, and about to be read again. Uncached, the
bill for a merchant is not the number of documents — it is documents multiplied by rounds, and the
multiplier is set by how disorganised the merchant is.

**The key has to carry the extractor, not only the content.** `sha256` alone says the bytes are the
same; it says nothing about whether the thing that read them still exists. A prompt revision or a
schema change must invalidate, or a report cites results produced by an extractor no longer in the
codebase and nobody can tell by looking.

**The hash is already required.** Constraint 3 makes SHA-256 part of the evidence record for a
documentary finding. The cache key is a byproduct of evidence we must keep regardless, not a new
artifact to maintain.

**What the cache may not become.** It serves extraction results *into* a run. It is an input, like
the ruleset version. It never reaches backwards: a finding belongs to the run that recorded it, with
its own evidence, and a later run producing the same value from a cache hit records that value
afresh (D-002, constraint 8). "Cached" must never come to mean "shared between runs."

### Why attempts terminate

The surveyed app's carry-forward, quoted in its own commit message: a document that escalates and
times out "is never stamped, contributes nothing, and re-bills on each click," and the fix — "a
terminal state (attempt counter, stamp after N)" — is described as still outstanding.

Their reasoning for not marking a failure done is correct as far as it goes. Marking it done is a
silent permanent skip, which is the worse error. But those are not the only two options, and the
third one is the one this project is built around:

| | Cost | What the report says |
|---|---|---|
| Retry forever | unbounded, invisible | nothing — the document is perpetually pending |
| Mark done on failure | bounded | nothing — reads identically to a clean document |
| **Terminate and record** | **bounded** | **`not_evaluable`, with what was attempted** |

The third row is not extra machinery. **Constraint 3 already requires it**: a `not_evaluable`
finding must evidence *why*, with the requests attempted and what they returned. The attempt ledger
that bounds the retries is the same ledger that evidences the outcome. Bounding cost and satisfying
the evidence rule are one piece of work, and skipping the bound does not save the bookkeeping — it
just means the bookkeeping never terminates.

**Unbounded retry is not resilience. It is an unpriced failure mode**, and one that grows fastest on
exactly the documents least likely to ever succeed.

---

## D-097 — The binary purge is withdrawn; archival restricts access, not existence
**2026-08-24 · Frank's ruling · amends D-084**

**Extended by D-130 — see below.** Bodies are purged at 180 days, but only after a verified export,
and a purge is an insert rather than a deletion of any row. **Also: the restricted-access regime
this entry describes is unbuilt** — `document_retrievals` has never been written to and no package
has ever been archived.

D-084's binary purge is withdrawn. Document bodies are retained under hard constraint 3 and
constraint 5's append-only rule, alongside the findings ledger, extracted field metadata and run
history. **Nothing in a package is deleted by application code.**

### The purge traded away exactly what constraint 3 exists to protect

D-084 reasoned from privacy exposure. The exposure is real and the reasoning was sound as far as it
went — but what it spent to reduce that exposure was defensibility, and constraint 3 is not a
preference that a sufficiently good reason can outweigh. **It is the refusal of that specific
trade.** It says so in its own words: store the artifact body, not only its hash, because a hash
"does not let anyone read what the document said."

The architecture doc reaches the same conclusion about the append-only triggers, and the sentence
transfers intact: *a guarantee that yields to a good reason is not a guarantee.* The purge had a good
reason. That is what made it dangerous, not what made it acceptable — a retention policy nobody could
justify would never have been written.

### A snippet answers the question a check asked

> A retained snippet is evidence for a finding we thought to make. It cannot answer a question no
> check asked.

That is the question that actually arrives: a processor, six weeks after submission, asking not
*"what did this check find"* but *"what does this statement say about X"* — where X is something no
rule in the ruleset addressed. The snippet cannot answer it. It lets someone re-read the fragment we
already quoted, which is the part nobody is disputing.

Generalised, because it will recur: **an evidence store holding only what the checks looked at is
complete with respect to the ruleset at the time of the run, and incomplete with respect to every
question asked afterwards.** Runs are immutable (D-002) precisely because later questions are
expected. Keeping the run and discarding what it was computed from preserves the answer and destroys
the ability to check it.

### The privacy interest is real, and is met a different way

At archival the package moves to **restricted access**:

- document bodies remain
- retrieval requires an explicit operator action
- every retrieval is logged against the package

The 30-day window from D-084 survives as the boundary between open access and restricted access,
rather than between existence and deletion. The day-23 operator notice survives unchanged in purpose:
it announces the access change, not an impending purge.

This is constraint 6's move applied to retention — the requirement restated as a **property** rather
than a mechanism. The property wanted is *bodies are not casually reachable, and every reach is
recorded*. Deletion was one mechanism for that, and the mechanism was in conflict with a hard
constraint while the property is not.

**The trade should be named rather than presented as free.** Access control is a weaker protection
against a full compromise than data that does not exist; deletion is genuinely the stronger privacy
control, and this project cannot afford it. What restricted access buys back is accountability a
purge cannot offer: under deletion, the last reads before the data went are invisible and the record
of who wanted it goes with it. Under this rule every retrieval leaves a trace against the package.

### Consequence for D-002 and constraint 5

With no deletion path, the supersedes chain (D-078, D-091) is **complete for the life of the
package**. A superseded document version remains readable, so *"what did the first version of this
statement say"* is answerable. Under D-084 it was not.

Worth naming the shape of what that would have been: a purge at 30 days would have left superseded
entries pointing at bytes that no longer existed — **a chain that looks intact and resolves to
nothing.** A reader following it would find structure where there was no longer any content, and
nothing in the chain itself would say so. That is this project's recurring defect wearing a retention
policy, and it is the second reason to refuse the purge independent of the first.

### "By application code" is the operative phrase

The rule is not *we will not delete*. It is that **no code path exists that can**, which is
constraint 5's form and the same distinction the architecture doc draws between what RLS decides and
what triggers decide. A constraint aimed at us cannot be enforced by a mechanism we hold the keys to.

Where that enforcement lives is an architecture question and is not settled here. What is settled is
the property it has to produce: **a retention job with a delete path is not permitted to exist**, and
neither is an operator override on one.

---

## D-098 — The two-source rule: one source is not a comparison
**2026-08-24 · Frank's ruling**

A consistency check with one source present returns `not_evaluable`, **never `pass`**. This applies
to every check in family C.

**A consistency check is a comparison, and one value is not a comparison — it is a reading.** `pass`
means *these agree*. A single value cannot agree with itself.

**Why `pass` is tempting here, which is the part worth writing down.** The lone value is usually
well-formed: a nine-digit EIN, correctly shaped, sitting on the application. It looks like a
satisfied check. But well-formedness is a property of the string, and the check's question is
whether the merchant's documents agree about it. **Format validation answers an easier question,
and answering the easier question is how the false pass gets in.**

**This is constraint 9 one layer up.** The constraint says a check that locates its subject by
matching the compliant form is blind to every non-compliant instance. The same structure applies to
comparison: **a check that confirms a lone value is blind to every disagreement it never saw.** In
both cases the set of things the check cannot see is exactly the set it exists to find.

### The scoring consequence, which is the one an underwriter feels

Merchant A supplies the application, the EIN letter and a W-9. The three disagree, and C-03 reports
it. Merchant B supplies the application alone. Under a `pass`-on-one-source rule, C-03 comes back
clean.

> **The less evidence you provide, the cleaner you look.**

That is a perverse incentive written directly into the report, and it would be invisible — a clean
report is a clean report, and nothing on the page would say that the cleanliness came from thinness.

### The missing source is already reported, in the family whose job it is

Worth being clear that this does not let a thin package off. A missing second source is usually a
missing slot, and family B reports slot state. So the absence surfaces twice, correctly:

- **Family B** — this required document was not supplied, in one of D-078's states with a D-079
  reason.
- **Family C** — this comparison could not be made.

Two facts, two places, neither one pretending to be the other. What is forbidden is the third
rendering, where C says `pass` and the reader infers the comparison happened.

### What must still be true

The `not_evaluable` **names which source was present and which were absent**, from the check's
enumerated `not_evaluable_when` conditions. A generic "insufficient data" is the same failure in
smaller type: it does not let a reader tell an unsupplied EIN letter from an unreadable one. Where
the absent source has a recorded `not_provided` reason, that reason carries through to the report
(D-078, D-102) — "not evaluated: no processing statements, new business" is a complete observation.

---

## D-099 — `fail` versus `review` is exactness of comparison, not importance of field
**2026-08-24 · Frank's ruling**

**`fail`** — the comparison is exact and a mismatch cannot be innocent: digit strings, dates against
a threshold, slot presence, arithmetic.

**`review`** — the comparison is fuzzy and a mismatch is often innocent: names, addresses, derived
figures set against stated ones.

**Importance cannot be the criterion, because D-009 forbids severity from touching state.**
"Importance" is severity wearing a different word. If *the routing number matters more than the
address* could set state, the state would encode our judgement of consequence — and a state that
encodes consequence is a determination, arrived at by arithmetic instead of by sentence.

So the criterion has to be a property of the **comparison**, not of the field. Exactness is that
property, and the question it asks is: *can a mismatch here be innocent?*

- **It cannot, for digit strings.** There is no formatting convention under which `071000013` and
  `071000014` are the same routing number. Two nine-digit strings match or they do not.
- **It very often can, for names and addresses.** "Acme Foods LLC" and "Acme Foods, L.L.C." are one
  company. A suite line written two ways is one address. A derived monthly volume a few percent off
  a stated one is a rounding difference or a different period boundary. A `fail` here would be wrong
  more often than right, and constraint 4's reasoning governs: false positives destroy trust in the
  tool faster than absent checks do.

### The asymmetry is intentional and looks wrong at a glance

A routing number off by one digit `fail`s. A legal name off by a comma goes to `review`. Read as
importance that is absurd — a name is at least as identifying as an account routing number.

Read as exactness it is exactly right. **The state describes what the comparison can support, not
what the mismatch means.** An underwriter reading `fail` on C-08 learns one specific thing: two
documents disagree in a way that cannot be a formatting difference. That is a fact about the
documents. Whether it is a typo, a stale voided check, or something else is theirs to decide
(D-001).

### Normalization is what makes the fuzzy tier tractable

Names and addresses are normalized before comparison, and **the normalization is shown in the
evidence**. Raw differs, normalized matches → `pass`, with both forms displayed. Normalized still
differs → `review`. Showing the normalization is what keeps the finding an observation rather than a
conclusion: the reader can see what we treated as equivalent and disagree with it.

### What must still be true

**A check's tier is a property of the check, declared in data — not chosen per instance.** A check
declared `review` returns `review` however large the discrepancy looks, and a check declared `fail`
does not soften because the difference seems like an obvious typo. This is constraint 4's rule for
`review_only` rules applied to the same problem: the moment a state can be talked up or down on the
facts of one instance, it stops being a property of the comparison and becomes a judgement about the
merchant.

---

## D-100 — Two evidence tiers, and the weaker one governs a mixed check
**2026-08-24 · Frank's ruling**

Following from D-087's four required elements:

| Tier | Source | Supplies |
|---|---|---|
| **character** | AcroForm fields (D-089), PDF text layer | all four — version, page, location, verbatim snippet |
| **page** | vision (D-093, D-095) | document version and page only |

**A check whose inputs span both tiers reports at the weaker tier.** The report states which tier
each observation rests on.

**Page tier cannot be improved, and the reason is structural rather than budgetary.** Location and a
verbatim snippet would have to come from the model, and D-095 already ruled that a model reporting
where it looked is a claim rather than a capture. Asking a vision model for a bounding box is asking
it to attest to its own provenance, which is the thing D-095 refuses. No prompt fixes this; it is a
property of the instrument.

### This qualifies D-087, and the qualification should be visible

D-087 says an extraction that cannot supply all four elements "is not a low-confidence candidate — it
is not a candidate," and its own closing section says a vision value with no location or snippet is
not a candidate. Read strictly, that bans vision outright — which is the outcome D-093 examined and
refused, because it leaves every photographed document unreadable and the consistency checks with
nothing to compare.

So the reconciliation, stated plainly rather than left to be inferred: **D-087's absolute
prohibition is on the *unmarked* value** — provenance silently absent, a page-tier reading presented
in the same shape as a character-tier one. A page-tier observation that is **marked as such**, at a
stated tier, with the page and version it does have, is admitted. What is never admitted is unequal
evidence rendered as equal.

That distinction is the whole ruling. Marking is not a caveat attached to a weaker finding; it is
what makes the weaker finding honest rather than false.

### Why the weaker side governs a mixed check

An EIN comparison between an AcroForm application and a photographed EIN letter is **page tier**.
The observation is a statement about both documents, and it is only as good as its weakest side.
Reporting it as character tier because one input was strong would overstate the pair, which is
constraint 3's rule about evidence appropriate to the surface — and the surface of a comparison is
its weakest input.

### The tier belongs in the finding, not in a footnote

An underwriter weighing a disagreement needs to know whether a value was read from a named form
field or from a photograph. Two findings that render identically while resting on different
qualities of evidence is precisely the presentation defect D-047 found: a control that cannot
distinguish two records a reader might plausibly hold.

**Practical shape, worth stating because it is counter-intuitive.** The anchor document is usually an
AcroForm, so the application side of most comparisons is character tier. It is the merchant's
*supporting* documents — photographed IDs, voided checks, scanned EIN letters — that pull
observations down to page tier. The stronger the merchant's paperwork looks to a human, the more
often it is the weaker evidence in our terms.

---

## D-101 — Documents Check rules live in two new files
**2026-08-24 · Frank's ruling**

**Amended by D-128 — see below.** The two-file split stands; `documents.templates.json` holds one
template rather than a per-processor array, because no per-processor requirement set exists.

Not in `rules/ruleset.json`. Two new files:

- **`rules/documents.checks.json`** — the checks, the document catalog with `examined` /
  `collected_only` flags, and the D-079 reason enumerations.
- **`rules/documents.templates.json`** — per-processor required slot sets and the D-081 conditionals.

`packages/ruleset` gains a **second loader and validator**, not a second package.

### Why not `ruleset.json`

That file is the Site Check program ruleset and it has its own schema: check types, scopes, tiers,
`expect`, `threshold`. Documents Check has a different shape — slots, counts, coverage windows,
cross-document comparisons, evidence tiers. **Forcing both shapes into one schema produces a schema
that fits neither**: every field optional, every invariant conditional on which kind of rule it is,
and the closed-schema property gone.

That property is not theoretical. D-010 records the schema catching two malformed rules the author's
own audit had passed over — the case for closed schemas is empirical here, and an open schema is
what a merged file would force.

**Constraint 1 requires the rules be data. It does not require one file.**

### Why two files rather than one

They change on different clocks, for different reasons, and by different hands.

`documents.checks.json` changes when **capability** changes: a check is written, a document type
moves from collected to examined, an enumeration gains a value. Rare, and every such change is
adjacent to code.

`documents.templates.json` changes when **a processor is added or a requirement shifts**. Frequent,
operational, and **the file most likely to be hand-edited by someone who is not an engineer.**

Splitting on rate of change and on who edits is the point: a file edited routinely by a non-engineer
should not also contain the check definitions. **The blast radius of a bad edit should match how
routine the edit is.**

### The test this design has to pass

> **Adding a processor is one entry in one file. No code, no schema change.**

That is what constraint 1 is for, and it is also the check to apply if this ever feels wrong: if
adding a processor requires touching a handler, the split is in the wrong place.

### One package, two loaders

A second package would duplicate the test harness, the CLI, and the exit-1-on-malformed behaviour in
order to hold a second JSON schema. `packages/ruleset`'s job is *load and validate rule data*; it now
does that for two shapes.

### What must still be true

**D-025 extends to both files.** Any change to either carries a decision number in the same commit,
exactly as `ruleset.json` does. A ruling that reaches the data but not this document is unreviewable
six months out whichever file the data lives in.

**The validator must catch cross-file dangling references.** This is new and it is where the first
real bug will be: a template naming a slot or a check that no catalog entry defines. Two files means
ids crossing a file boundary, and an id that resolves to nothing is a requirement that silently does
not exist — a template that looks complete and enforces less than it says. Validate it the way the
loader already validates a rule referencing a missing target rule.

**Note:** `docs/CHECK-INVENTORY.md` names a single `rules/documents.json` in its opening. This
decision supersedes that; the inventory's content is accepted (D-102), its filename is not.

---

## D-102 — Document catalog and reason enumerations accepted; three items stay open
**2026-08-24 · Frank's ruling**

`docs/CHECK-INVENTORY.md` §3 and §5 are accepted as drafted: **13 examined document types, 7
collected-only, 9 `not_provided` reasons, 4 waiver reasons.** Counts verified against the inventory
at acceptance.

**The counts are recorded because the enumerations are fixed under D-079.** A decision that accepts
"the list as drafted" without a number cannot detect a later silent addition, and a fixed list that
grows quietly is not fixed. The number is the checkable part.

### Three items remain open, and are recorded rather than defaulted

**1 — The statement freshness window.** 45 days is a placeholder in §4 and may vary by processor.
It is load-bearing rather than cosmetic: B-04 and B-06 both key on it, and B-06 re-evaluates at
report generation, so this number is what decides whether a package that sat on someone's desk turns
into a `fail` on its way out the door. **A placeholder that ships becomes the rule by inertia**, and
nobody afterwards can tell it was a guess.

**2 — "Applied for, not yet issued."** It genuinely does not fit D-078's five states. The document
will exist, so `not_provided` is wrong. The slot is still actionable, so it belongs in `missing`. But
`missing` carries no reason field, and an agent reading `missing` against a licence filed last week
will chase something already in motion. The inventory names three ways out — a sixth state, a reason
field on `missing`, or accept the noise. **This is a workflow question, so it is not one to settle by
reasoning from the data model.**

**3 — Whether a DBA filing slot is added.** The document type is in the examined catalog; the slot is
not in §4's table.

### The consequence of the third, stated precisely

The inventory's §8 says that without a DBA filing, C-02 "can only compare the application to itself
on the DBA side." **That overstates it, and the correction matters for the two-source rule.** C-02
reads the application, the DBA filing, the bank statement and the voided check. Without the filing it
still has three sources, and D-098 is satisfied whenever the bank statement or the voided check
carries a DBA — so C-02 does not collapse to `not_evaluable`.

What is lost is the **anchor**. The filing is the only one of the four that is an authoritative
record *of* the DBA rather than a downstream *use* of it. Agreement among the application, the bank
statement and the voided check establishes that the merchant uses the name consistently. It does not
establish that the name is registered, and the report must not be worded as though it did.

### What must still be true

These three are recorded here so that they are not resolved by implementation. **A build that picks
45 days because it was in the draft has made a business ruling in a commit**, which is exactly what
D-025 exists to prevent.

---

## D-103 — pdf-lib and pdfjs-dist are approved for packages/extraction
**2026-08-24 · Frank's ruling**

Both are approved dependencies of `packages/extraction`. `packages/engine/src/pdf.ts` — the
hand-rolled zlib content-stream extractor — is unaffected and stays.

**The architecture doc's ruling against PDF libraries governs report *generation*.** Its subject is
producing the report: the worker already has a browser, `page.pdf()` is the whole mechanism, and
adding Puppeteer or wkhtmltopdf or a React-PDF layer would duplicate a rendering stack we already
carry. A hand-rolled writer there keeps output deterministic, and determinism is the property that
ruling protects.

**Reading positioned text is a different problem with a different answer.** D-087 requires location
within the page. Location requires glyph positions. Glyph positions require a text-matrix
interpreter, font encodings and CID handling — and that is not a thing anyone should hand-roll at a
sensible cost, nor a thing whose failures would be visible if they got it slightly wrong. A
mis-mapped glyph produces a *wrong value carrying complete provenance*, which is worse than no
value (D-088).

`packages/engine/src/pdf.ts` already anticipated this split, in its own words: the generation ruling
"is about generation and does not cover reading, so this is a new decision rather than a departure
from an old one." This is that decision, made explicitly rather than left as a comment.

**Division of labour, so neither reader drifts into the other's job:**

| Reader | Reads | For |
|---|---|---|
| `pdf-lib` | the AcroForm — names, values, page, widget rectangles | D-089's form route |
| `pdfjs-dist` | the page content stream — positioned text items | D-087's location provenance |
| `packages/engine/src/pdf.ts` | flat text from content streams, no positions | COA rules (D-057), unchanged |

The engine's extractor is not deprecated by this and must not be replaced with a call into
`packages/extraction`. It answers a narrower question for a different surface and its limits are
documented where they are relied upon.

---

## D-104 — HEIC is converted at ingest, not refused
**2026-08-24 · Frank's ruling**

**Implementation deferred indefinitely by D-127 — see below.** The ruling stands; the conversion
path stays behind its port, and `unsupported` with a reason is the shipping behaviour.

HEIC is converted to JPEG at ingest on the Fly worker, and **the original is retained under
constraint 3**. `packages/extraction` stays format-pure and never receives HEIC. **M1 scope.**

**Refusing it puts a decode on an operator's desk and calls it a policy.** HEIC is the iPhone
camera default, and photographed owner IDs and voided checks are the two most-photographed types in
the catalog — so a refusal at upload is not an edge case, it is the ordinary path for the documents
this feature most needs to read. Nothing about the merchant's submission is wrong; we simply cannot
decode a container. That is our problem to solve, not theirs to work around.

**The original is retained, and that is the constraint-3 half.** Converting produces a derivative,
and a report that cites a value must be able to point at what was actually submitted. Keeping only
the JPEG would mean the artifact behind a finding is one we manufactured. Both are kept, the HEIC is
the original, and the supersedes chain is not involved — this is a rendering of one document, not a
replacement of it (D-091).

**M0's behaviour was correct and is not the end state.** Recording HEIC as `unsupported` with a
reason naming the conversion is exactly what D-092 asks of a file that cannot be handled: an
outcome, a reason, and a chaseable record rather than a silent skip. It stops being right the moment
the conversion exists, and this decision is what stops "unsupported, with a good reason" hardening
into the answer.

**`packages/extraction` stays format-pure.** The conversion belongs at ingest, not in the extractor.
Putting a codec inside a package defined as pure functions over bytes would give it a native
dependency and a platform surface, and every consumer would inherit both. The extractor's contract
stays *these bytes are a PDF or one of four image types*; making that true is the ingest layer's
job.

### Verification attempted 2026-08-24 — the sample was not HEIC

**D-104's implementation is NOT closed.** A file was supplied to close it and it did not test what
it needed to.

Two files, both from an iPhone 17 Pro, both **local to the working tree and deliberately not
committed** — they are real photographs, and merchant-adjacent sample material does not belong in
the repository. `.gitignore` is root-anchored against them so `git add .` cannot take them.

    2026-08-24 11.07.17.jpg    9.68 MB   camera original
    2026-08-24-11.07.17.heic  10.73 MB   re-saved, renamed

**Both are JPEG.** The second carries a `.heic` name and JPEG bytes.

Read before it was tested against, which is the only reason this was caught:

    first bytes   ff d8 ff e0 … 'JFIF'      JPEG SOI + APP0
    last bytes    ff d9                     JPEG EOI
    ftyp box      absent throughout          not an ISO-BMFF container at all
    sniff()       'jpeg'
    EXIF          4284 x 5712, orientation 1 (normal), Apple iPhone 17 Pro

So it is **neither HEVC-in-HEIF nor AVIF-in-HEIF**. It is a plain JPEG carrying a `.heic` filename —
iOS converts on export to most share targets, and the name survives the conversion.

**`libheif-js` remains unexercised against real HEIC.** The `HeicConverter` port is never reached by
this file: ingest dispatches on magic bytes, sees `jpeg`, and goes straight to the image route. What
was measured earlier stands unchanged — sharp's prebuilt binary links libheif with `aom` only and
cannot decode HEVC-in-HEIF, and `libheif-js` ships `_de265_*` symbols and therefore should. *Should*
is where it still sits. Closing this needs a file whose bytes begin with an `ftyp` box.

### Parked, 2026-08-24, after one bounded search

`node_modules` was searched for a HEVC-in-HEIF fixture to close this without asking for another
file: by extension, by `ftyp` magic bytes across every non-source file under 30 MB, and in the two
packages that would plausibly carry one. **Nothing.** No `.heic`, no `.heif`, no `.avif`, no
ISO-BMFF file of any kind. The earlier `--no-save` probes of `libheif-js` and `sharp` are gone too,
pruned by a later `npm install` — so neither the codec nor a sample is present.

**No dependency was added to go looking for a test file.** That would be installing a package to
justify installing a package.

**So HEIC stays unsupported-with-reason, and that behaviour is correct.** A `.heic` upload is
detected by magic bytes, stored, and recorded as a document version with `outcome: 'unsupported'`
and a reason naming the conversion — visible on the upload page, chaseable by an operator, and
never a silent skip (D-092). It is the M0 behaviour this decision already described as right until
the conversion exists. What has changed is only that we now know it is still the live behaviour.

**Closing it needs two things, in this order:**

1. **A file whose bytes begin with `ftyp` and a `heic`/`heix`/`mif1` brand** — a photograph
   transferred off an iPhone by a route that does not transcode. AirDrop to a Mac, or Finder/`ifuse`
   copy, preserve it; sharing to most apps does not, which is what produced two JPEGs.
2. **Then** the `libheif-js` decode, verified end to end against that file — output is a valid
   JPEG, dimensions and EXIF orientation survive, and it runs through `packages/extraction`.

Until step 1 exists there is nothing to verify, and a decode that has only been reasoned about is
exactly what this section already records once.

### What the sample did establish, being real

**D-089 works on a file whose extension lies.** This is the case that decision exists for, arriving
by accident with a genuine artifact rather than a fixture. Detected `jpeg`, routed to vision as one
page, page-tier provenance with no location or snippet (D-100). The filename changed nothing, which
is the whole point of not reading it.

### And one defect, found only because the file was real

**A directly-uploaded photograph is sent to the model at full size.** Nothing downscales it.

    stored          10.2 MB   4284 x 5712
    base64 in JSON  13.6 MB
    vendor cap       5 MB per image

Two times over the limit, so the call would be **rejected outright** — not degraded, rejected. Under
the bounded-attempt rule that becomes a terminal failure with a recorded reason (D-096), so it is
visible rather than silent, but it means **no photographed ID or voided check from a modern iPhone
can be read**, and those are the two most-photographed types in the catalog.

The asymmetry with the PDF path is the tell: `TARGET_LONG_EDGE` downscales a rendered page to
1500 px precisely because the vendor discards more (D-108), and an uploaded image bypasses that
entirely on its way to the same model. The fix belongs beside the HEIC conversion — both are ingest
normalising bytes so the extractor's contract is true — and neither is built.

Not fixed in this pass: this was a verification task, and reaching for the fix would have buried the
finding in a diff.

---

## D-105 — Label-anchored extraction is same-line only
**2026-08-24 · Frank's ruling**

No next-line fallback. A label-above-value layout yields nothing on the text route.

**It is the mechanism that produced the surveyed app's worst measured value.** Finding nothing after
a label, it took the next line — and on a form where captions stack vertically the next line is the
following caption. Measured: `business_legal_name = "Merchant Address"`, matched from the label
`Merchant Name`, at confidence 0.90, above that app's auto-apply threshold.

**Yielding nothing is the correct outcome, not a gap.** The honest recovery for a label-above-value
layout is the form route (D-089), which reads the widget and its rectangle, or vision (D-095), which
reads the rendered page where the pairing is visible. A text-layer guess is the one instrument that
cannot tell a value from the caption below it.

And the two directions are not symmetric. **A missed value is `not_evaluable` downstream** under the
two-source rule (D-098) — survivable, visible, and it names what it could not compare. **A wrong
value manufactures agreement**, which D-088 identifies as the worst output this feature can produce:
two documents mis-read the same way report as consistent, and the agreement is an artifact of the
extractor rather than a property of the paperwork.

### Provenance makes a value checkable, not true

Worth stating separately, because it is the thing most likely to be forgotten once every value in
the system carries a page and a rectangle.

Two values found while testing M0 had **complete D-087 provenance and were nonsense**:

    owner_name  = "1"      from the caption "Owner 1 Ownership %:"
    page_marker = "03/14"  from "Date of this notice: 03/14/2026"

Both named a page, a rectangle and a verbatim snippet. Both were wrong. Provenance answers *where
did this come from* and lets a human check it; it says nothing whatever about whether the thing is a
value at all.

> **Plausibility gates and provenance are separate mechanisms, and neither substitutes for the
> other.** Provenance without a gate is well-documented nonsense. A gate without provenance is an
> assertion nobody can check.

The gates that caught these two — a free-text value must contain a word, and a page marker's slash
form must carry the literal word "page" — are not decoration on top of the provenance requirement.
They are the other half of it.

---

## D-106 — Fixtures are committed when a human can review them
**2026-08-24 · Frank's ruling**

Committed when the artifact is reviewable. Generated when it is not.

**`CLAUDE.md`'s existing convention was written for saved storefront HTML**, and for HTML it is
right: the file *is* the evidence, a reviewer opens it and sees the markup a check runs against, and
regenerating it would lose the fidelity to a real site that makes it worth having.

**A binary PDF inverts the property the convention rests on.** Nobody can tell a filled AcroForm
from a flattened one by looking at the bytes — and that is the exact distinction two of the M0
fixtures exist to draw. A committed blob would be unreviewable in precisely the dimension under
test, while the generator that builds it reads as a description of what the fixture *is*.

So the convention is amended to state its discriminator rather than its format:

> **A fixture is committed when a reviewer can read it and see what it tests. Where the artifact is
> opaque, the generator is the reviewable thing and it is what gets committed.** Generated fixtures
> must be deterministic — a fixture whose bytes change per run cannot test anything
> content-addressed (D-091, D-096).

The determinism clause is not incidental. The M0 fixture builder pins document creation and
modification dates to the epoch, because `PDFDocument.create()` otherwise stamps the current time
and the resulting bytes hash differently on every run — which would make the cache tests pass
vacuously while appearing to assert something.

---

## D-107 — A sixth slot state: `not_evaluable`
**2026-08-24 · Frank's ruling · amends D-078**

D-078 named five slot states. There are six:

    satisfied · not_provided · waived · superseded · missing · not_evaluable

`missing` remains the unresolved default and **still the only state meaning chase this**. That part
of D-078 is untouched and is what the new state exists to protect.

### Why five was not enough

Owner Photo ID takes its required count from the application's ownership section. Until that
section is read, the count is **unknown** — and unknown is not zero and not one.

Under five states the slot would have to be `missing`, and `missing` is an assertion: it says a
required document is absent and someone should go and get it. We do not know that. We do not know
how many IDs to expect, so we cannot say any are absent. Reporting `missing` would be a verdict
resting on a count nobody established, which is constraint 9's shape in a new place.

`not_evaluable` says the true thing: *we could not work out what this slot requires*. It also
matches what the rest of the system already does — the four finding states have carried exactly
this distinction since M0, and a slot that could not be evaluated should not have to borrow a state
that means something else.

### The state is narrow on purpose

`0020_slots.sql` ties it to its one cause, in both directions:

```sql
constraint not_evaluable_means_the_count_is_unknown check (
  (state = 'not_evaluable') = (required_count is null)
)
```

A known count cannot be `not_evaluable`, and an unknown count cannot be `satisfied`. Without the
first half the new state becomes a general "we would rather not say", and `missing` is what that is
for. Without the second, a slot with no idea how many documents it needs could report as complete.

### What did not change

- **`missing` is still the default and still the only chase-this signal.** A new slot starts
  unresolved and stays on the list until someone acts (D-078).
- **`not_provided` and `waived` remain operator decisions carrying an enumerated reason** (D-079),
  and ingest never sets or clears them: a waived slot that receives a document stays waived. That
  is a conversation, not a state transition.
- **"Applied for, not yet issued" is still open.** D-102 item 2 records three ways out and calls it
  a workflow question. Adding one state for a measured, structural cause does not settle a
  different one by proximity, and bundling them would have been the tidier-looking mistake.

---

## D-108 — The rasterizer is pdfjs inside the Chromium we already run
**2026-08-24 · Frank's ruling**

`packages/extraction` declares a `Rasterizer` port and ships no implementation. The worker's
implementation renders with pdfjs inside Playwright's Chromium. No new runtime dependency, and no
change to the container.

### Measured, not estimated

The survey's warning was a 75-second bound sized against an estimate for a 10-page PDF that had
never run. So these are measurements, against generated fixtures:

| candidate | 1 page | 40pp text | 40pp scan, 13.7 MB | peak RSS | adds |
|---|---|---|---|---|---|
| pdfjs + `@napi-rs/canvas` | — | — | — | — | **does not work** |
| **pdfjs in Chromium** | 66 ms | 33 ms/pp · 1.31 s | **34 ms/pp · 1.35 s** | **146 MB** | nothing |
| poppler `pdftoppm` | not measured | | | | `apt-get` in the image |

**`@napi-rs/canvas` is not a candidate.** pdfjs 4.10 calls `ctx.fill(path)` with a `Path2D`, and
that binding throws ``Value is none of these types `String`, `Path` `` on the first glyph of the
first page. It failed before it rendered anything.

**poppler would mean maintaining system packages** in a container built from the Playwright image
precisely so we do not. Chromium is already there, already version-locked to the client by the
Dockerfile, and already exercised by every scan. 34 ms/page is not a number a system tool improves
on by enough to buy that.

Cold start is 215 ms to launch plus 78 ms to set up, paid once — the rasterizer is a resource the
caller opens and closes, not a function, because a browser per document would make launch most of
the cost of a short one.

### The DPI question has a ceiling, and it is the vendor's

Anthropic downsamples an image to ~1568 px on the long edge. Rendering above that is discarded
before the model sees it, so fidelity here is **a target to hit, not an axis to climb**.
`TARGET_LONG_EDGE` is 1500.

Measured cost of ignoring that: the same 40 pages at 2200 px took 45 ms/page instead of 34 and
produced 498 KB JPEGs instead of 293 KB. Roughly 35% more time and 70% more bytes, for pixels
nothing downstream will ever look at.

### Known, measured, and not fixed

Handing the PDF into the page as base64 costs **458 ms for a 13.7 MB file** and grows linearly. It
is once per document rather than per page. Serving the bytes over the same intercepted origin the
library comes from would remove it. Recorded rather than optimised: D-094 gives this job no time
ceiling, so 458 ms is a number to know, not yet a problem to solve.

### The failure this must never have

A rasterizer that returns a **blank page** is worse than one that throws. It produces a well-formed
JPEG, the vision call succeeds, the model correctly reports that it saw nothing, and the document is
recorded as read and empty. Every layer behaves and the answer is wrong.

So the tests assert on **ink**, not on the call completing, and the renderer paints white before
drawing — a PDF page is transparent where nothing is drawn, and a transparent JPEG becomes black,
which reads to a model as an unreadable scan.

One implementation note worth keeping, because it cost five 30-second timeouts with an empty
console: **an `about:blank` document has an opaque origin and cannot import a module over
`file://`.** Three things need a real origin — the pdfjs module, its worker, and
`standardFontDataUrl` — and each fails differently without one, the font fetch most quietly of all.
All three are served from a single Playwright-intercepted origin.

---

## D-109 — One clock: coverage evaluates against the run timestamp
**2026-08-24 · Frank's ruling**

Coverage windows are measured against **the run's timestamp**, and nothing else. There is one
clock, and a run carries it.

**B-06 is not a second evaluation.** Reading it as "freshness gets recomputed at report generation"
implies two evaluations that could disagree, and invites a stored verdict that a later pass
refreshes. What B-06 actually requires is narrower and stronger:

> A report is generated from a run created at send time, never from a stale one.

The freshness of a package is a property of *when it was screened*. If the answer needs to be
current, the thing that must be current is the run — not a field inside an old one. That is already
how the rest of the system works: a report is pinned to a run (D-083), and a run is immutable once
finished (D-002), so a report that needs today's answer needs today's run.

**A stored freshness verdict is stale the moment it is written**, and it is stale silently. It was
right when computed and it stays in the row looking exactly as authoritative afterwards, which is
the defect D-047 found in a control that could not distinguish a deliberate value from one that had
gone out of date. So the slot stores the **rule** — how many months, what grace — and the verdict is
computed wherever it is read, from the run's timestamp.

**B-06 keeps its id and its report line.** It is not absorbed into B-04 and it is not deleted. What
it checks is a different thing from what B-04 checks: B-04 asks whether the periods supplied cover
the required months, and B-06 asks whether the run this report is being generated from is the right
run to be answering that question. A package that sat on a desk for eight weeks fails B-06 not
because its statements aged but because nobody re-screened it, and those are different sentences to
put in front of an underwriter.

---

## D-110 — Slot state and count satisfaction are orthogonal
**2026-08-24 · Frank's ruling**

A slot is `satisfied` only when its required count is met. Below that it is `missing`.

**State carries the action; count carries the numbers.** `missing` is the only state meaning chase
this (D-078), and one-of-three is chase this — so a slot holding one bank statement of three is
`missing`, and the fact that it holds one is reported alongside as a count, not folded into the
state.

The alternative is a `partial` state, and it fails on both halves. It splits the chase-this signal
in two, so a reader scanning for what to do has to know that two states mean the same action. And
it puts a number into an enum: `partial` cannot say whether one of three or two of three is in hand,
so the count has to be reported next to it anyway — at which point the state is carrying nothing the
count was not already carrying.

Keeping them separate also means the count can be **unknown** without disturbing the state machine.
That is what the sixth state is for (D-107): where the required count is null the slot is
`not_evaluable`, and it is the count's unavailability that produces it rather than a special case
inside the state logic.

**What this rules out**, so it is not rediscovered: state is never derived from a percentage,
never rounded, and never softened because a slot is "nearly there". Two of three is `missing`, and
so is zero of three. What separates them is the pair of numbers printed beside the state.

---

## D-111 — W-9 and W-8BEN are two slots, not one row accepting either
**2026-08-24 · Frank's ruling**

CHECK-INVENTORY §4 lists them on one line. They are two slot definitions with opposite predicates:
`w9` where the entity is US-domiciled, `w8ben` where it is not. Confirms what M1 built.

**A single slot cannot express structural impossibility, which is the only thing D-081 lets a
conditional fire on.** One slot accepting either form would be satisfied by whichever arrived — so a
domestic entity that uploaded a W-8BEN would satisfy its tax-form requirement, and the document that
*cannot exist for this entity* would be recorded as the document that does.

Two slots with opposite predicates say the true thing in the data: for a domestic merchant the
`w8ben` slot is **not seeded at all**, because a domestic entity has no W-8BEN to give. Its absence
is the statement. There is no slot to satisfy by accident, and nothing for a mis-filed document to
land in.

This is D-081's own example — "a domestic entity files W-9, not W-8BEN" — and it only works as an
example if the two are separable. Collapsing them to one row turns a structural impossibility into
a merely-absent document, which is the exact substitution D-081 exists to forbid.

---

## D-112 — No variable-count slots; instances instead
**2026-08-24 · Frank's ruling**

CHECK-INVENTORY §4 gives Business License a count of `0..n`. There are no variable-count slots. It
is **off by default**, and an operator adds **named instances**, each with a count of 1, carrying
the `added` origin. Confirms the `slot_key` + nullable `instance_label` shape M1 built; the origin
is made explicit in the same change.

**`0..n` cannot distinguish the two answers that matter.** A slot with a count of zero is satisfied
by nothing at all — so "this merchant needs no licence" and "this merchant has supplied no licence"
produce the same row, showing the same state, with nothing to tell them apart. That is the
false-clean shape: an unmet requirement rendering exactly like an absent one.

**No slot versus a missing slot is obvious.** A merchant with no licensing requirement has no
licence slot on the package — there is nothing on the checklist and nothing to chase. A merchant who
needs two has two slots, each named, each `missing` until its document arrives, each satisfiable on
its own. An operator reading the list can see which licence is outstanding, which a single `0..n`
row can never say.

**Origin is recorded, not inferred.** A slot is `template` or `added`. The distinction matters
because the two answer to different rules: a template slot came from the processor's required set
and its absence would be a template change, while an added slot came from an operator's judgement
about this merchant. A named instance is always `added` — an operator adding an unlabelled one would
produce "Business License: satisfied" on a package with two licences, which is §3's complaint about
Additional Document in another costume.

---

## D-113 — Statement freshness is the last complete calendar month
**2026-08-24 · Frank's ruling**

Not a day count. **Supersedes the 45-day placeholder in CHECK-INVENTORY §4 and closes the third
open item from D-102.**

    required month = the last calendar month ending on or before (run date − grace)
    grace           = 10 days, configurable

Worked, because the arithmetic is the ruling:

| run date | run − grace | last month ending on or before | asks for |
|---|---|---|---|
| 3 May | 23 Apr | March (31 Mar ≤ 23 Apr) | **March** |
| 15 May | 5 May | April (30 Apr ≤ 5 May) | **April** |

Three consecutive periods work backward from there: a run on 3 May asks for March, February and
January; a run on 15 May asks for April, March and February.

### Why a day count was the wrong instrument

A day count measures from an instant that has nothing to do with how statements are produced.
Statements come out on a cycle, and **the grace period exists because they are not issued the
moment a cycle closes** — a merchant whose April cycle ended on the 30th does not have an April
statement on 1 May, and a rule that asks for one is asking for a document that does not exist yet.

Under 45 days the same merchant is compliant or not depending on which day of the month they happen
to apply, and the boundary moves through the middle of a cycle. "The last complete calendar month"
is a sentence a merchant can act on and an underwriter can check. It is also stable: the answer
changes once a month, on a knowable date, rather than every day.

### Cycles are not calendar months, so overlap decides

A statement running 12 March – 11 April is not "an April statement" or "a March statement" by its
label; it is 31 days of which 20 fall in March. **A period satisfies a required month when a
majority of its own days fall in that month.** That period satisfies March, and a run asking for
March accepts it.

The majority test is on the period's days rather than the month's, and the difference is not
academic: a short period wholly inside a month would fail a majority-of-the-month test while
plainly belonging to it. Where no month holds a majority — an unusually long period straddling
three — the period satisfies nothing, and the honest answer is that the required month is
uncovered rather than that some month was picked for it (D-080's discipline: periods are read off
the document, and what cannot be read off it is not inferred).

### The grace figure is mine, not Frank's

**10 days is my number.** It is a plausible interval between a cycle closing and a statement being
available, and it makes the two worked examples above come out where they should. It is not
measured, and I have no data on when processors and banks actually issue.

It is configurable per slot for that reason, and it is the first thing to move if measurement
disagrees. Flagged here rather than left to be discovered as a constant nobody questioned — which
is exactly what happened to the 45 days this replaces.

---

## D-114 — One gate: everything the model sees is normalised at one point
**2026-08-24 · Frank's ruling**

Every image that reaches the vision client — a rendered PDF page and an uploaded photograph
alike — comes out of a single port: long edge to `TARGET_LONG_EDGE`, EXIF orientation applied,
JPEG. `Rasterizer` becomes **`PageImager`**, and `extract()` no longer builds an image content
block anywhere.

### What was wrong, and why it was invisible

There were two producers of one thing. A PDF page went through `rasterize()`, which capped it at
1500 px because D-108 measured that the vendor discards more. An uploaded image was wrapped inline
in `extract()` and sent at whatever the camera produced.

Measured on a real iPhone photograph:

    stored          10.2 MB   4284 x 5712
    base64 in JSON  13.6 MB
    vendor cap       5 MB per image

Twice over, so the call is **rejected outright** rather than degraded — and no photographed ID or
voided check from a modern phone could be read at all. Those are the two most-photographed types in
the catalog (D-104).

**The constraint existed. It was attached to one of the two paths.** That is the whole defect, and
it is not a special case: a rule that lives on a route rather than on a destination is enforced for
whoever takes that route. The second route was added later, by someone who had no reason to look at
the first one's size handling.

### The rename is part of the ruling

`rasterize` described one of the two inputs. That framing is what made a second path look
reasonable — you do not "rasterize" a JPEG, so a JPEG plainly needed different handling, so it got
some. `PageImager` names the *output*: page N of this document, as the image the model will see.
There is nothing a caller can be holding that does not go through it.

**Consequence, accepted:** an image now requires a `PageImager`. Previously it needed only a vision
client. Without one it records `route: 'none'` with a reason (D-092) rather than being sent
unnormalised, which is the correct trade — an image nobody can normalise is one we should not be
sending.

### The original is retained at full size

The downscale is **for the model, not for storage**. Constraint 3 wants the artifact a finding
points at, and a report citing a value must be able to show what the merchant actually submitted —
not a rendering we made to fit a vendor's limit. `PageImager` produces a transient input to a call;
it never touches what ingest stored.

### What the tests do and do not prove, stated because the first version proved nothing

The first downscale test fed in an image the PDF path had **already capped at 1500 px**. So
`scale = min(1, 1500/1500) = 1`, and deleting the downscale entirely left it green. It asserted
"≤ 1500" against an input that was already 1500 — a test that could not fail. Rebuilt against a
3000 × 2000 fixture generated in its own Chromium, and verified failing two ways: with the scale
removed, and with images bypassing the gate as they originally did.

The EXIF test is weaker and is labelled as such in the file. It was written expecting
`imageOrientation: 'from-image'` to be the mechanism. **It is not** — this Chromium applies EXIF
regardless, and setting `'none'` explicitly changes nothing; both were tried and the test stayed
green. So it is a **characterisation test of Chromium**, not a guard on our own code. Worth keeping,
because the normalisation rests on that behaviour and a runtime that stopped doing it would be
caught. Not worth mistaking for a regression guard on the option, which is why the comment beside it
says so.

> A rotated ID is the silent failure here. Nothing downstream can tell a bad read from a sideways
> page, so the only place it can be caught is before the call.

---

## D-115 — The Documents Check rule files, and a loader that refuses
**2026-08-24 · Frank's ruling**

`rules/documents.checks.json` and `rules/documents.templates.json`, loaded and validated by a second
loader in `packages/ruleset` — a second loader, not a second package (D-101).

### Refusing, not warning

Cross-file validation **refuses to load**. There is no warning tier and no partial load.

The case it is built around: a template naming a `slot_key` the catalog does not define. That is not
a missing requirement — it is **a requirement that silently does not exist**. The package renders
with one fewer thing to chase, and a checklist with an item quietly absent is indistinguishable from
a checklist that never needed it. Nobody audits a list for the entries that were never on it.

> A startup warning is a line nobody reads in a log nobody opens.

Ten conditions refuse, and each is a way one file can lie about the other or about itself:

| | |
|---|---|
| a template names a slot the catalog does not define | the requirement that does not exist |
| a check reads a document absent from the catalog | a check that can never run |
| a check reads a `collected_only` document | a contradiction inside one file (D-082) |
| a `not_evaluable` condition outside the enumeration | §1 requires these be named |
| a reason outside the `not_provided` / `waived` enumerations | D-079 |
| a check id whose family prefix is not a family | the id is the only place family is declared |
| a duplicate id — check, catalog key, external source, reason, processor | |
| a slot appearing twice in one processor | |
| a predicate on anything but the three creation questions | D-081 |
| a check declaring both `fail` and `review` | D-099 — exactness is a property of the comparison |

**Every defect names the offending id and the file it came from**, and all defects are reported in
one pass rather than the first one found. Two files that reference each other make the file half of
that non-negotiable: `unknown slot 'bank_statment'` without a filename sends you to whichever
document you happened to have open.

### Verified discriminating, not merely present

The refusals were checked by removing the thing they guard. With cross-file validation disabled,
**exactly the ten refusal tests go red and the twenty round-trip tests stay green.** A guard nobody
has watched fail is a guard nobody has established works, and this project has shipped three of
those before.

### D-101's claim is a test, not an intention

> Adding a processor is an entry in the templates file and nothing else.

Proven rather than asserted: a second processor is added to the templates document alone — the
checks document passed through as the *same object*, not a copy — and it produces a different
required set. No code, no schema change, no migration. If that ever stops being true, a test says so
on the commit that broke it rather than on the day someone tries to onboard a processor.

### The seam M1 left was the right one

`loadSlotTemplate()` was hard-coded from CHECK-INVENTORY §4 in M1 specifically so this would be a
body swap, and it was. The exported types, `slotsForPackage`, `slotDefinition` and every caller are
untouched; only where the data comes from changed.

The join is what makes the cross-file validation load-bearing rather than tidy: **the template says
what is required, the catalog says what a document is** — its title, and whether it is examined or
collected-only. Neither file can build a slot alone, which is why a key present in one and absent
from the other has to stop the load.

---

## D-116 — `evidence_tier` is not a property of a check
**2026-08-24 · Frank's ruling · amends CHECK-INVENTORY §1**

§1 listed seven per-check properties. There are six. `evidence_tier` is removed, and `typical_tier`
moves to the catalog.

### Why it could not be declared

§2 already defines a finding's tier as **the weaker of the documents actually read**. §3 marks
several document types `mixed` — Articles, W-9, W-8BEN, business licence, proof of address. So a
check reading the application (character), the EIN letter (page) and a W-9 (mixed) has no static
answer that is true:

- `character` is false whenever the EIN letter arrives scanned, which is the usual case.
- `page` is false whenever it arrives as a text-layer PDF, and it would understate every finding
  that check ever produces.

**Redundant where derivable, false where not.** Where every input has a fixed tier the value is
already computable from `reads` plus the catalog; where an input is `mixed` there is nothing to
compute it from until a document exists. Either way the field earns nothing and can mislead.

### Where the tier belongs

**On the document, because a document has one.** `typical_tier` sits in the catalog beside the
title and the `examined` flag — a statement about what an EIN letter usually is, which is a real and
stable fact.

**And on the finding, computed.** That is what §2 always specified. Nothing changes about how a
report renders a tier; what changes is that the checks file no longer carries a field claiming to
know it in advance.

The general form, since it will recur: **a value that varies with the input is not a property of the
thing that consumes the input.** Declaring it there produces a number that is right until the first
interesting case.

### Related: the two-source rule binds comparisons, not arithmetic

§6 says family C is "all subject to the two-source rule" (D-098). **C-14 is not, and cannot be.**

C-14 sums the ownership percentages on the application and checks the total is no more than 100.
That is arithmetic **within one document**. There is no second source, there never will be, and
requiring one would make the check permanently `not_evaluable` — a rule that can never fire, which
is worse than an absent rule because it looks like coverage.

It carries `ownership_section_not_extracted` instead, which is the honest condition: the check
cannot run when the thing it counts was not read.

**A principled exception, not a carve-out**, and the principle is what D-098 actually says. Its
reasoning is about *comparison*: a check that confirms a lone value is blind to every disagreement
it never saw, because the set it cannot see is exactly the set it exists to find. C-14 is not
comparing a value across sources; it is testing a constraint on one document's own numbers, and a
second copy of the application would tell it nothing. The rule binds where its reasoning reaches.

C-19 is the other family C check without the condition, for a different reason: it compares a
recorded slot reason against evidence, so what it needs present is the resolved slot, not two
document sources.

---

## D-117 — B-06 is withdrawn; a stale run is a report property, not a check
**2026-08-24 · Frank's ruling · amends CHECK-INVENTORY §4, §6**

B-06 is withdrawn. Family B is B-01 through B-05. §6 now reads **38 checks, 35 in v1**.

### Why it stopped being a distinct check

B-06 was specified when freshness was going to be evaluated twice — once when the package was
assembled, once again when the report was generated — and the second evaluation was its whole
reason to exist. D-109 removed that shape. There is one clock now: coverage evaluates against the
run's timestamp, and the verdict is computed wherever it is read rather than stored.

Strip the second evaluation out and what B-06 can still ask at engine time is: was any statement
period read, and does the newest one fall inside the month D-113 requires. That is B-04. Not
adjacent to B-04 — the same question, put to the same slots, against the same clock, arriving at
the same answer. The M3 build made this concrete rather than theoretical: `b06()` and `b04()` both
resolved through `monthlySlots()` and `evaluateCoverage()`, and the only way to keep their notes
from being duplicates was to have B-06 speak about the run while B-04 spoke about the documents —
a difference in phrasing, not in fact.

Two findings on one fact is a cost paid by the reader. A report already carries thirty-eight
checks; every one of them has to be worth the line it occupies, and a line that restates the line
above it teaches the reader to skim. Worse, the two could disagree under a future edit to one of
them and nothing would catch it, because there is no fact for them to disagree *about*.

### What B-06 protected, and where it lives now

The real hazard was never that the engine would compute freshness wrongly. It was that a report
could be **sent** from a run assembled weeks earlier — statements fresh when the run was created,
stale when the underwriter read the PDF. That hazard is real and it survives this withdrawal.

But it is a property of report generation, not an observation about documents. Nothing the engine
can see distinguishes a run generated a minute ago from one generated in March; the run's
timestamp is the same value in both, and it is the *report* that has aged, not the run. A check
that cannot observe its own subject has no business returning a state about it — that is exactly
constraint 2's failure mode, and a `pass` from it would be the worst kind: correct-looking and
uninformed.

So it becomes a gate in M5: a report may not be generated from a stale run. The remedy is a new
run, which the immutability rule (D-002) already requires and already supports. This is a
precondition on sending, enforced once, in the one place that knows when sending is happening.

### Recorded here rather than in a decision of its own

**`ein_letter` carries `markers`.** The catalog entry now holds
`["CP-575", "147C", "Internal Revenue Service"]`, so A-04 has something to match. This satisfies
D-025 for that ruleset edit.

A-04 is deliberately weak and §6 says so. It catches a W-9 uploaded into the EIN Letter slot. It
detects nothing whatsoever about whether the document is genuine, and no finding text it produces
may imply otherwise. Marker sets for other types are added as they are needed; a type with no
marker set yields `no_marker_set_for_type` and the check is `not_evaluable`. That is the correct
answer and not a gap to be closed — the alternative, matching against an empty set and passing, is
the false `pass` constraint 2 exists to prevent.

**A-05's `fail` branch is unreachable today.** Extraction cannot locate a signature block, so every
input reaches `signature_block_not_located`. The check stays declared `["fail", "pass"]`. The
ruleset describes what a check *is*, not what extraction currently supports; trimming the declared
state would make the data track a temporary implementation gap, and the gap would then be invisible
in the one file anyone reads to learn what the system checks. Closing it needs signature block
location in `packages/extraction`.

---

## D-118 — A presence check over an incomplete haystack may not return absent
**2026-08-24 · Frank's ruling · amends CHECK-INVENTORY §6 (A-04)**

A-04 returns `not_evaluable` with reason `markers_not_searchable` on any vision-routed document.
It may return `fail` or `pass` only where the searched text is complete — character-tier text or
form fields.

### What was measured

The first live vision call read a scanned EIN letter. The page prints **INTERNAL REVENUE SERVICE**
in bold across the top. A-04 returned `review`: *"carries none of the markers expected for
ein_letter."*

Not a tuning problem. A-04 searches the extracted values and, for character-tier values, their
snippets. A vision page has no snippets — D-100 stops page tier at the page — and the vision prompt
closes the vocabulary deliberately: *"Report only the field ids listed above. Anything else on the
page is not asked for and must not be returned."* Marker text is not a field id. It therefore
cannot appear in the searched set, for any scanned document, ever. The check was not looking in the
wrong place; there was no place to look.

### Why this is the expensive direction

Constraint 9 names both failure directions and this is the one that costs more. With `expect:
absent`, a partial search reads as absence and yields a false `pass` — bad, and the reason the
constraint exists. With `expect: present`, it reads as *missing*, and produces an adverse finding
about a document that is exactly what it claims to be. An agent then chases a merchant for a
correct EIN letter. That wastes the merchant's time, wastes the agent's, and spends the thing the
report exists to earn, which is the reader's belief that a flagged item is worth looking at.

Scanned is not the exotic case here. An EIN letter is a piece of paper the IRS mailed; it arrives
photographed far more often than as a text-layer PDF. The check was blind on the majority case.

### The general form, which is the part worth carrying

**A presence check over an incomplete haystack cannot return absent.** It can return *present* —
finding something proves it is there, and a partial search is enough for that. It cannot return
*not there*, because it never established that its search covered the space.

So any check that asserts absence must first show the space was covered. Where it cannot, the
honest answer is `not_evaluable`, which is a real answer: it says the question was not settled, and
it names why. This is the same asymmetry constraint 2 is built on, applied to the search rather
than to the surface — and it generalises past A-04 to every check in families C and D that reports
something as missing.

### Marker lists come from specimens

`CP-575` does not match a real notice, which prints **CP 575 A**. That was written from memory of
what the form is called rather than from a document, and the hyphen is the form's name in prose,
not the string on the page.

Two corrections follow. Matching normalises spacing, punctuation and case, so a marker survives the
difference between how a document is *referred to* and how it is *printed*. And the `ein_letter`
set is corrected against a specimen. The rule for new marker sets is the same one D-106 applies to
fixtures: written from the artifact, not from recollection of it.

---

## D-119 — The vision client retains `stop_reason` and `usage`
**2026-08-24 · Frank's ruling · amends D-093, D-096**

`VisionResponse` carries the model's stop reason and its token counts. Both were being discarded at
the transport boundary.

### `stop_reason` — a truncation is not a parse failure

At `max_tokens` the model's JSON comes back cut off mid-object. `mapVisionResponse` then throws
`VisionParseError("model response was not JSON")`, which is a **wrong diagnosis of a real event**.
The response was perfectly well-formed for as far as it went; what happened is that we did not
allow enough room for the answer.

Two costs follow, and the second is worse than the first. The operator reading the reason is sent
looking for a malformed-output problem that does not exist. And D-096's bound spends one of its two
attempts on a retry that is deterministic — same page, same prompt, same ceiling, same truncation —
so the bound is half consumed by a repeat of a failure that could not have gone otherwise.

Truncation is a distinct outcome with its own reason. Knowing it happened also makes it fixable:
raise `max_tokens` for that page, or record it as terminal, both of which are decisions that
require knowing which failure occurred.

### `usage` — D-093 approved metered spend and nothing metered it

D-093 approved vision on the ground that metered use is not vendor spend in the sense the
architecture rules out: it is bounded per page, it is attributable to a run, and it stops when we
stop calling. Every part of that argument assumes the meter exists. It did not. `VisionResponse`
was `{ text }`, so the tokens a call cost were unobservable to everything above the transport.

The measurement that closed this was taken by teeing `fetchImpl` inside a verification script,
which is proof the number is reachable and no way to run a system. Input and output tokens are now
recorded per call, so cost is observable through the port.

**Baseline, so a future change has something to be compared against:** one scanned page at
1160×1500, 2,364 input tokens, 144 output, $0.00925, 12.2 s end to end.

### Why the suite could not see either

`fakeVision` returns `{ text: JSON.stringify(payload) }` — always complete, always well-formed,
always exactly the shape the port declares. That made the port faithful and the transport untested:
no test had ever seen a real Messages API response, so nothing could notice that seven of its nine
top-level keys were being dropped, or that one of them distinguished two failures we were merging.

A fake that only produces the success shape tests the happy path and certifies nothing else. The
fake is extended to produce truncated and malformed responses, so both are reachable from the suite
rather than only from a live call.

---

## D-120 — An unavailable input is `not_evaluable`, never silence
**2026-08-24 · Frank's ruling · amends CHECK-INVENTORY §1**

A check whose input is unavailable returns `not_evaluable` with a named reason. It does not decline
to appear.

### What M3 did, and why it was wrong

When A-01 established that a document could not be read, the checks that needed that document were
not run at all. The reasoning was that five checks emitting one observation is noise, and the
observation had already been made once, correctly, by A-01.

The noise is real. Silence is not the remedy.

A reader looking at a report cannot tell the difference between **"we asked and could not answer"**
and **"we never asked"**. Those are different facts about our diligence, and only one of them is
true. Worse, they are indistinguishable in the direction that flatters us: an absent A-04 looks
like a check that had nothing to say, when what actually happened is that the check could not run
and we did not say so.

The whole posture of this product is that every finding is a fact with a capture behind it, and
that an unobservable thing is reported as unobserved rather than as anything else. That posture
does not survive a check quietly removing itself from the report. **Every check in the inventory is
accounted for in every run**, with one of four states, and where the state is `not_evaluable` the
reason names what was missing.

This is D-092 applied one level up. D-092 says every input, and every page, resolves to a recorded
outcome — nothing is silently dropped at extraction. The same rule holds at the check layer: a
check is an input too.

### Where the noise goes instead

Presentation is M5's problem and it is a good one to have. The report collapses findings that share
a single cause into one line that names its dependents — *"the document could not be read; A-02,
A-04, A-05 and A-07 could not be evaluated"* — so the reader sees one observation and can still
account for four checks.

**Do not solve a display problem in the engine.** The engine's output is the record; the report is a
rendering of it. Compressing the record to make the rendering tidy destroys information at the only
layer that has it, and it is not recoverable downstream — the same mistake in miniature that D-077
refuses at the extraction boundary.

---

## D-121 — Slot origin is the same three values at every layer
**2026-08-24 · Frank's ruling · migration 0026**

`origin` is `required | conditional | added`, in `rules/documents.templates.json`, in the engine's
`SlotSnapshot`, and in the `slots` table. Migration 0026 widens `slots_origin_check`, which allowed
only `template | added`.

The live M1 run found this: the seeding code had to map three values onto two, and there was no
mapping that did not throw something away.

### Why `conditional` has to reach the database

It would be easy to read `conditional` as a detail of how a slot got seeded — a fact about the
template's logic, spent at seeding time, of no further interest once the row exists. That is exactly
wrong, and D-081 is the reason.

D-081's mechanism is that conditional slots fire on **structural impossibility**: a slot is seeded
because the facts make it inapplicable to omit, not because someone chose to include it. So
`conditional` on a stored slot is the answer to *"why is this slot here?"* — and that is the
question someone asks when a package looks wrong. A merchant contests a request; an analyst asks why
we wanted a document; a reviewer six months out asks why this package had nine slots and a similar
one had seven. Collapsed into `template`, every one of those questions is unanswerable from the
data, and the only remaining route is re-deriving the template against facts that may themselves
have been edited since.

A column that cannot distinguish "the template always asks for this" from "the template asked for
this because of what you told us" has lost the part that a person would want to know.

### The general shape

The storage layer is not entitled to a narrower vocabulary than the layer above it. Where it has
one, code between them must map, and a mapping that is not injective is silent data loss dressed up
as an adapter. Widen the column.

---

## D-122 — Three conditions M4 needed, and what a global assertion cannot see
**2026-08-24 · Frank's ruling · amends CHECK-INVENTORY §6**

Three `not_evaluable` conditions are added, and per D-025 this is their decision number.

| Condition | On | Status |
|---|---|---|
| `no_dba_declared` | C-02 | follows from a ruling already made |
| `routing_directory_unavailable` | C-10 | follows from a ruling already made |
| `stated_figure_absent` | D-01 … D-04 | new, and belongs in §6 |

### The first two were already decided, only unnamed

C-02 must not report a clean check on a merchant who has no DBA. A sole proprietor trading under
their own name has nothing to compare, and a `pass` there is a finding about something that never
happened. C-10 cannot pass on a lookup it never made: with no directory loaded there is no
observation, and reporting one would be the constraint 2 failure in its plainest form. Both
conditions are the name the existing ruling needed in order to be expressible.

### `stated_figure_absent` is a genuinely new case

Three months of processing statements implying $410,000 a month, set against an application field
that is blank.

That is not a `pass` — nothing was compared. It is not `no_processing_statements` — the statements
are there and were read, and the derivation succeeded. It is not
`processing_statements_not_provided` — nobody recorded a reason, because nothing was refused. The
situation is that **one side of a comparison is absent**, and until now family D had no way to say
so.

This is D-098's reasoning arriving at a case D-098 did not name. That rule is about corroboration
between documents; this is a derived figure with no stated figure to meet. Different subject, same
logic: a comparison with one side missing has established nothing, and the honest report of
nothing established is `not_evaluable` with a reason, never a state that reads as a result.

The derivation is still recorded in the finding text. What we worked out is worth having even when
there is nothing to set it against — it simply is not a comparison, and must not be rendered as
one.

### Recorded alongside: what the existing test could not see

An unanchored `str.replace` during D-120's work put `document_not_readable` onto D-06 as well as
the five A-family checks it was aimed at. The four-space pattern matched as a substring inside an
eight-space-indented line.

The test that should have caught it asserted that **every condition a check declares appears in the
global `not_evaluable_conditions` list**. That assertion was true before the corruption and true
after it, because the condition added to D-06 was a properly enumerated one — just on a check that
does not mean it.

**A global assertion over a set cannot detect misassignment within it.** Membership and allocation
are different properties, and a test of the first says nothing about the second. The corrupted file
was valid by every rule the loader and the suite enforced.

So each check's conditions are now pinned individually — thirty-eight entries, tedious on purpose.
The generalisation worth keeping: where a wrong value would still satisfy every constraint the
system checks, the constraint is not the thing that needs strengthening. The allocation does, and
that means writing it down.

---

## D-123 — A run records what it ran against
**2026-08-24 · Frank's ruling · migration 0028**

`document_runs` carries the slot table and the document list the run executed against, alongside a
digest over both.

### D-085 was unachievable, not merely unenforced

"Same run in, byte-identical report out" reads like a discipline — something you hold to by not
putting a clock in the builder. It is not. Slots are mutable: a document arriving after a run
changes `slots.state`, and a report assembled from the run plus *current* slots is a function of
the run **and the moment it was rendered**.

So regenerating a report a week later, from a run id that had not changed and could not change,
produced a different document. Nothing was wrong with the builder. The property was false at the
data layer, and no amount of care above it would have made it true.

That is the part worth carrying: **a purity claim over mutable inputs is not a claim about the
function.** The run had to be made self-contained before "pure function of a run" meant anything,
and the fix was a schema change rather than a code change.

The digest follows from the same fact. D-117 moved the stale-run precondition out of the engine
because nothing in a snapshot distinguishes a fresh run from an aged one; a run that records its
inputs can answer that question, and one that does not cannot.

### How purity gets verified

**By rebuilding from rows supplied in reversed order**, not by calling the builder twice on one
object.

The second establishes that a function is deterministic on an identical argument, which is true of
almost any function and is not the property. What has to hold is that a run *reconstructed from its
rows* yields the same bytes however the database returned them — because that is what regenerating
a report actually does, and row order is not a fact about the run.

The distinction is not academic. Break-testing found four ordering defects that the weaker test
passed over, every one of them a fixture too small to tell two orders apart: one package-level
finding cannot detect an unsorted list, and findings written out in check-id order cannot detect a
missing sort. A test that cannot distinguish the failure is not evidence of the property.

### §7 is data, not markup

CHECK-INVENTORY §7 lives in `rules/documents.checks.json` as `not_checked`, with the D-076 line
that no external verification was performed beyond the routing directory lookup.

It is the report's statement of **what Mintro did not verify**, and that is a claim about the
system's boundaries — the same kind of thing as a check definition, which is why it belongs in the
same file. Held in a React component it would be editable by anyone touching the frontend, with no
decision number and no review, and the sentence most in need of governance is precisely the one
that says what we did not do.

Silence is not a boundary (D-018, D-076). A reader cannot tell from an absent claim whether the IRS
was consulted and matched or never consulted at all; both render as nothing. The section exists to
deny coverage a reader would otherwise reasonably assume, and a denial that can be quietly deleted
is not one.

---

## D-124 — A sent report carries no covering note
**2026-08-24 · Frank's ruling**

The operator types an address. There is no note field, and `document_report_sends` has no column
for one.

### Why not, when Site Check has one

Site Check's send carries an analyst note, audited for directive language under D-029. That is a
reasonable design there and the wrong one here, and the difference is not squeamishness about prose.

**D-085 makes this report machine output.** Same run in, byte-identical report out — a property
something can assert, and the reason D-079 fixed the reason enumerations in the first place. A note
is not a function of the run. It is a function of whoever was sending, on the day they sent it.

Put the two in one email and the note **borrows the report's credibility without inheriting its
constraints**. Every sentence in the document has been through a copy audit, is derived from a
finding with evidence behind it, and can be regenerated and compared. The note sits beside all of
that, in the same message, under the same sender, and none of it is true of the note. A reader has
no way to tell which half is which, and the half with weaker guarantees is the one they read first.

That is the same argument D-085 makes about annotation on a finding, one layer out. Annotation was
refused there because an analyst's gloss is indistinguishable in weight from the observation it
attaches to. An email note is indistinguishable in weight from the report it attaches to.

### The send is an operator action, not an authored message

Worth separating, because it is what makes the omission cost nothing. Sending is an event (D-083):
a person decides this report should go to this address now. That decision needs a recipient and a
click. It does not need composition, and treating it as authorship is what creates a place for a
determination to be typed.

**And a text field is found.** A box on a modal labelled anything at all will eventually hold *"this
one looks fine to me"* — a compliance conclusion, in Mintro's message, forwarded under Mintro's
name (constraint 7, D-067). The control that prevents it is the absence of the box, not a policy
about what to type in it.

If a note is genuinely wanted later, it needs a column and a decision. That friction is correct for
this boundary: it makes adding one a thing somebody argued for, rather than a field a developer
added because the modal looked empty.

### Recorded alongside

**Refusals are logged, not only deliveries (0029).** `document_report_sends` carries `outcome` and
`error`, with the error required exactly on a rejection. "We tried to send this to the underwriter
and the provider refused it" is the fact a dispute turns on, and 0028 had nowhere to put it — a log
of successes answers the half nobody asks about, while looking perfectly healthy.

**The dry-run mailer is a separate implementation**, and `mailer` is a column value rather than a
flag. A test send and a delivered report are different rows, distinguishable for ever, without
anyone having to remember which environment was configured at the time.

---

## D-125 — The check records what it compared; the renderer displays it
**2026-08-24 · Frank's ruling · migration 0030**

A finding records the sources its comparison consulted and which value differed, written at the
point the comparison happened. `document_findings.evidence` and `evidence_note`.

### Why not derive it in the renderer

The report shows three routing numbers and marks the odd one. That marking could be worked out
again at render time — group the values, find the minority, mark the rest. It would usually agree.

**The failure mode is not cost, it is disagreement.** Two derivations means two normalisers, and
the moment they differ by a comma or a leading zero, the renderer marks a different value than the
check did. The report then says one thing in its sentence and another in its evidence rows, and
both look authoritative because both were produced by us.

The check is the only thing that knows. It ran the comparison, with the normaliser for that field,
and reached a state on that basis. Anything else re-deriving the same answer is a second opinion
wearing the first one's clothes.

**The general form: a display of a decision must come from the decision, not from a reconstruction
of its inputs.** Where a renderer needs to show *why*, the reason travels with the result. This is
the same argument D-123 makes about the run recording its own inputs, at the level of a single
finding — and both were found the same way, by trying to render something the data could not
support and noticing before inventing it.

### Recorded alongside, both from the first live PDF

**Mounted and renderable are different states.** `DocumentsPrintOnly` set its readiness flag in a
mount effect, `page.pdf()` fired immediately, and the PDF came out in Consolas and Segoe UI because
the webfonts had not arrived. The page asserted it was ready and was not, and nothing failed —
there was simply a different document at the end of it.

So anything that prints, screenshots or snapshots waits on `document.fonts.ready`, bounded so a
page that never settles still produces something. Typography is not decoration in a document whose
mono face carries every id, count and value; a silent substitution is the quiet kind of wrong,
looking like a rendering quirk and actually being a different artifact from the one approved.

**Our own pdfjs rasterizer renders repeating-gradient tiling patterns as a flat fill.** A rasterized
page of the report shows the `not_evaluable` hatching as solid colour. A Chromium print-media
screenshot of the same page shows it hatched correctly.

**The PDF is right and the inspection tool is wrong**, and that is worth writing down precisely
because the instinct on seeing it is to go and fix the hatching. It is also a caution about the
rasterizer generally: it exists to feed page images to a vision model, where a flattened background
pattern costs nothing, and it is not a faithful renderer for looking at our own output.

---

## D-126 — A run records the identity it rendered under
**2026-08-24 · Frank's ruling · migration 0032**

**Amended by D-129 — see below.** An operator-typed DBA is now captured at package creation as a
label for finding the merchant. It is not the report's DBA and does not reach the masthead.

`document_runs` carries the merchant name and domain the run was rendered for. The report route
reads them off the run, not off the merchant row.

### The data was pure and the page was not

D-085 held throughout: `merchantName` was a render prop, not part of `DocumentsReport`, so the
report *data* was a function of the run alone and the byte-identical tests were true.

The rendered page was a different question, and nobody had asked it. The masthead came from a live
read of the merchant row, so renaming a merchant changed the top of a report whose run had not
changed. **A sent PDF and a regenerated page would then disagree while both claimed the same run
id** — which is the exact failure D-002 and D-083 are built to prevent, arriving through a prop
rather than through the data.

The lesson worth extracting: **purity of a value is not purity of the artifact.** A function can be
pure and still be composed, at render time, with something that moves. Asking "is this a pure
function of the run?" of the object and not of the page is how the gap survived — the tests were
correct and were testing the wrong boundary.

This is D-123 one level down. That ruling made a run record the slot table and document list it
read; identity is also read, so it belongs in the same place for the same reason.

### DBA is not stored, and not derived

There is no DBA column on a merchant. The trading name is a value **extracted from the
application**, and C-02 is the check that compares it across documents.

Deriving it separately for a masthead would put a second derivation beside the check's, and the two
could then disagree — the report heading one name while the check that examines names reports
another. That is precisely what D-125 refuses: a display of a decision must come from the decision.

So the masthead shows a DBA only where the report data carries one, and today it carries none. An
absent line is honest; a line assembled from a second reading of the same document is not.

---

## D-127 — HEIC is deferred indefinitely, not pending
**2026-08-24 · Frank's ruling · closes D-104's implementation**

The conversion path built at M1 stays behind its port, unwired and unverified. D-104's ruling is
not overturned; its implementation is closed as **deferred** rather than left open.

### Why the premise changed

D-104 rested on a factual claim: HEIC is the iPhone camera default, photographed IDs and voided
checks are the most-photographed types in the catalog, so a refusal at upload is the ordinary path
rather than an edge case.

**In practice Mintro rarely if ever receives HEIC.** Merchants send documents through channels that
re-encode — which is the same fact that produced two false samples during verification: sharing a
photograph to most apps hands over a JPEG, and both files that arrived for testing began `ffd8ffe0`
with no `ftyp` box anywhere in them. The mechanism that keeps HEIC out of our inbox is the
mechanism that kept it out of our test fixtures.

An argument built on frequency does not survive the frequency being wrong.

### Why deferred rather than finished

The remaining work is small and the temptation is to close it out. That is the thing to resist: the
only way to finish it now is to verify against a file we manufactured, and a conversion path proven
against a synthetic sample is proven against our idea of the format rather than against what a
merchant's phone produces. It would carry the appearance of verification and none of the substance
— worse than an unwired path, because an unwired path is honest about what it is.

So the code stays where it is, behind a port nothing supplies, and the fixture generator stays with
it. Nothing is deleted; the work is not lost, it is parked.

### The behaviour that ships is D-104's own interim answer

A HEIC upload resolves to `unsupported` with a reason naming the format. D-104 called that
"correct and not the end state" — this ruling says it is the end state for now, and it is a good
one: recorded, visible on the upload page, chaseable under D-092. An operator sees the file was
received and not read, and can ask for a resend in another format.

That is a working path, not a gap. The merchant is asked once for something trivial, rather than a
decoder being maintained for a case that does not arrive.

### What reopening requires

Two things, and the second is the one that has already failed twice:

1. **Evidence merchants are actually sending HEIC** — a real upload, not an assumption about what
   phones default to.
2. **A file whose bytes begin with `ftyp`.** Not a photograph someone shared to a chat app, which
   re-encodes to JPEG on the way. Checking the leading bytes before testing anything against them is
   the rule that stopped the last two from passing for the wrong reason.

---

## D-128 — One default set, adjusted per package; there is no per-processor requirement set
**2026-08-24 · Frank's ruling · amends D-101 and D-081**

There is **one** default document set. It is prechecked at package creation and the operator adds
or removes slots for that package. Nothing ties a package to a processor's requirements, because
no such tie exists on the back end and none is planned.

`rules/documents.templates.json` is collapsed accordingly: a single `template`, not a `processors`
array. **D-101's two-file split stands** — capability in `documents.checks.json`, required sets in
`documents.templates.json` — and only the shape of the second file changes.

### Why the structure had to go rather than sit there

The array held one entry and had held one entry since it was written. Read from outside, it says
Mintro maintains a requirement set per processor and currently has one configured. That is a claim
about the product, made by the shape of a file, and it is false.

**Unused capability is not neutral.** It is a promise nobody made: the next person reading it plans
around a multi-processor model, `packages.processor_key` looks like a foreign key into requirements,
and STATUS.md ends up describing per-processor sets as a thing that exists. The cost of keeping it
is paid by every future reader; the cost of removing it is one commit, and it can be reintroduced
under a decision if a processor ever supplies a set of their own.

Collapsing was chosen over annotating for that reason. A comment saying "deliberately unused" is
read by whoever opens the file; the structure is read by everyone who hears about it secondhand.

### What `packages.processor_key` means now

It stays, with a narrower meaning: **who the package is for**, not *which requirement set applies*.
That is a real fact about a package and worth recording. It is no longer a key into anything, and
nothing looks it up to decide what documents are required.

### D-081 is amended, not withdrawn

The three questions — entity type, existing processor, US-domiciled — still resolve at package
creation and still remove slots outright. That was never about processors. It is about **structural
impossibility**: a sole proprietorship has no Articles of Organization to supply, and a domestic
entity files a W-9 rather than a W-8BEN. Asking for a document that cannot exist is not a
requirement, it is a mistake, and no operator should have to decline it.

What changes is the boundary. D-081 previously did the whole job of deciding a set; now it decides
only the part an operator must not be asked about. **Everything else is adjustable**, and the
distinction is exactly that: impossible things are removed and never offered, unwanted things are
offered and can be unchecked.

### Origin becomes more load-bearing, not less

`required | conditional | added` (D-121) was already recorded per slot so that *why is this slot
here* stays answerable. Operator adjustment makes that question more likely to be asked, not less —
a package with an unusual set now has two possible explanations, the facts or a person, and the
column is what separates them.

And a removed default is recorded **as a removal**, not as an absence. A shorter list is
indistinguishable from a list that was always shorter, and "the operator did not want this" is a
different fact from "this was never asked for". The report can then say the set was adjusted rather
than quietly showing fewer rows.

### What I got wrong

I built the per-processor structure from D-101's wording without asking whether a second processor
existed or was expected. The file was correct against the ruling and wrong about the product, and
nothing in the tests could have caught that — they check a template loads, not that the shape of
the file describes something real.

---

## D-129 — The three answers accept "not known yet", and are recorded
**2026-08-25 · Frank's ruling · amends D-081, D-126, D-128 · migration 0034**

Entity type, existing processor and US domicile accept **not known yet**, that is the default, and
all three are stored on the package.

### They were never in the schema

`packages` had thirteen columns and none of them was any of these. The answers lived as React state,
produced a slot list, and were discarded. The package recorded the *result* — which slots, with
which origin — and not the inputs.

So *"why is this slot here"* already answered **"because of an answer nobody recorded"**, which is
the gap D-121 was written to close. That is a defect independent of this ruling and it is fixed by
the same three columns.

Three nullable columns, and **NULL is "not known yet"**. The same shape as `slots.required_count`
under D-107: unknown is not a value, and giving it one — an `unknown` enum member, a sentinel string
— would make it a thing the operator chose rather than a thing nobody has established.

### Forcing a guess is worse than allowing unknown

At creation the operator often does not know the entity type. The answer is in the documents they
are about to upload. A required dropdown with a plausible default does not obtain the answer; it
manufactures one, and a wrong entity type **silently removes a slot that should be present**.

So: **a conditional whose predicate is unanswered does not resolve.** The slot is offered and
prechecked, never removed. Structural impossibility removes a document only when the fact
establishing it is known — both W-9 and W-8BEN are offered when domicile is unknown, and Articles
is offered when entity type is unknown, because we cannot say which is impossible.

This is D-107 one level up. There the count is unknown so nothing can be called absent; here the
fact is unknown so nothing can be called impossible. The wrong answer in both cases is the
confident one.

### Resolution after creation is a waive, not a delete

An operator who learns the entity type from the EIN letter updates it, and the conditionals resolve
then. But the slot already exists and `slots_are_never_deleted` (D-097) means it cannot be removed.

It transitions to `waived` with `not_applicable_to_entity_type`, which the reason enumeration
already carries and `reason_matches_its_state` already accepts.

**And `resolved_by` records whether that was `operator` or `fact`.** Both produce the same row with
the same reason, and they are not the same event: one is a person's judgement, the other a
structural consequence of an answer. D-128 turns on keeping those separable — a package with an
unusual set has two possible explanations, the facts or a person, and something has to say which.

### Extraction surfaces these answers and never applies them

Extraction can read entity type off the application, and C-05 already compares it across three
documents. The data will be there. It still does not get to decide.

**D-088 removed confidence from extraction deliberately.** An extracted "LLC" is a value with
provenance and no score. That is the right shape for a finding a human reads and the wrong shape for
a fact that silently deletes a requirement — there is no threshold to gate on, because we built
none on purpose.

**An extracted value is evidence about the answer, not the answer.** Treating a page-tier read of a
photographed application as *known* is exactly the overreach this state exists to prevent. The
ruling above says a document is impossible only when the establishing fact is known; a model's
reading of a scan is not that.

**And the circularity decides it.** An extracted entity type can remove the very document C-05
compares it against. C-05 then passes on fewer sources, with nothing on the page saying why the set
shrank. That is a report which looks complete and is not — the failure this system is least able to
see from the inside, and the one every other ruling here is arranged against.

So the build is a **one-click confirmation**: the value and its provenance, shown as
*"the application states LLC · application p.1"*. The operator owns the answer; the system does the
reading and the reminder. The audit then says the fact was set by a person, at a time, having been
shown a specific document — which is a sentence worth being able to write.

### Four corrections to the creation modal, ruled at the same time

**The merchant dropdown is gone.** Legal name, DBA and domain are typed. The DBA is there because
the DBA is often the name anybody actually remembers.

**That DBA is not the report's DBA.** It is the operator's label for finding a merchant, entered
before any document has been read. It does not feed C-02, which compares what the *documents* say,
and it does not reach the report masthead — D-126 leaves that empty until the report data carries
one. Two names that look alike and mean different things: one is how we find the package, the other
is what the paperwork claims. Wiring the first into the second would be D-125's failure, a display
assembled from a second derivation.

**The existing-processor question is removed entirely.** No slot predicates on it, and asking a
question that changes nothing trains an operator to answer without reading. The column stays and
stays null: Processing Statements is default-on and resolves through `not_provided` with a reason,
which is the path D-081 already intended for a merchant with no processing history.

**US domicile gets "Not sure"**, on the same reasoning as the rest of this ruling.

---

## D-130 — Purge at six months, gated on an export that has been verified
**2026-08-25 · Frank's ruling · extends D-097 · amends D-084 and D-085 · migrations 0035 onward**

**Amended by D-132 — see below.** The staged export archive is discarded on a verified copy and swept from the bucket after twenty-four hours; the download link is nulled once it lapses, leaving `download_issued_at` as the record. An export interrupted after the upload leaves an archive no row points at, which is why the sweep keys on the bucket.

At **180 days from `retention_started_at`** a package surfaces as a candidate for deletion. An
operator exports it — including the document bodies — to storage Mintro controls, verifies the
export, and only then are the bodies purged. Findings, run history, the send log, slot states and
package facts stay in the database indefinitely. A purge requires an approval that only a purge
approver may write.

### This extends D-097 rather than reversing it, and the distinction is mechanical

D-097's operative sentence is *nothing in a package is deleted by application code*. That survives
literally:

**The bodies are objects in a bucket. The record is rows in Postgres. A purge deletes objects and
inserts rows. It updates nothing and deletes no row.**

Every append-only trigger stays as written. In particular there is **no `purged_at` on
`document_versions`** — that table refuses updates, and relaxing it for one marker is exactly the
trade D-097 declined. A purge is an insert into `purged_objects`; *is this purged* is an
exists-check.

*(Corrected at build: this entry first named the table `document_version_purges`, which cannot
record a staging copy or a report PDF — both of which the same ruling puts in scope. One table over
all four object classes, keyed by `kind`, because a purge record that cannot express two of the
things it deleted is a record that reads as complete and is not.)*

### D-097 had two arguments, and only one of them is answered by the export

The first — *a snippet cannot answer a question no check asked* — is answered, provided the export
carries the bodies rather than the citations. That is why the export is the condition and not a
courtesy.

The second is not answered by the ruling as stated, and is designed out here:

> a purge would have left superseded entries pointing at bytes that no longer existed — a chain that
> looks intact and resolves to nothing.

That failure is still available at six months. It is closed only because the purge record carries
the storage key, the sha256, the byte count and the **export id**, so a reader following the chain
gets *"version 1, sha256 abc…, exported to E-0007 on 2027-02-14"* rather than a dead end. **The
chain resolves to a location instead of to nothing.** And a purge is all-or-nothing per package,
superseded versions included: purging the live ones and keeping the rest is the half-resolving chain
in a different costume.

### D-097 argued defensibility at six weeks and was right; it never asked about six months

At six weeks, indefinite retention protects. At six months, holding SSNs, dates of birth, licence
images and account numbers is a liability that grows rather than a protection — and the thing that
retention was protecting, the ability to answer a later question, is preserved by the export. What
changes is not the principle but the horizon.

### Only an approver approves, and approval is an artifact

`analysts.purge_approver` with `is_purge_approver()` beside `is_analyst()` — the same shape as the
gate every other table uses. **No hardcoded identity**: it puts a person into schema, makes the
approval path untestable anywhere but production, and buys protection only against an adversary who
already holds the service key.

Against that adversary nothing in-database is sufficient — they can drop the triggers too. **The
export is the durability control; the gate is the accident control.** Once the order is export →
verify → purge, a mistaken or malicious purge destroys a copy rather than the only copy. The gate
has to be good, not perfect, and what it defends against is the realistic failure: a well-meaning
cleanup on the wrong row.

Approval is a row in `package_purge_approvals` naming the package, the approver, the export, and
**the package digest at approval time**. The digest binding reuses D-117's stale-run mechanism: if
the package moved between approval and purge — reopened, a document added — the approval is for a
different thing and the purge refuses. One approval yields one purge.

**Approver and executor are recorded separately** although they are the same person today. Recording
it makes the day there are two people visible rather than silent.

The gate is **advisory with respect to Storage**: deleting an object is an API call the worker makes
with the service key, and no trigger governs it. What follows is a build rule — the purge job
**derives its targets from the approved package and never from an argument.** A job that takes a
list of keys can be handed the wrong list, and the gate never sees it.

### The manifest is not the anchor

A manifest listing twelve files against twelve present files proves only that the manifest agrees
with itself. Completeness needs the counts **checked against the database at export time and
recorded**, and the **manifest hash written back to the ledger that survives**. The export attests
to itself; only the record that is never deleted can attest to the export.

The export carries: document bodies **and the originals where a conversion occurred** (D-104 — "as
uploaded" means the submission, not the derivative we stored); **superseded versions**; the
extraction blobs, without which every provenance citation in the ledger points nowhere; the findings
ledger; run history; the send log **with the PDFs that were actually sent**; slot states with their
reasons and `resolved_by`; `package_slot_removals`, without which a shortened set is
indistinguishable from a set that was always short; the upload ledger including failures **and the
staged bytes of uploads that never became a version**; the retrieval log; the package and merchant
rows; **the ruleset files as they were at run time**, without which the ledger is a list of opaque
codes; and a plain README, which is report copy for D-001 purposes and describes rather than
instructs.

The sent PDFs matter for a specific reason. `document_report_sends` stores `pdf_sha256` and not the
bytes, because the report is regenerable from the run. Regeneration requires the app, and after a
purge it will not match anyway. Exporting the PDFs and recording that each hash matched **at export
time** is the last moment that claim is checkable.

### The export builder is the first code that reads a document body

Nothing in this system has ever read `document_versions.storage_key` back out of storage. There is
no signed-URL path for a document body — `evidence.ts` serves the crawl bucket, `pdfQueue` serves
report PDFs, and the worker's only download is the staging object during ingest. Bodies have been
write-only for four milestones.

**D-035 is the precedent, and it is exact.** The seventh consecutive storage defect surfaced on the
*first real use* of a write path that four milestones of testing had never exercised, and the lesson
recorded then was that a path is proven by being used, not by being tested around. This is that
path in the read direction, and it is standing as **the precondition for deletion** — the one place
where "we thought it worked" is unrecoverable.

So the export builder is verified by **reconciling the export against a database query**, not
against itself, and that reconciliation happens before anything downstream trusts it. A manifest
generated from the same traversal that wrote the archive will agree with the archive whether or not
either is complete.

### Verification is two facts and they are never merged

The export goes to the operator's local drive, then to the vault by hand. Only the first hop is
verifiable in-app.

**Hop 1 is verified mechanically** by writing through a `FileSystemFileHandle` and reading the file
back, checking **every member against the manifest's per-file hash** — not only the archive's own
hash, because that proves the archive is intact and not that the manifest describes it. Fallback is
a streamed re-upload, hashed and never persisted. A declared hash is recordable and **does not
satisfy the precondition**; the method is stored, so a weak verification is visible rather than
indistinguishable.

**The manifest hash is not displayed before verification.** Showing it first is what would reduce a
returned hash to a copy-paste. It is recorded at export time — that is the anchor — and displayed
afterwards as a receipt.

**Hop 2 is an attestation, in its own column, in its own words**, and no surface renders it as a
verification. D-064 is the precedent: a send that reported success and wrote no row, because "the
API returned 200" and "it went" were one fact. `send_requests.transmitted` exists because those had
to be split, and this is the same split.

### Every uploaded file exists in storage twice, and one copy is invisible

The browser stages bytes at `{packageId}/staging/{uuid}`; the worker writes the content-addressed
object at `{packageId}/{sha256}`. **Nothing ever removes the staging object.** A purge scoped to
`document_versions.storage_key` would delete the copy the database knows about, leave the staging
copy holding the same licence images, and report success — **liability reduced on paper and not in
fact.**

So staging copies and rendered report PDFs are in scope, and the purge **reconciles against a
listing of the package's storage prefix** rather than trusting the columns. Anything it did not
expect makes it **refuse**: an object we cannot account for means our model of what is stored is
wrong, and deleting under a wrong model is the failure this whole design is arranged against.
Reporting and continuing would delete correctly nine times and catastrophically once.

### A purged package's report still renders, and that is the hazard

`buildDocumentsReport` is a pure function of the stored run — slots, documents, findings and identity
all snapshotted as jsonb, no body read. After a purge it regenerates **byte-identically, with no
sign the bodies are gone.** There is no broken page to prevent; there is a perfect-looking page
resting on nothing retrievable, which is D-097's sentence one level up.

Purge state is therefore a **second input to the report**, resolved where the run record is loaded so
the screen and the PDF cannot disagree (D-125), and shown **in the masthead** rather than only on
document rows — a reader skimming should know before they read a finding.

**D-085's byte-stability becomes conditional, and it is stated here rather than left to be
discovered.** *Same run in, byte-identical report out* now holds only within a purge state. The same
run renders differently before and after. That is correct — the document is making a true statement
about retrievability at render time — and it means a regenerated PDF will not match the
`pdf_sha256` in the send log. Any future *prove this is what we sent* check would report a false
discrepancy against a purged package. The exported PDFs are where that proof moves.

### No sixth lifecycle state

Purge is orthogonal to lifecycle — an archived package is purged and is still archived — and
`enforce_package_lifecycle` is a transition machine that should not be touched for something that is
not a transition.

### The three retention numbers, and a clock nothing started

`retention_days` defaults to **30** (D-084) and is **read nowhere**. `create_document_package` wrote
**365**, chosen while writing 0033 with no ruling behind it and never consulted by anything. This
ruling adds **180 days from `retention_started_at`** for purge candidacy.

Ruled: **access restricts at 30 — D-084's actual number, from which the 365 silently departed** —
and purge eligibility at 180. The 365 is named here rather than quietly overwritten, because the
useful fact is not the value but that a number entered the system without a ruling and nobody
noticed for two milestones. The code is corrected to 30 in the same commit as this entry, since a
ruling that reaches the decision file and not the code is unreviewable six months out (D-025).

**And `retention_started_at` is set by nothing but a test.** `enforce_package_lifecycle` validates
transitions and does not start the clock; the partial index over it indexes zero rows. Measured from
that column, six months would never arrive. Starting the clock is therefore the prerequisite for
this ruling rather than a detail of it, and it is what P0 builds.

### D-097's restricted-access regime is unbuilt, and stays recorded as unbuilt

`document_retrievals` has a table, a policy and an append-only trigger, and **nothing inserts a
row**. No package has ever been archived. D-097 describes bodies that are not casually reachable and
reaches that are recorded; neither exists in code.

That is not fixed here. P0 starts the clock and nothing else, so this ruling does not imply a regime
that is not there. Worth saying plainly what the combination means today: document bodies are
**neither restricted nor purged**.

D-097 has read as in force since M1 and now carries a marker saying otherwise. `docs/STATUS.md` did
not misdescribe it — it did not mention retention at all, which is the failure D-044 named for
Layer 3: *it was not blocked and not deferred; it was never written down*, and a gap that appears in
no list is the one nobody argues about. It is listed now.

### Out of scope, recorded as raised

Crawl evidence (`evidence` — same append-only rule, same indefinite retention, same bodies) and the
merchant credential store (`credentials`, `vault_entries`). The liability argument that motivates
this ruling applies to both, and neither is addressed by it.

---

## D-131 — A module nothing imports is not built
**2026-08-25 · found in deployment · guards added in P6**

`apps/web/src/lib/exportVerification.ts` was written, typechecked, unit-tested, reviewed and
committed. It shipped in a bundle that contained **none of it**. Nothing in the app imported it, so
Vite removed it, and the deployed page had no verification flow at all.

Every check was green. `tsc` compiles an unimported file. Its tests import it directly, so they
proved the module worked and said nothing about whether anything reached it. The milestone was
reported as built and was absent from production.

### Why the usual defences all miss this one

The project's habit is to break the code and watch a test go red. That habit cannot see this,
because **the test suite is itself a caller**. Deleting the module turns its tests red; deleting the
*only path to it from the app* turns nothing red, because there was no such path to delete.

It is the D-035 shape in a new place: a path proven by being tested around rather than by being
used. There, the first real use of a write path surfaced the seventh consecutive storage defect;
here, the first real use was a deploy nobody could see the inside of.

### And it hid a second failure behind itself

`packages/engine` has two entry points: `index.ts` for Node and `browser.ts` for the bundler.
`verifyExportArchive` was exported from the first and not the second, so the browser build could not
resolve it — and **the build did not fail**, because the module that imported it had already been
tree-shaken away. The error appeared the instant a component imported it, which was the first time
anything asked the real question.

One orphan concealed a broken export from a package entry. Neither was visible while the file was
unreachable.

### Two guards, because one layer is not enough

**`apps/web/test/reachability.test.ts`** walks the import graph from `main.tsx` — static imports,
re-exports and dynamic imports, the three edges a bundler follows — and fails on any source file
under `src/` it cannot reach. It asserts the property that actually failed rather than a proxy for
it, and the allowlist is empty. **A file that genuinely belongs outside the app graph belongs
outside `src/`.**

**`apps/web/test/bundledControls.test.ts`** builds the app and reads the output, checking that each
control's copy and each RPC name is in the emitted JavaScript. It catches the symptom one layer
further out, and it is what would have caught the entry-point mismatch as well.

It **builds rather than skipping when `dist` is absent.** A test that skips passes in exactly the
situation it exists to check, which is the same defect wearing a different hat.

### The rule

**A module nothing imports is not built.** Not "is untested", not "is dead code to tidy later" — it
does not exist in the artifact, and every other signal will say it does.

---

## D-132 — The staged copy goes, and the link does not linger
**2026-08-25 · Frank's ruling · amends D-130 · migration 0043**

P6 gave the export a staging area and no housekeeping. Two things were left behind, and D-130 did
not anticipate either because neither exists until an export is *built* rather than designed.

**The staged archive is a second full copy of every document body**, in the bucket the purge exists
to empty. It had a manual discard button, so an operator who downloaded and walked away left it
there indefinitely.

**The download link is a bearer credential in a row that is never deleted.** Inert after two hours
and still a credential-shaped string travelling into every backup, every support export, and every
schema audit that has to stop and work out whether it is live.

### The failure D-130 did not anticipate

An export interrupted after the upload leaves `status = 'running'`, **no `storage_key` recorded**,
and a complete archive in the bucket that no row points at. A copy of every document body in a
package, reachable by no control in the system, and invisible to every design that starts from the
request table — expiry driven from the row, removal on verification, removal on discard. All three
walk past it, because the row that would name it was never written.

One was found in the test project by listing the prefix. It is the strongest reason this exists.

So **the sweep keys on the bucket**, not on the rows. The same reasoning as the purge
reconciliation: the database says what it believes is stored, and that is a different question from
what is stored.

### Two triggers, because they close different failures

**Removal on verification is the primary, and it fires on evidence rather than a timer.** A matched
`read_back` or `reupload` means the archive is on the operator's disk and has been hashed member by
member — the staged copy is provably redundant. That is export-before-purge one level down: the
copy goes once another one is proven.

**Never on `declared`.** A typed hash proves somebody read a string. Nothing established that a file
exists anywhere, and discarding on it would remove the only copy on the strength of an operator's
typing. Never on a mismatch either: the copy on disk is not the archive.

**The sweep is the backstop, and it is the more important half.** Verification-only leaves the copy
forever in exactly the cases that should worry us most — the abandoned request and the interrupted
export. It removes any object under `exports/` older than twenty-four hours, stamps the row where
there is one, and reports the ones there were not.

An object whose age cannot be read is left alone. Removing on an unparseable date would turn a bad
clock into a deletion.

### The link: record that one was issued, not the link itself

`download_issued_at` is the durable fact. The URL is nulled by the same sweep once it lapses.

**Not on consumption, because consumption is not observable.** Fetching a signed URL tells the
database nothing at all — the request never reaches it. Inferring it from a verification row was the
obvious substitute and it is wrong: it misses the operator who downloads and does not verify, which
is precisely the person whose copy has been handed out. Expiry is the only event this side can see.

`finished_exports_are_fetchable` had to move with it. It required a *live* URL on every finished
row, which the sweep makes false the first time a link lapses. What it was really asserting is that
a finished export was reachable at some point, so it now reads `download_issued_at` and is renamed
`finished_exports_were_fetchable`.

### The freeze is relaxed in exactly one direction

`reject_finished_export_mutation` froze the download columns on a finished row. The sweep needs to
clear them, so they may now change **to NULL and to nothing else**.

The asymmetry is the whole of it: **nulling can only take a download away; repointing could send an
operator at a different archive while the row still names the export it was taken for.** One is
housekeeping, the other is a misdirection with a record that looks correct. `download_issued_at`
stays frozen, because it is the record.

### Two findings from building it, worth keeping

**A row that violates a `NOT VALID` constraint cannot be repaired one column at a time.** The check
runs against the whole finished row on every update, so `request_export_discard` setting
`discard_requested_at` alone was refused on exactly the rows that needed discarding — and the only
way out was to set both discard columns in one statement. A row can reach a state no ordinary path
can leave. Not an argument against `not valid`; an argument for fixing the rows or knowing they are
frozen before adding one.

**Consumption of a signed URL is not observable to the database.** Worth writing down because the
instinct is to clear a credential "once it has been used", and here there is no such event. Any
scheme that appears to detect it is really detecting something adjacent — a verification, a page
load — and will be wrong for whoever does the one without the other.

### What this is not

None of it is a purge. These are artifacts this system made hours earlier, not a merchant's
submission, and no approval governs them. `purge_approver` is untouched and still held by nobody.

---

## D-086 amendment — the transport is adopted; the prompts and schemas are not
**2026-08-24 · Frank's ruling**

> Parent resolved the same day: D-086 is now in place above. This amendment was written before it
> through the same sequencing error, and stays here at the end rather than beside its parent so that
> record survives.

The survey found three genuinely portable extraction services in `mintro-intake-lite` — no imports,
pure functions over bytes, roughly a thousand lines between them. Portable is not the same as
adoptable, and the split runs straight through the middle of each file.

**Adopted: the transport.** The Messages API call shape, the headers and `anthropic-version`,
`temperature: 0`, the retry ladder (one retry on transient and 5xx, one further retry with a stricter
JSON-only reminder on a parse failure), the per-call and per-document timeout bounding, and the
structured `{ ok, … } | { ok: false, error }` return that never throws raw at its caller. This is the
part that took them several iterations and a production incident to get right, and it carries no
assumption about what a document is.

**Not adopted: the prompts and the field schemas.** Two reasons, and the second is disqualifying.

**They are keyed to that app's vocabulary.** The intake schema is ~70 keys shaped as
`document_requests` titles — `"who was your last processor/bank?"`, `"owner 1 ownership %"` — because
its job is pre-filling a merchant application form. Documents Check reads documents against a rule
set. Importing the schema would import that app's requirements catalog through the back door and
bind our field names to their form.

**They collapse absence to null, which D-077 forbids.** Every one of those prompts instructs the
model to "use null for any field the document does not show." One value then stands for *not present*,
*present and blank*, *present and illegible*, *present and the model declined to read it*, and
*present and the model missed it*.

The survey measured where that ends up. In the surveyed app an absent key in the candidate store
means any of seven distinct things, and nothing downstream can separate them, because **the
distinction was destroyed at the only point where it existed.** No amount of care in the consuming
code recovers information the prompt threw away. That is precisely the failure constraint 2 is drawn
around — an unobservable thing must be reported as unobserved, never as a value.

**The test, so this does not drift back in.** If a prompt instruction or a schema field can be traced
to a `document_requests` title, to that app's intake form, or to a null-for-anything-missing rule, it
does not belong here. Prompts and schemas are authored fresh against our rule set, and they carry
absence as a state rather than as a value.

---

## D-133 — A check reports the surface it read, in its title as well as its note
**2026-08-26 · Frank's ruling · amends D-018 · ruleset 2.9.0 → 2.11.0**

Six rule titles are rescoped, and two handlers stop claiming more than they saw. `OFFS-003` no
longer returns `pass` under any input.

| Rule | Was | Now |
|---|---|---|
| OFFS-003 | Social links point to the home page only | Social accounts linked from the storefront |
| FULF-001 | Ships to USA only | Shipping policy states USA only |
| OFFS-001 | No affiliate program | No affiliate or referral program URLs |
| PAY-001 | No peer-to-peer payment methods | No peer-to-peer payment methods named on public pages |
| COA-003 | Purity at or above 98% | Certificate states purity at or above 98% |
| COA-002 | COA updated within 60 days | Certificate reports a test date within 60 days |

### What the audit found

Table 2 of `peptide-requirements-tables.md` lists nineteen requirements a crawl cannot observe.
Read against it, the rule set holds up better than expected in one place and worse in another,
and the split is instructive.

**The states are mostly right.** Thirteen rules are `type: "manual"`; `invariants.ts` forces
`layer: null`, no handler exists, and `report.ts` classifies them `not_reachable` carrying the
rule author's own reason. Shipping practice, ban lists, support transcripts, lab accreditation —
all of them decline to answer, which is correct.

**The notes are right, and D-018 is why.** That ruling audited every `expect: absent` pass note
and widened five. `doc_parse` writes the model sentence: *"This reports what the certificate
states; the assay was not repeated."*

**The titles were never audited at all.** D-018 closed by saying *"this is a reporting rule, not
a state rule"* — a correct scoping of that ruling, and the reason the gap survived. The report
renders `rule.title`, then the `clause` verbatim, then the note. **The tick strip renders
`ruleId — title — state` and no note.** So the most scannable surface in the document carries the
least qualified claim on it, and six titles were asserting facts about merchant conduct that no
check observed.

`tier` is no protection here. It maps a *violation* to `fail` or `review`; a `pass` is never
routed to a human. Every one of these reached the underwriter unreviewed by construction.

### OFFS-003 was the one that could never be right

Its `collectFinding` returned `satisfied` on both branches. There was no input to that handler
that produced anything but `pass`, under a title reading *"Social links point to the home page
only"* — a fact about where a bio link on a platform leads. The rule's own params admit it:
*"Bio-link inspection requires platform fetch."*

The case this fails on is the common one. A merchant links no social account from the storefront
and runs an Instagram full of dosing advice: green tick. Absence of a link on one page was being
read as compliance of an off-site account, which is A-04 exactly — **a presence check over an
incomplete haystack cannot return absent** (D-118).

The code's comment records the reasoning that produced it: *"Collection never produces a
violation — there is nothing here to be wrong about — so the finding is `pass`."* Not-wrong is not
satisfied. A collection has no verdict in it.

So the two cases are told apart rather than collapsed:

- **Links found** → `review`, via a new `unsettled()` constructor. There is something for a human
  to open, and hard constraint 4 puts anything a check cannot settle in front of one. Table 1 of
  the requirements document independently reaches the same state: *partially observable → review*.
- **No links found** → `not_evaluable` / `not_exposed`. Nothing seen, nothing settled.
  Manufacturing a review item out of an empty homepage would waste the queue this rule feeds.

`unsettled()` always returns `review`, so an `auto_fail` collecting rule would auto-fail every
merchant who links a social account — the mirror image of the bug being removed. A new invariant
requires any rule with `collect` to be `review_only`.

### FULF-001 was making the claim its neighbours decline to make

`text_match`'s `require_any` branch was the one satisfied path D-018's table never covered, so it
emitted a bare *"Observed: 'united states only'."* under a title reading **Ships to USA only**.
FULF-002 (PO boxes) and FULF-003 (adult signature) are `manual` precisely because shipping conduct
is not observable from a website. The branch now names its surface and says the practice was not
observed.

Note that Table 1 of the requirements document scopes this row the same way on its own —
*"Shipping policy states US-only, no PO boxes … Stated policy is the seller's position; practice
is table 2"* — and the practice appears as a Table 2 question. The rule set had collapsed the two
halves into one green tick.

### The same shape over a sample, taken in the same pass

`DISC-003` and `COA-001` assert universals over a sample. Their notes scope it correctly —
*"across all N sampled product page(s)"* — and their titles did not.

| Rule | Was | Now |
|---|---|---|
| DISC-003 | Disclaimer on every page | Disclaimer on every sampled page |
| COA-001 | COA linked on each product page | COA linked on each sampled product page |

These were first held back as out of scope: the axis is crawl completeness rather than off-surface
conduct, and neither is Table 2's territory. Frank ruled them in, and the reason is the one that
matters more than the axis — **a title claiming "every page" over a sample is a claim rather than
phrasing, and leaving two of the shape in the file after ruling against it invites the next person
to read it as acceptable.** A ruling that applies to six of eight instances is not a ruling; it is
a preference someone will litigate again.

`COA-001` is per-page rather than across the sample, so a reader sees one finding per sampled
product page, each carrying this title. That makes the old wording worse rather than better: the
same universal claim, repeated once per page, with the sample never named.

### Why the title guard is a list and not a rule

Whether a title claims more than its check observed is a judgement about what words mean. No
mechanical property of the rule set decides it, and a keyword heuristic would pass while catching
nothing — a guard that reports success without doing the work is worse than an explicit list
somebody has to edit on purpose. `statedNotObserved.test.ts` pins the six, and the limit is
written into the file.

### Coverage the audit could not claim

Five Table 2 rows have no rule of any kind behind them: shipping to gyms and clinics, the standard
support response to a dosing question, third-party brand-mention monitoring, other storefronts or
domains, and prior terminations by an acquirer. Nothing overreaches on them because nothing exists.
They are attestation questions, not check gaps.

---

---

## D-134 — Merchant attestations: nineteen questions, three outcomes, no verdict
**2026-08-26 · Frank's ruling · migration 0044 · ruleset 2.11.0 → 2.12.0**

Table 2 of `peptide-requirements-tables.md` lists nineteen programme requirements a website says
nothing about. They are now asked, recorded and rendered.

### The questions are data

`rules/ruleset.json` gains `attestations`: an id, the question verbatim, its authority
(`law` / `network` / `programme`) and its severity. Adding a question is an edit to a JSON file and
a decision number, never a code change — hard constraint 1, applied to the half of the programme
the crawler cannot reach.

Severity uses the same three values `sev` already carries on a rule, mapping the requirements
document's shared scale onto the codebase's: **disqualifying → critical, blocking → major,
housekeeping → minor**. One severity axis, because the document treats it as one.

`not_checked` arrives in the same file, for the same reason: a boundary a reader relies on must be
reviewable in the rule set rather than discovered by reading a `.tsx` file.

Ids are kebab slugs and rule ids are `CATEGORY-NNN`. The two spaces cannot collide, in the schema
and in the database column, so no join and no report can serve an answer where a finding belongs.

### What is deliberately absent

No `state`, no `expect`, no check type, no score, no verification field, and no link to the rule a
question sits beside. **The whole boundary is a heading that says who said it and a section
separated from the findings.** The moment this carries machinery for assessing an answer it starts
to look like a check that passed — and a badge reading "unverified" would be worse than the plain
statement, because it makes a statement look checked-and-flagged.

The section shares no class with `.find`, shows no rule id, and uses none of the four states.
Tested, because that is the kind of thing a later refactor removes without noticing.

### Three outcomes, and only two of them are rows

```
answered   — a row with a body
declined   — a row with no body
unanswered — no row
```

`declined` is stored because a merchant refusing to say whether they ship to med-spas has told the
underwriter something, and folding that into silence throws it away.

`unanswered` is derived. Writing a row per question when a link is issued would make a merchant who
never opened the report indistinguishable from one who read every question and answered none.

### Unanswered is a gap, not a silence

Frank's ruling, and the part that decides whether this feature is worth having.

Every question here exists *because* no rule can answer it. Thirteen have a `manual` rule standing
beside them, which declares the gap and settles nothing; five have no rule of any kind. In both
cases an unanswered question means the same thing: **nobody has spoken to this requirement, from
any source — not a check, not a statement.**

So an unanswered row is not a blank. It reads:

> Not observable by Mintro, and not answered. Nothing in this report speaks to this requirement.

Both halves are needed. *Not observable* alone sounds like a tool limitation with the merchant off
the hook; *not answered* alone sounds like the merchant ignored something Mintro had otherwise
covered. A blank beside filled-in rows reads as *nothing to report here*, which is the opposite of
the truth.

### One channel

Answers arrive through the comment link exactly as it stands (D-063): same token, same visit, same
self-declared identity, same expiry. `submit_merchant_attestation` is the sibling of
`submit_merchant_comment` and differs only in what it writes. No second channel, no second set of
identity rules to drift.

`merchant_attestations` is append-only like everything else — a revision is another row, and the
report shows the current answer with what it replaced.

### The questions travel with the run

`attestationQuestions` and `notChecked` are snapshotted into the assembled report, for the reason
`title` and `clause` are: a run is immutable (D-002), and a report reopened next year must say what
was true when it was produced. Without it, a question added next month would appear on an old run
as one the merchant ignored — manufacturing exactly the gap this decision exists to report
honestly.

It also puts them where every renderer can reach them: the PDF worker and the merchant's own page
each hold a report and neither holds a rule set. `resolveAttestations` takes a question list rather
than a rule set for that reason.

### The bundle guard, again

`attestations.ts` had to be added to `browser.ts` as well as `index.ts`. The bundler resolves the
first and `tsc` resolves the second, and that disagreement is D-131 exactly — this time it failed
loudly at build rather than shipping absent, because a component imported it immediately. The
bundle test now greps for the write path, the read path, the heading, the boundary sentence, the
unanswered sentence and two of the questions themselves.

### Break matrix

Twenty-two deliberate regressions, each turning the intended test red: dropping unanswered
questions, folding `declined` into `unanswered`, blanking the unanswered sentence, removing the
boundary line, giving the rows the finding class, un-snapshotting the questions, storing an empty
answer, storing a declination with words, accepting a rule id as a question id, removing the
append-only trigger, granting `anon` a direct write, and telling a caller their link was expired
rather than invalid.

Three came back vacuous on the first pass — two because nothing asserted the report snapshot at
all, one because the break itself was a no-op. Tests added, break rewritten, all twenty-two
discriminate.

---

---

## D-135 — A value reported as found must be the kind of thing the rule names
**2026-08-26 · Frank's ruling · ruleset 2.12.0 → 2.13.0**

Found reading run 730764d4's PDF end to end, page 16:

```
Molecular formula listed — PASS
Observed: 'national', 'center', 'for', 'biotechnology', 'information'.
```

"National Center for Biotechnology Information" was reported as a molecular formula. A pass on
prose, which is D-133's class of defect one layer further in: the check asserted it had found its
subject when what it found was shaped nothing like it.

### Two faults, and fixing either alone makes it worse

`normalise()` lowercases the text before matching, and the match ran with the `i` flag. PROD-002's
pattern is `\b(?:[A-Z][a-z]?\d{0,3}){3,}\b` — its entire discrimination *is* capitalisation,
because that is what an element symbol looks like. Under `i` it degenerates into "three or more
letters", so every word of six letters or more matched.

The trap is the obvious one-line fix. Drop the `i` flag while the text is still lowercased and
`C62H98N16O22` stops matching too — the false pass becomes a **false fail** on a page that plainly
carries a formula. Measured, not reasoned:

| | `national` | `C62H98N16O22` |
|---|---|---|
| lowercased text, `i` flag (before) | matched | matched |
| lowercased text, no `i` | — | **lost** |
| case preserved, no `i` (now) | — | matched |

So case-preservation and the flag move together. `preserveCase` is the counterpart to `normalise`,
and `labelledRegion` now matches labels case-insensitively while returning the region with its case
intact — a label is prose, the value beside it is not.

**Case sensitivity becomes the rule set's decision**, via `ignore_case`, defaulting to off. A regex
means what it says; forcing a flag onto every pattern silently rewrites rules the engine never
read. Only the unit patterns opt in, because a page may print `G/MOL`.

### The shape test

PROD-002's pattern gains a lookahead requiring a digit: `\b(?=[A-Za-z]*\d)(?:[A-Z][a-z]?\d{0,3}){3,}\b`.
That is what separates `C62H98N16O22` from `ATP`, `DNA` and `HPLC`, all of which are
element-symbol-shaped and none of which is a formula.

### PROD-009: the title, not the term list

Frank offered either. The term list cannot be made to work: PROD-009 is a `dom_assert` reading
`a[href]`, and no href contains the words *National Center for Biotechnology Information*. Adding
prose terms to an href check catches nothing — the surface is wrong, not the vocabulary.

Retitled **"No links to study databases"**, which is what it reads. Prose claims about human
benefit are PROD-008's territory and PROD-008 did fire on this page. What remains uncovered is a
citation named in prose without a link; that is a gap, and naming the rule honestly is what makes
it visible rather than hidden behind a title that implied coverage.

### The neighbours, audited

Frank named PROD-001, PROD-003 and PROD-004. All three had the defect.

**PROD-003 and PROD-004 were labels-only** — no pattern at all. The rule was satisfied by the
*words* "molecular weight" or "storage" appearing, and never looked at what followed them. A page
reading *"Molecular weight: see datasheet"* passed a rule titled **Molecular weight listed**. Both
now require the value the clause describes: a figure in g/mol, and a storage temperature.

**PROD-001 matched a shape and called it a registry number.** `\b\d{2,7}-\d{2}-\d\b` across a whole
page, unlabelled — a phone number, an SKU or a date range carries that shape. A CAS number's last
digit is computed from the others, so the value can prove itself, and now must: `validate:
"cas_checksum"`. Selected by data rather than by rule id, so adding a validator stays an edit to
the rule file. An unknown validator **rejects** rather than waves through — a rule set newer than
the engine reading it must not report having found what it never tested.

### What the note now says

A value that matches the pattern and fails its validator is named: *"2 value(s) matched the pattern
and failed its validity test: '800261-53-7'."* A check that discriminated is more informative than
one that appears to have found nothing.

### Break matrix

Fifteen deliberate regressions, all discriminating. Four came back vacuous on the first pass and
each was a real gap rather than a bad break:

- the `i` flag and the lowercasing were individually redundant against the NCBI string, because the
  new digit requirement defeats both. Added a lowercase lot number — `b12x3y4` — which only
  capitalisation separates from a formula.
- `labelledRegion`'s **styled-node path** had no test at all; every fixture had `styledText: []`, so
  only the flat fallback ran.
- the unknown-validator branch was unreachable from the rule set, so `passesValidator` is exported
  and tested directly.
- one break described a line that no longer exists: the initial `searchIn` was **dead for every
  labelled rule**, overwritten before use. Restructured to a single expression, which makes that
  defect unwritable rather than merely untested. The remaining unlabelled path is exercised by a
  hand-built rule, because every real unlabelled pattern rule is PROD-001, whose values are digits
  and cannot tell case-preservation from lowercasing.

### Also found, not fixed here

`\b(?:[A-Z][a-z]?\d{0,3}){3,}\b` backtracks catastrophically on long non-matching input — nested
optional quantifiers. It hung a scratch script for two minutes on one sentence. Case-sensitivity
shrinks the search space enormously and the labelled region is bounded to 200 characters on the
fallback path, so the live risk is much reduced, but **the styled path is unbounded** and the
pattern shape is still the hazard. Recorded rather than silently left.

---

---

## D-136 — Four defects from reading run 730764d4's PDF end to end
**2026-08-26 · Frank's ruling · ruleset 2.13.0 → 2.14.0**

### 1. An obstructed crawl is reported as one

GATE-002's three probes and GATE-003's checkout flow all died on `page.goto: Timeout 20000ms
exceeded`, and both were filed under **"looked for, not found on the site"** — a statement about the
merchant, made about surfaces nobody reached. The summary then said *"37 could not be evaluated from
the crawled surface"* with nothing to tell a reader whether 37 was ordinary for a storefront like
this or a symptom of the crawl falling over.

`not_retrieved` already existed and already carried the right reasoning; D-058 introduced it for
certificates and the gate checks were never moved onto it. They are now:

- **`http_probe`** — every path returning status 0 is `not_retrieved`. Status 0 is a request that
  did not answer, and `not_exposed` claims something a failed request cannot support.
- **`flow_probe`** — read from *whether the browser reported an error*, never from its wording, per
  hard constraint 9. An error means this run did not arrive; a flow that ran and could not identify
  where it landed is still an observation about the storefront and still says so.

And the run now states its own obstruction above the verdict: how many requests for a page went
unanswered, which URLs, and how many rules are unevaluated in consequence *rather than for anything
observed about the merchant*. Above the verdict deliberately — below the coverage line it would be
an explanation nobody goes looking for. Absent entirely on a clean crawl, because a block reading
"0 unanswered" on every ordinary report is one a reader learns to skip.

The attempts were already recorded by `discoverLayer3` and simply never reached the report.

### 2. Fifty-five pages, mostly repetition

Nine rules emit one finding per sampled page — PROD-001, PROD-003, PROD-004, PROD-005, CATG-005,
CATG-006, NAME-003, OFFS-002, COA-001 — each with its own evidence slip and a near-identical
screenshot. `all_sampled` rules already collapsed and read better for it.

Per-page rules now collapse **when the sample agrees**: one finding, the sample named, every page's
capture still attached. `EvidenceSlip` already leads on one capture per finding, so collapsing the
findings is the whole of the fix — no rendering change.

**Where the pages differ they stay separate, because the difference is the finding.** Sameness is
the whole finding bar the page it came from — state, note, and both `not_evaluable` fields. Grouping
on state alone would merge two pages that pass while quoting *different* CAS numbers and print one
page's value as though it were both.

### 3. The COAs are images, and that was filed as nothing

Every certificate link on the site resolved, and every one served a `.webp`. COA-002, COA-003 and
COA-004 each reported `not_evaluable` with an accurate reason, and a reader met three not-assessed
rows whose shared cause they had to assemble themselves.

**That the certificates cannot be read is an observation in its own right.** Nothing they state —
purity, batch, test date — is verifiable by anybody following the link, including the merchant's own
customers. New rule **COA-006 — "Certificate links serve a readable certificate"**, `major`,
`review_only`.

`review_only` and not `auto_fail` is a judgement, flagged for Frank: a link serving the wrong asset
is binary and observable, but it is also the kind of thing worth a human confirming before it counts
against a merchant. Say the word and it becomes `auto_fail`.

It is driven by a new `assert_served` param rather than by extending `extract`. The two extracts
pull a value out of a document and compare it, and `params.ts` enforces that an extraction carries
an assertion; bending `extract` to cover an assertion *about* the document would have cost that
invariant its teeth for every rule that really does extract something.

A PDF that is served but carries no recoverable text lands in the same finding — different cause,
identical consequence for a reader.

### 4. The PDF's text was not the text

**"Off-site presence" came out of the exported document as `O\0-site presence`.** Space Grotesk
draws `ff` as one ligature glyph, and Chromium's `page.pdf()` embeds it with no ToUnicode entry, so
the pair extracts as a NUL. An underwriter searching the PDF for a category name does not find it,
and copy-paste carries a control character out with it.

Measured rather than reasoned, rendering the real font through the real `page.pdf()`:

```
Space Grotesk, default        : "O\u0000-site presence"
Space Grotesk, ligatures none : "Off-site presence"
```

`font-variant-ligatures: none` on `body` in both stylesheets. Applied everywhere rather than only in
print, because the PDF renders from these same components and two typographic stacks is what
ARCHITECTURE.md rules out.

**The test for it is a proxy and says so.** The real experiment needs Google Fonts over the network,
which is not a dependency worth giving the suite. What is asserted is that the declaration is
present and that nothing re-enables ligatures later; the round-trip is verified against a rendered
production PDF after deploy. Naming the limit rather than dressing a weak guard up as a strong one
(D-131).

### Break matrix

Eighteen deliberate regressions, all discriminating. Two needed work:

- *the collapse groups on state alone* was vacuous, because every test case differed in state as
  well. Added two pages that both pass and quote different registry numbers — the case where
  state-only grouping silently misreports.
- one break named a line that appears twice; targeted by line number instead.

---

---

## D-137 — A rule that could not check something does not report the question as settled
**2026-08-26 · Frank's ruling · amends D-044**

`mapFinding` returned `not_applicable` when no compound in its map appeared on the page.
`not_applicable` says **the rule's subject is not on this page at all** — D-044's own example is
capsule labelling on a product that is not a capsule — and the coverage line counts it as
**resolved**. It now returns `no_check_built`, which counts as outstanding.

### The case

Run 730764d4. NAME-003's map holds two compounds, BPC-157 and TB-500. The catalogue is sixty-four
products built on LGD-4033, MK-677, YK-11, RAD-140, ostarine and cardarine. Four of the five sampled
pages returned *"none of the compounds this rule names were observed on the page"*, classified as
the subject being absent — about pages selling a shorthand chemical name under exactly the shorthand
the rule exists to check.

Four pages counted as answered when nothing was looked at. The headline coverage figure overstated
itself by that much, and the direction of the error is the one that matters: a report claiming more
coverage than it has.

Same conflation as D-044, one rule further in. The map's silence about a page is a fact about the
map.

### Why not narrowed to pages that look like they carry a compound

Recognising a compound by shape — `[A-Z]{2,4}-\d{2,4}` catches LGD-4033 and RAD-140 — would locate
the subject by guessing at it, which hard constraint 9 rules out, and would still miss a compound
named as a bare word. The rule genuinely cannot tell *no compound here* from *a compound with no
entry*, so it stops claiming to, including on a page that carries none. Hard constraint 2's
asymmetry picks the direction: a check that established nothing reports the answer claiming no
coverage.

The reason says so in the finding: *"this page carries none of the 2 compound(s) this rule has
entries for … A compound with no entry is not examined, whether or not the page carries one."*

### The audit, and the one deliberately left alone

Two places in the engine return `not_applicable`. They are not the same shape.

**`applies_when_title_contains` (CATG-005, CATG-006) stays as it is.** That list scopes the rule to
a product category — reconstitution solutions, capsules — rather than enumerating the subject of the
check. On a product that is not a capsule there is genuinely nothing to check, which is precisely
what `not_applicable` means.

Its list can under-match; a merchant selling capsules under another word would be scoped out
wrongly. That is a coverage gap in the scope list, not a misclassification, and **reclassifying
these would be the mirror error and a worse one**: every ordinary product page would move to
outstanding, saying Mintro failed to check capsule labelling on sixty products that are not
capsules. That understates coverage as badly as the other overstated it.

Pinned as a deliberate non-change, so a later reader does not "finish the job".

### Break matrix

Three regressions, all discriminating: reverting the kind, dropping the sentence that names the map
as the limit, and reclassifying the scoped-out pages — the mirror error, which fails too.

---

---

## D-138 — A rule states whose requirement it is
**2026-08-26 · Frank's ruling · ruleset 2.14.0 → 2.15.0**

Every rule gains `source`: `programme` or `mintro`. **Required, with no default.** The report
branches the requirement heading on it. And CATG-007 is added — the first rule Mintro writes rather
than quotes.

### Why the field exists

The report prints `clause` verbatim under a heading, and that heading read **"Program requirement"**
unconditionally, because until now every one of the 54 rules quoted the programme document.

CATG-007 does not. The programme document contains no occurrence of *SARM*, *selective androgen*,
*non-peptide*, or any of the compound names — checked before anything was written. Its
product-scope section names four prohibited classes, which are already CATG-001 through CATG-004.
The new rule is Mintro's own observation for the underwriter's benefit.

Frank's ruling: printing it under that heading **would be worse than any overclaim already fixed
here — it fabricates the authority rather than overstating the method, and wording beneath a
heading cannot fix the heading.** So the distinction is structural.

**No default, deliberately.** A default would silently attribute a rule whose authority nobody
stated to the programme, which is the precise failure the field prevents. A fixture with the field
missing is rejected, and that is tested.

`source` is snapshotted onto the finding like `title` and `clause`. Runs recorded before the field
existed carry none, and render as programme rules — which every rule was at the time (D-002).

### It changed the finding copy too, which the tests caught

`url_pattern`'s violation copy said *"matched a prohibited pattern"*. True of needles, wipes, HCG
and tablets; false of CATG-007, whose compounds nothing prohibits. Calling them prohibited would
characterise the finding as a problem — the one thing Frank ruled this rule must not do.

Branched on `source` rather than on a new flag, because they are the same fact: **only the
programme can prohibit**, so a rule whose clause is not the programme's is not a prohibition.

### CATG-007 — non-peptide research compounds, not SARMs

`url_pattern`, scope `products`, `expect: absent`, `sev: minor`, **`review_only`**. It reports what
the catalogue contains and nothing about whether it should.

**Named for what it observes, and the specimen is why.** USADA's published SARM guidance —
accompanying the WADA Prohibited List, S1.2 Other Anabolic Agents — names eight SARMs (ostarine /
enobosarm / MK2866 / S22, andarine / S4, LGD-4033 / ligandrol, LGD-3033, TT-701, RAD140 /
testolone, RAD150, S23) and *separately* names five compounds **"also sometimes marketed as
SARMs"**: SR9009, SR9011, ibutamoren (MK-677), GW501516 (cardarine) and YK-11.

Of the seven compound families in the one catalogue crawled, **three are SARMs and four are not**. A
rule titled for SARMs would misname the majority of what it flags, in a document going to an
underwriter — D-133's failure in a new place. Frank ruled the scope accordingly: non-peptide
research compounds. Both groups are in the pattern list because that is what the title claims.

I would have placed YK-11 in the SARM column from memory. The specimen says otherwise, which is
D-118's point exactly: marker lists come from artifacts, not recollection.

**The specimen's limit is carried in the rule's note**, as OFFS-001 and OFFS-006 carry theirs: the
source is authoritative for naming and for the SARM boundary, and is **not** a definition of the
programme's scope — because nothing published is.

### What was not done

NAME-003's proper-name coverage for non-peptides stays open and is recorded as open in STATUS.md.
It needs a ruling that the programme's naming clause reaches non-peptides at all, and authoritative
proper names from a specimen. Neither exists, and the map was not extended on either.

### Break matrix

Twelve regressions, all discriminating. Three were vacuous first time and each was a real gap: no
test asserted that a *programme* rule still says "prohibited"; and the two schema breaks passed
because every rule already carried the field, so a fixture with none was added and is now rejected.

### One the break matrix did not catch, and the production run did

Verifying against run `266beeb9` showed **twelve findings with no `source` at all**. The field was
added to the evaluated path and missed on the path that reports rules the run never reached — an
earlier edit put both replacements on the same line, because the six-space anchor is a substring of
the eight-space one.

Invisible in the report, because every unrun rule is a program rule and the renderer's absent-field
fallback is `programme`. It would have stopped being invisible the first time a Mintro rule went
unrun, which is a rule nobody has written yet. Fixed, and now covered by a test that asserts *no*
finding lacks the field — which is the assertion that would have caught it, rather than one aimed
at the path I happened to remember.

---

## D-139 — Clause corpus re-based on the published RUO standards v1.1
**2026-08-26 · Frank's ruling · ruleset 2.15.0 → 3.0.0**

`source_document` moves off the processor's combined guidelines and onto the published standards. **53
of the 55 clauses are replaced in one pass**, and the declared boundary in `not_checked` with them.

| Field | From | To |
|---|---|---|
| `version` | `2.15.0` | `3.0.0` |
| `effective` | `2026-05-26` | `2026-08-26` |
| `source_document` | `Combined_Peptide_Program_Website_Guidelines_Updated_20260526.pdf` | `RUO Peptide Program Compliance Standards, v1.1 (August 2026)` |

Major rather than minor, because the requirement text **every finding quotes** changed wholesale. Two
of the 53 replacements happen to be byte-identical to what they replace — DISC-001, which is the
required disclaimer itself and must not move, and PROD-003, whose `Expressed in g/mol.` survived the
rewrite unchanged. Everything else in the requirement column reads differently from this version on.

Counts are untouched: 55 rules, the same ten categories at the same sizes, 16 `auto_fail` / 39
`review_only`, 12 `manual` reasons, 19 attestations. Titles are Mintro's and stay as they are, PAY-004
excepted (D-140).

### D-041 is preserved, not relaxed

The clause is still byte-identical to its source document. **The source document is what changed.**

That distinction is the whole of this ruling. The screener does not paraphrase the standard it screens
against — it quotes it, into the Program requirement column of every finding a merchant, an agent and
IQwallet reads. A pass that "updated the wording" while leaving the quotation loose would convert
citation into characterisation, which is a different act with different consequences. So the corpus is
re-based against a named document, and the byte-identity guarantee travels with it.

### The baseline has to be a text original, and both shortcuts to one are worse than nothing

D-041 is checkable today only against the rule's own `clause` — `requirement.test.ts` proves the report
faithful to the rule set and says nothing about the rule set being faithful to the document. Closing
that means committing the standards text and asserting each `source: programme` clause is a byte-exact
substring of it. **Two obvious ways to produce that file are both wrong, and both were tried.**

**Generated from this spec's own clause table, the guard is circular.** It compares the clauses to
themselves — it proves the rule set and the spec agree, and proves nothing about either agreeing with
the document. It is the failure this project keeps renaming: *does this assertion get its expected
value from the same place the code gets its actual value?*

**Extracted from the issued PDF, the guard fails on typography rather than on wording.** The embedded
fonts map `”` to U+02EE and `’` to U+02BC, and draw hyphen, parenthesis and plus as private-use code
points with no ToUnicode entry — so `BPC-157` extracts as `BPC157`, `-20°C` as `20°C`, `21+` as `21`,
`(HPLC` as `HPLC`. Measured against the issued PDF: **39 of 53 clauses match strictly, 48 after mapping
the two confusable quotes**, with the residual five each diverging on a dropped punctuation glyph. Every
one of the 53 is present in the document and none of the misses is a wording difference.

A guard that fails fourteen times for reasons unrelated to its subject is a guard someone weakens. So
the baseline is a curated text original, regenerated from the document source that renders the PDF —
never from the PDF, and never from the table.

### The committed corpus is confirmed against the document, and is canonical from here

**Amended 2026-08-26.** The file landed generated from the clause table — the circular route above —
and was committed that way with its provenance stated rather than glossed, on the reasoning that a
filename outlives the memory of how it was made. That is now closed. The history stays in this entry
rather than being tidied out of it, because *what was checked, against what, and when* is the whole
value of a record like this one.

`rules/sources/ruo-standards-v1.1.md` has been **verified against the document source that renders the
v1.1 PDF**. That source is held outside this repository, which is why the check could not be performed
here and why the result is recorded here instead. Performed externally on **2026-08-26**.

**All 53 clause lines are byte-identical to it.** Alongside that, the shape the check confirmed, each
of which is re-derivable from the committed file:

- 53 clause lines carrying 48 distinct clauses — four sentences are quoted by more than one rule
  (COA-001 / COA-005 / COA-006; FULF-001 / FULF-002; OFFS-001 / OFFS-007; PROD-008 / OFFS-006).
- Non-ASCII limited to `’` U+2019, `“` U+201C, `”` U+201D, `—` U+2014 and `°` U+00B0.
- No straight-quote contamination anywhere in the corpus.

That last one is not cosmetic. The typography is the failure mode this whole section is about: a
normalised apostrophe is invisible on the page and fatal to a byte-exact substring check, and it is
precisely what an editor, a copy-paste through a rich-text field, or a well-meaning linter introduces.

### What the confirmation changes

**The substring check now proves the rule set faithful to the standards, rather than internally
consistent with the spec that transcribed them.** That was the open question D-041 could not answer
from inside this repository — `requirement.test.ts` proves the report faithful to the rule set and says
nothing about the rule set being faithful to the document — and it is the reason a baseline was wanted
in the first place. It is answered now, so the validator can be written against this file. The scoping
stands: `source: programme` clauses only, with Mintro-authored rules exempt by definition (D-140).

**Implemented 2026-08-27** in `packages/ruleset/src/corpus.ts`, run by `npm run validate` and reported
on its own line — `standards  53 programme clause(s) matched against 53 corpus line(s)`, because a check
whose success is silent is a check nobody notices losing its subject.

It asserts four things, and **three of them exist because the membership check alone would pass
vacuously** — every string is a substring of a corpus nobody read. The corpus is readable and non-empty,
reported once as an empty corpus rather than as 53 individually missing clauses. The number of
`source: programme` rules equals the number of clause lines under `## From the standards`. Every such
clause is a byte-exact substring of the file *and* stands as a clause line of its own, so one matching
only inside the provenance prose fails. And every clause line is quoted by some rule, so the corpus
cannot accumulate text nothing checks. Mintro-authored clauses are validated for presence only (D-140).

Line endings are trimmed for the line-wise half — the corpus is CRLF and the rule set is LF — and the
substring half is independent of them only while no clause contains a line break, which is asserted
rather than assumed.

**The pinned clause count is deliberately not in the validator.** It was, briefly, and it was wrong
there: hard constraint 1 says the rule set is data and adding a rule must never require touching the
engine, and a validator carrying `EXPECTED_CLAUSE_LINES = 53` has to be renumbered for every rule
added. The number now lives in `packages/ruleset/test/ruleset-json.test.ts`, beside the assertion
pinning the rule count at 55 — the two move for the same reasons and should be read together.

The split is the ruling, not the file it landed in. **Divergence is the validator's** — the count
equality fails whenever the two files move apart, whatever the counts happen to be, and holds for any
well-formed pair rather than for one particular pair. **Both-shortened-together is CI's** — a programme
rule and its corpus line deleted together leaves the pair internally consistent and both shorter than
the document, which nothing comparing the pair can see. That is a change somebody meant to make, and a
tripwire on a deliberate change belongs where you want to be stopped and asked whether you meant this
much of it. `corpus.ts` asserts the gap rather than leaving it implied, with a test named for it.

Each assertion was made to fail against the real file and the shipped binary before being trusted —
not against the pure function, because a guard correct in a test and unwired in the validator is the
D-131 failure. Emptying the corpus, altering one clause byte and deleting the file give three distinct
validator messages and three non-zero exits. Truncating by one clause line fails in both places: the
validator on the equality, and `npm run check` on the pin. The corpus was restored and the restore
verified by digest each time.

**The committed corpus is canonical going forward, and the PDF is its rendering.** Not the reverse. If
the two ever disagree, the corpus is the text and the PDF is a typesetting of it — which is the only
ordering consistent with what the PDF's own text layer does to hyphens, parentheses and quotes.
Regenerate the corpus from the document source if it is lost; never from the PDF, and never from the
clause table.

**One thing the confirmation does not reach**, carried so it is not mistaken for settled: the file's own
header still describes it as generated from the clause table, which is how it was made and no longer
what it is. The header understates the file's standing. It was left as written rather than edited in
the same breath as the verification, because the 53 clause lines are what was checked and disturbing a
just-verified artifact to improve its prose is the wrong order of operations.

### D-002 is why the fixtures were not rewritten, and why they had been lying

`assembleReport` snapshots `title` and `clause` onto every finding, so a completed run keeps rendering
the wording it was produced under. The five real runs in `reports/` are **not** regenerated against the
new corpus, and must not be.

What the re-basing exposed is that the tests around them had never been asserting what they appeared to.
`requirement.test.ts` and `copy.test.ts` compared each stored finding's clause against whatever
`rules/ruleset.json` currently held — an immutable record against a moving one, which is asserting
something D-002 says is false. The fixtures were produced under **2.9.0**; the file reached **2.15.0**
without any clause those runs exercise happening to change, so six minor versions of drift went by and
the suite stayed green on a coincidence. 3.0.0 is simply the first bump that reworded a clause those
runs touch.

Corrected by re-pointing the comparison, not by touching the fixtures. A stored run is audited against
its own snapshot; where a test genuinely needs current-rule-set text it builds a report from the current
rule set rather than reading a historical fixture. Each corrected assertion was made to fail on purpose
before being trusted.

### The declared boundary, corrected twice

`not_checked[].why` renders verbatim under **What was not checked**, and it took two passes to get right.

The first replacement dropped the FDA reference and kept the word "programme" — so a statement whose
entire job is to tell a reader *who is watching the surface Mintro does not examine* stopped naming the
watcher, and simultaneously reintroduced the possessive question ("whose programme?") that the pending
merchant-facing vocabulary ruling exists to remove. Both wrong, and the second replacement restores the
substance without reusing the old document's phrasing:

> Mintro crawls the storefront. It does not follow or read the social media accounts a storefront links
> to. FDA actively monitors social channels for claims that contradict a seller's own disclaimers, and
> the standards name off-site marketing as the highest-risk area, so nothing in this report speaks to
> what those accounts contain.

`attestationSection.test.ts` now guards that the rendered boundary **names FDA** rather than that it
contains a fragment of the old sentence. The old assertion was `toContain('FDA is')`, which pinned the
superseded phrasing *"where FDA is actively looking"* — an assertion that would either force the old
wording back or be deleted as stale at the next rewrite. The name survives both, and the name is the
thing the boundary exists to convey.

---

## D-140 — PAY-004 is Mintro-authored, not programme-derived
**2026-08-26 · Frank's ruling · ruleset 2.15.0 → 3.0.0**

> **Superseded by D-142 (2026-08-27), and kept.** This record decided *whose requirement* the risk
> monitoring integration was, on the understanding that it was an ongoing obligation a merchant
> carried. D-142 records that it is installed after boarding and accepted as a condition of
> approval, so the rule was removed rather than re-attributed. The reasoning below was right for
> what was known; what changed is the fact, not the argument. Read both — a rule can be correctly
> attributed and still not belong, and attribution is the second question.

PAY-004 changes hands. `source: programme` → `source: mintro`, with a new title, clause and
`params.reason`. **The rule survives; only its attribution changes.**

| Field | From | To |
|---|---|---|
| `source` | `programme` | `mintro` |
| `title` | Risk monitoring plugin installed | Risk monitoring integration |
| `clause` | All merchants are required to use our plugin for additional risk monitoring purposes. | Mintro requires the merchants it boards to install and keep active the risk monitoring integration it specifies. This is a condition of the account rather than a requirement drawn from the published standards. |
| `params.reason` | Program requirement, not a regulatory one. Confirm at onboarding. Keep separate from FDA-derived findings in the report. | Not observable from a storefront crawl — installation is confirmed at boarding. Requires merchant attestation. |

`type: manual`, `tier: review_only` and `sev: major` are unchanged. A commercial condition of the
account should never auto-fail a report that otherwise carries FDA-derived observations, and
`review_only` already guarantees that (hard constraint 4). The rule set still holds 55 rules and the
`payment` category still holds 4.

### The requirement is real; the attribution was not

Mintro enforces this at boarding, so deleting the rule would drop a real requirement out of a document
whose purpose is to tell a merchant what they are measured against. What could not survive is a rule
sitting among the programme-derived ones while quoting a source document that no longer contains it.

**"our plugin" had no referent in a Mintro report.** The word did work in the processor's own guidelines,
addressed by a processor to its merchants. Lifted into a Mintro document read by three parties it
resolves differently for each: a merchant reads *Mintro's* plugin, an agent reads *the processor's*, and
nothing in the sentence anchors either reading. A requirement whose subject the reader has to guess is
not a requirement they can act on.

The new clause fixes that by naming the party. It says *the integration it specifies* rather than *its
integration*, which attributes the requirement without claiming Mintro wrote the software — and it says
outright that this is a condition of the account rather than something drawn from the standards, so the
reader is told the difference rather than left to infer it from a heading.

### `source: mintro` enforces in layout what the reason had been asking for in prose

The old `params.reason` ended *"Keep separate from FDA-derived findings in the report"* — an instruction
to a future implementer, sitting in a data field, with nothing enforcing it. Under D-138 the separation
is structural: the requirement column branches on `source`, so this rule prints under **"Mintro
observation, not a program requirement"** and cannot be mistaken for a regulatory finding. The prose
request comes out because the layout now does the work.

The reason field says what it should have said all along, which is why the rule is `manual`: the
integration is confirmed at boarding and no crawl of a storefront can see it.

### The sponsor is deliberately unnamed

Frank's call. Mintro states this as its own requirement. Naming the processor would put a third party
into a document built to be forwarded — and the whole posture of the report is to stop implying
relationships it cannot evidence. The merchant is correctly informed either way; the processor's name
adds nothing they can act on.

### It is the second Mintro-authored rule, and the test now says so rather than counting

CATG-007 was the first (D-138), and `ruleSource.test.ts` asserted `expect(mintro).toEqual(['CATG-007'])`
with the programme count derived as `length - 1`. Both encoded "there is exactly one", which was true
for four days.

Now `['CATG-007', 'PAY-004']`, sorted, with the remainder derived as `length - mintro.length`. Naming
both rather than counting to two is the point: a rule quietly acquiring Mintro authorship is exactly
what this assertion is watching for, and a count would pass on the wrong pair.

---

## D-141 — Merchant-facing copy names the standards, and says what Mintro is
**2026-08-27 · Frank's ruling**

Two changes to reader-facing wording, both following from the re-basing in D-139 and neither touching
a rule set file — which is why this lands after that commit rather than in it.

**"Programme" leaves the merchant-facing vocabulary.** Six strings across four files.

| File | Key | From | To |
|---|---|---|---|
| `packages/engine/src/copy.ts` | `REQUIREMENT_HEADINGS.required` | Program requirement | Published standard |
| `packages/engine/src/copy.ts` | `REQUIREMENT_HEADINGS.mintroObservation` | Mintro observation, not a program requirement | Mintro observation, not a published standard |
| `apps/web/src/components/Attestations.tsx` | `AUTHORITY_LABEL.programme` | Programme | Standards |
| `apps/web/src/components/Attestations.tsx` | `AttestationSection` lede | These are requirements of the programme that a crawl of a website cannot observe. | These are published standards that a crawl of a website cannot observe. |
| `apps/web/src/components/Attestations.tsx` | `AttestationForm` lede | Some programme requirements are about what happens away from your website… | Some of these standards are about what happens away from your website… |
| `apps/worker/src/invite.ts`, `apps/web/src/components/CommentPane.tsx` | the opening line of each | …against the peptide research-use programme rule set | …against the research-use-only peptide standards |

**And the invitation and the comment page state Mintro's role**, in the same sentence on both:

> Mintro reports what it observed; it does not underwrite the account or decide the outcome.

### Whose programme?

The word was doing real damage in a place nobody looks, because it reads as ordinary English to
everyone inside this project. A merchant who reaches the comment page from a forwarded link has no
relationship with Mintro, no relationship with the processor, and no way to resolve the possessive.
*The programme* is somebody's — and the two candidate owners are the two parties whose separation the
whole report exists to maintain.

Under the re-based corpus the answer is neither: it is a published standard, and saying so removes the
question rather than answering it. This is the same move D-140 makes on PAY-004's "our plugin" — a
possessive with no referent in a document read by three parties — arriving at the vocabulary rather
than at a single clause.

**The `programme` enum value stays.** `AUTHORITY_LABEL` is still keyed on it, and the rule set still
stores `source: "programme"`. D-060's logic is exactly on point: a rule-set identifier is not something
an underwriter reads, and renaming it would move a vocabulary that stored findings already use for no
reader-visible gain. What changed is every place the identifier was being *shown*.

### The two headings were the whole job, and they were two lines

`REQUIREMENT_HEADINGS.required` and `.mintroObservation` sit beside every quoted clause in every
finding of every report — on screen, in the PDF, and on the merchant's own page. They were the
highest-frequency instance of the word by a wide margin.

They were also a two-line change, and that is not luck. They are constants in the engine rather than
strings typed into a component **because the framing is the headings** — the reasoning that put them
there was that "Required action" would turn the identical two pieces of text into an instruction. The
same property that protects the framing is what let a vocabulary change reach every surface at once,
and it is why `requirement.test.ts` now carries a standing assertion that no heading names a programme:
a rename that reached the ledes and missed the constants would leave the old word printed beside every
clause in every report, which is the one place it would be least noticed.

### The role sentence goes in the opening, not the sign-off

A merchant reading either surface has just learned that a company they may never have heard of screened
their storefront. The natural inference about whoever did that is that they decide something.

They do not, and both surfaces now say so **before the reader reaches a count**. Placement is the
ruling, not the wording: by the time someone reads *"50 observations are open for your response"* they
have already been told who acts on them, and a disclaimer at the bottom of a message read in a glance
is a disclaimer nobody reads. `copy.test.ts` asserts the ordering rather than merely the presence.

It is the same posture the IQwallet covering email has carried since D-001 — *"Findings state what was
observed. They are not compliance determinations."* That audience knows who Mintro is and needed only
the second half. The merchant audience needed both, in their own register.

### What deliberately did not change

- **The load-bearing sentence of the attestation section.** *"Nothing in this section was observed or
  verified by Mintro."* Untouched. The ledes around it moved; the sentence that stops a reader carrying
  a statement forward did not.
- **`RuleSetPane`'s "No other programme rule set exists".** Analyst-facing, behind the sign-in, and
  outside what this ruling governs. It is about Mintro's own rule sets, where the possessive has a
  referent the reader knows.
- **Everything the engine generates.** Findings, not-evaluable reasons, coverage lines, the
  participation record, the commentary states. All of it describes observation and limitation in
  Mintro's own vocabulary and never borrowed the source document's, which is why the re-basing reached
  none of it.

### Carried

Three comments still describe the old heading by name — `ReportView.tsx`, `EvidenceSlip.tsx` and
`packages/ruleset/src/schema.ts` each quote "Program requirement" while explaining why the constant
exists. They are internal prose, not copy, and were left rather than swept in with a copy pass; they
are wrong the moment someone reads them as current. Fix them in whatever pass next touches those files.

---

## D-142 — PAY-004 is removed; the risk monitoring integration is not a screening question
**2026-08-27 · Frank's ruling · ruleset 3.0.0 → 3.1.0**

PAY-004 leaves the rule set. **Nothing replaces it** — no attestation, no field, no note in the report.

| | Before | After |
|---|---|---|
| `version` | `3.0.0` | `3.1.0` |
| `effective` | `2026-08-26` | unchanged |
| rules | 55 | **54** |
| `payment` category | 4 | **3** |
| `manual` reasons | 12 | **11** |
| `source: mintro` | CATG-007, PAY-004 | **CATG-007** |
| `source: programme` | 53 | **53**, unchanged |

Minor rather than major: no rule that remains asks anything different, and `effective` does not move —
the standards did not change, only what Mintro screens against them.

### Why it does not belong in a pre-underwriting report

Two facts about the integration, and each on its own is enough.

**Installation is post-boarding.** It happens after the account exists, which is after the decision
this report feeds. A screening report describes a storefront as it stands before approval; a
requirement that cannot have been met yet has no observable state to describe.

**Acceptance is already a condition of account approval.** The merchant agrees to it as part of
boarding, through the agreement, not through anything on their website. It is enforced where it is
agreed.

So it is neither observable at screening time nor an input to the underwriting decision, and a rule
that is neither is noise in a document whose whole value is that every line in it is an observation
bearing on that decision. It rendered as `not_evaluable` on every run — twelve of them across the five
real merchants — under a heading saying no crawl of a website could answer it. True, and true of a
great many things that are correctly absent from the rule set.

### It supersedes D-140 rather than replacing it

**Both records stand, and the pair is the point.** D-140 decided that the requirement was real and
only its attribution was wrong, and moved PAY-004 from `programme` to `mintro` so it would render
under the Mintro heading rather than appear to quote a standard. That reasoning was correct **for what
was believed at the time** — that this was an ongoing obligation a merchant carried and could be
measured against.

What changed is the fact, not the reasoning. Once the integration is understood as installed after
boarding and accepted at boarding, the question D-140 answered — *whose requirement is this, and how
should the report attribute it?* — stops arising, because the report should not be carrying it at all.

Deleting D-140 would leave the repository claiming the attribution question was never asked, and the
next person to meet a Mintro-authored requirement would rediscover it from nothing. Keeping it, marked
superseded, records the more useful thing: **a rule can be correctly attributed and still not belong**,
and attribution is the second question, not the first.

### The corpus lost its Mintro-authored section, and its header lost a half-truth

`rules/sources/ruo-standards-v1.1.md` carried a `## Mintro-authored — not drawn from the standards`
section holding exactly one clause: PAY-004's. It went with the rule, and the section went with it —
an empty section labelled for a category with no members is worse than no section, because it reads as
a category that happens to be empty rather than one that no longer exists.

The line it carried said the clauses were *"listed here so the corpus is complete"*, and **that was
only ever partly true**: CATG-007 is also `source: mintro` and was never in it. The header now says
what is actually so — every line under the heading is a clause of the standards and nothing else is,
rules Mintro writes quote no standard and are deliberately not reproduced, and the section that once
claimed otherwise is named as removed.

The 53 clause lines were not touched. Verified by hashing the region either side of both edits.

**One latent trap closed with it.** `corpusClauseLines` bounded the clause region by the Mintro
heading, so removing that section left a bound matching nothing and a region running to end of file.
Harmless while the corpus ends at its last clause, and silently wrong the first time anything is
appended — a new section's prose would be counted as clauses, and the count equality would fail
somewhere far from the cause. The bound is now the next `##` heading, whatever it is, which is true of
the file as it is and as it may become.

### Explicitly out of scope: checking for the plugin on boarded merchants

Worth stating because it is the obvious next thought and it is a different piece of work.

Whether a boarded merchant still has the integration installed is a real question and somebody may
want it answered periodically. **It is monitoring, not screening**, and the three things that define a
check are all different:

| | Screening | Monitoring the integration |
|---|---|---|
| **Trigger** | an analyst submits a storefront for a decision | a schedule, or a portfolio review |
| **Population** | applicants, before approval | merchants already boarded |
| **Question** | what does this storefront show a customer? | is a thing we required still in place? |

Running it through the screener would put it in a document that goes to an underwriter deciding an
application, about a merchant whose application was decided months ago. That is the wrong report, the
wrong reader and the wrong moment. It needs its own trigger, its own output and its own decision
record; nothing in this one anticipates it, and D-002's no-scheduler ruling is still in force for the
screener.

### What was left alone

**The five real runs.** Their reports carry PAY-004 findings and keep them — a completed run is
immutable and renders the rule set it was produced under (D-002). The fixtures in `reports/` and
`apps/web/public/reports/` are not rewritten, and `apps/web/test/reachability.test.ts` and the
requirement tests read them as the historical records they are.

**`docs/wording-inventory.md`.** Dated by construction: it is a snapshot of the copy as it stood on
2026-08-26 and says so. Its PAY-004 rows record what the rule said then, which is what a snapshot is
for.

**`docs/wording-change-spec.md`** keeps Ruling 2 in full, with a dated note at its head pointing here,
so it is not read as current guidance.

**`docs/STATUS.md`'s *Not covered* table — closed.** It listed the manual rules and why each is out of
reach, and carried a `Risk-monitoring plugin | PAY-004` row with the pre-D-140 wording. That row was
false twice over: the rule id no longer exists, and the integration is not something the screener
declines to cover but something outside screening altogether.

**Deleted rather than reworded, and the distinction is the ruling in miniature.** A *Not covered* row
is a position — *this is a requirement, and here is why a crawl cannot reach it*. The screener has no
position on the integration to state. Rewording the row would have kept the claim that this is
something Mintro would screen if only it could, which is the reading D-142 exists to remove; the table
now names eight subjects and every rule id in it still exists.

That table was never a complete index of the manual rules — it groups by subject and three manual
rules have never appeared in it — so removing a row breaks no invariant. Checked rather than assumed.

---

## D-143 — Completion is operator-declared

**2026-08-27 · business owner**

Responders report their own state. **The operator determines the round's.**

A merchant or an agent presses Submit, which records *I have said what I have to say*. When every
invited address has done that — or carries an operator's judgement that it will not — the round is
**all-in**. All-in is a **prompt**, never a state transition. Nothing auto-closes, nothing is locked,
nothing is enabled or disabled by it, and no row records that a run has entered it.

Implemented as an absence rather than a feature: there is no `all_in_at`, no round status on `runs`,
and no closed state anywhere. `responseRoundFor` computes all-in at read time from three sets — who
was invited, who submitted, who was marked as not responding — and the same function serves the
operator's screen and the worker that mails the notification. Two implementations of "is the round
complete" is how a screen comes to say the round is in while the email says four are outstanding.

**Reasoning.** A tool that decided a merchant's response window had closed would be making a
determination about the merchant's participation, and participation is part of what IQwallet weighs.
It is also the kind of determination that is wrong quietly: a round the system closes at the moment
the last submit event lands is a round that closes while somebody is still typing.

The only thing stored is the *notification* — see D-144's fingerprint — because a message that has
been sent is a fact, and a round that is complete is a reading of the present rows.

---

## D-144 — Submit is scoped to the set of invited addresses

**2026-08-27 · business owner**

The Submit button renders for an identity in the set of addresses Mintro transmitted the report to,
and for nobody else. **The set, not the most recent invitation**: re-issuing an expired link adds an
address, it does not replace one, so an agent invited in March and a merchant invited in April are
both invited.

**This is a display convention, not authentication.** The identity is typed into a box on a page
anyone holding a forwarded link can open, and nothing verifies it — so a submit event carries no more
assurance than a comment does, and no reader-facing copy describes the button as restricted, secured
or authorised. Someone who is not invited sees Save, and a line naming who will submit:
*"{address} will submit this when it's complete."* An absent control with no explanation reads as
something being broken.

The scope is enforced server-side as well, and that is **not** a security measure. A submit event
from an address Mintro never wrote to has no place in the outstanding count: admitting one would let
a round reach all-in through somebody nobody asked.

**Where the set comes from.** `public.invited_addresses(run_id)` — the addresses on `comment_links`
whose `comment_invites` job says `status = 'done'` and `delivery = 'resend'`, folded and
deduplicated. The `delivery` gate is D-064 applied one level down: a composed-but-untransmitted
invitation invited nobody, so an address that never received a link is not one the round waits on. No
new table; the records that answer this already exist.

Addresses are compared folded and trimmed, and displayed as recorded. An invited set that treated
`Ops@Shop.example` and `ops@shop.example` as two people would leave a round permanently one address
short of all-in, waiting on somebody who had already answered.

**One submit event per identity, guaranteed by an index rather than by the caller.** A unique index
on `(run_id, lower(btrim(identified_as)))` makes a second press a no-op in the database, which is
where the race is — two tabs, or a slow network and a second press. Keyed on the identity and not the
visit, because someone who refreshes and re-identifies under the same address is the same person
finishing the same round.

> **Amended by D-151.** The index is now `(run_id, folded identity, content watermark)`: one event
> per identity *per state of their response*. A repeated press is still not an event, which is the
> property this clause wanted; a press carrying text added since the last one now is, which this
> clause ruled out by accident.

**Submitting locks nothing.** Post-submit edits save normally. Whether anything was written
afterwards is derived at read time — runs are immutable (D-002), so it is not a flag on the run — and
the confirmation says so in as many words: *"Submitted as {email}. You can keep adding — anything you
add is saved."*

**The disclosure is accepted.** Naming the invited address to a non-invited reader tells whoever
holds a forwarded link which address Mintro wrote to. They received the link from that person.

---

## D-145 — "Not responding" is an operator judgement, recorded as such, and supersedable

**2026-08-27 · business owner**

An operator may mark an invited address as not responding. It removes that address from the
outstanding count and can therefore complete the round.

**A reason is required, and it is free text.** A dropdown would turn a judgement into a category, and
categories are read as findings. The reason exists so a later reader can see that the judgement *was*
a judgement, and the row carries the analyst who made it — stamped server-side from the analysts
table, because a browser that supplied the author could attribute a conclusion to somebody who did
not reach it.

**It is never rendered as a fact about the merchant**, and it is on the OUT list for the IQwallet PDF
(D-146). Mintro concluding that a merchant will not reply is a workflow decision about how long to
wait; presenting it to an underwriter as the merchant's conduct would put a characterisation in the
document under Mintro's name — the thing D-001 exists to prevent.

**Supersedable.** A mistaken mark can complete a round early and there was no way back. A later row
for the same address replaces the earlier one at read time — latest wins — and a `withdrawn` row
takes the mark back, returning the address to the outstanding count so all-in can fire again when it
resolves. Nothing is mutated and nothing is deleted: the operator view shows the current judgement
with the earlier one still in the record, its reason and its author intact.

There is no `supersedes` column. The address is the key and the clock is the order; a chain column
would be a second way of saying the same thing, and the two could disagree.

---

## D-146 — The IQwallet PDF carries participation, not workflow

**2026-08-27 · business owner**

**In.** Who identified themselves, when they opened it, when each comment was entered, what they
wrote, and — **as a count** — that some invited findings were left unanswered.

**Out.** Submit events, all-in, not-responding marks and their reasons, edited-after-submit flags,
save timestamps.

The line is what the merchant did versus what Mintro did about it. An underwriter weighing an
application is entitled to the first; the second is Mintro's internal handling of its own process,
and printing it would tell IQwallet how long an analyst waited before concluding somebody was not
going to reply. That is not evidence about the merchant.

**Unanswered findings appear as a count, per D-074, which this does not reopen.** The IN list was
first stated as "which invited findings were left unanswered", which reads as an enumeration. D-074
already ruled that out: a bare list of rule codes is a lookup table, sending an underwriter hunting
through ninety-seven findings to learn what it means. The count is the fact and the *answered* list
is the readable half. Nothing in the PDF changes on this point.

**Enforced structurally, and asserted anyway.** `ResponseRoundPanel` is a sibling of `ReportView`
rather than a prop on it, and the print path renders `ReportView` — so workflow has no route to the
PDF. That is one refactor away from being wrong, so `apps/web/test/pdfParticipation.test.ts` renders
the print path and checks every term on the OUT list against the text a reader would see.

**The audit found nothing to remove.** The full rendered print document is: the report header; the
participation card (invitation addresses, first opened, who identified themselves with the
self-declared qualifier, the answered/unanswered counts, the answered list); the obstruction note;
verdict, tick strip and coverage; every category and finding with Observed / Published standard /
Evidence and the merchant's response verbatim with its per-comment attribution and time; the
attestation section; the not-checked section; and the run meta. Everything on the IN list is present,
and no item on the OUT list appeared — because none of it existed before this slice.

---

## D-147 — Draft rows are collapsed at render, not at write

**2026-08-27 · business owner**

The merchant page autosaves on blur, so one response can arrive as five rows: a sentence, the
sentence finished, a typo fixed. Every row is stored — append-only is not negotiable — and printing
all five would present four abandoned half-sentences to an underwriter as things the merchant said.

**The rule.** Render the latest body per finding per author, and print an earlier body only where it
was current at the time of an **accepted `sends` row** for that run.

That reads D-002 correctly. Its guarantee is that *a version IQwallet may have read stays readable*,
not that every keystroke reaches the document. A version that was current when a document went out is
one an underwriter may be holding; a version superseded thirty seconds later, before anything was
sent, was never read by anyone outside Mintro.

The boundary is not a heuristic and not a time window — it is the `sends` table, which is also what
closes the round (D-148). "What IQwallet may have read" and "what ended the response round" are one
fact, read from one place.

**And a second rule, at the other end.** Autosave writes only when the body differs from the last
stored body for that identity and finding. Tabbing through an untouched field writes nothing — not a
request the server declines, no request — so most of the noise never reaches storage and the row
count means something. The database enforces it too: an identical body returns the existing row and
its stored time rather than appending.

**Save on unchanged text confirms against the stored row.** A real round trip, with the timestamp
read back from what is held — which is why the confirmation can show a time earlier than the press.
That is the honest answer to *when was this saved*. "Not a no-op with a toast" means do not fake it
in the client; a real read of real storage satisfies it.

**A mutable draft table was rejected.** It would have left words the page told a merchant were saved
sitting somewhere the report never reads.

This amended one existing test. `packages/engine/test/commentary.test.ts` asserted that two versions
by one author both render, under D-002's heading. That was right when a merchant pressed a button per
response and every row was a deliberate act. Both rows are still stored, and the test now covers both
halves: the current words alone when nothing has been sent, and both when a send carried the earlier
one.

---

## D-148 — The response round closes when the operator sends to IQwallet

**2026-08-27 · business owner**

There is no close button and no closed state. Sending the combined document ends the response round,
and `sends` already records it.

All-in is a prompt toward that act, not a precondition for it — D-001 is unchanged, and **send is
never blocked**, including for a round with four addresses outstanding. An operator may send at any
point, and the participation record says what the merchant's side looked like when they did.

**This interlocks with D-147.** Accepted `sends` rows are already the boundary the renderer keys on,
so *what IQwallet may have read* and *what closed the round* are the same fact rather than two that
could drift apart.

---

## D-149 — A send that may be repeated carries an idempotency key

**2026-08-27 · business owner**

Every queue in this system claims a row, does the work, and records the outcome. Between the work
and the record there is a window: if the worker dies in it, the row stays `running`, the stale-claim
reclaim picks it up after fifteen minutes, and the job runs again. That is the right behaviour for a
scan and the wrong behaviour for an email, which cannot be un-sent.

**The claim did not close it, and the code said it did.** The all-in one-shot is a partial unique
index on `(run_id, all_in_fingerprint)`, claimed before the message is composed — which resolves a
race between *two* notices for one invited set. It does nothing about *one* notice retried: the row
updating itself to values it already holds violates no index. Reproduced against the real migrations
before this was written; the update succeeded and a second email would have gone.

**The fix is at the provider.** Resend's `Idempotency-Key` on `POST /emails` returns the original
response without sending again, and keys are kept for **24 hours** — comfortably past our fifteen
minute reclaim. Verified against their documentation rather than assumed.

**The key covers the content, not just the job.** Resend normalises and hashes the request body
against the stored key and answers `409 invalid_idempotent_request` when the same key arrives with a
different one. A key naming only the job would therefore turn a message whose content legitimately
changed between the crash and the reclaim — another responder submitted, so the count line moved —
into a job that 409s on every attempt and can never send. `idempotencyKeyFor` folds a content digest
in, and the semantics land where they should:

    same job, same words   the provider returns the first response and sends nothing
    same job, new words    a different key, and a different message goes, which it is

That property depends on the composed message being **deterministic over unchanged rows**. The
response notice is: every time in it is a stored time read from its own row, never a clock read.
`apps/worker/test/responseNoticeJob.test.ts` asserts a re-run produces the same key, so a clock
reaching the body fails the suite.

**One policy, both surfaces, and it deduplicates less on one of them.** A reclaimed invitation mints
a **fresh token**, because the first was never stored and cannot be recovered — so the body differs,
the key differs, and a second invitation is sent. That is correct rather than a gap: links are
additive by design (D-063), both work, both open the same report, and suppressing the second would
leave a merchant holding an invitation whose delivery nobody can demonstrate.

**B1 was rejected and the reasoning is recorded.** Resolving an ambiguous reclaim to `not_sent`
would mean a genuinely failed send is never retried and an operator is silently never told — the
failure the notification exists to prevent. A duplicate is noise against a run view that already
shows the truth.

### The two comments that asserted this could not happen

Both `handleInvite` and `handleNotice` had a branch, for the case where the recording write returns
an error, saying the job was *"reported rather than retried silently"* because *"a reclaim would send
a second copy"*. Returning does not prevent the reclaim: it leaves the row at `status = 'running'`,
which is exactly what the claim query looks for. The comments described an intention as though it
were a mechanism, and reading them would have cost somebody an afternoon before they looked at the
claim query. Both now say what actually happens and what makes it survivable.

### Not fixed, and named rather than left

The IQwallet report send has the same window. `SentButUnrecordedError` covers the case where the
recording write *throws* — the row is marked `failed` with `transmitted` true, which takes it out of
the reclaim set — but a hard crash bypasses that and IQwallet would receive the report twice. It is
not fixed here because the payload contains a freshly rendered PDF whose bytes are not stable across
renders, so a content-digest key would never match and a job-only key would 409. Closing it needs a
deterministic render or a stored artifact, which is a separate piece of work.

---

## D-150 — `merchants.domain` is folded, and the table says so

**2026-08-27 · business owner**

`merchants.domain` had two writers that disagreed about its shape. The crawl writes
`new URL(url).host`, which the WHATWG parser always lowercases. The Documents Check package form
wrote `domain.trim()` — whatever an analyst typed. `ensure_merchant` looked the domain up with
`where domain = trim(p_domain)`, and the column carries a plain case-sensitive `unique`.

So typing `Shop.Example` for a storefront already stored as `shop.example` matched nothing, inserted,
and was not refused. **One storefront, two merchant rows**: Site Check runs hanging off one and the
Documents Check package off the other, with nothing joining them. Reproduced against the real
migrations before anything was changed.

**Three changes, and the middle one is the one that lasts.**

- `ensure_merchant` folds to `lower(trim())` once, and uses that value for both the lookup and the
  insert. Computing it twice is how the two came to differ in the first place.
- `merchants.domain` gains `check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')` — character for character
  the constraint `credential_deposits.merchant_domain` has carried since 0013. Normalising in one
  function fixes the writer that was wrong; the constraint fixes every writer, including the ones
  nobody has written yet.
- `NewPackage.tsx` folds before it submits, so an analyst meets the stored value rather than a
  constraint violation.

**It refuses rather than folds.** Anything reaching the constraint unfolded is a writer that has not
been taught, and silently accepting it would leave that writer undiscovered — which is the position
this decision exists to get out of.

**No rows changed.** Surveyed first: seven rows, every one already lowercase, no pair colliding under
a fold. Every one came from the crawl, which had it right; nobody has yet typed a capitalised domain
into the package form. The defect was real and reachable and had not been triggered.

**D-002 does not bite, and the reason is worth stating.** `merchants` carries no append-only trigger
and is already upserted on every run by `persistRun`, and D-002 and hard constraints 5 and 8 name
runs, findings and evidence. Folding a domain in place changes no id, so no `runs.merchant_id` is
repointed and no run row is touched. Had two rows collided, **merging them would have been a
different matter** — that repoints runs at a different merchant, which is a write to a run, and would
have needed a ruling before it happened rather than after.

**The constraint immediately found a second thing.** A fixture in
`apps/worker/test/schema/packages.test.ts` generated `northwind.example-k3j2` — the unique suffix
appended after the TLD, which is not a domain. Every other fixture in that suite already had it the
right way round. The fixture was fixed; the constraint was not weakened.

---

## D-151 — A re-submit over new text is a real event

**2026-08-27 · business owner**

**Amends D-144, and extends D-143.** It does not stand alone, and which part of each it touches
matters:

- **D-144 said** *"Submit is idempotent per identity. Pressing twice does not produce two events."*
  That is now **one event per identity per state of their response**. The property D-144 wanted —
  a repeated press is not an event — is untouched. What it accidentally also ruled out was a press
  that carried something new.
- **D-143 is extended, not amended.** Completion is still operator-declared, all-in is still a
  prompt, and a re-submit **cannot** be the all-in transition: it is by an address that resolved when
  it first submitted, so the outstanding set does not move and the fingerprint index stays scoped to
  `kind = 'all_in'`.

### The defect

`comment_submissions` was unique on `(run_id, folded identity)`. A second press recorded nothing and
sent nothing — while the button said "Submit again" and the page confirmed. **A merchant who added a
paragraph and pressed it was told something had happened when the database had done nothing.** The
addition surfaced only as `editedAfterSubmit` in the operator panel, which nobody is necessarily
watching.

### The watermark

Every submission records `covers_content_at` — the newest thing that identity had written when they
pressed. A later press is an event only when there is content newer than that. The unique index moves
with it:

    pressed twice, nothing written between   same watermark, refused, no event
    pressed again after adding a paragraph   different watermark, a new row, a notice

Still an index rather than a check in the caller, for the reason D-144 gave: two tabs, or a slow
network and a second press, is a race, and the race is in the database. `-infinity` in the index
expression because nulls are distinct in a unique index by default, and submitting having written
nothing is a legitimate thing to say — *I have looked and I have nothing to add.*

### Both channels count as writing

The watermark covers comments **and** attestation answers. An answer to one of the nineteen questions
is text the merchant added exactly as a comment is; scoping the question to one channel would leave
someone who answered five questions after submitting with a dark button and an operator told nothing
— the same silence this decision exists to remove, in the other half of the page. `editedAfterSubmit`
widened to match, so the merchant page's button and the operator's flag cannot disagree about what
writing is.

### A third notice kind

`resubmit`, distinct from `submit` and `all_in`. It leads *"A responder added to their response after
submitting."*, names who, when they pressed, when the text was added, says their earlier response
stands, and links to the run. It falls under the copy audit like the others.

It never claims the all-in fingerprint. Checked **before** all-in rather than after, because a
re-submit arriving while the round happens to be in would otherwise compose the all-in message for a
set the operator was told about days ago — and then be refused by the index, sending nothing at all.

The idempotency key folds a content digest as the others do (D-149), and every time in the body is a
stored time: the press and the content watermark, both read from the row. A test asserts a re-run
produces the same key, so a clock reaching the body fails the suite.

### The button never offers a press that records nothing

After a submit the control **goes away**, and comes back only when there is content newer than that
event — labelled "Submit your addition", because it is one. The page computes the watermark from the
same two channels the database does and from values the database handed back, rather than recomputing
them: a second expression of the watermark is a button that offers a press the server declines, which
is the original defect in a new spelling.

`submit_response_round` returns `recorded`, so a caller that presses anyway is told nothing happened
rather than handed the old row to confirm. The page and the function each hold the guarantee
independently.

### Also in this slice

**Button hierarchy.** Save takes the primary style when it is the only control on the page. The
merchant who was forwarded the link — the common case, and the one with no Submit button — was seeing
a single quiet control and no visual answer to *what do I press when I have finished*. Where Submit is
also rendered the original ordering is right.

**The disabled asymmetry, resolved toward Save.** `!identified` **is** reachable: nothing gates the
page render on identity, `Identify` is a card at the top rather than a door, and the whole page
including the footer renders before anyone types an address. Submit was unreachable in that state
only because `maySubmit` happens to require an identity — a coupling nothing stated, and one that
would have left a pressable button whose handler returns immediately. Both carry the guard now.

---

## D-152 — A run has a wall-clock deadline, and the queue says when nothing is working

**2026-08-28 · engineering · prompted by the comopeptides hang**

Full trace in `docs/stuck-run-investigation.md`. In short: request `5ccd3051` claimed at 13:37:55
ET, produced its last output at 13:39:47, and then sat silent. The worker was alive and healthy —
no OOM, no restart, `oom_killed=false` — and blocked inside `runCheckoutFlow`. It stayed blocked
for **twenty-nine minutes**, and ended only because an operator restarted the machine at 14:08:51,
which tore down Chromium and rejected the pending call.

Nothing recovered it, and nothing was going to. Three separate mechanisms that look like they
cover this each declined to:

- **The `try/catch` in `handle`** writes `status: 'failed'` on any throw. Nothing threw. A hang is
  not an exception, and code that only handles exceptions does not handle it.
- **The stale-claim reclaim** takes back a `running` row after fifteen minutes — from inside the
  job loop, which was the thing that was stuck. See D-154.
- **The UI** showed `running` with a progress line, which was true and useless: the line was the
  last thing the worker managed to say, half an hour earlier.

### The ruling

**A run gets 25 minutes of wall clock. After that it is terminated, not waited on.**

The number is derived, not picked. Summing every per-step timeout in a full crawl gives a bounded
worst case of about sixteen minutes. Twenty-five leaves headroom for a slow-but-progressing site
while ensuring that anything past it is not going to finish — the observed hang was already at
twenty-four minutes when the investigation opened.

> **Correction, 2026-08-28 — the paragraph above is wrong, and the error is instructive.**
>
> Sixteen minutes was **not** the full-crawl bound. It was the bound on the work *remaining after
> the `layer 3:` line* — the gate block alone — computed in `docs/stuck-run-investigation.md` §3.3,
> where it is correctly scoped and correctly labelled. Writing this decision, that figure was
> carried across and restated as "a full crawl", which it never was.
>
> The real bound, summing every timeout in the code, is **3,555s — 59.3 minutes** (56.1 without the
> post-login re-render). The largest terms are Layer 0 sitemaps 615s, `cartHoldsProduct` 584s, the
> sign-up probe 544s, and the four Layer 3 document probes 1,026s.
>
> So the ruling above was not what it claimed to be. A twenty-five minute ceiling under a
> fifty-nine minute bound is **not headroom over the worst case — it is a cap at 42% of it**, and a
> legitimately slow but progressing run would be terminated and recorded as `watchdog_timeout`. Run
> `5506488a` (sportstechnologylabs, 626s, completed normally, nothing wrong) already spent 42% of
> the budget.
>
> This is the same defect the investigation was about, one level up: **a bound asserted rather than
> established**. The number was carried from a place where it had been derived to a place where it
> had not, and nothing in between checked that the scope still held. D-026's rule is about
> preconditions in code; it applies just as well to a figure in a decision record.
>
> What the deadline is, and what it is not, is settled in D-155, which also brings the real bound
> down far enough for a ceiling to sit above it.

**The timeout resolves; it does not throw.** `Promise.race` between the crawl and a timer, with
the timer resolving to a sentinel. Routing it through the `catch` would have been less code and
would have recorded a fabricated exception against a run where nothing failed. The queue row gets
a distinct, machine-readable token — `watchdog_timeout:` — so the difference survives into the
database and into the UI, which says "no worker" rather than "failed".

**The browser is recycled after a termination.** This is what makes the watchdog real rather than
cosmetic. `screenStorefront` creates its own contexts and hands none back, so there is no way to
reach the abandoned crawl's pages from the caller. Racing a timer returns control to the loop and
leaves the crawl running inside Chromium, holding contexts and pages on a machine with 1GB. The
close both frees them and rejects whatever call was hung, which is the only way to end it from
outside. The loop owns the browser's lifetime, so the loop does the recycling; `handle` reports
that it is needed rather than closing something it did not open.

### Mid-run checkpointing was considered and rejected

The tempting alternative: write findings as each layer completes, so a hang at minute twenty-nine
leaves twenty-eight minutes of work on disk instead of nothing. The comopeptides run had rendered
about ten pages and produced 64 captures, all of which were lost.

**Rejected, and not on cost grounds.** It breaks D-002 and hard constraint 8.

A run is immutable. `0004_runs.sql` freezes the row on `finished_at`, evidence is append-only with
a trigger that `service_role` cannot bypass, and `persistRun` verifies completeness *before*
closing precisely because an earlier version closed first and froze five runs carrying findings
that cite captures with no evidence row — unfixable, because runs are never deleted.

Checkpointing means a run row that exists while incomplete and grows over time. That is a run in a
*pending* state, and the whole design says there is no such thing: a request records that someone
asked, a run records what was observed, and the second does not exist until there is something to
record. A half-written run is indistinguishable from a complete one to every reader — the report
route, the PDF renderer, the export builder — and none of them has a way to ask "is this all of
it?" That is the exact shape of D-033's defect, reintroduced deliberately.

The behaviour under an abrupt kill confirms the current design is right. When the operator's
restart landed one second after the totals line, `persistRun` had not started: **no merchant row,
no run row, no findings, no evidence, no storage objects.** Verified. The interrupted run left
nothing behind to reconcile, because writing once after the crawl returns means there is no
partial state to be wrong about. Checkpointing would have left a run row, some findings and some
evidence from a crawl that never finished — and D-002 would have frozen it there.

Losing the work is the price of that guarantee, and the price is correct. A re-scan is cheap: the
second attempt of this same request completed in 163 seconds.

### The queue surfaces staleness

A request whose claim is older than the watchdog deadline renders as **"no worker"**, in amber,
with the time of the last claim and the last progress line — not as `running`, and not as failed.
The count beside the queue separates the two: a stalled request is pending but is not progressing,
and "1 in progress" over a row nothing is touching is what made the hang look like ordinary work.

It says what is known and stops there. It does not say the run failed, because it has not: a stale
claim is released and retried (D-154). The progress dot stops animating, because an animation over
dead work is the display asserting something it was not told.

Measured from `claimed_at`, never `created_at`. Time spent waiting for a free worker is not the
worker failing to answer, and counting it would mark a request stale before anyone had picked it
up.

---

## D-153 — `setDefaultTimeout` is not a bound, and the two calls it misses are the ones that hang

**2026-08-28 · engineering**

The first draft of the fix for D-152 set `page.setDefaultTimeout` on every context in `probe.ts`,
`flow.ts` and `cart.ts`, on the reasoning that the crawl's one bounded file — `render.ts:111` — did
that and the unbounded ones did not.

**That fix would have been cosmetic, and the measurement is why it is not the fix.** Playwright
1.49, `setDefaultTimeout(3000)`, against a page whose main thread is wedged in a `while (true)`:

| call | outcome |
|---|---|
| `page.evaluate(...)` | still pending at **39s**; rejected only when the browser was torn down |
| `page.content()` | still pending at **12s**; rejected only when the browser was torn down |

Neither honours the default and neither accepts a timeout argument. So the default bounds the
calls that were already bounded — navigations and actions — and misses exactly the two that hang.

A `.catch` does not help either, and this is the same error one level down. `flow.ts` wrapped both
in `.catch(() => ...)` and read as defensive. A catch converts a **rejection** into a fallback; a
call that never settles never rejects, so the handler never runs. The code looked guarded and was
not, which is D-026's shape again — a precondition asserted rather than established.

### The ruling

**Every Playwright call is bounded explicitly. Where the API accepts a timeout, it is passed; where
it does not, the call is wrapped in `withDeadline`.** No call relies on an ambient default.

`withDeadline` bounds *our* wait, not the browser's work: racing a timer does not cancel the
underlying call, which stays pending inside Playwright. What ends it is the page or context being
closed, which every caller here already does in a `finally`. Both halves are required and the
pairing is documented at the top of `deadline.ts`, because a caller that raced a deadline and then
kept using the page would be talking to a page with an abandoned operation still on it.

Call sites, with the bound each was given:

| file | call | bound |
|---|---|---|
| `probe.ts` | `page.content()` | `withDeadline`, 20s (the probe timeout) |
| `flow.ts` | `page.content()` in `observe` | `withDeadlineOr`, 20s, empty string |
| `flow.ts` | `locator.count()` per payment marker | `withDeadlineOr`, 20s, `0` |
| `flow.ts` | `locator.count()` in `clickFirst` | `withDeadlineOr`, 20s, `0` |
| `locate.ts` | `page.evaluate` in `establishCheckout` | `withDeadlineOr`, 20s, `null` |
| `cart.ts` | `page.evaluate` reading the cart page | `withDeadlineOr`, 10s, `null` |
| `render.ts` | `page.evaluate(extractPage)` | `withDeadline`, render timeout (30s) |
| `render.ts` | `page.content()` | `withDeadline`, render timeout (30s) |
| `signup.ts` | `page.evaluate(extractSignupForm)` | `withDeadline`, 30s |

Page-level defaults are set in `probe.ts` and `flow.ts` as well, for the navigations and actions
they *do* cover. On the **page**, never on the context: a context supplied by a caller outlives
the call, and retuning it would apply a timeout to every later request the caller makes with a
context it did not know had been touched.

`render.ts`, `locate.ts` and `signup.ts` are outside the three files the work was scoped to. They
are included because they carry the identical defect on the *main* render path — every page of
every run goes through `render.ts` — and bounding the checkout flow while leaving an unbounded
`evaluate` on every page render would have fixed the instance and left the class.

---

## D-154 — The stale-claim sweep runs on its own clock, and a working worker says so

**2026-08-28 · engineering**

The reclaim in `claimNext` is correct and did nothing for twenty-nine minutes, because it lives
inside the job loop. Everything in that loop is behind one `await handle(...)`, so a sweep placed
there can only run when the worker is idle — and an idle worker is the one case where nothing needs
sweeping. The mechanism was structurally unable to fire in the situation it exists for.

**The sweep moves onto its own `setInterval`, once a minute, outside the loop.**

**It releases; it does not execute.** A stale row is set back to `queued` for whoever polls next,
here or on another machine. Concurrency is unchanged: the loop stays strictly sequential and one
machine still runs one job at a time. Making the sweep a second executor would be a concurrency
change nobody asked for, on a 1GB machine already running Chromium.

### The heartbeat is not optional, and moving the sweep is what makes it necessary

`claimed_at` was written once, at claim time, and never touched. That was safe **only** because
reclaim ran between jobs — a job in flight could not be reclaimed, because the loop that would
reclaim it was the loop running it.

Move the sweep onto a timer and that accidental protection is gone, and the numbers then collide.
`STALE_CLAIM_MS` is fifteen minutes; D-152 lets a run go to twenty-five. A perfectly healthy
sixteen-minute crawl would have a sixteen-minute-old claim, the sweep would read it as abandoned,
and the request would be released and run **a second time, concurrently with the first**, against
the merchant's site — two runs where an analyst asked for one.

So the worker now refreshes `claimed_at` every sixty seconds while it works, and the sweep is
tuned to that: fifteen minutes is fifteen consecutive missed beats, not one slow write.

This is what makes "stale" mean what `0012_scan_requests.sql` always claimed it meant. Not *old* —
**no worker is touching this**. A stale claim becomes positive evidence that a worker is gone
rather than an inference from elapsed time, which is D-026's rule applied to the queue instead of
to a session. The heartbeat is stopped in `handle`'s `finally` before anything else, because a
heartbeat outliving its job would keep refreshing a claim on a row nobody is working, which is
precisely the lie the sweep depends on not being told.

Deliberately **not** done: starting the second Fly machine. It exists, it is stopped, and the CAS
claim is safe for any number of workers — but a second machine doubles the Chromium memory bill and
is a concurrency change, and the fix for "one job blocked everything" is to stop jobs blocking, not
to add a lane.

---

## D-155 — Layer 3 probe cost, and the watchdog as a policy cap

**2026-08-28 · engineering · prompted by run 5506488a**

sportstechnologylabs completed normally in **626s**. Of that, **349s — 56% of the whole run — was
the payment/refund probe**, which found nothing. The same step took 25s on comopeptides. Both
observed hangs had occurred in this phase, so it was worth knowing whether 626s was normal.

### What the probes actually do

`findDocument` runs four times — terms, shipping, FAQ, payment/refund — after a fifth probe for the
sign-up form. Each builds `candidates = (homepage links whose href+text contains a hint) ∪
(conventional paths)`, then loops **sequentially**, stopping at the first candidate
`establishDocument` accepts. Every candidate is a full `renderPage`.

Measured, rather than assumed:

| | sportstechnologylabs | comopeptides |
|---|---|---|
| candidates tried, payment | 8 | 8 |
| candidates tried, all four surfaces | 8 / 6 / 7 / 8 | 8 / 7 / 6 / 8 |
| **network requests per candidate** | **201** (52 third-party hosts) | 245 (6 third-party) |
| requests *after* domcontentloaded | 41 | 9 |
| cost per candidate, unthrottled | 5.7s | 2.7s |
| └ of which `networkidle` | 3.4s | 1.3s |
| └ of which extract + content + screenshot | 0.11s | 0.08s |

**Catalogue size is not the driver.** 64 products and 37 products both cost 27-28 document
candidates; the counts come from the path lists, which are fixed. What differs is the merchant's
page weight and third-party fan-out, because `networkidle` waits on it.

Within run 5506488a the per-candidate cost was 6s for surfaces found on the first candidate, 11.5s
for shipping (6 candidates, all 404) and **43.6s** for payment (8 candidates, all 404) — eight
times what the same work costs today. Raw HTTP to those same eight paths is flat at 1.5-1.75s, so
the origin is not slow. The best-supported reading is CDN throttling under the volume the probe
itself generates: ~1,600 requests for the payment phase alone, ~3,800 for the Layer 3 sweep.

So: **no bug fired, and the design is still wrong.** It treats "try a path" as a cheap probe when
each one is a full themed page render, and it does 27+ of them per run. The burst of speculative
404s is exactly what makes a protected storefront slow down — the probe is self-penalising.

### Four reductions

1. **Linked candidates are capped at four.** The list was uncapped, and unbounded work in a crawl
   is a hang waiting for the right storefront — twenty matching footer links would have added
   twelve minutes to one surface. Four is the measured maximum across both storefronts and all
   four surfaces (0-3) plus one. Beyond about four a match is no longer a policy link but an
   unrelated URL containing `return` or `payment`. **Truncation is recorded in the attempts and
   logged**, never silent, on the same rule Layer 0 follows for its sitemap cap — and if the number
   is ever wrong it errs safe, because a document not reached is `not_exposed`, outstanding, never
   a `pass`.

2. **Probe renders wait 3s for network quiet, not 8s.** Measured settle is 1.3-3.4s. The located
   candidate is used **as rendered** — one fetch — so the capture and the text a check reads are
   the same visit; a re-read at the full wait would put a screenshot in the report that does not
   show the text beside it. The risk this carries is a shorter wait under-rendering a document and
   tripping the 400-character floor, a *false absence*. The four surfaces are server-rendered
   policy pages present at DOM-ready (9,503 / 2,616 / 5,243 characters measured), so the floor is
   nowhere near — and it is verified by re-run rather than argued.

3. **A candidate that fails `establishDocument` is not screenshotted.** `renderPage` gained
   `keepCapture`, a predicate run after the page is read and before the expensive part. A themed
   404 at a path the merchant never used is not evidence of anything. The DOM snapshot is still
   kept: it is cheap, and it is the record of what was actually served at a URL this run requested.
   This cannot produce a finding citing a capture that was not taken — `screenshotKey` is set only
   when a screenshot exists and `pageEvidence` reads the key rather than assuming one (D-012).

4. **The sign-up probe visits once.** It rendered the page and then navigated to it again to read
   the form. The original reasoning — that folding the extraction into `renderPage` would make
   every surface pay for a Layer 3 concern — is answered by making it opt-in: only the sign-up
   probe passes `readSignupForm`. The form, the DOM snapshot and the screenshot now describe one
   state of one page instead of three fetches that might differ.

### What it cost and what it saved

Controlled A/B, same afternoon, same network, the four changes stashed and restored:

| | before | after | change |
|---|---|---|---|
| comopeptides wall clock | 115s | 110s | −4% |
| comopeptides artifacts | 64 · 6.1MB | 42 · 3.6MB | **−34% / −41%** |
| sportstechnologylabs wall clock | 162s | 161s | −0.6% |
| sportstechnologylabs artifacts | 53 · 10.3MB | 38 · 8.4MB | **−28% / −18%** |

**Findings identical on every one of 54 rules, and on the note text of every finding** — 62 and 66
respectively — on both storefronts. That was the acceptance condition: a cost reduction that
changes what is observed is a regression, not an optimisation.

Worth being plain about the wall-clock column: on a responsive site these changes save almost
nothing, because the probe renders were already fast. The saving is in artifacts, in bytes, and —
the point — in what happens on a slow day, where an uncapped list and an 8s idle wait per rejected
candidate is where the 349s came from.

### The bound, and the correction to D-152

Recomputed from the timeouts in the code:

| | |
|---|---|
| before | **unbounded** — the linked list had no cap, so no ceiling existed. 3,555s (59.3 min) was a *floor*, computed at zero linked candidates |
| after | **3,668s — 61.1 min**, a real ceiling for the first time |

The cap therefore *raises* the computed worst case while removing the unbounded one, which is the
honest direction. D-152's claim of a sixteen-minute full-crawl bound is corrected in place: that
figure was the bound on the gate block alone, carried across from the investigation and restated
as something it never was.

### The watchdog is a policy cap, not a safety bound

**30 minutes**, and it sits *below* the 61-minute worst case deliberately.

A ceiling above the arithmetic bound could not catch what the watchdog exists for. The observed
hang ran 29 minutes and was still going when an operator's restart ended it; a 75-minute cap would
have let it run. And the bound assumes all ~90 navigations time out at 30s, which describes a run
that is already broken.

So it is sized against measurement: observed runs are 110-163s normally and 626s on a throttled
day, making 30 minutes 2.9x the worst legitimate run seen. **The exposure is stated rather than
hidden** — a legitimate run between 30 and 61 minutes would be terminated, and none has been
observed within a factor of three of that.

Bringing the arithmetic bound under the cap is possible but not free: the remaining bulk is Layer 0
sitemaps (615s), `cartHoldsProduct` (584s) and the Layer 3 sweep (1,683s). Cutting the first
changes catalogue coverage and the second is D-056's cart confirmation, bought with the most
consequential false pass this project has found. Neither is worth a tidier number.

**A termination is a statement about the run, never about the merchant.** Nothing derived from it
may reach a report as a property of the storefront. It says this crawl did not come back in time
and says nothing about what the site does, contains or permits — and because a run is written once
after the crawl returns, a terminated run produces no findings at all, so there is no observation
available to misattribute.

---
