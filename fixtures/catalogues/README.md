# Stored catalogues, as URL paths

One file per storefront. Every `<loc>` path the crawl read from that merchant's sitemaps,
deduplicated and sorted. One path per line, LF, no header — so a reviewer can read the file and
see exactly what a matcher is being run against, which is what `CLAUDE.md` § Conventions asks of a
fixture.

These exist because `evidence/` is **gitignored**. A test reading from it passes on a clean
checkout by having nothing to check — the failure `.gitignore` already carries a comment about,
against `/reports/`. The false-positive proof for a rule that reaches an underwriter cannot rest on
files that are not in the repository.

## What is here, and what is not

| file | paths | provenance |
|---|---|---|
| `biotechpeptides.com.txt` | 287 | `<loc>` entries across 16 stored runs |
| `www.corepeptides.com.txt` | 251 | 16 stored runs |
| `swisschems.is.txt` | 182 | 22 stored runs |
| `sportstechnologylabs.com.txt` | 96 | 14 stored runs |
| `www.comopeptides.com.txt` | 38 | run `356ce753`'s `product-sitemap.xml` |

**`peptidesciences.com` is absent, and its absence is the honest answer rather than an omission.**
That merchant served `robots.txt` and answered three sitemap paths with `403`. Its stored report
records `CATG-003` as *"no sitemap could be found or parsed at robots.txt or the well-known paths"*
and 48 of its findings as `not_evaluable`. There is no catalogue to match against because we were
never served one, and inventing one to fill the row would be worse than the gap.

`www.corepeptides.com` was not on the list this fixture was asked for and is here because the
evidence holds it. It is the second-largest catalogue of the five and carries eight of the sixteen
slugs a naive `rt` substring matcher hits, so leaving it out would have weakened the proof.

**Comopeptides is transcribed rather than extracted.** Its evidence is not in this repository; the
38 paths come from `packages/engine/test/codedProductSlugs.test.ts`, which transcribed them from
that run's stored `product-sitemap.xml` in the order the sitemap listed them. That file is the
provenance, and it predates the rule these fixtures now test.

## Every path, not only the products

`CATG-008` is scoped to `products`, and these files carry the whole URL surface — articles,
policies, cart and account paths included. That is deliberate and it is stricter: a pattern that
fires on nothing in this set certainly fires on nothing in the products subset, and filtering first
would let a false positive hide behind a classifier decision rather than being seen.

It also matters for the contrast. The slugs a naive substring `rt` hits — `cartalax`, `cortagen`,
`cartilage`, `migration`, `/cart/`, `telmisartan` — are mostly editorial and utility URLs, so a
products-only fixture would understate by half what whole-token matching is buying.

## Line endings are LF, and pinned twice

`.gitattributes` carries `fixtures/catalogues/*.txt eol=lf`, which is an exception to the
repo-wide `* text=auto` (D-152). That rule is right for anything a person edits — stored LF,
checked out however the platform wants — and wrong for a file a test reads line by line and
compares as strings, because then the checkout is part of the test input.

It is an exception with a receipt. These files went green on the machine that wrote them and red
on the very next checkout of the same commit: stored LF, checked out CRLF under `core.autocrlf`,
so every path arrived as `/shop/rt/\r`. Three assertions failed comparing paths and the reported
failure pointed at the GLP-1 rule, which was matching perfectly.

`eol=lf` fixes the checkout and is not trusted to be the whole fix. `readCatalogue` in
`packages/engine/test/glp1Patterns.test.ts` trims every line, so a file arriving with CRLF through
some other route — an editor, a patch, a later edit to `.gitattributes` — still cannot decide
whether the suite passes. Two independent guards, because this one lives in a file nobody reads
until it has already gone wrong.

## Regenerating

These are extracted from `evidence/*/layer0/*` by decompressing each stored document and reading
its `<loc>` elements. They change only when a new merchant is crawled, and a change to an existing
file means that merchant's published catalogue moved — which is a fact worth seeing in a diff, not
a reason to regenerate silently.
