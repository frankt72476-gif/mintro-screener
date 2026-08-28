# Report fixtures

Real reports from real storefronts, pinned so the tests that read them have something to read.

## Why these are here and not in `reports/`

`reports/` is the worker's local output directory and is gitignored. Three tests read it —
`apps/web/test/anchors.test.ts`, `apps/worker/test/copy.test.ts` and
`apps/worker/test/requirement.test.ts` — and each opened with `if (!existsSync('reports')) return []`.

On the machine that produced them that reads every report and checks a great deal. On a clean
checkout it reads **nothing**, and three test files pass by having no input. That is the vacuous
pass the blocker audit was about, in our own suite: a check that cannot fail is not a check.

`anchors.test.ts` had already been bitten by the same shape once — its header records that an
earlier version "passed over an empty list… A check that never saw a single anchor reported that
every anchor resolved." The `existsSync` guard reintroduced it one level up.

## What is here

| file | run | rule set | domain | scanned |
|---|---|---|---|---|
| `biotechpeptides.com.json` | `63514a3b` | 2.9.0 | biotechpeptides.com | 2026-08-23 |
| `corepeptides.com.json` | `e3e80bd3` | 2.9.0 | corepeptides.com | 2026-08-23 |
| `peptidesciences.com.json` | `86b4dc3a` | 2.9.0 | peptidesciences.com | 2026-08-23 |
| `sportstechnologylabs.com.json` | `71bea35a` | 2.9.0 | sportstechnologylabs.com | 2026-08-23 |
| `swisschems.is.json` | `74eefa47` | 2.9.0 | swisschems.is | 2026-08-23 |
| `run-c268f8d7.json` | `c268f8d7` | 3.1.0 | sportstechnologylabs.com | 2026-08-28 |
| `run-5b29036d.json` | `5b29036d` | 3.1.0 | www.comopeptides.com | 2026-08-28 |

**Two of these are the same storefront and not the same run.** `sportstechnologylabs.com.json` is
`71bea35a` at 2.9.0; `run-c268f8d7.json` is `c268f8d7` at 3.1.0. They are named differently because
the first five are keyed by domain — the shape `npm run pdf` expects — and the reference runs are
keyed by run id. Anything reading this directory by domain will find the older one.

The five at 2.9.0 are deliberately old. They predate `notEvaluableKind` (D-044), the obstruction
banner (D-136), the blocking summary (D-161) and the sample basis (D-162), so they are the runs that
exercise every "this report predates the field" path — the one thing a freshly generated fixture
cannot test. Runs are immutable (D-002), so they will stay that way.

The two at 3.1.0 are the restructure reference runs, carrying every current field.

**These are outputs, not inputs.** Nothing regenerates them and nothing should: they are what those
runs produced. A test that needs a report of a shape not here should build one with
`assembleReport`, as most of the suite does.
