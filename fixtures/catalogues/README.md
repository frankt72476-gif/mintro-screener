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

## Regenerating

These are extracted from `evidence/*/layer0/*` by decompressing each stored document and reading
its `<loc>` elements. They change only when a new merchant is crawled, and a change to an existing
file means that merchant's published catalogue moved — which is a fact worth seeing in a diff, not
a reason to regenerate silently.
