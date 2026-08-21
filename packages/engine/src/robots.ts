/**
 * robots.txt parsing.
 *
 * Layer 0 wants one thing from robots.txt: where the sitemaps are. `Sitemap:` is a
 * group-independent directive, so it is read regardless of which `User-agent` block it sits in.
 *
 * `Disallow` paths are collected too, but never treated as evidence of anything. A disallowed
 * path is not proof a page exists — it is a request not to visit one, and a merchant excluding
 * `/collections/weight-loss` has not thereby been observed to have that collection. Findings
 * come from URLs a sitemap actually lists.
 */

export interface RobotsTxt {
  /** Absolute sitemap URLs declared in the file, deduplicated, in declaration order. */
  readonly sitemaps: readonly string[];
  /** Disallow paths, as context for a human reading the report. Never a finding on their own. */
  readonly disallowed: readonly string[];
  /** True when the file was fetched and parsed. False when it was missing or unreadable. */
  readonly present: boolean;
}

export const EMPTY_ROBOTS: RobotsTxt = { sitemaps: [], disallowed: [], present: false };

/**
 * Parses robots.txt.
 *
 * @param text    File contents.
 * @param baseUrl Origin, used to resolve a relative `Sitemap:` value. Out of spec, but it
 *                appears in the wild and resolving it costs nothing.
 */
export function parseRobotsTxt(text: string, baseUrl: string): RobotsTxt {
  const sitemaps: string[] = [];
  const disallowed: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    // Comments run to end of line and may follow a directive.
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (value === '') continue;

    if (directive === 'sitemap') {
      const absolute = toAbsolute(value, baseUrl);
      if (absolute !== null && !seen.has(absolute)) {
        seen.add(absolute);
        sitemaps.push(absolute);
      }
    } else if (directive === 'disallow') {
      disallowed.push(value);
    }
  }

  return { sitemaps, disallowed, present: true };
}

/** Resolves a possibly-relative URL, rejecting anything that is not http(s). */
function toAbsolute(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
