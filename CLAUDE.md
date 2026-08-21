# Mintro Screener — brief for Claude Code

Read this before writing anything. Then read `docs/ARCHITECTURE.md` for technical
rulings and `docs/DECISIONS.md` for business rulings. All three are binding.

## What this is

A pre-underwriting screener. An analyst enters a merchant storefront URL. We crawl the
public surface, check it against the RUO peptide program rule set, and produce a report
with a verbatim capture behind every finding. The report goes to IQwallet, who makes the
actual approval decision.

**We do not make compliance determinations.** We report observations. Every finding is a
fact with a capture attached: "this page displays a Weight Loss collection, here is the
screenshot." Never "this merchant is non-compliant." That distinction is legal, not
stylistic. Do not let it drift in copy, variable names, or report text.

## Roles

Architecture, stack, and technical trade-offs are already decided in `docs/ARCHITECTURE.md`.
If you think a decision is wrong, say so and stop — do not silently substitute. If a
question is about the business (who gets emailed, what blocks a send, pricing, what a rule
should mean), stop and ask. Do not guess at business rules.

## Hard constraints

1. **The rule set is data, not code.** `rules/ruleset.json` is the single source of truth.
   Adding a rule must never require touching the engine. If you find yourself writing
   `if (ruleId === 'GATE-002')` anywhere outside a check-type handler, the design is wrong.

2. **Four states, always.** `fail`, `review`, `pass`, `not_evaluable`. A rule that cannot be
   observed from the crawled surface returns `not_evaluable` — never `pass`. Reporting an
   unobservable rule as passing is the worst bug this system can have.

3. **No finding without evidence, appropriate to the surface.** Every finding names its
   evidence kind explicitly, and carries the capture that kind requires. See D-012.

   - **Rendered-page findings (L1+)** — full-page screenshot, DOM snapshot hash, source URL,
     matched value, UTC timestamp.
   - **Documentary findings (L0)** — the stored artifact body, its SHA-256, source URL, UTC
     timestamp, matched pattern, matched URLs.

   Store the artifact body, not only its hash: a hash proves a document has not changed, but
   it does not let anyone read what the document said. Keep the SHA-256 alongside it — that is
   what proves the stored artifact is the one fetched.

   This applies to `pass` as much as to a failure. The absence of a prohibited URL is a
   finding about the catalogue and needs the same backing as its presence.

   **Never synthesize a visual capture that did not occur.** If the capture a finding's kind
   requires could not be made, the finding is `not_evaluable`, not a bare assertion — and a
   `not_evaluable` finding must itself evidence *why*, with the requests attempted and what
   they returned.

4. **Ambiguous checks never auto-fail.** Rules marked `tier: "review_only"` (dosing
   co-occurrence, abbreviation matching) go to a human queue regardless of confidence.
   These are where false positives live and false positives destroy trust in the tool.
   Severity never overrides this — see D-009.

5. **Evidence storage is append-only.** Screenshots and DOM snapshots are never overwritten
   or deleted by application code. This is a defensibility requirement.

6. **Credentials go in a vault, never in Postgres columns or env files in the repo.**
   Merchant screening-account credentials are secrets. Encrypt at rest, log every access.

7. **Findings describe, they never instruct.** No report copy tells anyone what to do —
   not "do not forward", not "recommend", not "should". State the observation and attach
   the capture. See D-001.

8. **Runs are immutable.** Re-scanning a merchant creates a new run. Nothing in application
   code updates or deletes a completed run or overwrites its evidence. See D-002.

## Build order

Do these in sequence. Do not start the next until the previous is working and reviewed.

- **M0 — Ruleset loader + validator.** Parse `rules/ruleset.json`, validate against a schema,
  fail loudly on a malformed rule. No crawling yet. Ship with tests.
- **M1 — Layer 0 crawler.** robots.txt + sitemap.xml fetch, URL slug matching. No browser.
  This alone resolves a large share of merchants. Prove it against 5 real storefronts.
- **M2 — Playwright worker.** Homepage render, footer computed-style checks, product page
  sampling. Screenshot + DOM capture to storage.
- **M3 — Report API + frontend.** Persist runs and findings, render the report. `demo/index.html`
  is the **design specification** — the layout, four-state system, evidence slip, tick strip
  and copy are settled. Port it to React faithfully. Do not redesign it, and do not deploy
  it (see D-004).
- **M4 — Auth modes.** Scripted Shopify/WooCommerce login, then assisted sign-in.
- **M5 — PDF + Resend send.** See architecture doc: PDF is Playwright print-to-PDF of a
  report route, not a separate rendering library.
- ~~M6 — Scheduled re-scan + diff.~~ **Deferred — see D-002.** Do not build a scheduler.
  Re-running a merchant must still create a new immutable run; the data model already
  supports this and must not regress.

Documents Check is a later phase. Leave the nav item and route stubbed. Do not build it.

## Conventions

- TypeScript everywhere. `strict: true`. No `any` in check handlers.
- Rule IDs are stable and never reused. Format: `CATEGORY-NNN`.
- All timestamps UTC, ISO 8601, stored as `timestamptz`.
- Check handlers are pure where possible: given a page context and rule params, return a
  finding. Side effects (storage writes) happen in the runner, not the handler.
- Tests: every check type needs a fixture-based test. Fixtures live in `fixtures/`, are
  saved HTML from real storefronts, and are committed.

## When you are unsure

Ask. A wrong `pass` on this system has consequences well beyond a bug report.
