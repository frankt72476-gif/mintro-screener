/**
 * Reaching the sign-up form and the terms document (D-048).
 *
 * Layer 3 reads pages a visitor gets to by *doing* something. Nothing here evaluates compliance —
 * it finds the pages and reads their structure, and the handlers in `@mintro/engine` decide what
 * that means.
 *
 * ## Discovery is not the same problem as location
 *
 * Hard constraint 9 forbids locating the *subject of a check* by its compliant form. That applies
 * inside the form: the terms checkbox is found by `type` and `required`, the research field by
 * the autofill vocabulary, never by their labels.
 *
 * Finding the sign-up *page* is a different problem and has no structural answer — a registration
 * page is reached by a link or a conventional path, both of which are prose. So this tries a list
 * of candidates, and **records every attempt and what it returned**. When none yields a page with
 * a password field the result is `not_evaluable` evidencing the attempts, never "the merchant has
 * no sign-up form". That is hard constraint 3 applied to a negative.
 *
 * ## Politeness
 *
 * Every navigation goes through the same `Pacer` the rest of the crawl uses, so the `Crawl-delay`
 * a merchant declared is honoured across the whole run rather than per layer (D-013). Layer 3 adds
 * several page loads to an origin already being crawled, which is exactly the case the delay is
 * for.
 */

import type { Browser, BrowserContext } from 'playwright';
import type {
  EvidenceArtifact,
  FetchAttempt,
  Located,
  Pacer,
  PageContext,
  SignupForm,
  SurfaceSpec,
} from '@mintro/engine';
import { discoverLayer0, located, NO_SIGNUP_FORM, unreachable, withoutFragment, type Fetcher } from '@mintro/engine';
import { docsOriginFor, docsPacerFor, llmsTxtUrls } from './docsOrigin.js';
import { pageTypeEntry, surfaceFromSlug } from './evaluationPages.js';
import type { PageTypeDocument, PageTypeTable, VerticalPages } from '@mintro/ruleset';
import { probeSurface } from './surfaceProbe.js';
import { establishDocument } from './locate.js';
import { PROBE_IDLE_MS, renderPage } from './render.js';

/**
 * Paths a sign-up form lives at, most specific first.
 *
 * Platform conventions, not guesses: Shopify serves `/account/register`, WooCommerce serves
 * `/my-account/`, and the generic spellings cover bespoke themes. Every one that is tried is
 * reported whether it worked or not.
 */
const REGISTER_PATHS = [
  '/account/register',
  '/my-account/',
  '/register',
  '/signup',
  '/sign-up',
  '/create-account',
  '/customer/account/create/',
  '/account/login',
];

/** Paths a terms document lives at. */
const TERMS_PATHS = [
  '/pages/terms-and-conditions',
  '/pages/terms-of-service',
  '/pages/terms',
  '/terms-and-conditions',
  '/terms-of-service',
  '/terms',
  '/terms-conditions',
];

/** Link text and hrefs that point at a terms document, for the homepage-link fallback. */
const TERMS_LINK_HINTS = ['terms', 'conditions', 'terms-of-service', 'terms-and-conditions'];

/** Shipping policy (FULF-001) and FAQ (COMM-001), stage 2. Same shape, same guards. */
const SHIPPING_PATHS = [
  '/pages/shipping-policy',
  '/pages/shipping',
  '/shipping-policy',
  '/shipping',
  '/shipping-returns',
  '/delivery',
];
const SHIPPING_LINK_HINTS = ['shipping', 'delivery', 'shipping-policy'];

const FAQ_PATHS = ['/pages/faq', '/pages/faqs', '/faq', '/faqs', '/frequently-asked-questions', '/help'];
const FAQ_LINK_HINTS = ['faq', 'faqs', 'frequently asked', 'frequently-asked'];

/**
 * Nothing is guessed any more (D-274).
 *
 * The about surface shipped with a path list built from every about slug in both the bare and
 * `/pages/` forms — sixteen guesses at a conventional URL. Run `f6008fa9` rendered **fourteen themed
 * 404s** from it: `/blog`, `/mission`, `/news`, `/our-story`, `/story`, `/why-us` and their
 * `/pages/` twins, every one a full browser navigation to learn that CoMo does not use that path.
 *
 * A storefront that publishes a page **links to it or lists it**. Candidates now come from the
 * homepage's nav and footer and from the sitemap, and from nowhere else. Both are the merchant
 * telling us what they have; a path list is us telling them what they ought to have.
 *
 * The policy surfaces keep their path lists, and that is deliberate rather than an oversight: a
 * terms page that no page links and no sitemap lists still has to be found, because *the merchant
 * publishes no terms* is a finding and *we did not look hard enough* is not. An about page that
 * nothing links and nothing lists is a page with no readers.
 */

/**
 * How many editorial pages one run reads.
 *
 * Eight, because a storefront with a blog has dozens and the point is a sample of how it writes,
 * not an archive. What is left over is recorded rather than dropped: a reader has to be able to see
 * that the run chose, and which way (D-076).
 */
const MAX_EDITORIAL_PAGES = 8;

/**
 * The phrases an about link says, for a link that is not in the chrome (D-271).
 *
 * A link in the nav or footer whose href names the about surface is followed whatever it says —
 * *About Como Peptides* is a real one and no phrase list would have it. This is the other door: a
 * link in body copy saying the phrase outright, which is how *Read Our Story →* is reached.
 *
 * Neither door decides the surface. `surfaceFromSlug` does, so `/about-our-return-policy` is
 * refused by the page selector's own band ordering rather than by a rule written twice.
 */
const ABOUT_LINK_TEXTS: readonly string[] = ['about', 'about us', 'our story', 'mission'];

/**
 * The phrases an editorial link says, for one outside the chrome (D-274).
 *
 * Short and literal, like the about list, and for the same reason: these are the words a site puts
 * on a nav item. Anything looser reads a body link saying *learn more about shipping* as an
 * editorial page.
 */
const EDITORIAL_LINK_TEXTS: readonly string[] = [
  'faq',
  'faqs',
  'help',
  'blog',
  'news',
  'articles',
  'research',
  'learn',
  'guides',
  'resources',
  'education',
  'quality promise',
  'certificates of analysis',
];

/** A payment-methods or refund policy page - public, and where payment rails get advertised. */
const PAYMENT_PATHS = [
  '/pages/payment-methods',
  '/payment-methods',
  '/pages/refund-policy',
  '/refund-policy',
  '/refunds',
  '/returns',
  '/pages/returns',
  '/return-policy',
];
const PAYMENT_LINK_HINTS = ['payment', 'refund', 'return', 'chargeback'];

/**
 * How many homepage links a surface will follow before it stops adding candidates (D-155).
 *
 * The linked set was uncapped, and unbounded work in a crawl is a hang waiting for the right
 * storefront. Each candidate is a full page render — measured at 201 network requests on one of
 * the validation storefronts — so twenty matching footer links would have added twelve minutes to
 * a single surface.
 *
 * **Four**, and the number comes from measurement rather than taste. Matches are ordered by
 * document position, and the links a visitor would actually follow — the footer policy links —
 * come first and come in ones and twos. Measured across the two validation storefronts and all
 * four surfaces: **0 to 3 matches**, maximum 3. Four is that maximum plus one.
 *
 * Beyond about four, a match is no longer a policy link: it is an unrelated URL that happens to
 * contain `return` or `payment`. Paying a full page render for each of those is the cost this cap
 * exists to stop.
 *
 * Truncating is also the *safe* direction if the number is ever wrong. A document not reached is
 * `not_exposed` — outstanding, and never a `pass` — so a cap that bites produces a coverage gap
 * that says so, not a false clearance.
 *
 * Truncation is **reported, never silent**. A surface that stopped adding candidates says so in
 * its attempts, because "we did not look" and "we looked and found nothing" are different claims
 * and a reader must be able to tell them apart. That is the same rule Layer 0 follows for its
 * sitemap cap.
 */
export const MAX_LINKED_CANDIDATES = 4;

export interface Layer3Discovery {
  readonly signup: SignupForm;
  /**
   * The rendered sign-up page, where one was reached (D-198).
   *
   * Carried so the eye-test manifest can name its capture. `SignupForm` describes the fields and
   * has no key; the rubric asks whether the gate reads as a control or a formality, which is a
   * question about the picture.
   */
  readonly signupPage?: PageContext;
  /*
    `Located<PageContext>` rather than `PageContext | undefined` (D-182).

    A surface that was not established has to carry *what was tried and what each candidate
    returned*, or the finding it produces asserts an absence with nothing behind it — which is what
    seventeen `not_exposed` findings across the reference corpus did, every one of them with zero
    attempts on its evidence. Hard constraint 3 requires the requests attempted.

    Reusing `Located<T>` rather than inventing a parallel record is deliberate: it already carries
    the attempts and, since D-181, the `obstructed` flag that says which party failed. Two shapes
    for one relation are two things free to disagree.
  */
  readonly terms: Located<PageContext>;
  readonly shipping: Located<PageContext>;
  readonly faq: Located<PageContext>;
  readonly payment: Located<PageContext>;
  /**
   * The page a storefront wrote about itself (D-271).
   *
   * Angle 1's subject in the merchant's own words. Rendered like the other four and, unlike them,
   * also read by the `all_sampled` product rules — a lifestyle claim is a lifestyle claim wherever
   * the site makes it, and the about page is where it is made in prose rather than in a spec table.
   */
  readonly about: Located<PageContext>;
  /**
   * The editorial pages this run read, up to eight (D-274).
   *
   * A FAQ, a blog, an article, a quality promise — prose a storefront publishes to be read. They
   * join `all_sampled`, so the product rules read them, and they go to the eye test as their own
   * captures. Empty on a storefront that publishes none, which is most of them.
   */
  readonly editorial: readonly PageContext[];
  /**
   * Every page type the vertical's documents list asked for, located or not (D-284).
   *
   * Empty for peptides, whose surfaces are the named fields above. An adult AI crawl fills it from
   * its vertical's `documents`, and `terms` above is the same entry as `pageTypes.get('terms')`.
   */
  readonly pageTypes: ReadonlyMap<string, Located<PageContext>>;
  /**
   * Every page established for each page type, in the order read (cluster 2 commit 3).
   *
   * `pageTypes` holds the first, which is what a `text_match` rule reads; a `dom_feature` rule reads
   * them all. The docs host's pages are appended to `docs`. Empty for peptides.
   */
  readonly pagesByType: ReadonlyMap<string, readonly PageContext[]>;
  /**
   * The docs host read as a second origin, where the vertical enables one and the primary site
   * linked one (cluster 2). Absent otherwise — always absent on a peptide run.
   */
  readonly docsOrigin?: {
    readonly origin: string;
    /** Every docs page established on it, in the order read. */
    readonly pages: readonly PageContext[];
  };
  /** Every navigation made looking for any of them, and what it returned. */
  readonly attempts: readonly FetchAttempt[];
  readonly artifacts: readonly EvidenceArtifact[];
  /**
   * Every page this pass actually rendered, in the order it rendered them (D-264).
   *
   * Carried out for the challenge count, which needs a denominator covering the whole crawl rather
   * than the homepage and the product sample alone. Most of these are conventional paths that
   * returned a themed 404 and are established as nothing; a page's presence here says only that a
   * navigation happened, never that a surface was found.
   */
  readonly pages: readonly PageContext[];
  /**
   * Candidates the cheap probe could not decide on, and how many it saw in total (D-182).
   *
   * Carried out rather than swallowed. `undecided` renders, so a probe layer failing on every
   * request behaves exactly like one where every path answered — same findings, same cost — and
   * would be invisible without a count.
   */
  readonly probe: { readonly undecided: number; readonly total: number };
}

export interface DiscoverOptions {
  readonly runId: string;
  readonly pacer: Pacer;
  /**
   * The crawl's shared anonymous context (D-267).
   *
   * Passed through so a consent gate this pass meets is the *same* gate the homepage already went
   * through, rather than a second submission of a merchant's form. Optional, because a caller with
   * no shared context is still correct — it simply pays the pass again.
   */
  /**
   * Every URL Layer 0 obtained from the sitemaps (D-274).
   *
   * The second source of candidates for the surfaces that are found rather than guessed. A
   * storefront that publishes a page links to it or lists it, and this is the listing half.
   */
  readonly sitemapUrls?: readonly string[];
  /**
   * Puts a set of candidate URLs in the order they should be read (D-274).
   *
   * Supplied by the caller because ranking by suspicion needs the rule set, and this module holds
   * no rule knowledge (hard constraint 1). Absent, the order is the order they were found — which
   * is correct for every surface that renders one page, and only matters for editorial.
   */
  readonly rankCandidates?: (urls: readonly string[]) => readonly string[];
  readonly context?: BrowserContext;
  /** The run's cancellation, checked before every candidate and passed to every render (D-281). */
  readonly signal?: AbortSignal;
  /** True when the crawl has already entered a gate on `context` (D-267). */
  readonly alreadyEnteredGate?: boolean;
  /** Called when a render here submitted a gate, so the caller can stop re-passing it. */
  readonly onEnteredGate?: (description: string) => void;
  readonly timeoutMs?: number;
  /**
   * Links seen on the rendered homepage, used to find the linked surfaces.
   *
   * `inNav` and `inFooter` arrived with D-271: an about page is located by exact link text *in the
   * chrome*, because the same words in body copy are a blog post. Optional so a caller that has
   * only href and text still works — it simply locates no surface that asks for the chrome.
   */
  readonly homepageLinks?: readonly {
    readonly href: string;
    readonly text: string;
    readonly inNav?: boolean;
    readonly inFooter?: boolean;
  }[];
  /**
   * Progress within the surfaces phase (D-173).
   *
   * The optional count is `done of total` over the **surfaces**, one level only — the sign-up form
   * plus the four documents. Not per-path depth: how many candidate URLs a surface will try is an
   * implementation detail of that surface, and a counter that moved by paths would run at a rate
   * nobody could read while telling a reader nothing about how much of the crawl is left.
   */
  readonly onProgress?: (line: string, count?: { readonly done: number; readonly total: number }) => void;
  /**
   * The vertical's page types (D-284).
   *
   * Absent or without `documents`: the peptide pass below, exactly as it was. With `documents`: the
   * sign-up form, then each listed page type, located through the vertical's own table.
   */
  readonly pages?: VerticalPages;
  /**
   * What reading a docs host needs, where the vertical enables it (cluster 2): the fetcher Layer 0
   * used, for its sitemap and `llms.txt`, and the page cap the primary origin's sample runs under.
   * Absent: no docs host is read, whatever the vertical says.
   */
  readonly secondOrigin?: { readonly fetcher: Fetcher; readonly pageCap: number };
  /**
   * The origin the homepage was actually served from (cluster 4 commit 3a).
   *
   * A scan queued as `https://xchar.ai` is served from `https://www.xchar.ai`, and every link on the
   * site and every sitemap entry carries the served origin. Page-type discovery reads candidates on
   * this origin; the peptide pass is unchanged and does not read it.
   */
  readonly servedOrigin?: string;
}

/**
 * Finds the sign-up form and the terms document, or records why neither was reached.
 *
 * Stops at the first candidate that yields what it is looking for. The remaining candidates are
 * not tried, and the attempts list says exactly which were made — a reader must not infer that a
 * path was absent when it was simply never requested.
 */
export async function discoverLayer3(
  browser: Browser,
  origin: string,
  options: DiscoverOptions,
): Promise<Layer3Discovery> {
  const say = options.onProgress ?? ((): void => undefined);
  const attempts: FetchAttempt[] = [];
  const artifacts: EvidenceArtifact[] = [];
  const pages: PageContext[] = [];

  const byPageType = options.pages?.documents;
  if (options.pages !== undefined && byPageType !== undefined) {
    return discoverPageTypes(browser, origin, options, options.pages, byPageType, {
      attempts,
      artifacts,
      pages,
      say,
    });
  }

  /*
    The four documents as a table, so the denominator is structural (D-173).

    They were four hand-written calls, which meant the surface count a progress line would report
    had to be a literal `5` maintained beside them. A surface added here now moves the denominator
    with it, and a denominator that can fall out of step with the work is the one this model must
    not have.
  */
  const documents = [
    { label: 'terms document', paths: TERMS_PATHS, linkHints: TERMS_LINK_HINTS },
    { label: 'shipping policy', paths: SHIPPING_PATHS, linkHints: SHIPPING_LINK_HINTS },
    { label: 'FAQ', paths: FAQ_PATHS, linkHints: FAQ_LINK_HINTS },
    { label: 'payment or refund policy', paths: PAYMENT_PATHS, linkHints: PAYMENT_LINK_HINTS },
    /*
      The about page (D-271).

      Last, because it is the newest and because the four above answer angles that decide routing
      while this one answers angle 1 — what the business says it is. `linkHints` is empty: this
      surface is located by exact link text in the chrome, not by a substring of an href.
    */
    {
      label: 'about page',
      paths: [],
      linkHints: [],
      linkTexts: ABOUT_LINK_TEXTS,
      surface: 'about',
    },
    /*
      Editorial, last and capped (D-274).

      Located the same way the about page is — chrome links and the sitemap, no guesses — and unlike
      every other surface here it renders more than one page. `limit` is what makes it a sample
      rather than an archive.
    */
    {
      label: 'editorial page',
      paths: [],
      linkHints: [],
      linkTexts: EDITORIAL_LINK_TEXTS,
      surface: 'editorial',
      limit: MAX_EDITORIAL_PAGES,
    },
  ] as const;

  const total = documents.length + 1; // the sign-up form is the first of them
  let done = 0;

  /** Announces the surface about to be read, with how many of them are behind it. */
  const step = (label: string): void => {
    say(`looking for the ${label}`, { done, total });
  };

  step('sign-up form');
  const signupFound = await findSignupForm(browser, origin, options, attempts, artifacts, pages, say);
  const signup = signupFound.form;
  done += 1;

  const probe = { undecided: 0, total: 0 };
  const found = new Map<string, Located<PageContext>>();
  /** Every page each surface established, for the surfaces that yield more than one (D-274). */
  const established = new Map<string, readonly PageContext[]>();
  for (const what of documents) {
    options.signal?.throwIfAborted();
    step(what.label);
    const outcome = await findDocument(
      browser, origin, options, attempts, artifacts, pages, say, what, probe,
    );
    found.set(what.label, outcome.located);
    established.set(what.label, outcome.pages);
    done += 1;
  }
  say('policy pages read', { done, total });


  const surface = (label: string): Located<PageContext> =>
    found.get(label) ?? unreachable(`the ${label} was not looked for`, []);

  return {
    signup,
    ...(signupFound.page === undefined ? {} : { signupPage: signupFound.page }),
    terms: surface('terms document'),
    shipping: surface('shipping policy'),
    faq: surface('FAQ'),
    payment: surface('payment or refund policy'),
    about: surface('about page'),
    // Every editorial page, not the first, and the FAQ ahead of them (D-274).
    editorial: editorialSample(established.get('FAQ') ?? [], established.get('editorial page') ?? []),
    pageTypes: new Map(),
    pagesByType: new Map(),
    attempts,
    artifacts,
    pages,
    probe,
  };
}

/**
 * The Layer 3 pass for a vertical that names its documents by page type (D-284).
 *
 * The sign-up form first, as for peptides, then each page type in the vertical's order through the
 * same `findDocument` — the same probe, the same guards, the same attempts on every miss. Only the
 * candidate sources differ: a page type is found by the homepage links and sitemap entries its
 * vertical's table classifies as that type, ranked by table order where the vertical asks, then by
 * any conventional paths it lists.
 *
 * The peptide surfaces this vertical does not read are reported as not looked for, with no attempts:
 * no rule in its rule set reads them, and nothing claims they were searched.
 */
async function discoverPageTypes(
  browser: Browser,
  origin: string,
  options: DiscoverOptions,
  vertical: VerticalPages,
  documents: readonly PageTypeDocument[],
  sinks: {
    readonly attempts: FetchAttempt[];
    readonly artifacts: EvidenceArtifact[];
    readonly pages: PageContext[];
    readonly say: (line: string, count?: { readonly done: number; readonly total: number }) => void;
  },
): Promise<Layer3Discovery> {
  const { attempts, artifacts, pages, say } = sinks;
  const total = documents.length + 1;
  let done = 0;

  say('looking for the sign-up form', { done, total });
  const signupFound = await findSignupForm(browser, origin, options, attempts, artifacts, pages, say);
  done += 1;

  /*
    The site's own origin, as the homepage was served (commit 3a). Run 6571d6a9 was queued as
    xchar.ai and served from www.xchar.ai: every link and sitemap entry carried www, the candidate
    filter compared them with the apex, and every page type but terms came back "no candidate paths".
  */
  const site = options.servedOrigin ?? origin;

  /*
    Candidate links from every page established so far (commit 3a), not the homepage alone. A site
    that links its removal policy only in an inner page's footer is a site that links it. The homepage
    contributes every link it carries, as before; an established page contributes its nav and footer.
  */
  const pool: ChromeLink[] = [...(options.homepageLinks ?? [])];

  const probe = { undecided: 0, total: 0 };
  const located = new Map<string, Located<PageContext>>();
  const pagesByType = new Map<string, PageContext[]>();
  for (const document of documents) {
    options.signal?.throwIfAborted();
    say(`looking for the ${document.label}`, { done, total });
    const outcome = await findDocument(
      browser,
      site,
      { ...options, homepageLinks: [...pool] },
      attempts,
      artifacts,
      pages,
      say,
      {
        label: document.label,
        paths: document.paths,
        linkHints: [],
        surface: document.pageType,
        ...(document.limit === undefined ? {} : { limit: document.limit }),
        table: vertical.table,
        rankByPageTypeOrder: vertical.rankByPageTypeOrder,
        // The page type's own slugs, as its path would carry them (`character/new` as written).
        pathNames: vertical.table.filter(([, type]) => type === document.pageType).map(([slug]) => slug),
      },
      probe,
    );
    located.set(document.pageType, outcome.located);
    pagesByType.set(document.pageType, [...outcome.pages]);
    pool.push(...chromeLinksOf(outcome.pages));
    done += 1;
  }
  say('policy pages read', { done, total });

  const docs = await readDocsOrigin(browser, origin, options, vertical, sinks, probe);
  if (docs !== undefined && docs.pages.length > 0) {
    const primaryDocs = located.get('docs');
    if (primaryDocs === undefined || !primaryDocs.located) {
      located.set('docs', docs.first);
    }
    pagesByType.set('docs', [...(pagesByType.get('docs') ?? []), ...docs.pages]);
  }

  const notRead = (label: string): Located<PageContext> =>
    unreachable(`the ${label} is not read by this vertical's crawl`, []);

  return {
    signup: signupFound.form,
    ...(signupFound.page === undefined ? {} : { signupPage: signupFound.page }),
    terms: located.get('terms') ?? notRead('terms document'),
    shipping: notRead('shipping policy'),
    faq: notRead('FAQ'),
    payment: notRead('payment or refund policy'),
    about: notRead('about page'),
    editorial: [],
    pageTypes: located,
    pagesByType,
    ...(docs === undefined ? {} : { docsOrigin: { origin: docs.origin, pages: docs.pages } }),
    attempts,
    artifacts,
    pages,
    probe,
  };
}

async function findSignupForm(
  browser: Browser,
  origin: string,
  options: DiscoverOptions,
  attempts: FetchAttempt[],
  artifacts: EvidenceArtifact[],
  /** Every page rendered here, whether or not it yielded a form (D-264). */
  pages: PageContext[],
  say: (line: string) => void,
): Promise<{ readonly form: SignupForm; readonly page?: PageContext }> {
  // The most informative thing seen while looking. A page that carried a sign-in form but no
  // account-creation form says something quite different from nothing being found at all, and
  // the finding should carry whichever actually happened.
  let closest = '';

  for (const path of REGISTER_PATHS) {
    options.signal?.throwIfAborted();
    const url = `${origin}${path}`;
    /*
      One visit, not two (D-155).

      This used to render the page and then navigate to it a second time to read the form, which
      doubled the cost of the whole sign-up probe. `readSignupForm` reads it out of the page that
      is already open, in the same visit — so the form, the DOM snapshot and the screenshot all
      describe one state of one page rather than three fetches that might differ.

      The capture is kept only for the page that actually yields a form. The rest are conventional
      paths that returned a themed 404, and a screenshot of one is not evidence of anything.
    */
    const rendered = await renderPage(browser, url, {
      runId: options.runId,
      pacer: options.pacer,
      timeoutMs: options.timeoutMs ?? 30_000,
      idleMs: PROBE_IDLE_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      readSignupForm: true,
      ...gatePassOptions(options),
      keepCapture: (candidate) =>
        candidate.renderError === undefined &&
        candidate.httpStatus >= 200 &&
        candidate.httpStatus < 400,
    });
    artifacts.push(...rendered.artifacts);
    pages.push(rendered.page);

    const page = rendered.page;
    if (page.renderError !== undefined) {
      attempts.push({ url, status: 0, error: page.renderError });
      continue;
    }

    attempts.push({ url, status: page.httpStatus });
    if (page.httpStatus < 200 || page.httpStatus >= 400) continue;

    const raw = rendered.signupForm;
    if (raw === undefined) continue;
    if (!raw.found) {
      if (raw.candidateForms > 0) closest = `${page.finalUrl} — ${raw.locatedBy}`;
      continue;
    }

    say(`  sign-up form located at ${page.finalUrl} · ${raw.fields.length} field(s)`);
    /*
      The page travels out beside the form (D-198).

      The eye test asks how the entry gate *reads*, which needs the picture; `SignupForm` describes
      the fields and carries no capture key. Returned rather than re-derived, because this is the
      only place that knows which of the candidate paths was the one that yielded a form.
    */
    return {
      form: {
        found: true,
        locatedBy: raw.locatedBy,
        url: page.finalUrl,
        fields: raw.fields,
        candidateForms: raw.candidateForms,
      },
      page,
    };
  }

  say(
    closest === ''
      ? `  no sign-up form reached · ${attempts.length} path(s) tried`
      : `  no sign-up form reached · closest: ${closest}`,
  );
  return { form: closest === '' ? NO_SIGNUP_FORM : { ...NO_SIGNUP_FORM, locatedBy: closest } };
}

/**
 * The editorial sample a run reads, FAQ first (D-274).
 *
 * `editorial` is the one surface that yields a set: the question it answers is *how does this site
 * write*, and one blog post is an anecdote. So the surface renders up to `MAX_EDITORIAL_PAGES` and
 * what the rules read is the list, not its first entry.
 *
 * The FAQ leads it, and comes from the surface that already read it rather than a second render. A
 * FAQ carrying dosing guidance is the clearest single signal angle 1 has, and suspicion ranking is
 * the wrong question for it: it must not fall off the end of the cap because its slug tripped no
 * rule. It cannot arrive as an editorial candidate on its own, because `surfaceFromSlug` labels it
 * `faq` — COMM-001 reads that document specifically and relabelling it would take a rule's subject
 * away from it. It keeps its surface and joins the list here, which is what puts it in
 * `all_sampled` and in front of the eye test.
 */
export function editorialSample(
  faq: readonly PageContext[],
  editorial: readonly PageContext[],
): readonly PageContext[] {
  return [...faq, ...editorial].slice(0, MAX_EDITORIAL_PAGES);
}

/**
 * The sitemap entries that name a surface (D-274).
 *
 * The listing half of the candidate sources, and pure for the same reason `selectLinkedCandidates`
 * is: it is the part worth testing against a real sitemap, and it needs no browser to do it.
 *
 * The surface is decided by `surfaceFromSlug` — the page selector's own table — so the two doors
 * cannot disagree about what an about page is. An entry that names no surface is somebody else's
 * page, and an entry on another origin is somebody else's site.
 */
export function selectListedCandidates(
  sitemapUrls: readonly string[],
  origin: string,
  surface: string | undefined,
  /** The vertical's page-type table (D-284). Absent, the peptide one. */
  table?: PageTypeTable,
): readonly string[] {
  if (surface === undefined) return [];
  return sitemapUrls.filter((url) => url.startsWith(origin) && surfaceFromSlug(url, table) === surface);
}

/**
 * The homepage links a surface will follow, and how many it declined to (D-155).
 *
 * Pure, and separated from the fetching loop so the cap can be tested without a browser. Deduped
 * before the slice, so the budget counts distinct pages rather than the same policy link appearing
 * in a header and a footer.
 */
export function selectLinkedCandidates(
  homepageLinks: readonly {
    readonly href: string;
    readonly text: string;
    readonly inNav?: boolean;
    readonly inFooter?: boolean;
  }[],
  linkHints: readonly string[],
  origin: string,
  /**
   * A surface located by where a link sits and what it says, with the **href deciding** (D-271).
   *
   * A second, stricter door into the same candidate list, and the two halves do different jobs.
   *
   * **The href decides the surface**, through `surfaceFromSlug` — the page selector's own table, so
   * the crawler looks for exactly the pages the selector knows how to label. That is what refuses
   * `/about-our-return-policy`, which carries an about token and a policy token and is a policy
   * page: the selector's band ordering already ruled on it (D-270), and this reads that ruling
   * rather than re-deciding it. A second definition of *what an about page is* would be two answers
   * to one question (D-181).
   *
   * **The text and the chrome decide whether to look at all.** A link is a candidate when it sits
   * in the nav or the footer — where a site links the page it wrote about itself — or when its text
   * is one of the phrases outright. CoMo needs both halves: *About Us* and *About Como Peptides*
   * are in the chrome and say different things, and *Read Our Story →* says the phrase from body
   * copy. All three point at `/about-us/`.
   *
   * Deduped with the hint matches by the same `Set`, so a link satisfying both is one candidate
   * rather than two renders of one page.
   */
  linkTexts: readonly string[] = [],
  /** The surface `surfaceFromSlug` must agree the href names, when `linkTexts` is in play. */
  surface?: string,
  /**
   * A vertical whose page types are decided by the href alone (D-284).
   *
   * With a table, any homepage link whose href the table classifies as `surface` is a candidate,
   * wherever it sits — the merchant linking the page is the merchant telling us it exists. Absent,
   * the peptide doors above, unchanged.
   */
  table?: PageTypeTable,
): { readonly followed: readonly string[]; readonly dropped: number; readonly matched: number } {
  const wanted = new Set(linkTexts.map((text) => text.toLowerCase()));

  /** Trailing punctuation and lead-in verbs are chrome, not text: "Read Our Story →" is "our story". */
  const said = (text: string): string =>
    text
      .toLowerCase()
      .replace(/^(read|see|learn|view)\s+(more\s+)?/, '')
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const namesTheSurface = (link: {
    readonly href: string;
    readonly text: string;
    readonly inNav?: boolean;
    readonly inFooter?: boolean;
  }): boolean => {
    if (wanted.size === 0 || surface === undefined) return false;
    if (surfaceFromSlug(link.href) !== surface) return false;
    return link.inNav === true || link.inFooter === true || wanted.has(said(link.text));
  };
  /*
    Deduped on the URL a request would actually carry (D-219).

    A fragment never leaves the browser, so `/about/#how-quickly` and `/about/` are one candidate.
    Deduping on the raw href kept both — a second full page render of a page already rendered, and
    a finding whose "requests attempted" listed a URL nothing ever asked for.

    Matching still reads the href **with** its fragment, because a fragment is often where the link
    text lives: `#shipping` on an anchor labelled "Delivery" is exactly the signal these hints look
    for. What is stripped is what gets requested, not what gets matched.
  */
  const distinct = [
    ...new Set(
      homepageLinks
        .filter((link) => {
          const haystack = `${link.href} ${link.text}`.toLowerCase();
          if (table !== undefined && surface !== undefined && surfaceFromSlug(link.href, table) === surface) {
            return true;
          }
          return linkHints.some((hint) => haystack.includes(hint)) || namesTheSurface(link);
        })
        .map((link) => withoutFragment(link.href)),
    ),
  ].filter((url) => url.startsWith(origin));

  const followed = distinct.slice(0, MAX_LINKED_CANDIDATES);
  return { followed, dropped: distinct.length - followed.length, matched: distinct.length };
}

/**
 * Finds one published document, or records why it was not reached.
 *
 * One function for terms, shipping policy and FAQ (D-049): they differ only in which paths and
 * link hints to try, and three copies would be three places for the redirect guard below to be
 * got wrong.
 */
async function findDocument(
  browser: Browser,
  origin: string,
  options: DiscoverOptions,
  attempts: FetchAttempt[],
  artifacts: EvidenceArtifact[],
  /** Every page rendered here, whether or not it was established as the document (D-264). */
  pages: PageContext[],
  say: (line: string) => void,
  what: {
    readonly label: string;
    readonly paths: readonly string[];
    readonly linkHints: readonly string[];
    /** Link text or chrome placement, for a surface a substring hint would over-match (D-271). */
    readonly linkTexts?: readonly string[];
    /** The surface name the href must resolve to, read from the page selector's table (D-271). */
    readonly surface?: string;
    /** How many pages of this surface one run reads. Absent means one (D-271). */
    readonly limit?: number;
    /** The vertical's page-type table, where it is not the peptide one (D-284). */
    readonly table?: PageTypeTable;
    /** Read candidates in the order of the table entry that classified them (D-284). */
    readonly rankByPageTypeOrder?: boolean;
    /**
     * What the located page's own path must contain, where it is not `linkHints` (D-284).
     *
     * `establishDocument` refuses a page whose path names none of these, and an empty list names
     * nothing — so a page type found by its table alone passes its table's slugs here.
     */
    readonly pathNames?: readonly string[];
    /**
     * The candidates, given outright rather than found from the homepage links and sitemap
     * (cluster 2). The docs host's pages come from its own sitemap and `llms.txt`.
     */
    readonly candidates?: readonly string[];
  },
  probeTally: { undecided: number; total: number },
): Promise<{ readonly located: Located<PageContext>; readonly pages: readonly PageContext[] }> {
  /*
    This surface's own attempts, kept separately from the run-wide list (D-182).

    The shared `attempts` array feeds `describeObstruction`, which is a run-level summary. A
    *finding* needs the requests made for *its* surface — six URLs, each with its status — and
    filtering the run-wide list by surface afterwards would be a second derivation of a fact this
    loop already knows.
  */
  const mine: FetchAttempt[] = [];
  const record = (attempt: FetchAttempt): void => {
    mine.push(attempt);
    attempts.push(attempt);
  };

  /**
   * Every page of this surface that was established, in the order they were read (D-271).
   *
   * One entry for every surface but editorial, which reads up to its `limit`. `first` is what the
   * existing four callers consume, unchanged: a `Located<PageContext>` naming the page and how it
   * was identified.
   */
  const establishedPages: PageContext[] = [];
  let first: Located<PageContext> | null = null;

  /** Set when a candidate answered but could not be turned into a page we could read (D-156). */
  let obstructed = false;
  /** The marker from the first candidate bot protection answered, if any (D-265). */
  let challenged: string | undefined;
  /** The first candidate the merchant's own consent gate stood in front of, if any (D-266). */
  let gated: string | undefined;
  /*
    Every guard now lives in `establishDocument` (D-054).

    This function chooses candidates and fetches them. It does not decide whether what came back
    is the document — six instances of one defect were six call sites each deciding that for
    itself, and the fix for one never reached the next.
  */
  const spec: SurfaceSpec = { label: what.label, pathNames: [...(what.pathNames ?? what.linkHints)] };

  // A link on the homepage is how a visitor actually reaches the document, and it survives themes
  // that spell the path their own way. The path still has to name the surface — `establishDocument`
  // enforces that, so a "Return to shop" link cannot select `/shop/`.
  // Capped, and the cap is recorded when it bites (D-155).
  const { followed: linked, dropped, matched: distinct } = selectLinkedCandidates(
    options.homepageLinks ?? [],
    what.linkHints,
    origin,
    what.linkTexts ?? [],
    what.surface,
    what.table,
  );

  if (dropped > 0) {
    const line =
      `${what.label}: ${distinct} homepage links matched this surface; the first ` +
      `${MAX_LINKED_CANDIDATES} were followed and ${dropped} were not requested`;
    attempts.push({ url: origin, status: 0, error: line });
    say(`  ${line}`);
  }

  /*
    The sitemap, as the second source (D-274).

    Filtered by the same `surfaceFromSlug` the link door uses, so the crawler looks for exactly the
    pages the page selector knows how to label — one definition, two sources. A sitemap entry that
    names no surface is somebody else's page.
  */
  const listed = selectListedCandidates(options.sitemapUrls ?? [], origin, what.surface, what.table);

  const found = what.candidates !== undefined ? [...new Set(what.candidates)] : [...new Set([...linked, ...listed])];
  // Candidates given outright are already in the order to read them: they are not re-ranked.
  const ordered =
    what.candidates !== undefined
      ? found
      : what.rankByPageTypeOrder === true && what.table !== undefined
      ? rankByTableEntry(found, what.table)
      : options.rankCandidates === undefined
        ? found
        : [...options.rankCandidates(found)];

  const limit = what.limit ?? Infinity;
  const candidates = [
    ...new Set([...ordered, ...what.paths.map((path) => `${origin}${path}`)]),
  ];

  /*
    What the cap left, declared rather than dropped (D-076).

    A surface that read eight of nineteen pages and said nothing would give a reader a sample with
    no denominator.
  */
  if (candidates.length > limit) {
    const line =
      `${what.label}: ${candidates.length} candidate(s) were found and the first ${limit} were ` +
      `read; ${candidates.length - limit} were not requested`;
    attempts.push({ url: origin, status: 0, error: line });
    say(`  ${line}`);
  }

  for (const url of candidates) {
    options.signal?.throwIfAborted();
    if (!url.startsWith(origin)) continue;

    /*
      Ask the origin before spending a render (D-182).

      Most candidates here are guesses at conventional paths and most are wrong; on comopeptides 22
      of 24 renders were discarded. A status-only request answers "does this path exist" for a
      fraction of the cost, and `probeSurface` is deliberately unable to conclude anything else.

      `undecided` renders. The probe observing nothing is not the origin saying a path is absent,
      and a cheap check must never turn a reachable surface into a miss.
    */
    probeTally.total += 1;
    const probe = await probeSurface(url, { pacer: options.pacer });

    if (probe.verdict === 'rejected') {
      // The origin's own answer about this path, recorded as the status it actually returned.
      record({ url, status: probe.status, error: `the origin answered HTTP ${probe.status}` });
      continue;
    }

    if (probe.verdict === 'undecided') {
      probeTally.undecided += 1;
      say(`  the probe could not decide on ${url} (${probe.error ?? 'no reason given'}); rendering it`);
    }

    /*
      Rendered as a probe, not as evidence (D-155).

      The short idle wait and the deferred capture both follow from what this loop is: a guess at a
      conventional path, wrong most of the time. `keepCapture` runs `establishDocument` on the page
      before the screenshot is taken, so a themed 404 at a path the merchant never used costs a
      render and not a capture. The candidate that *is* located is screenshotted on this same
      visit — one fetch, so the capture shows the text the checks read.
    */
    const rendered = await renderPage(browser, url, {
      runId: options.runId,
      pacer: options.pacer,
      timeoutMs: options.timeoutMs ?? 30_000,
      idleMs: PROBE_IDLE_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      keepCapture: (page) => establishDocument(url, page, spec, []).located,
      ...gatePassOptions(options),
    });
    artifacts.push(...rendered.artifacts);
    pages.push(rendered.page);

    const outcome = establishDocument(url, rendered.page, spec, []);
    if (!outcome.located) {
      const renderFailed = rendered.page.renderError !== undefined;

      /*
        Which party fell short on this candidate — **read, not re-derived** (D-216, D-265).

        This was `renderFailed && probe.verdict === 'answered'`, computed here, beside an
        `establishDocument` call that had already asked the same question of the same page and
        answered it more carefully. Two derivations of one fact, and they disagreed exactly the
        way D-216 says they do. Everything the local rule missed fell through to `not_exposed` —
        *the merchant does not publish this page* — a claim about the merchant made from a request
        the merchant never answered.

        What the local rule missed:

          - **A candidate that refused us.** A `403`, `401`, `429` or `5xx` is *you may not read
            this*, and establishes nothing about whether the page exists. **This is where every
            real instance came from**: eighteen findings across six runs rest on a refusal, every
            one of them a `403`, every one filed as the merchant publishing nothing.
          - **A render that threw where the probe could not decide.** The probe's opinion about
            whether a path exists says nothing about whose failure a thrown render was. Making
            "ours" conditional on a different question is the conflation D-044 and D-181 name.
          - **Bot protection.** Its own kind, because the operator's next move differs (D-264).

        `establishDocument` answers all three, because it is where the guards live (D-054), and
        its flag had no reader until now. A `404`, a `410` and a `200` that failed a content guard
        still leave both alone: those are the origin answering, and the answer is about the
        merchant.
      */
      if (outcome.gated !== undefined) gated ??= outcome.gated;
      else if (outcome.challenged !== undefined) challenged ??= outcome.challenged;
      else if (outcome.obstructed === true) obstructed = true;

      record({
        url,
        // The probe's status is a real one and survives a failed render, which used to zero it.
        status: renderFailed ? probe.status : rendered.page.httpStatus,
        error: renderFailed ? (rendered.page.renderError as string) : outcome.reason,
      });
      continue;
    }

    record({ url, status: rendered.page.httpStatus });
    say(`  ${what.label} located at ${outcome.how}`);
    establishedPages.push(outcome.value);
    if (first === null) first = located(outcome.value, outcome.url, outcome.how);

    /*
      One page is enough for every surface but editorial (D-274).

      The four policy surfaces are singular by nature — a storefront has one terms page — so they
      stop here exactly as they did. Editorial declares a `limit` and keeps going until it has that
      many, because the question there is *how does this site write*, and one blog post is an
      anecdote.
    */
    if (establishedPages.length >= limit) {
      return { located: first, pages: establishedPages };
    }
  }

  if (first !== null) return { located: first, pages: establishedPages };

  say(`  no ${what.label} reached`);
  return {
    located: unreachable(
      `no ${what.label} was reached: ${describeCandidates(mine)}`,
      mine,
      obstructed,
      challenged,
      gated,
    ),
    pages: [],
  };
}

/**
 * The context and gate settings a render here inherits from the crawl (D-267).
 *
 * One helper rather than two spread literals, because the two call sites in this module must agree:
 * a policy-page render that built its own context would meet a gate the homepage had already been
 * through and submit the merchant's form a second time.
 */
function gatePassOptions(options: DiscoverOptions): {
  readonly context?: BrowserContext;
  readonly alreadyEnteredGate?: boolean;
  readonly onEnteredGate?: (description: string) => void;
} {
  return {
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.alreadyEnteredGate === undefined
      ? {}
      : { alreadyEnteredGate: options.alreadyEnteredGate }),
    ...(options.onEnteredGate === undefined ? {} : { onEnteredGate: options.onEnteredGate }),
  };
}

/** What the loop tried, in one clause, for a reason a reader can check against the attempts. */
function describeCandidates(attempts: readonly FetchAttempt[]): string {
  if (attempts.length === 0) return 'no candidate paths were available to try';
  const answered = attempts.filter((a) => a.status >= 200 && a.status < 300).length;
  return answered === 0
    ? `none of the ${attempts.length} path(s) tried was served`
    : `${answered} of the ${attempts.length} path(s) tried was served but could not be read as one`;
}

/**
 * Candidates in the order of the table entry that classified each (D-284).
 *
 * Stable, so candidates classified by the same entry keep the order they were found in. What makes a
 * page named by a terms slug read ahead of one named only by a policy slug, when both are linked.
 */
export function rankByTableEntry(urls: readonly string[], table: PageTypeTable): readonly string[] {
  const rank = (url: string): number => pageTypeEntry(url, table) ?? Infinity;
  return urls
    .map((url, index) => ({ url, index, rank: rank(url) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.url);
}

/**
 * The docs host, read as the one additional origin a run may have (cluster 2).
 *
 * Only where the vertical enables it and the primary site's nav or footer links one
 * (`docsOriginFor`). Its sitemap is read by Layer 0's own discovery, unchanged, and its `/llms.txt` as a
 * plain URL list; the linked page leads, then `llms.txt`'s URLs, then the sitemap's. Pages are rendered
 * through `findDocument` like every other Layer 3 page — the same probe, guards and attempts — under
 * the run's pacer, up to the page cap the primary origin's sample runs under.
 *
 * Every page on the docs host is a docs page: the host names the surface, so the path guard is given
 * `/`, which every path carries.
 */
async function readDocsOrigin(
  browser: Browser,
  primaryOrigin: string,
  options: DiscoverOptions,
  vertical: VerticalPages,
  sinks: {
    readonly attempts: FetchAttempt[];
    readonly artifacts: EvidenceArtifact[];
    readonly pages: PageContext[];
    readonly say: (line: string, count?: { readonly done: number; readonly total: number }) => void;
  },
  probe: { undecided: number; total: number },
): Promise<{ readonly origin: string; readonly first: Located<PageContext>; readonly pages: readonly PageContext[] } | undefined> {
  if (options.secondOrigin === undefined) return undefined;
  const links = options.homepageLinks ?? [];
  const docsOrigin = docsOriginFor(vertical, primaryOrigin, links);
  if (docsOrigin === null) return undefined;

  const { fetcher, pageCap } = options.secondOrigin;
  const { attempts, artifacts, pages, say } = sinks;
  options.signal?.throwIfAborted();
  say(`reading the docs host ${new URL(docsOrigin).host}`);

  // Its sitemap, by the same discovery the primary origin's went through.
  const layer0 = await discoverLayer0(docsOrigin, fetcher, { runId: options.runId });
  artifacts.push(...layer0.artifacts);
  attempts.push(...layer0.attempts);
  const fromSitemap = layer0.urls
    .map((slug) => slug.url)
    .filter((url) => {
      try {
        return new URL(url).origin === docsOrigin;
      } catch {
        return false;
      }
    });

  // `llms.txt`, as text. A file that is not served, or that bot protection answered, lists nothing.
  const llmsUrl = `${docsOrigin}/llms.txt`;
  const llms = await fetcher(llmsUrl);
  attempts.push({
    url: llmsUrl,
    status: llms.status,
    ...(llms.error === undefined ? {} : { error: llms.error }),
  });
  const fromLlms =
    llms.status >= 200 && llms.status < 300 && llms.challenged === undefined ? llmsTxtUrls(llms.body, docsOrigin) : [];

  const linked = links
    .map((link) => withoutFragment(link.href))
    .filter((href) => {
      try {
        return new URL(href).origin === docsOrigin;
      } catch {
        return false;
      }
    });

  /*
    The docs host's own Crawl-delay, where it asks for more than the primary's (cluster 2 commit 2a).
    Its robots.txt was read by the Layer 0 pass above.
  */
  const pacer = docsPacerFor(options.pacer, layer0.robots.crawlDelaySeconds);
  if (pacer !== options.pacer) {
    say(`  the docs host asks for a longer crawl delay; its requests are paced at ${pacer.delay.effectiveMs} ms`);
  }

  const candidates = [...new Set([...linked, ...fromLlms, ...fromSitemap])];
  const outcome = await findDocument(
    browser,
    docsOrigin,
    { ...options, pacer },
    attempts,
    artifacts,
    pages,
    say,
    {
      label: 'documentation page',
      paths: [],
      linkHints: [],
      pathNames: ['/'],
      limit: pageCap,
      candidates,
    },
    probe,
  );

  // What the docs read covered, in the attempts whatever it was: a read that stopped at the cap is
  // visible as one (D-076).
  attempts.push({
    url: docsOrigin,
    status: 0,
    error:
      `docs host ${new URL(docsOrigin).host}: ${outcome.pages.length} page(s) read of ` +
      `${candidates.length} candidate(s); the cap is ${pageCap}` +
      (candidates.length > pageCap ? `, so ${candidates.length - pageCap} or more were not requested` : ''),
  });

  return { origin: docsOrigin, first: outcome.located, pages: outcome.pages };
}

/** A link as discovery reads it: where it points, what it says, and whether it sits in the chrome. */
export interface ChromeLink {
  readonly href: string;
  readonly text: string;
  readonly inNav?: boolean;
  readonly inFooter?: boolean;
}

/**
 * The nav and footer links of pages already established, as candidate sources (commit 3a).
 *
 * Read from each page's rendered DOM (`PageContext.links`, extracted after render), so a nav a site
 * builds in the browser is read as the browser shows it. The chrome only: body links on an inner page
 * are that page's content, not the site's map of itself.
 */
export function chromeLinksOf(pages: readonly PageContext[]): readonly ChromeLink[] {
  return pages.flatMap((page) =>
    page.links
      .filter((link) => link.inNav === true || link.inFooter === true)
      .map((link) => ({ href: link.href, text: link.text, inNav: link.inNav, inFooter: link.inFooter })),
  );
}
