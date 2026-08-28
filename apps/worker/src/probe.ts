/**
 * Probing paths, with or without a session.
 *
 * Uses the browser rather than `fetch` for one reason: the session lives in a Playwright context,
 * and the whole point of the probe is that the same path is requested twice — once carrying that
 * session and once not. Two different HTTP clients would make the comparison unsound.
 *
 * Redirects are followed and the final URL retained. A merchant who gates their catalogue answers
 * an anonymous request with a redirect to the login form, and "302 to /account/login" is the
 * observation that matters — a status alone would lose it.
 */

import { createHash } from 'node:crypto';
import type { Browser, BrowserContext } from 'playwright';
import type { ProbeResult } from '@mintro/engine';
import { withDeadline } from './deadline.js';

export interface ProbeOptions {
  /** A context carrying a session, or null to probe as an anonymous visitor. */
  readonly authenticated: BrowserContext | null;
  readonly timeoutMs?: number;
}

/** Probes each path once, returning a result per path whether or not it completed. */
export async function probePaths(
  browser: Browser,
  origin: string,
  paths: readonly string[],
  options: ProbeOptions,
): Promise<ProbeResult[]> {
  const timeout = options.timeoutMs ?? 20_000;

  // A fresh anonymous context per probe run: reusing one would let a cookie set by an earlier
  // path leak into the next, which is exactly the confusion this check is trying to resolve.
  const context = options.authenticated ?? (await browser.newContext());
  const owned = options.authenticated === null;
  const results: ProbeResult[] = [];

  /*
    Defaults go on the pages this function creates, never on the context (D-153).

    A context supplied through `options.authenticated` belongs to the caller and outlives this
    call. Setting a default on it would silently retune every later request the caller makes with
    it — a timeout applied by a function the caller did not know was involved is the kind of
    action-at-a-distance that is very hard to find later. Pages created here are ours, so the
    setting stays inside the call.
  */

  try {
    for (const path of paths) {
      const url = new URL(path, origin).toString();
      const fetchedAt = new Date().toISOString();
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        // `page.content()` takes no timeout and ignores the page default — measured, not assumed
        // (D-153). Against a page whose main thread is wedged it never settles, so the bound has
        // to come from outside it. The `finally` below closes the page, which reaps the call.
        const bodyText = await withDeadline(page.content(), timeout, `page.content() for ${url}`);

        results.push({
          url,
          status: response?.status() ?? 0,
          finalUrl: page.url(),
          sha256: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
          fetchedAt,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = raw.split('\n')[0] ?? 'request failed';
        results.push({ url, status: 0, finalUrl: url, error: message, fetchedAt });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    if (owned) await context.close().catch(() => undefined);
  }

  return results;
}
