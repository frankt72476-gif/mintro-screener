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
import { extractPage, type RawExtraction, type RawStyledText } from './extract.js';

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
}

export interface RenderResult {
  readonly page: PageContext;
  /** Screenshot and DOM snapshot, ready for the evidence store. */
  readonly artifacts: readonly EvidenceArtifact[];
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
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

    const status = response?.status() ?? 0;
    const finalUrl = page.url();

    const extraction = (await page.evaluate(extractPage, {
      paymentTerms: [...PAYMENT_TERMS],
      selectors: [...(options.selectors ?? [])],
    })) as RawExtraction;
    const html = await page.content();
    const htmlSha256 = sha256(html);

    // Captures happen before the keys are set. A key is only written onto the context once the
    // artifact actually exists, so no finding can cite a screenshot that was never taken (D-012).
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' }).catch(() => undefined);

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
        requestedUrl: url,
        finalUrl,
        httpStatus: status,
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
        ...(screenshotKey === undefined ? {} : { screenshotKey }),
        ...(domKey === undefined ? {} : { domKey }),
      },
      artifacts,
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
