/**
 * Rendering a page with Playwright and turning it into a `PageContext`.
 *
 * This is the only file in the project that drives a browser. Everything downstream works from
 * the plain data it produces, so every Layer 1 check is testable from a fixture.
 *
 * Honours `Crawl-delay` from the first request (D-013) — the pacer is awaited before every
 * navigation, not only before Layer 0 fetches.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  classifyChallenge,
  classifyConsentGate,
  describeConsentGate,
  headerLookup,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  parseCssColour,
  type EvidenceArtifact,
  type PageContext,
  type Pacer,
  type PageLink,
  type Rgb,
  type ShopStructure,
  type StyledText,
  USER_AGENT,
} from '@mintro/engine';
import {
  extractConsentGate,
  extractPage,
  extractSignupForm,
  type RawExtraction,
  type RawSignupForm,
  type RawStyledText,
} from './extract.js';
import { withDeadline } from './deadline.js';
import { passConsentGate } from './consentGatePass.js';

/** Payment method names looked for in the footer, carried forward for Layer 3 (PAY-001). */
const PAYMENT_TERMS = [
  'Zelle',
  'Cash App',
  'CashApp',
  'Venmo',
  'Friends & Family',
  'friends and family',
  'Bitcoin',
  'BTC',
  'crypto',
  'Wire transfer',
  'Western Union',
  'Zelle®',
];

export interface RenderOptions {
  readonly timeoutMs?: number;
  readonly viewport?: { width: number; height: number };
  /** Awaited before navigating, so a declared Crawl-delay is observed (D-013). */
  readonly pacer?: Pacer;
  /** Run id, so evidence keys are unique per run (D-002). */
  readonly runId: string;
  /** CSS selectors the rule set asks about, evaluated in the page. */
  readonly selectors?: readonly string[];
  /**
   * A context carrying a merchant session, for pages behind a login (M9).
   *
   * When given, it is used and **not closed** — it belongs to the caller and outlives this render.
   * Absent, an anonymous context is created and closed here, as before.
   *
   * The gate rules never travel this path: `runGateRules` builds its own anonymous access and has
   * no parameter that could carry a session (D-039).
   */
  readonly context?: BrowserContext;
  /**
   * How long to wait for network quiet after DOM-ready. Defaults to `DEFAULT_IDLE_MS` (D-155).
   *
   * Shortened by the Layer 3 probes, which spend most of their time here waiting on themed 404
   * pages that will never be used for anything.
   */
  readonly idleMs?: number;
  /**
   * Whether this render's capture is worth keeping, decided **after** the page is read (D-155).
   *
   * Called with the page as it stands — everything except the artifact keys, which is all any
   * caller needs to judge it. Returning false skips the screenshot; the DOM snapshot is still
   * retained, because it is cheap and it is the record of what was actually served.
   *
   * The predicate runs before the capture rather than after, so the decision costs nothing when
   * the answer is no. Absent, every render is captured, which is the behaviour every other caller
   * wants.
   *
   * **This cannot cause a finding to cite a capture that was not taken.** `screenshotKey` is set
   * only when a screenshot exists, and `pageEvidence` reads the key from the page rather than
   * assuming one (D-012). A page whose capture was skipped falls back to its DOM key.
   */
  readonly keepCapture?: (page: PageContext) => boolean;
  /**
   * Also read the sign-up form out of this page, in the same visit (D-155).
   *
   * Opt-in, and that is the whole of the original objection answered. `signup.ts` navigated twice
   * — once to render, once to read the form — on the reasoning that folding the extraction into
   * `renderPage` would make *every* surface pay for a Layer 3 concern. Behind a flag, only the
   * sign-up probe pays, and the second navigation goes away.
   */
  readonly readSignupForm?: boolean;
  /**
   * This context has already been through a consent gate on this origin (D-267).
   *
   * The gate is passed **once per browser context**, not once per page: it sets a cookie and the
   * context outlives the render. A run whose sixteen product pages sit behind one gate submits the
   * form once and walks through fifteen times.
   *
   * The caller owns this because the caller owns the context. `screen.ts` builds one for the whole
   * crawl and flips this after the first pass; a caller with no shared context leaves it unset and
   * gets a pass per render, which is correct for a context that starts empty.
   */
  readonly alreadyEnteredGate?: boolean;
  /**
   * Called when this render actually submitted a gate, with the gate's description.
   *
   * How the caller learns to set `alreadyEnteredGate` on the next one, and how the run records
   * that it entered at all. Absent, the pass still happens and is simply not reported upward.
   */
  readonly onEnteredGate?: (description: string) => void;
}

/**
 * How long to wait for network quiet after DOM-ready, for an ordinary render.
 *
 * Unchanged at 8s for the pages a report is built from. Measured settle on the two validation
 * storefronts is 1.3-3.4s, so this is generous for a page that is going to be read.
 */
export const DEFAULT_IDLE_MS = 8_000;

/**
 * The same wait, for a Layer 3 probe render (D-155).
 *
 * A probe is a guess at a conventional path, and most guesses are wrong. Measured settle is
 * 1.3-3.4s on the two validation storefronts, so 3s covers the observed range while cutting up to
 * 5s per rejected candidate.
 *
 * ## The risk this carries, and how it is checked
 *
 * The located candidate is used as rendered — one fetch, so the capture and the text a check reads
 * are the same visit. That is deliberate and it is why there is no re-read at the full wait: two
 * fetches would put a screenshot in the report that does not show the text beside it.
 *
 * The cost is that a shorter wait could under-render a document and make `establishDocument`
 * reject it on the 400-character floor — a *false absence*, which is the direction this project
 * cares most about. The four surfaces this touches are server-rendered policy pages on WooCommerce
 * and Shopify themes, present at DOM-ready (measured: 9,503 / 2,616 / 5,243 characters on the
 * validation storefronts), so the floor is not close. It is verified rather than assumed: both
 * storefronts are re-run against their recorded findings whenever this value moves, and a changed
 * finding is a regression, not an optimisation.
 */
export const PROBE_IDLE_MS = 3_000;

/**
 * The anonymous context every crawl render uses (D-017, D-267).
 *
 * Extracted so a caller can build **one for the whole run** and hand it to every render. That is
 * what makes a consent gate a once-per-run event rather than a once-per-page one: the gate sets a
 * cookie, and a context created and closed inside each render throws it away sixteen times.
 *
 * D-017 unchanged: polite mitigations, not stealth. A standard desktop viewport, a real
 * accept-language, and the same declared identity the Layer 0 fetcher uses. A merchant who inspects
 * their logs still sees who we are and can reach us.
 */
export async function createCrawlContext(
  browser: Browser,
  viewport?: { width: number; height: number },
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    userAgent: USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
  });
}

export interface RenderResult {
  readonly page: PageContext;
  /** Screenshot and DOM snapshot, ready for the evidence store. */
  readonly artifacts: readonly EvidenceArtifact[];
  /** Present only when `readSignupForm` was asked for, and the page yielded a reading (D-155). */
  readonly signupForm?: RawSignupForm;
}

/**
 * Renders one page and captures it.
 *
 * A failure is returned as a `PageContext` carrying `renderError`, never thrown: the layer above
 * has to turn "the page did not render" into `not_evaluable` findings, and it can only do that
 * if the failure arrives as data.
 */
export async function renderPage(
  browser: Browser,
  url: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const timeout = options.timeoutMs ?? 30_000;
  const capturedAt = new Date().toISOString();

  let context: BrowserContext | undefined;
  /**
   * This render's page, held where the `finally` can reach it (D-268).
   *
   * It used to live inside the `try`, and nothing closed it. That was survivable only because a
   * context created here was closed on the way out and took its page with it — so the reaping was
   * a side effect of context ownership rather than anything this function did on purpose.
   *
   * D-267 gave the run **one shared context** and handed it to every render. Every render then
   * borrowed, nothing was closed, and each one leaked a Chromium renderer process for the life of
   * the crawl. On 2026-09-10 a CoMo run left nine-plus `headless_shell` processes resident on a
   * 985 MB machine with 19 MB available and no swap.
   */
  let opened: Page | undefined;
  // A caller-supplied context is borrowed, never closed: it holds the merchant session and the
  // run needs it for the next page too.
  const borrowed = options.context !== undefined;

  try {
    // Crawl-delay is observed before the request leaves, not after (D-013).
    await options.pacer?.before();

    // D-017: polite mitigations, not stealth. A standard desktop viewport, a real
    // accept-language, and the same declared identity the Layer 0 fetcher uses. A merchant who
    // inspects their logs still sees who we are and can reach us.
    context = options.context ?? (await createCrawlContext(browser, options.viewport));

    const page = await context.newPage();
    // Handed to the `finally` immediately, so a throw anywhere below still closes it. The body
    // keeps its own `const` so the closures above narrow: a captured `let` does not (D-268).
    opened = page;
    page.setDefaultTimeout(timeout);

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Give client-rendered storefronts a chance to paint. `networkidle` is unreliable on sites
    // with polling widgets, so this waits for quiet with a bounded fallback rather than hanging.
    // Shortened for Layer 3 probe renders, which spend most of their time here on pages that are
    // about to be discarded (D-155).
    await page
      .waitForLoadState('networkidle', { timeout: options.idleMs ?? DEFAULT_IDLE_MS })
      .catch(() => undefined);

    const status = response?.status() ?? 0;
    const finalUrl = page.url();
    /*
      The response headers, read here because this is the only moment they exist (D-264).

      `response` goes out of scope with the page. Nothing downstream of `renderPage` has ever seen
      a header, which is why `cf-mitigated: challenge` — the authoritative signal, sitting on every
      one of the twenty-one interstitials this crawl stored — went unread for the whole life of the
      renderer. The status was read into a variable and branched on nowhere.
    */
    const headers = response === null ? {} : response.headers();

    /*
      Both of these are unbounded without the wrapper (D-153).

      `page.evaluate` and `page.content()` take no timeout and ignore `setDefaultTimeout`. This is
      the highest-traffic pair in the crawl — every page of every run goes through here — so an
      unbounded wait on either is a hang available on any storefront, not only one with a checkout
      flow. A failure here already has a home: it throws, the catch below returns a `PageContext`
      carrying `renderError`, and the layer above turns that into `not_evaluable` with a reason.
    */
    /*
      One read, performed twice on a gated URL (D-267).

      The crawler now ticks a consent gate's boxes and reads what is behind it, so the same document
      has to be extracted, classified and possibly extracted again. Pulling the read into a closure
      rather than copying it is the whole of what keeps the two passes identical — a second copy is
      how the four render-failure blocks of D-181 drifted.
    */
    const read = async (): Promise<{
      readonly extraction: RawExtraction;
      readonly html: string;
      readonly htmlSha256: string;
    }> => {
      const observed = (await withDeadline(
        page.evaluate(extractPage, {
          paymentTerms: [...PAYMENT_TERMS],
          selectors: [...(options.selectors ?? [])],
        }),
        timeout,
        `page.evaluate() extracting ${url}`,
      )) as RawExtraction;
      const body = await withDeadline(page.content(), timeout, `page.content() for ${url}`);
      return { extraction: observed, html: body, htmlSha256: sha256(body) };
    };

    /*
      The gate classification, also performed twice on a gated URL (D-267).

      The structural observation comes from the DOM pass, which is the only thing that can answer
      *are this form's only editable controls required checkboxes*. Read a second time after the
      pass to answer a different question: is it still there.
    */
    const readGate = async (): Promise<ReturnType<typeof classifyConsentGate>> =>
      classifyConsentGate({
        status,
        ...((await withDeadline(
          page.evaluate(extractConsentGate),
          timeout,
          `page.evaluate() reading the consent gate at ${url}`,
        )) as Awaited<ReturnType<typeof extractConsentGate>>),
      });

    let { extraction, html, htmlSha256 } = await read();

    /*
      The sign-up form, read in this same visit when the caller asked for it (D-155).

      Deferred behind the gate pass (D-267): on a gated URL the form that matters is the one on the
      page behind the gate, and reading it before entering would read the gate's own checkboxes.
    */
    const readSignup = async (): Promise<RawSignupForm | undefined> =>
      options.readSignupForm === true
        ? ((await withDeadline(
            page.evaluate(extractSignupForm),
            timeout,
            `page.evaluate() reading the sign-up form at ${url}`,
          )) as RawSignupForm)
        : undefined;

    /*
      Is this capture worth keeping (D-155)?

      Asked here, with everything a caller needs to judge it and before the expensive part. A Layer
      3 probe rejects most of what it renders — a themed 404 at a path the merchant never used —
      and a screenshot of a page we discarded is not evidence of anything.

      The DOM snapshot is kept either way: it is cheap, and it is the record of what was actually
      served at a URL this run requested.
    */
    /*
      Was this the site, or the thing in front of it (D-264)?

      Decided here, once, from everything the response carried — the header, the parsed title and
      the served document — and recorded on the page rather than re-derived by each reader. Every
      consequence follows from this one field: `isRendered` is false, so `renderFailure` short-
      circuits every page-taking handler; `wasServed` is false, so the page is not counted as
      covered; the capture is filed under `challenge` rather than `dom`, so no later reader can
      pick it up as a page.
    */
    const challenge = classifyChallenge({
      status,
      header: headerLookup(headers),
      title: extraction.title,
      body: html,
    });

    /*
      Was this the page, or the merchant's gate standing in front of it (D-266)?

      Asked only where there was no challenge, because the two cannot both be true and a challenge
      is the more basic fact: an interstitial from the edge never reached the merchant's own gate.
    */
    let gate = challenge === null ? await readGate() : null;

    /*
      The gate is captured **before** it is passed (D-267).

      Whatever happens next, this is the document the merchant served at this URL and it is what
      GATE-001 cites: the acknowledgements verbatim, so a reader can see exactly what was affirmed
      on the way in. Capturing it afterwards would be capturing the catalogue and calling it a gate.
    */
    let gateCapture: { readonly html: string; readonly sha256: string } | undefined;
    let enteredGate: string | undefined;
    let finalUrlNow = finalUrl;
    let statusNow = status;

    if (gate !== null) {
      gateCapture = { html, sha256: htmlSha256 };
      const description = describeConsentGate(gate);

      /*
        Passed once per context, not once per page (D-267).

        The gate sets a cookie, and the context outlives this render — `screen.ts` builds one for
        the whole crawl — so the second gated URL of a run arrives already through. `alreadyEntered`
        is how a caller says *this context has been through*, which keeps the run to one submission
        even when sixteen product pages are behind the same gate.
      */
      const outcome =
        options.alreadyEnteredGate === true
          ? { submitted: false, acknowledged: 0, refusal: 'this context has already entered' }
          : await passConsentGate(page, timeout);

      if (outcome.submitted) {
        options.onEnteredGate?.(description);

        /*
          Land on the page that was asked for, not wherever the gate sent us.

          The gate carries a return path and most implementations honour it, but "most" is not a
          contract. A plain `goto` back to the requested URL costs one GET, is not a second
          submission, and makes the guarantee unconditional: what comes back is the page for *this*
          URL or it is nothing.
        */
        if (page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => undefined);
        }
        await page
          .waitForLoadState('networkidle', { timeout: options.idleMs ?? DEFAULT_IDLE_MS })
          .catch(() => undefined);

        ({ extraction, html, htmlSha256 } = await read());
        finalUrlNow = page.url();

        /*
          Still a gate? Then it is a gate, and nothing is submitted a second time (D-267).

          A merchant whose gate does not take, or takes and re-presents, gets the D-266 behaviour
          unchanged: the page is `gated`, every rule pointed at it is blinded, and GATE-001 still
          passes on the gate that is there. A retry loop would be hammering a merchant's form to
          get a result the run does not need.
        */
        gate = await readGate();
        if (gate === null) enteredGate = description;
      }
    }

    const signupForm = await readSignup();

    const provisional: PageContext = {
      ...toPageContext(url, finalUrlNow, statusNow, extraction, html, htmlSha256, capturedAt),
      ...(challenge === null ? {} : { challenged: challenge.marker }),
      ...(gate === null ? {} : { gated: describeConsentGate(gate) }),
      ...(enteredGate === undefined ? {} : { enteredGate }),
    };
    /*
      A challenged response is never worth a screenshot, whatever the caller thinks (D-264).

      `keepCapture` is a caller's judgement about a page, and this is not one. The interstitial's
      DOM is retained because it is the record of what was served; a full-page PNG of it is 44 kB
      of a spinner, and — worse — it is the sort of artifact that ends up beside a finding as
      though it showed the merchant's site. Run 0003c814 stored exactly one.
    */
    /*
      A gated document **is** screenshotted, and a challenged one is not (D-264, D-266).

      The difference is what the picture shows. An interstitial from the edge shows a spinner and
      evidences nothing anyone needs to look at. A consent gate is the merchant's own control, and
      GATE-001 now returns `pass` on it — so a reader auditing that finding is entitled to see the
      gate as it was served, which is the same standard the overlay branch has always met.
    */
    const keep =
      challenge === null && (options.keepCapture === undefined || options.keepCapture(provisional));

    // Captures happen before the keys are set. A key is only written onto the context once the
    // artifact actually exists, so no finding can cite a screenshot that was never taken (D-012).
    const screenshot = keep
      ? await page.screenshot({ fullPage: true, type: 'png' }).catch(() => undefined)
      : undefined;

    const artifacts: EvidenceArtifact[] = [];
    let screenshotKey: string | undefined;
    let domKey: string | undefined;
    let challengeKey: string | undefined;
    let gateKey: string | undefined;

    if (screenshot !== undefined) {
      const digest = sha256Buffer(screenshot);
      screenshotKey = `${options.runId}/layer1/${digest}.png`;
      artifacts.push({
        key: screenshotKey,
        kind: 'screenshot',
        url: finalUrl,
        sha256: digest,
        byteLength: screenshot.byteLength,
        contentType: 'image/png',
        fetchedAt: capturedAt,
        body: '',
        gzip: screenshot,
        gzipByteLength: screenshot.byteLength,
      });
    }

    {
      const gzip = gzipSync(Buffer.from(html, 'utf8'));
      const key = `${options.runId}/layer1/${htmlSha256}.html`;
      /*
        Stored either way; named differently (D-264).

        The run has to record what happened, so the interstitial is retained exactly like any other
        document. What changes is the key it is set on and the kind it is filed under, and both of
        those are the whole point: `evaluationRun` selects the pages a draft reasons over with
        `kind === 'dom'`, and the nine interstitials of run 0003c814 were `dom`.
      */
      if (challenge !== null) challengeKey = key;
      else if (gate !== null) gateKey = key;
      else domKey = key;
      artifacts.push({
        key,
        kind: challenge !== null ? 'challenge' : gate !== null ? 'gate' : 'dom',
        url: finalUrl,
        sha256: htmlSha256,
        byteLength: Buffer.byteLength(html, 'utf8'),
        contentType: 'text/html',
        fetchedAt: capturedAt,
        body: html,
        gzip,
        gzipByteLength: gzip.byteLength,
      });
    }

    /*
      The gate itself, stored beside the page it stood in front of (D-267).

      Two artifacts for one URL, and both are needed. The `dom` capture is the catalogue page every
      product rule now evaluates; this one is the gate, and it is what GATE-001 cites — the record
      of what a visitor is asked to affirm, and of what this crawl affirmed on the way in.

      Only where the gate was actually passed. A gate that stayed shut is stored once, under
      `gate`, by the block above: there is no page behind it to store.
    */
    if (gateCapture !== undefined && enteredGate !== undefined) {
      const gzip = gzipSync(Buffer.from(gateCapture.html, 'utf8'));
      gateKey = `${options.runId}/layer1/${gateCapture.sha256}.html`;
      artifacts.push({
        key: gateKey,
        kind: 'gate',
        url: finalUrl,
        sha256: gateCapture.sha256,
        byteLength: Buffer.byteLength(gateCapture.html, 'utf8'),
        contentType: 'text/html',
        fetchedAt: capturedAt,
        body: gateCapture.html,
        gzip,
        gzipByteLength: gzip.byteLength,
      });
    }

    if (!borrowed) await context.close();
    context = undefined;

    return {
      page: {
        ...provisional,
        ...(screenshotKey === undefined ? {} : { screenshotKey }),
        ...(domKey === undefined ? {} : { domKey }),
        ...(challengeKey === undefined ? {} : { challengeKey }),
        ...(gateKey === undefined ? {} : { gateKey }),
      },
      artifacts,
      ...(signupForm === undefined ? {} : { signupForm }),
    };
  } catch (error) {
    return {
      page: failedPage(url, capturedAt, describeError(error)),
      artifacts: [],
    };
  } finally {
    /*
      The page is always ours, so it is always closed (D-268).

      **Before the context**, and unconditionally. Two separate lifetimes were being managed by one
      decision: `borrowed` is a fact about the *context*, and it was silently deciding the *page*
      too. The page is created here on every path, is used by nothing else, and outlives this
      function on no reading of it.

      This is also what re-arms the deadlines. `withDeadline` bounds `page.evaluate` and
      `page.content()`, but a rejection there only stops *us* waiting — the call keeps running in
      the renderer until something closes the page. That reaping used to come free with the context
      close; since D-267 it came from nowhere, so a wedged page stayed wedged and resident.

      Swallowed, because a failure to close is not a failure to render: the caller has a
      `PageContext` either way, and throwing here would discard a good result over a cleanup error.
    */
    await opened?.close().catch(() => undefined);

    // Only ours. Closing a borrowed context would take the merchant session with it and turn the
    // rest of the run anonymous without saying so.
    if (!borrowed) await context?.close().catch(() => undefined);
  }
}

/**
 * The page as read, before anything is known about its captures.
 *
 * Built once and used twice: handed to `keepCapture` so a caller can judge the page before the
 * screenshot is taken, then spread into the returned context with whatever keys resulted. One
 * construction rather than two means the object a caller inspects and the object a check reads
 * cannot disagree.
 */
function toPageContext(
  requestedUrl: string,
  finalUrl: string,
  httpStatus: number,
  extraction: RawExtraction,
  html: string,
  htmlSha256: string,
  capturedAt: string,
): PageContext {
  return {
    requestedUrl,
    finalUrl,
    httpStatus,
    title: extraction.title,
    text: extraction.text,
    html,
    htmlSha256,
    footer: toRegion(extraction),
    links: extraction.links as PageLink[],
    styledText: extraction.styledText.map(toStyledText),
    shop: toShopStructure(extraction),
    footerPaymentTerms: extraction.footerPaymentTerms,
    gate: extraction.gate,
    selectorMatches: extraction.selectorMatches,
    productTitle: extraction.productTitle,
    capturedAt,
  };
}

function failedPage(url: string, capturedAt: string, renderError: string): PageContext {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 0,
    title: '',
    text: '',
    html: '',
    htmlSha256: sha256(''),
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt,
    renderError,
  };
}

function toRegion(extraction: RawExtraction) {
  return extraction.footer.found
    ? {
        found: true,
        text: extraction.footer.text,
        styledText: extraction.footer.styledText.map(toStyledText),
        locatedBy: extraction.footer.locatedBy,
      }
    : MISSING_REGION;
}

function toShopStructure(extraction: RawExtraction): ShopStructure {
  const platform = extraction.shop.platform;
  const known = ['shopify', 'woocommerce', 'magento', 'bigcommerce'] as const;
  const matched = known.find((candidate) => candidate === platform);

  return {
    productUrls: extraction.shop.productUrls,
    collectionUrls: extraction.shop.collectionUrls,
    catalogueEntryUrls: extraction.shop.catalogueEntryUrls,
    ...(matched === undefined ? {} : { platform: matched }),
    signals: extraction.shop.signals,
  };
}

/**
 * Converts browser colour strings into resolved RGB.
 *
 * A colour that will not parse falls back to a value that cannot silently create a passing
 * contrast ratio — DISC-002 auto-fails, so an unparseable colour must not be guessed into
 * legibility. Black on white is the highest-contrast pair, so defaulting there means an
 * unreadable colour is never the reason a merchant is failed; the failure would have to come
 * from font size, visibility, or a colour we did read.
 */
function toStyledText(raw: RawStyledText): StyledText {
  return {
    text: raw.text,
    selector: raw.selector,
    fontSizePx: raw.fontSizePx,
    color: toRgb(raw.color, { r: 0, g: 0, b: 0 }),
    backgroundColor: toRgb(raw.backgroundColor, { r: 255, g: 255, b: 255 }),
    visible: raw.visible,
    collapsedAncestor: raw.collapsedAncestor,
    ...(raw.hiddenReason === undefined ? {} : { hiddenReason: raw.hiddenReason }),
  };
}

function toRgb(value: string, fallback: Rgb): Rgb {
  const parsed = parseCssColour(value);
  return parsed === null ? fallback : parsed.colour;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const sha256Buffer = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}
