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

import type { Browser } from 'playwright';
import type {
  EvidenceArtifact,
  FetchAttempt,
  Pacer,
  PageContext,
  SignupForm,
  SurfaceSpec,
} from '@mintro/engine';
import { NO_SIGNUP_FORM } from '@mintro/engine';
import { establishDocument } from './locate.js';
import { renderPage } from './render.js';
import { extractSignupForm, type RawSignupForm } from './extract.js';

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

export interface Layer3Discovery {
  readonly signup: SignupForm;
  readonly terms?: PageContext;
  readonly shipping?: PageContext;
  readonly faq?: PageContext;
  readonly payment?: PageContext;
  /** Every navigation made looking for either, and what it returned. */
  readonly attempts: readonly FetchAttempt[];
  readonly artifacts: readonly EvidenceArtifact[];
}

export interface DiscoverOptions {
  readonly runId: string;
  readonly pacer: Pacer;
  readonly timeoutMs?: number;
  /** Links seen on the rendered homepage, used to find the terms document. */
  readonly homepageLinks?: readonly { readonly href: string; readonly text: string }[];
  readonly onProgress?: (line: string) => void;
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

  const signup = await findSignupForm(browser, origin, options, attempts, artifacts, say);

  const terms = await findDocument(browser, origin, options, attempts, artifacts, say, {
    label: 'terms document',
    paths: TERMS_PATHS,
    linkHints: TERMS_LINK_HINTS,
  });

  const shipping = await findDocument(browser, origin, options, attempts, artifacts, say, {
    label: 'shipping policy',
    paths: SHIPPING_PATHS,
    linkHints: SHIPPING_LINK_HINTS,
  });

  const faq = await findDocument(browser, origin, options, attempts, artifacts, say, {
    label: 'FAQ',
    paths: FAQ_PATHS,
    linkHints: FAQ_LINK_HINTS,
  });

  const payment = await findDocument(browser, origin, options, attempts, artifacts, say, {
    label: 'payment or refund policy',
    paths: PAYMENT_PATHS,
    linkHints: PAYMENT_LINK_HINTS,
  });

  return {
    signup,
    ...(terms === undefined ? {} : { terms }),
    ...(shipping === undefined ? {} : { shipping }),
    ...(faq === undefined ? {} : { faq }),
    ...(payment === undefined ? {} : { payment }),
    attempts,
    artifacts,
  };
}

async function findSignupForm(
  browser: Browser,
  origin: string,
  options: DiscoverOptions,
  attempts: FetchAttempt[],
  artifacts: EvidenceArtifact[],
  say: (line: string) => void,
): Promise<SignupForm> {
  // The most informative thing seen while looking. A page that carried a sign-in form but no
  // account-creation form says something quite different from nothing being found at all, and
  // the finding should carry whichever actually happened.
  let closest = '';

  for (const path of REGISTER_PATHS) {
    const url = `${origin}${path}`;
    const rendered = await renderPage(browser, url, {
      runId: options.runId,
      pacer: options.pacer,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    artifacts.push(...rendered.artifacts);

    const page = rendered.page;
    if (page.renderError !== undefined) {
      attempts.push({ url, status: 0, error: page.renderError });
      continue;
    }

    attempts.push({ url, status: page.httpStatus });
    if (page.httpStatus < 200 || page.httpStatus >= 400) continue;

    const raw = await readForm(browser, page.finalUrl, options);
    if (raw === null) continue;
    if (!raw.found) {
      if (raw.candidateForms > 0) closest = `${page.finalUrl} — ${raw.locatedBy}`;
      continue;
    }

    say(`  sign-up form located at ${page.finalUrl} · ${raw.fields.length} field(s)`);
    return {
      found: true,
      locatedBy: raw.locatedBy,
      url: page.finalUrl,
      fields: raw.fields,
      candidateForms: raw.candidateForms,
    };
  }

  say(
    closest === ''
      ? `  no sign-up form reached · ${attempts.length} path(s) tried`
      : `  no sign-up form reached · closest: ${closest}`,
  );
  return closest === '' ? NO_SIGNUP_FORM : { ...NO_SIGNUP_FORM, locatedBy: closest };
}

/**
 * Reads the form out of a page that is already known to load.
 *
 * A second navigation rather than folding this into `renderPage`: the sign-up form is a Layer 3
 * concern and every other surface would pay for the extraction. It goes through the pacer like
 * everything else.
 */
async function readForm(
  browser: Browser,
  url: string,
  options: DiscoverOptions,
): Promise<RawSignupForm | null> {
  await options.pacer.before();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 30_000 });
    return (await page.evaluate(extractSignupForm)) as RawSignupForm;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => undefined);
  }
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
  say: (line: string) => void,
  what: { readonly label: string; readonly paths: readonly string[]; readonly linkHints: readonly string[] },
): Promise<PageContext | undefined> {
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
  const linked = (options.homepageLinks ?? [])
    .filter((link) => {
      const haystack = `${link.href} ${link.text}`.toLowerCase();
      return what.linkHints.some((hint) => haystack.includes(hint));
    })
    .map((link) => link.href);

  const candidates = [...new Set([...linked, ...what.paths.map((path) => `${origin}${path}`)])];

  for (const url of candidates) {
    if (!url.startsWith(origin)) continue;

    const rendered = await renderPage(browser, url, {
      runId: options.runId,
      pacer: options.pacer,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    artifacts.push(...rendered.artifacts);

    const outcome = establishDocument(url, rendered.page, spec, []);
    if (!outcome.located) {
      attempts.push({
        url,
        status: rendered.page.renderError === undefined ? rendered.page.httpStatus : 0,
        error: outcome.reason,
      });
      continue;
    }

    attempts.push({ url, status: rendered.page.httpStatus });
    say(`  ${what.label} located at ${outcome.how}`);
    return outcome.value;
  }

  say(`  no ${what.label} reached`);
  return undefined;
}
