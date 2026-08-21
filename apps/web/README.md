# apps/web

The report frontend. React + Vite, deployed to Netlify per `netlify.toml`.

## The design is specified, not decided here

`demo/index.html` is the design specification (D-004). `src/styles.css` is its CSS carried over
essentially verbatim, with a documented block of additions at the end for things real data needs
and the demo had no equivalent for. **Changing a value in the ported section changes settled,
reviewed design.** The additions are marked and explained.

One deliberate departure from the stack table in `docs/ARCHITECTURE.md`, which lists Tailwind:
the design specification *is* hand-written CSS, and expressing it as utility classes would be a
translation of a settled design with drift at every step. Tailwind is not installed. It remains
the right choice for surfaces that have no design spec behind them; this one has.

## The rule set

Imported as JSON and validated through `@mintro/ruleset`'s `parseRuleset` — the same validator
the worker uses. There is no second parser (hard constraint 1). If the committed rule set fails
validation the app renders the defect list and nothing else, because a report rendered against
rules that were never checked is worse than no report.

`@mintro/ruleset/browser` is the entry point used here: identical schema and invariants, minus
the filesystem loader, which would drag `node:fs` into the bundle.

## Evidence

Never linked directly. `src/lib/evidence.ts` mints a **short-expiry signed URL** per view from
the private `evidence` bucket. A signed URL baked into a stored report would either expire and
break the report or be given a long enough life to be a public URL with extra steps.

The report shows which access path produced a capture, so a screenshot loaded from a local
development directory can never be mistaken for one retrieved from the private bucket.

## Local development

    npm run scan-full -- --report-dir ./reports --evidence-dir ./evidence https://example.com
    npm run web

`link-runs` copies worker output into `public/`. Both directories are gitignored; production
serves reports from Supabase and evidence through signed URLs.
