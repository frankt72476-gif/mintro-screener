# Product pages, for the empty-cart attribution check

Three pages, each reproducing one structural shape observed on a real storefront. They exist so
`inspectAddOutcome` can be tested against a real DOM rather than against a stub that returns the
answer it is supposed to compute.

Hand-written rather than saved wholesale. `CLAUDE.md` prefers saved HTML from real storefronts, and
these are the case for the exception it allows: the real pages are 170KB of theme, analytics and
related-product markup, of which four elements matter. A reviewer can read these and see what is
being detected; nobody can read the original and see it.

Every structure here was observed live on the storefront named, and is quoted rather than invented:

| file | shape | observed on |
|---|---|---|
| `variable-product.html` | `form.variations_form[data-product_variations]`, add control carrying `disabled wc-variation-selection-needed` | `www.comopeptides.com/shop/bpc-157-tb500-blend/`, and `www.corepeptides.com/peptides/bpc-157-tb-500-10mg-blend/` in stored Layer 1 evidence |
| `late-overlay-product.html` | an interstitial that is absent at load and arrives on a timer, with its own dismiss control | comopeptides again — the shape that made the old probe depend on clicking before the lightbox rendered (D-227) |
| `overlay-covered.html` | a fixed, viewport-covering element at `z-index: 9999` sitting over the add control | comopeptides' age-affirmation lightbox, an Elementor `.dialog-widget` measured at 1280×720 |
| `simple-product.html` | an ordinary add control, nothing in the way | `sportstechnologylabs.com/product/bpc-157-tb-500-ghk-cu-glow-stack/` and `swisschems.is/product/longevity-research-bundle/`, both of which the probe drives successfully |

The third is the one that keeps the test honest. Without it these assert only that blockers are
found where they exist, and a detector that answered "blocked" unconditionally would pass.

**No text is matched, here or in the detector.** The age-gate wording is not reproduced and the
variation labels are arbitrary, because detection is structural (constraint 9) and a fixture
carrying the real copy would let a text-matching regression pass unnoticed.
