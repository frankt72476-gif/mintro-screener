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
import type { Browser, BrowserContext } from 'playwright';
import {
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
  extractPage,
  extractSignupForm,
  type RawExtraction,
  type RawSignupForm,
  type RawStyledText,
} from './extract.js';
import { withDeadline } from './deadline.js';

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
  // A caller-supplied context is borrowed, never closed: it holds the merchant session and the
  // run needs it for the next page too.
  const borrowed = options.context !== undefined;

  try {
    // Crawl-delay is observed before the request leaves, not after (D-013).
    await options.pacer?.before();

    // D-017: polite mitigations, not stealth. A standard desktop viewport, a real
    // accept-language, and the same declared identity the Layer 0 fetcher uses. A merchant who
    // inspects their logs still sees who we are and can reach us.
    context = options.context ?? await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      userAgent: USER_AGENT,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
    });

    const page = await context.newPage();
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
      Both of these are unbounded without the wrapper (D-153).

      `page.evaluate` and `page.content()` take no timeout and ignore `setDefaultTimeout`. This is
      the highest-traffic pair in the crawl — every page of every run goes through here — so an
      unbounded wait on either is a hang available on any storefront, not only one with a checkout
      flow. A failure here already has a home: it throws, the catch below returns a `PageContext`
      carrying `renderError`, and the layer above turns that into `not_evaluable` with a reason.
    */
    const extraction = (await withDeadline(
      page.evaluate(extractPage, {
        paymentTerms: [...PAYMENT_TERMS],
        selectors: [...(options.selectors ?? [])],
      }),
      timeout,
      `page.evaluate() extracting ${url}`,
    )) as RawExtraction;
    const html = await withDeadline(page.content(), timeout, `page.content() for ${url}`);
    const htmlSha256 = sha256(html);

    /*
      The sign-up form, read in this same visit when the caller asked for it (D-155).

      Before the capture, so the page is in the state the screenshot will show.
    */
    const signupForm =
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
    const provisional = toPageContext(url, finalUrl, status, extraction, html, htmlSha256, capturedAt);
    const keep = options.keepCapture === undefined || options.keepCapture(provisional);

    // Captures happen before the keys are set. A key is only written onto the context once the
    // artifact actually exists, so no finding can cite a screenshot that was never taken (D-012).
    const screenshot = keep
      ? await page.screenshot({ fullPage: true, type: 'png' }).catch(() => undefined)
      : undefined;

    const artifacts: EvidenceArtifact[] = [];
    let screenshotKey: string | undefined;
    let domKey: string | undefined;

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
      domKey = `${options.runId}/layer1/${htmlSha256}.html`;
      artifacts.push({
        key: domKey,
        kind: 'dom',
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

    if (!borrowed) await context.close();
    context = undefined;

    return {
      page: {
        ...provisional,
        ...(screenshotKey === undefined ? {} : { screenshotKey }),
        ...(domKey === undefined ? {} : { domKey }),
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
