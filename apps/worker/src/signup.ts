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
import { located, NO_SIGNUP_FORM, unreachable, withoutFragment } from '@mintro/engine';
import { aboutSlugs, surfaceFromSlug } from './evaluationPages.js';
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
 * How a storefront talks about itself (D-271).
 *
 * **Paths derived from the page selector's own about slugs**, in both the bare and `/pages/` forms
 * every platform uses. Writing the list twice would be two answers to *what is an about page*, and
 * the selector's copy is the one that also has to label the capture afterwards.
 */
const ABOUT_PATHS: readonly string[] = aboutSlugs().flatMap((slug) => [
  `/${slug}`,
  `/pages/${slug}`,
]);

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
  readonly context?: BrowserContext;
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
      paths: ABOUT_PATHS,
      linkHints: [],
      linkTexts: ABOUT_LINK_TEXTS,
      surface: 'about',
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
  for (const what of documents) {
    step(what.label);
    found.set(
      what.label,
      await findDocument(browser, origin, options, attempts, artifacts, pages, say, what, probe),
    );
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
  },
  probeTally: { undecided: number; total: number },
): Promise<Located<PageContext>> {
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
  const spec: SurfaceSpec = { label: what.label, pathNames: [...what.linkHints] };

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
  );

  if (dropped > 0) {
    const line =
      `${what.label}: ${distinct} homepage links matched this surface; the first ` +
      `${MAX_LINKED_CANDIDATES} were followed and ${dropped} were not requested`;
    attempts.push({ url: origin, status: 0, error: line });
    say(`  ${line}`);
  }

  const candidates = [...new Set([...linked, ...what.paths.map((path) => `${origin}${path}`)])];

  for (const url of candidates) {
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
    return located(outcome.value, outcome.url, outcome.how);
  }

  say(`  no ${what.label} reached`);
  return unreachable(
    `no ${what.label} was reached: ${describeCandidates(mine)}`,
    mine,
    obstructed,
    challenged,
    gated,
  );
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
