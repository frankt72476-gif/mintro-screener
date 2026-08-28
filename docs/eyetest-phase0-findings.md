# Eye-test layer — Phase 0 findings

**Investigation only. No code, ruleset, schema or migration was changed.**

Scope: what a screening run persists per page, how much of a storefront it actually reaches, and
how three candidate blocker-tier checks locate their subject.

## Method, and how far these answers can be trusted

Two sources, and the difference between them matters:

1. **The code**, read directly — `apps/worker/src` (crawl path), `packages/engine/src/checks`
   (handlers), `supabase/migrations` (evidence and findings schema).
2. **The five validation runs already committed to this repository** — `reports/*.json` and the
   matching artifact sets under `evidence/<run_id>/`. Those are the 2026-08-23 runs at ruleset
   **2.9.0**; the current ruleset is **3.1.0**.

No new crawl was performed. That is a deliberate choice and it is defensible for this question:
for all three rules in Question 3, the `params` block is **byte-identical between 2.9.0 and
3.1.0** — only `clause`, `title` and the new `source` field changed. The check handlers those
rules dispatch to (`textMatch.termsFinding`, `textCooccurrence`, `payment.checkPaymentTerms`) and
the capture path (`render.ts`, `extract.ts`) have not changed in any branch these rules reach.
The observed behaviour below is therefore current behaviour, not a historical artifact.

Where a claim below rests on reading code rather than on an observed run, it says so.

One thing I could not verify and am flagging rather than asserting: the `evidence` bucket
contents I measured are the **local mirror** written by `bin/scan.ts --evidence-dir`. It writes
the same `EvidenceArtifact` objects, under the same keys, that `persistRun` would upload. I did
not read the production Supabase bucket.

---

# Question 1 — what a run persists, per page

## 1.1 The short version

A rendered page produces exactly **two** artifacts and no more:

| Artifact | Key | Stored as |
|---|---|---|
| Full-page screenshot | `<run_id>/layer1/<sha256-of-png>.png` | PNG, not compressed further |
| DOM snapshot | `<run_id>/layer1/<sha256-of-html>.html` | gzipped, **full `page.content()`** |

`apps/worker/src/render.ts:125-166`. Both go into the private `evidence` bucket, plus one row in
`public.evidence` carrying key, run, kind, sha256, byte count, content type and URL.

Everything the check handlers read is a *derived* structure computed in one `page.evaluate()`
(`apps/worker/src/extract.ts`) and carried in memory as a `PageContext`. **The `PageContext` is
never persisted.** It is not written to the database and not written to storage. Only the report
that comes out the far end is stored, on `runs.report`.

That split is the single most important fact for the eye-test layer, and it cuts both ways:

- Something not extracted into `PageContext` is **not lost** — the raw HTML is in the DOM
  snapshot and can be re-parsed later.
- Something not in the raw HTML at capture time (image bytes, a checkout page, a page the crawl
  never rendered) is **gone**, and no amount of re-reading recovers it.

## 1.2 Page markup and metadata

| Item | Extracted into `PageContext`? | In the stored DOM snapshot? |
|---|---|---|
| Raw HTML | Yes — `page.html`, in memory | **Yes**, verbatim, gzipped |
| `<title>` | Yes — `page.title` | Yes |
| `<meta name="description">` | **No** | Yes |
| Canonical URL | **No** | Yes |
| URL slug / final URL | Yes — `page.requestedUrl`, `page.finalUrl` | n/a |
| Open Graph `og:` tags | **No** | Yes |
| JSON-LD / microdata | **Parsed and discarded** — see below | Yes, the script blocks are intact |
| `<link rel>` | **No** | Yes |
| Navigation structure | Partially — every `<a href>` carries `inNav` / `inFooter` booleans | Yes |
| Extracted visible text | Yes — `page.text` | derivable |
| Per-node computed style | Yes — `page.styledText` (font size, colour, effective background, visibility) | **No** — measured in the live browser, not recomputable from HTML |

**On structured data specifically.** `extract.ts:298-317` does read
`script[type="application/ld+json"]` and `[itemtype*="schema.org/Product"]`, but it keeps exactly
one field: `entry.url`, and only when `@type === 'Product'`, and only to seed the product-URL
list. `Offer`, `AggregateRating`, `Review`, price, availability, brand, SKU — all parsed past and
dropped. There is no structured-data object anywhere in `PageContext`.

The bodies survive in the DOM snapshot. Measured on the committed runs: every captured product
page carries 1–4 JSON-LD blocks and 11–13 `og:` properties.

**Per-node computed style is the one thing genuinely not recoverable.** `styledText` carries the
resolved colour, the *effective* background walked up through transparent ancestors, the rendered
font size, and the visibility reason. That is a measurement of a live layout. A future pass
reading the stored HTML gets none of it.

## 1.3 Images

- **URLs: not extracted.** There is no `<img>` handling anywhere in `extract.ts`. Images are not
  in `PageContext` in any form.
- **`alt` attributes: not extracted**, same reason.
- **Image bytes: never downloaded.** Nothing in the worker fetches a storefront image.
  (`rasterize.ts` and `ingest.ts` handle Documents Check uploads and PDF page rendering — a
  different subsystem, no storefront reach.)

Both `src` and `alt` are present in the stored DOM snapshot as attributes. Measured on the
committed runs: 10–33 `<img>` elements per captured page, with `alt` present on essentially all
of them. So the *references* are recoverable and the *pixels* are not — except insofar as they
appear inside the full-page screenshot, which is a rendering of the page, not the asset.

## 1.4 Screenshots

- **Taken:** yes. `page.screenshot({ fullPage: true, type: 'png' })` — genuinely full-page. The
  biotechpeptides homepage capture is 1440 × 4595.
- **Per page, unconditionally** — not per finding. Every call to `renderPage` attempts one,
  before any rule runs.
- **A failure is swallowed** (`.catch(() => undefined)`) and produces no artifact. That is not a
  silent false claim: `screenshotKey` is set only when the buffer exists, so a finding falls back
  to citing the DOM key, and `pageEvidence` is structured so no finding can cite a capture that
  was never made (D-012). But it also means a run does not record *that* a screenshot failed.
- **Stored** in the `evidence` bucket at `<run_id>/layer1/<sha>.png`.

**Screenshots are content-addressed, and that has a consequence worth stating.** The key is the
SHA-256 of the PNG bytes. Two pages that render pixel-identically collapse to **one object** and
**one `evidence` row** — and that row carries only the *first* URL. This is why artifact counts
and page counts diverge sharply:

| Run | DOM snapshots | Screenshots | Distinct resolved page URLs |
|---|---|---|---|
| biotechpeptides.com | 23 | 12 | 10 |
| peptidesciences.com | 36 | **1** | 1 |
| sportstechnologylabs.com | 24 | 10 | 9 |
| swisschems.is | 19 | 18 | 12 |

peptidesciences is the extreme case: every navigation resolved to the same `/home-shutdown` page,
producing 36 byte-varying HTML snapshots (a nonce moves) and **one** screenshot, because the
rendered pixels were identical every time.

**Retention.** Screening evidence is **not in the scope of any purge path.** The retention system
(P0–P7, migrations `0035`–`0043`) operates on Documents Check *packages*, in a separate
`DOCUMENTS_BUCKET`, with targets typed `document_body | document_original | upload_staging |
report_pdf` and derived from an approved package id. Nothing in it can reach a `<run_id>/…` key in
the `evidence` bucket. Beyond that, `public.evidence` carries an append-only trigger that is
explicitly **not bypassable by `service_role`**, and `putEvidence` uploads with `upsert: false`.
Screenshots are written once and are never deleted or overwritten by application code.

## 1.5 Commerce surface

**Checkout is reached, but nothing about it is retained.**

`runCheckoutFlow` (`apps/worker/src/flow.ts`) drives a real shallow flow: open a product page,
click add-to-cart, confirm the cart actually holds the product, proceed to checkout, look for a
payment field. On swisschems.is it reached a live `input[autocomplete="cc-number"]`.

It stores **no artifact**. It computes `sha256` of the checkout page's HTML (`flow.ts:79`) and
returns it — and the body is discarded. Same for `probePaths` (`probe.ts:52`), which backs
GATE-002. So the two access-gating rules produce findings citing a hash of a document that exists
nowhere. Against hard constraint 3 — *"store the artifact body, not only its hash: a hash proves a
document has not changed, but it does not let anyone read what the document said"* — this is a
gap, and it is on the two rules where the observation is most consequential.

Confirmed in the committed reports: every GATE-002 and GATE-003 finding, including the
swisschems.is GATE-003 **fail**, carries `evidenceKey` empty.

**Payment method indicators.** PAY-001's evidence comes from **footer text plus policy-page body
text**, never from checkout. `publicSurfaces()` (`layer3.ts:184`) assembles: the homepage footer,
the terms document, the shipping policy, the FAQ, and the payment/refund policy — whichever of
those the crawl actually reached. There are no payment *badges* in the picture at all: no image
extraction, no gateway-host detection on this path, no icon recognition. It is a substring search
over rendered text.

Two dangling pieces are worth naming:

- `CheckoutSurface` (`packages/engine/src/page.ts:182-208`) declares exactly the checkout capture
  PAY-001 would want — `text`, `gateways` recognised structurally by SDK host, `thirdPartyHosts`.
  **It has no producer and no consumer.** Nothing constructs it, nothing reads it.
- `footerPaymentTerms` **is** extracted (`extract.ts:371`), carried through `PageContext`, and
  **read by no check**. Its vocabulary is a second, divergent copy — it includes `Bitcoin`, `BTC`,
  `crypto`, `Wire transfer`, `Western Union`, which are not in PAY-001's ruleset terms — and it is
  hardcoded in `render.ts:30-43` rather than read from the rule set.

**Subscription, auto-refill, pack-size.** Not captured in any structured form. There is no variant,
price, option or subscription field in `PageContext`. The only DOM interrogation beyond the fixed
extraction is `selectorMatches` — a `Record<selector, count>` for selectors the *rule set* declares,
and the rule set declares only three: `input[type=checkbox][required]`, `a[href]`, and
`[class*=review], [class*=testimonial], [data-product-reviews]`. Nothing about variants or
subscriptions. Pack sizes appear only as words inside `page.text` and as markup inside the DOM
snapshot.

## 1.6 What is attached to a finding

`pageEvidence()` (`packages/engine/src/checks/pageEvidence.ts:26-33`) is the only constructor for
rendered-page evidence. It produces exactly:

```
kind:         'rendered_page'
sourceUrl:    page.finalUrl
sourceSha256: page.htmlSha256
evidenceKey:  page.screenshotKey ?? page.domKey ?? ''
capturedAt:   page.capturedAt
matchedValue: (added by the handler, optional — a string)
```

So: **one URL, one hash, one artifact key, one timestamp, and a string.**

There is **no selector**, **no bounding box**, **no screenshot region**, and no highlight. The
capture is a full-page PNG and the reader locates the matched text themselves. `styledText` carries
a CSS path per node, but it never reaches a finding.

Note also that `evidenceKey` cites the screenshot *or* the DOM, never both — the DOM key is dropped
whenever a screenshot exists. It stays derivable, because `sourceSha256` is the HTML hash and the
DOM key is `<run_id>/layer1/<that hash>.html` by construction.

### Is that enough to re-verify months later?

For a **Layer 1/2 rendered-page finding: yes.** The DOM snapshot is the full page as served, the
screenshot shows what a visitor saw, the HTML hash binds them, and both are append-only and outside
every purge path. A dispute six months out is answerable from the artifacts alone.

For three classes of finding: **no.**

1. **PAY-001** — `checkPaymentTerms` builds its evidence by hand rather than through
   `pageEvidence`, and hardcodes `evidenceKey: ''` and `sourceSha256: ''` (`payment.ts:72-76`). It
   also sets `sourceUrl: surfaces[0]?.url`, which is *always the homepage* when a footer was found
   — regardless of which surface the term was actually observed on. And `capturedAt` is
   `new Date()` at check time, not the page's capture time. Observed on swisschems.is: PAY-001
   **failed** on `Zelle` seen on `/payments/`, and the finding cites `https://swisschems.is/` with
   no key, no hash, and a timestamp roughly 40 seconds after the page was captured. The
   `/payments/` capture exists in the evidence set. The finding does not point at it.
2. **GATE-002 / GATE-003** — hash only, body discarded (§1.5).
3. **`not_evaluable` findings from Layer 3 discovery** — GATE-004, GATE-005 and GATE-006 in the
   committed reports carry an **empty** `evidence` array. The `attempts` list that would evidence
   *why* exists in `discoverLayer3` and reaches the report only through the run-level `attempts`
   field added by D-136 — which post-dates these runs and is absent from all five stored reports.
   Whether the current build attaches attempts per-finding rather than only run-level was not
   verified against a fresh run.

### One schema inconsistency, unverified against production

`ArtifactKind` includes `'coa'` (`packages/engine/src/findings.ts:51`) and `coa.ts:157` writes
artifacts with that kind. `public.evidence.kind`'s check constraint allows only
`('robots', 'sitemap', 'screenshot', 'dom')` (`0006_evidence.sql:13`), and no later migration
amends it. Read literally, `persistRun` would throw on the evidence insert for any run that
successfully fetched a certificate — which is the biotechpeptides case, where a COA PDF was fetched
and stored locally. I did not run this against a live database, and the production schema may
differ from the migration set. Flagging it as an inconsistency to confirm, not as an observed
failure.

---

# Question 2 — how much of each storefront is reachable

## 2.1 What a run does and does not record about its own reach

**There is no page manifest.** No table, no report field, no artifact lists the pages a run
visited. The closest things are:

- `evidence` rows, one per *distinct artifact*, which under-counts pages wherever two pages
  produced identical bytes and loses the second page's URL entirely;
- distinct `sourceUrl` values across the report's findings, which counts only pages a finding
  happened to cite.

The numbers below were reconstructed by decompressing every stored DOM snapshot and grouping by
its canonical / `og:url`. That is a reconstruction, not something the system reports.

## 2.2 Per storefront

Catalogue size is taken from the merchant's own sitemaps, which are stored as Layer 0 artifacts.
"Pages captured" counts distinct resolved URLs with a stored DOM snapshot.

### biotechpeptides.com — WooCommerce, run `63514a3b`

- **10 pages captured**, plus 12 snapshots of the 404 page.
- home 1 · product 5 · policy 3 (`/terms-and-conditions/`, `/shipping/`, `/refunds-and-returns/`)
  · account 1 (`/my-account/`) · category 0
- Sitemaps: 287 URLs, **89 product URLs**. → **5 of ~89 products seen (5.6%).**
- **Age gate: present, and the crawl went straight past it without interacting.** GATE-001 passed:
  a `role=dialog` interstitial containing `21+` that locks scrolling. The homepage screenshot shows
  it — a modal reading *"The products on this website are only for research professionals of 21+
  years of age… I agree / I decline"* over a dimmed hero. Below the fold the entire page is fully
  rendered and readable: product grid, prices, footer disclaimer. Nothing in `render.ts` clicks
  anything. The gate is client-side and **not enforced server-side**, so all five product pages
  were served anonymously.
- **Account wall: none.** `wall: false` — every sampled product page was served to an anonymous
  request.

### corepeptides.com — WooCommerce, run `e3e80bd3`

- No local artifact mirror for this run, so a page inventory could not be reconstructed. From the
  report: 5 product pages, homepage, `/terms/`, `/shipping/`, `/my-account/` — the same shape as
  biotechpeptides.
- Sitemaps: 251 URLs, **105 product URLs**. → **5 of ~105 (4.8%).**
- Age gate: GATE-001 **review** — `21+` on the page and an overlay present, but the signal was not
  inside the overlay. Crawl unaffected.
- Account wall: none. `wall: false`.

### peptidesciences.com — Magento, run `86b4dc3a`

- **1 page captured.** Every navigation — homepage, all Layer 3 candidate paths, all GATE-002
  probes — resolved to `https://www.peptidesciences.com/home-shutdown`.
- home 0 · product **0** · policy 0 · category 0 · other 1
- **No sitemap was retrieved at all** (robots.txt only, which declares `Crawl-delay: 3`). Catalogue
  size unknown from the crawled surface.
- This is not a wall and the report says so correctly: *"No product pages were attempted, so
  nothing can be said about a login wall."* 48 of 53 rules `not_evaluable`, 36 of them
  `not_exposed`.
- Age gate: GATE-001 **review** — no interstitial and no age signal observed.

### sportstechnologylabs.com — WooCommerce, run `71bea35a`

- **9 pages captured**, plus 15 snapshots of the 404 page.
- home 1 · product 5 · policy 1 (`/terms-of-service/`) · faq 1 · account 1 · category 0
- Sitemaps: 97 URLs, **64 product URLs**. → **5 of ~64 (7.8%).**
- Age gate: GATE-001 **review** — none observed.
- Account wall: none for the catalogue. **The checkout is walled**, correctly: the GATE-003 flow
  added a product, confirmed the cart, navigated to `/checkout`, and was redirected to
  `/my-account/?redirect_to=…%2Fcheckout%2F`. Reported as `pass`.
- GATE-002 **fail**: `/shop` returned 200 to an anonymous request.

### swisschems.is — WooCommerce, run `74eefa47`

- **12 pages captured** — the widest reach of the five — plus 7 snapshots of the 404 page.
- home 1 · product 5 · category 1 (`/shop/`) · policy 3 (`/term-conditions/`, `/shipping/`,
  `/payments/`) · faq 1 · account 1
- Sitemaps: 182 URLs, **134 product URLs**. → **5 of ~134 (3.7%).**
- Age gate: GATE-001 **review** — none observed.
- Account wall: none. `wall: false`. GATE-002 **fail** (`/shop` served 200 anonymously) and
  GATE-003 **fail** — the flow reached a live card field at `/checkout/`.

## 2.3 The tension you named, sized

The sample is fixed at **5 product pages** (`SAMPLE_SIZE`, `screen.ts:60`), selected by suspicion
score from whatever product URLs Layer 0 and Layer 1 between them identified. It does not scale
with catalogue size. Across the four storefronts with a readable catalogue, the crawl saw
**3.7% – 7.8%** of the products, and **9 to 12 pages in total.**

But the shape of the constraint is not the one the brief anticipated, and this matters for scoping.
**On these five storefronts, access control was not what limited coverage.** Not one of the five
walled its catalogue. The one age gate encountered was client-side and served every page anyway.
The two access failures that *were* found were failures in the direction of openness — `/shop`
served anonymously, a card field reachable as a guest. Those merchants are less compliant, not
more, and the crawl saw *more* of them.

What limited coverage was, in order:

1. **A fixed 5-page sample** against catalogues of 64–134 products. By far the largest term, and it
   is a design parameter, not a merchant behaviour.
2. **Site-level breakage** — peptidesciences redirected everything to one page and yielded a single
   capture. This is the "four pages on the well-built site" scenario, but its cause was a shutdown
   redirect, not access control.
3. **Discovery by convention** — policy pages, FAQ and the sign-up form are found by trying a
   hardcoded path list and homepage link hints (`signup.ts:48-98`), stopping at the first hit. A
   merchant spelling a path unconventionally is simply not reached.

The honest framing for the report is therefore not primarily "the gate hid the catalogue" but
**"five of N products were read, and here is which five"** — a sampling statement. The
reachable-coverage line the report will need is a per-type page count against a sitemap-declared
total, and **that number is not currently computed, stored, or reported anywhere.** The report's
existing `coverage` object counts *rules* by resolution state; it says nothing about pages.

A first-class caveat for the rubric: if an eye-test dimension is about the *catalogue* — how the
storefront presents its range, how consistent product presentation is across it — five samples out
of 134 cannot honestly support it. If a dimension is about the *homepage and policy set*, coverage
is effectively complete, because those surfaces are singular and were reached on four of five
sites.

---

# Question 3 — evidentiary strength of the three candidate blockers

All three are `sev: critical`. PROD-005 and PROD-008 are `tier: review_only`; **PAY-001 is
`auto_fail`.**

## 3.1 PROD-005 — dosing information

**Type** `text_cooccurrence`, surface `product`. Class A `[mg, mcg, iu, ml]`, class B
`[daily, weekly, twice, per day, cycle, titrate, subcutaneous, intramuscular, injection schedule,
dose, dosage]`, window 12 tokens.

**How it locates its subject.** It does not locate a subject. `findCooccurrences`
(`textCooccurrence.ts:101`) tokenises the whole visible page text with
`text.toLowerCase().split(/[^a-z0-9]+/)`, finds every class-A token index and every class-B token
index, and reports any pair within 12 tokens. There is no region, no spec table, no dosing block —
the entire rendered page is one flat bag of tokens.

### The failure mode that matters: a false pass, on the exact string the rule exists to catch

The tokeniser splits on non-alphanumerics, so `5mg` becomes the single token `"5mg"`, which is not
equal to `"mg"`. **A mass written without a space is invisible to class A.** Run against the
compiled handler:

| Input | Hits |
|---|---|
| `BPC-157 5mg twice daily subcutaneous injection` | **0** |
| `BPC-157 5 mg twice daily subcutaneous injection` | 3 |
| `Reconstitute with 2ml bacteriostatic water and dose daily` | **0** |
| `Suggested research dosage: 250mcg per day` | **0** |
| `Suggested research dosage: 250 mcg per day` | 2 |

Zero hits means `satisfied()` — a **`pass`**. The rule reports "no quantity term was observed
within 12 tokens of a schedule or route term" about a page that says *5mg twice daily
subcutaneous*.

This is hard constraint 2 in its worst form, and it is also constraint 9 in the `expect: absent`
direction: the check locates its subject by one particular *spelling* of it, and is blind to every
instance written the other way — which, on peptide storefronts, is the common way.

**Prevalence in the committed runs.** I extracted every mass/volume expression from the stored
product-page HTML:

- biotechpeptides product page: 10 mass tokens, **0 space-separated**. All `10mg`, `5mg`, `70mg`.
- swisschems product page: 2 mass tokens, **0 space-separated**. All `5mg`.
- sportstechnologylabs product page: 13 mass tokens, **10 space-separated** (`5 mg`, `50 mg`,
  `20 mg`) mixed with `10MG`, `10mg`, `5MG`.

So on two of three sites, class A could not have matched anything at all, whatever the page said.

To be precise about what this does and does not show: PROD-005 returned `pass` on all 20 product
pages across the four runs, and those passes are **not wrong** — I found zero class-B tokens on the
sampled pages, so the rule would have passed on the schedule side regardless. The defect is latent,
not yet realised. But it means the twenty passes on record were not arrived at by an examination
that could have failed.

### Other false-positive / false-negative sources

- **Excerpts are not verbatim.** `excerpt()` rebuilds the passage by joining lowercased,
  punctuation-stripped tokens: `"bpc 157 5 mg twice daily subcutaneous injection"`. That string is
  written to `matchedValue`, which `persistRun` copies into `findings.matched_value`. It is a
  reconstruction, not the merchant's text — a reviewer comparing it against the screenshot is
  comparing against something the page never displayed.
- **No negation handling.** *"We do not provide dosing information — do not ask"* contains `dose`
  and, near any mass, produces a hit.
- **Third-party content.** The window is 12 tokens over the whole page. A cited paper's abstract, a
  customer review, a research-literature summary — all in scope, all indistinguishable from
  merchant copy.
- **`cycle` is broad.** On a SARMs storefront, "cycle support" and "post-cycle" are commercial
  category words, not dosing schedules.
- **Cross-boundary hits.** Nothing restricts the window to a sentence or an element. A mass at the
  end of a product card and `daily` at the start of the next block are 3 tokens apart.
- **Word-boundary handling is correct here** — `locate()` compares whole tokens, so `ml` does not
  match inside `html`. That part is sound.

## 3.2 PROD-008 — disease claims

**Type** `text_match`, surface `all_sampled`, `expect: absent`, terms
`[treat, cure, prevent, heal, recovery, therapy, therapeutic, symptom, injury, disease, condition]`.

**How it locates its subject.** It does not. `termsFinding` (`textMatch.ts:491`) lowercases and
whitespace-collapses the *whole visible page text* and does a plain `haystack.includes(term)` per
term. **`word_boundary` is not set on this rule**, so every match is an unanchored substring search
over the entire page.

### What it actually matched, from the committed captures

I decompressed the stored product-page HTML and located every hit in context.

**On swisschems.is `/product/healing-research/` — matched `cure`, `heal`, `condition`:**

| Term | Actual matching text |
|---|---|
| `cure` | **"se**cure** checkout"**, **"se**cure** payments"** |
| `heal` | "Healing Research Bundle" — the product's own name |
| `condition` | "terms & **condition**s" — footer boilerplate; "treatment conditions" |

Not one of those three is a disease claim. Two are substring accidents inside `secure`.

**On biotechpeptides `/product/bpc-157-tb-500-10mg-blend-2/` — matched `treat`, `cure`, `prevent`,
`heal`, `recovery`, `therapeutic`, `injury`, `disease`, `condition`:**

| Term | Actual matching text |
|---|---|
| `treat`, `cure`, `prevent`, `disease` | **"The statements and the products of this company are not intended to diagnose, treat, cure or prevent any disease."** |
| `therapeutic` | "VH, Pang JS. **Therapeutic** potential of…" — a citation title in a reference list |
| `condition` | "our **terms and conditions** for more det…" — footer link |
| `heal`, `recovery`, `injury` | research-literature summary prose |

**The single largest driver of PROD-008 hits is the FDA-style compliance disclaimer.** It is the
sentence whose presence is the best available evidence that the merchant is *complying*, and it
trips the rule on every storefront that carries it — all four crawled runs matched `treat` + `cure`
+ `prevent` together, which is that sentence's exact word set.

This is the constraint-9 trap, inverted. The brief's formulation is a check that locates its
subject by matching the compliant form and is therefore blind to non-compliance. PROD-008 does
something adjacent and equally bad: it has no subject-location step at all, so **the compliant form
is itself a hit.** The rule cannot distinguish *"this product cures fatigue"* from *"not intended
to cure any disease"*, and on real storefronts the second is far more common.

### Enumerated failure modes

- **Negation** — the disclaimer, above. Also "does not treat", "no therapeutic claims are made".
- **Substring, no word boundary** — `cure` ⊂ `secure`; `heal` ⊂ `health`, `healthy`, `healthcare`;
  `treat` ⊂ `treatment`, `retreat`; `prevent` ⊂ `preventative`; `condition` ⊂ `conditions`,
  `conditioning`, `air conditioning`, `storage conditions`.
- **Footer and nav boilerplate** — "Terms & Conditions" appears in the footer of essentially every
  storefront and guarantees a `condition` hit on every sampled page, on every merchant, forever.
- **Third-party content** — reference lists, paper titles, abstracts. `therapeutic` on
  biotechpeptides came from a citation.
- **Quoted / attributed text** — no distinction between merchant voice and quoted material.
- **The product's own name** — `heal` ⊂ "Healing Research Bundle".
- **`recovery`, `injury`, `symptom` are not claim verbs.** They describe a research context. The
  rule's `note` already concedes *"High false-positive rate. Review only."*

**Consequence for a blocker tier.** In its current form PROD-008 fires on effectively every peptide
storefront, and on all four crawled runs the matched-term list is dominated by boilerplate,
disclaimers and citations. Its `matchedValue` is a comma-joined list of *terms*, not the sentences
they occurred in — so a reviewer receives `"treat, cure, prevent, heal, disease, condition"` and a
full-page screenshot, with no indication that five of those six came from the compliance disclaimer
and the footer. Constraint 4's premise is exactly this: *false positives destroy trust in the tool.*

## 3.3 PAY-001 — payment outside a merchant account

**Type** `text_match`, surface `footer_and_public_pages`, `expect: absent`, **`tier: auto_fail`**,
terms `[Zelle, Cash App, CashApp, Venmo, Friends & Family, friends and family]`.

**How it locates its subject.** `checkPaymentTerms` (`payment.ts:47`) iterates the public surfaces
`publicSurfaces()` assembled — homepage footer, terms, shipping policy, FAQ, payment/refund policy
— lowercases each surface's text and does `lower.includes(term.toLowerCase())`. Substring, no word
boundary, no region.

**What it gets right, and this is genuinely well handled.** The `expect: absent` false-pass trap is
guarded: a `pass` requires `surfaces.length > 0` and the note names every surface read. Zero
surfaces returns `not_evaluable` with a reason (observed on peptidesciences). The D-049 rescope
away from `checkout_and_footer` was correct — the old scope made the rule resolvable only for
merchants who *fail* GATE-002/003.

### Failure modes

**False negatives — the larger risk, on an `auto_fail` rule.**

- **The term list is closed and small.** Six spellings. `Venmo.me`, `Zelle®` (present in
  `render.ts`'s dead vocabulary but not in the ruleset), `PayPal F&F`, `PP F&F`, `FF`, `Chime`,
  `Wise`, `Revolut`, `Bitcoin`/`BTC`/`USDT` — none matched. The rule's own clause names "PayPal
  Friends & Family"; the terms match `Friends & Family` as a bare phrase, which misses `PayPal F&F`
  and matches innocuous copy containing the phrase.
- **Text only.** A merchant advertising Zelle with a logo image and no adjacent text is invisible —
  no image extraction, no OCR, no alt-text reading.
- **Surface-bound.** Only five surface *kinds* are read, each found by convention. A merchant with
  a `/how-to-order/` page not matching the payment link hints is never read, and the rule still
  reports `pass` — naming the surfaces it read, which is honest, but the state is `pass`.
- **Checkout is excluded by construction** (§1.5). The note says so explicitly.

**False positives.**

- **No negation handling.** *"We do not accept Venmo, Cash App or Zelle"* — a policy statement
  affirming compliance — produces an **auto_fail**. This is the same shape as PROD-008's disclaimer
  problem, and here it is not routed to review; `tier: auto_fail` makes it a `fail` directly. On a
  page titled "How To Pay", a sentence listing rails the merchant *refuses* is not unlikely.
- **Substring, no word boundary.** `Venmo` and `Zelle` are distinctive enough to be low-risk.
  `Cash App` is riskier — "cash app" appears in ordinary sentences. `Friends & Family` /
  `friends and family` is the worst: *"a gift for friends and family"*, *"share with friends and
  family"* is common marketing copy and produces an auto_fail on a critical rule.
- **Third-party content.** Any embedded review, testimonial or FAQ answer quoting a customer is in
  scope.

**Evidentiary weakness, and this is the reason it should not be promoted to blocker as it stands.**
Restating §1.6: the finding carries `evidenceKey: ''` and `sourceSha256: ''`, hardcoded;
`sourceUrl` is always the first surface (the homepage when a footer exists) rather than the surface
the term was found on; `capturedAt` is the check's clock, not the page's.

The one observed `fail` in the committed set makes this concrete. swisschems.is:

```
PAY-001 [fail]
note:  Observed on the payment or refund policy (https://swisschems.is/payments/) (Zelle): Zelle.
       5 public surface(s) were read: …
ev:    url = https://swisschems.is/            ← the homepage
       key = (none)
       sha = (none)
       at  = 2026-08-23T15:16:16.736Z          ← check time, not capture time
```

The `/payments/` page **was** captured — its DOM snapshot is in the evidence set. The finding just
does not point at it. So the most consequential single finding in the run — a `critical`
`auto_fail` on a payment rail — is, at the evidence layer, a bare assertion with a URL that is not
where the observation was made.

Constraint 3 is unambiguous: *"No finding without evidence, appropriate to the surface… Never
synthesize a visual capture that did not occur. If the capture a finding's kind requires could not
be made, the finding is `not_evaluable`, not a bare assertion."* PAY-001 declares
`evidenceKind: 'rendered_page'` — the kind that requires a screenshot, a DOM hash, a source URL, a
matched value and a timestamp. It supplies two of the five, and one of those two is wrong.

## 3.4 Summary against the blocker-tier question

| | PROD-005 | PROD-008 | PAY-001 |
|---|---|---|---|
| Tier today | review_only | review_only | **auto_fail** |
| Subject located structurally? | No — flat token bag | No — flat substring | No — flat substring per surface |
| Word boundaries? | Yes (whole tokens) | **No** | **No** |
| Negation handled? | No | No | No |
| Boilerplate excluded? | No | No — footer drives `condition` | Footer *is* a named surface |
| Third-party content excluded? | No | No | No |
| Dominant real-world error | **False pass** — `5mg` unmatched | **False positive** — the compliance disclaimer | **False negative** (closed vocabulary) and **false positive** (negation) |
| Finding carries a capture? | Yes — screenshot + HTML hash | Yes — screenshot + HTML hash | **No — empty key, empty hash, wrong URL** |
| Excerpt verbatim? | **No** — detokenised reconstruction | n/a — reports term names only | n/a — reports term names only |

Two things are worth separating, because they are different kinds of work:

- PROD-005 and PROD-008 have an **evidence path that meets constraint 3** and a **matching
  discipline that does not**. Their captures are sound; what is attached to them is a term list or
  a detokenised string.
- PAY-001 has the **inverse** problem in addition — its matching is no worse than the others', but
  its evidence construction bypasses `pageEvidence` entirely and produces a finding that cannot be
  re-verified from what it cites. It is also the only one of the three that reaches `fail` without
  a human.

## 3.5 One structural observation that spans all three

Every finding these three produce says `evidenceKind: 'rendered_page'`, and constraint 3 binds that
kind to a specific evidentiary payload. Two of the three satisfy it by routing through
`pageEvidence()`, which reads keys the renderer sets only after a capture succeeded — that
mechanism works, and it is why no finding in the committed set cites a screenshot that was never
taken.

`checkPaymentTerms` is the one check in this set that constructs an `Evidence` object literal by
hand. That is the whole difference. It is D-026's shape again — a precondition (a capture exists,
and this URL is where the observation was made) that no reader of the finding can see is being
asserted rather than established.

---

# What is not captured today — plain list

Stated as absences, not as proposals.

**Not extracted into `PageContext`, but recoverable from the stored DOM snapshot:**
`<meta name="description">`, canonical URL, `og:` tags, `<link rel>`, all JSON-LD and microdata
beyond `Product.url`, `<img src>`, `<img alt>`, variant/option/price markup, subscription and
pack-size markup.

**Not captured at all, and unrecoverable:**

- Image bytes for any storefront asset.
- The checkout page — reached by the GATE-003 flow, hashed, body discarded.
- The GATE-002 probe responses — reached, hashed, bodies discarded.
- Any page not rendered by `renderPage`: everything outside the homepage, the 5 sampled products,
  and the Layer 3 candidate paths.
- Per-node computed style for any page not rendered (it is measured live and not derivable from
  stored HTML).
- The second URL of any two pages that rendered byte-identically — the key is the content hash and
  the `evidence` row keeps the first URL only.

**Captured but read by nothing:** `footerPaymentTerms` (extracted, carried, never consumed; its
vocabulary is a divergent hardcoded copy). `CheckoutSurface` (type declared, no producer, no
consumer).

**Not computed, stored or reported anywhere:** pages visited per run, pages by type, catalogue
size, sample fraction. The report's `coverage` object counts rules by resolution state, not pages.
