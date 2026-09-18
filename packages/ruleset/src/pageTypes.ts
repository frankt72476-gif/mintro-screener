/**
 * Page types, per vertical: which URL slugs name which kind of page (D-274, D-284).
 *
 * Data about how to recognise a page, and nothing about what a rule asks of it. The crawler decides
 * what a candidate URL is by asking which slug in its vertical's table the path carries, first match
 * in table order winning; the rules name the page types they read.
 *
 * Browser-safe: no filesystem, so the web bundle can import it alongside the rest of `browser.ts`.
 *
 * ## The peptide table moved here unchanged
 *
 * It lived as `SURFACE_SLUGS` in `apps/worker/src/evaluationPages.ts` and moved here with its
 * comments, entries and order untouched (D-270, D-274; run 97bf366a). The order is load-bearing, and
 * `pageTypes.test.ts` holds it against a literal copy of the table as it stood.
 */

/** `[slug, pageType]`, tried in order. A slug is a token sequence: `sign-up` is `['sign', 'up']`. */
export type PageTypeTable = readonly (readonly [string, string])[];

export const PEPTIDE_PAGE_TYPES: PageTypeTable = [
  /*
    Specific first, general second, and the split is load-bearing rather than tidy.

    `/pages/shipping-policy` carries both `shipping` and `policy`. With `policy` listed first it was
    labelled `terms` — a shipping policy filed as the terms page, which is wrong twice: the terms
    page then looks present when it is not, and the shipping policy angle 5 wants is filed
    somewhere nobody looks for it. Seen on run 97bf366a.
  */
  ['shipping', 'shipping_policy'],
  ['refund', 'shipping_policy'],
  ['return', 'shipping_policy'],
  ['returns', 'shipping_policy'],
  ['checkout', 'checkout'],
  ['cart', 'checkout'],
  ['register', 'register'],
  ['registration', 'register'],
  ['signup', 'register'],
  ['sign-up', 'register'],
  ['login', 'register'],
  ['faq', 'faq'],

  // General. Reached only when no specific token matched the path.
  ['policy', 'terms'],
  ['policies', 'terms'],
  ['terms', 'terms'],

  ['account', 'register'],

  /*
    How a storefront talks about itself — a third band, **after** the general one (D-270).

    The table used to be two bands and the ordering rule was *specific before general*. About is
    neither: it is the loosest reading of all, and a path carrying an about token and a policy token
    is a policy page. `/about-our-return-policy` and `/blog/terms-of-service` are both real shapes,
    and both should be read as what they are about rather than where they live.

    So the rule is now *specific, then general, then about*, and `slugBands` in the test file is
    what holds it.

    `about-us` precedes `about` and `our-story` precedes `story` for the reason the shipping note
    above records: these are token sequences, and the longer one has to be tried first or the
    shorter one swallows it.
  */
  ['about-us', 'about'],
  ['about', 'about'],
  ['our-story', 'about'],
  ['story', 'about'],
  ['mission', 'about'],
  ['why-us', 'about'],

  /*
    Editorial, last of all (D-274).

    `blog` and `news` moved here from the about band: a blog is not a page a site wrote about
    itself, it is a page a site wrote to be read, and the two answer different angles. `faq` is
    **not** here — it keeps its own surface, because COMM-001 reads that document specifically and a
    FAQ relabelled `editorial` would take a rule's subject away from it.

    `quality`, `coa`, `certificates` and `promise` are on the list because CoMo has no blog, no
    articles and no research pages, and does have `/quality-promise/`, `/how-to-read-a-coa/` and
    `/certificates-of-analysis/`. A list that matched nothing on the one merchant we can test
    against would be a surface that renders on no run.
  */
  ['articles', 'editorial'],
  ['article', 'editorial'],
  ['research', 'editorial'],
  ['learn', 'editorial'],
  ['guides', 'editorial'],
  ['guide', 'editorial'],
  ['resources', 'editorial'],
  ['education', 'editorial'],
  ['blog', 'editorial'],
  ['news', 'editorial'],
  ['quality', 'editorial'],
  ['coa', 'editorial'],
  ['certificates', 'editorial'],
  ['certificate', 'editorial'],
  ['promise', 'editorial'],
];

/**
 * The adult AI page types (cluster 2, Frank 2026-09-18).
 *
 * **Removal before guidelines before terms, and `policy` last.** First match wins, so the order is the
 * precedence:
 *
 *   - `content-removal-policy` carries `removal` and `policy` and is the removal page, so the removal
 *     band comes first;
 *   - a guidelines page may be called `/content-policy`, and is a guidelines page;
 *   - a terms slug (`terms`, `tos`, `terms-of-service`) names the terms page outright;
 *   - a bare `policy` / `policies` slug is read as terms only when nothing more specific matched, and
 *     among terms candidates a terms slug is read before a policy slug (`rankByPageTypeOrder`).
 *
 * `character/new` is the token sequence `character new`, as `/character/new` tokenises.
 */
export const ADULT_AI_PAGE_TYPES: PageTypeTable = [
  ['content-removal', 'removal'],
  ['removal', 'removal'],
  ['complaints', 'removal'],
  ['dmca', 'removal'],
  ['report', 'removal'],
  ['community-guidelines', 'guidelines'],
  ['content-policy', 'guidelines'],
  ['acceptable-use', 'guidelines'],
  ['guidelines', 'guidelines'],
  ['rules', 'guidelines'],
  ['terms-of-service', 'terms'],
  ['terms', 'terms'],
  ['tos', 'terms'],
  ['pricing', 'pricing'],
  ['plans', 'pricing'],
  ['credits', 'pricing'],
  ['subscribe', 'pricing'],
  ['create-character', 'create'],
  ['new-character', 'create'],
  ['character/new', 'create'],
  ['create', 'create'],
  ['generate', 'generate'],
  ['image', 'generate'],
  ['imagine', 'generate'],
  ['studio', 'generate'],
  ['documentation', 'docs'],
  ['docs', 'docs'],
  ['help', 'docs'],
  ['faq', 'docs'],
  ['policy', 'terms'],
  ['policies', 'terms'],
];

/**
 * A page type a vertical's Layer 3 pass looks for, and how.
 *
 * Found by the homepage's links and the sitemap, through the vertical's table — the merchant telling
 * us what they have (D-274). `paths` are conventional locations tried after those, for a page whose
 * absence would itself be a finding; empty for a page type that is only ever found.
 */
export interface PageTypeDocument {
  readonly pageType: string;
  /** How progress lines and unreached findings name it. */
  readonly label: string;
  readonly paths: readonly string[];
  /** Pages of this type one run reads. Absent means one. */
  readonly limit?: number;
}

export interface VerticalPages {
  readonly table: PageTypeTable;
  /**
   * The Layer 3 documents this vertical locates by page type.
   *
   * Absent for peptides, whose documents — terms, shipping, FAQ, payment, about, editorial — are
   * located by the long-standing pass in `apps/worker/src/signup.ts`, unchanged.
   */
  readonly documents?: readonly PageTypeDocument[];
  /**
   * Read a page type's candidates in the order of the table entry that classified them (D-284).
   *
   * What makes "a terms slug beats a policy slug" hold when both are linked. Off for peptides, whose
   * candidates are read in the order they were found, as they always have been.
   */
  readonly rankByPageTypeOrder: boolean;
}

export const PEPTIDE_PAGES: VerticalPages = { table: PEPTIDE_PAGE_TYPES, rankByPageTypeOrder: false };

export const ADULT_AI_PAGES: VerticalPages = {
  table: ADULT_AI_PAGE_TYPES,
  rankByPageTypeOrder: true,
  documents: [
    {
      pageType: 'terms',
      label: 'terms document',
      paths: ['/terms-of-service', '/terms', '/tos', '/terms-and-conditions', '/legal/terms'],
    },
    { pageType: 'guidelines', label: 'guidelines page', paths: [] },
    { pageType: 'removal', label: 'content removal page', paths: [] },
    { pageType: 'pricing', label: 'pricing page', paths: [] },
    { pageType: 'create', label: 'character creation page', paths: [] },
    { pageType: 'generate', label: 'generation page', paths: [] },
    { pageType: 'docs', label: 'documentation page', paths: [] },
  ],
};
