# Mintro Screener

Pre-underwriting screener for the RUO peptide merchant program. Takes a storefront URL,
checks it against the program rule set, and produces an evidence-backed report for IQwallet.

## What's here now

    demo/index.html        Design spec for M3. Open locally. Not deployed — see D-004.
    brand/                 Logo assets derived from the supplied PNG. See D-007.
    rules/ruleset.json     51 rules, the single source of truth. Data, not code.
    packages/ruleset/      M0 — loader, schema and validator for the rule set.
    packages/engine/       M1 — Layer 0 crawler and check handlers. No browser.
    fixtures/ruleset/      Valid and deliberately malformed rule sets for the test suite.
    CLAUDE.md              Standing brief for Claude Code. Read first.
    docs/STATUS.md         Where the project stands. Start here if you are new.
    docs/ARCHITECTURE.md   Stack and technical rulings.
    docs/DECISIONS.md      Business rulings, dated, with reasoning.
    docs/DEPLOY.md         git -> Netlify, step by step.

## Working on it

    npm install
    npm run check       # typecheck + tests
    npm run validate    # validate rules/ruleset.json, exit 1 if it is malformed
    npm run scan -- https://storefront.example    # Layer 0 scan, read-only

`npm run check` runs both halves for a reason: some guarantees are enforced by `tsc` rather
than by an assertion, and the tests pass without them.

## What this is not

Not a compliance monitor and not a determination. We report observations with captures
attached. IQwallet decides. Rules marked `manual` in the ruleset cannot be seen from a
website and are reported as not evaluable — never as passing.

## Getting started with Claude Code

    cd mintro-screener
    claude

Then: "Read CLAUDE.md and docs/ARCHITECTURE.md, then start on M0."

## Deploying

Frontend to Netlify, worker to Fly, data on Supabase. See `docs/DEPLOY.md`.
Nothing is deployable until M3; that is expected.
