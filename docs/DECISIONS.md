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
