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
