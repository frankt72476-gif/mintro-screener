/**
 * sitemap.xml parsing.
 *
 * The single most important behaviour in this file is refusing to parse something that is not
 * a sitemap. Many storefronts answer an unknown path with `200 OK` and an HTML "not found"
 * page. A lenient `<loc>` scan over that HTML finds no URLs, and "no URLs" reads exactly like
 * "a catalogue with nothing prohibited in it" — a false `pass` on an `auto_fail` rule, which
 * is the worst outcome this system can produce (hard constraint 2).
 *
 * So a document that does not declare itself a sitemap is rejected as unparseable, and the
 * caller turns that into `not_evaluable`.
 */

/** What a sitemap document turned out to be. */
export type SitemapKind = 'urlset' | 'sitemapindex';

export interface ParsedSitemap {
  readonly kind: SitemapKind;
  /** `<loc>` values. Page URLs for a urlset, nested sitemap URLs for a sitemapindex. */
  readonly locations: readonly string[];
}

export interface SitemapParseFailure {
  readonly kind: 'unparseable';
  readonly reason: string;
}

export type SitemapParseResult = ParsedSitemap | SitemapParseFailure;

export const isParsedSitemap = (result: SitemapParseResult): result is ParsedSitemap =>
  result.kind !== 'unparseable';

/**
 * Parses a sitemap document.
 *
 * Hand-written rather than pulling in an XML library: sitemaps are machine-generated and this
 * needs exactly one element. The strictness that matters is in the guard below, not in the
 * extraction.
 */
export function parseSitemap(body: string, baseUrl: string): SitemapParseResult {
  const trimmed = body.trim();

  if (trimmed === '') {
    return { kind: 'unparseable', reason: 'document is empty' };
  }

  // Reject an HTML page served with 200 before looking for locations in it.
  const kind = detectKind(trimmed);
  if (kind === null) {
    return {
      kind: 'unparseable',
      reason: looksLikeHtml(trimmed)
        ? 'document is HTML, not a sitemap (the server answered a missing sitemap with a page)'
        : 'document declares neither <urlset> nor <sitemapindex>',
    };
  }

  const locations: string[] = [];
  const seen = new Set<string>();

  for (const match of trimmed.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const raw = decodeXmlEntities(stripCdata(match[1] ?? '')).trim();
    if (raw === '') continue;

    const absolute = toAbsolute(raw, baseUrl);
    if (absolute === null || seen.has(absolute)) continue;

    seen.add(absolute);
    locations.push(absolute);
  }

  return { kind, locations };
}

/** A sitemap must say what it is. Anything else is not one. */
function detectKind(body: string): SitemapKind | null {
  if (/<sitemapindex[\s>]/i.test(body)) return 'sitemapindex';
  if (/<urlset[\s>]/i.test(body)) return 'urlset';
  return null;
}

function looksLikeHtml(body: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(body) || /<body[\s>]/i.test(body);
}

function stripCdata(value: string): string {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return match === null ? value : (match[1] ?? '');
}

/** The five predefined XML entities, plus numeric references. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function toAbsolute(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
