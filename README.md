# Mintro Screener

Pre-underwriting screener for the RUO peptide merchant program. Takes a storefront URL,
checks it against the program rule set, and produces an evidence-backed report for IQwallet.

## What's here now

    demo/index.html        Design spec for M3. Open locally. Not deployed — see D-004.
    brand/                 Logo assets derived from the supplied PNG. See D-007.
    rules/ruleset.json     51 rules, the single source of truth. Data, not code.
    CLAUDE.md              Standing brief for Claude Code. Read first.
    docs/ARCHITECTURE.md   Stack and technical rulings.
    docs/DECISIONS.md      Business rulings, dated, with reasoning.
    docs/DEPLOY.md         git -> Netlify, step by step.

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
