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
import {
  classifyChallenge,
  classifyConsentGate,
  describeConsentGate,
  headerLookup,
  type ProbeResult,
} from '@mintro/engine';
import { extractConsentGate } from './extract.js';
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

        /*
          What answered, classified here because only here are the headers in scope (D-264).

          This is where the false pass came from. GATE-002 probed three paths on phoenixpeptide,
          all three returned 403 behind a Cloudflare challenge, and the handler — which sees only
          a status — read three refusals as *"served content directly"* and returned `pass` on a
          critical stopping condition. The handler's arithmetic is fixed too, but a status alone
          could never have carried this: it takes the header and the document to know that the
          403 was the edge rather than the origin.
        */
        const challenge = classifyChallenge({
          status: response?.status() ?? 0,
          ...(response === null ? {} : { header: headerLookup(response.headers()) }),
          body: bodyText,
        });

        /*
          And whether the merchant's own gate answered instead of the listing (D-266).

          One extra `page.evaluate` on three paths per run, and it is the difference between
          GATE-002 auto-failing a merchant for their gate and crediting them for it. Asked only
          when there was no challenge: an interstitial from the edge never reached the merchant.

          Nothing submits the form. This reads it.
        */
        const gate =
          challenge === null
            ? classifyConsentGate({
                status: response?.status() ?? 0,
                ...((await withDeadline(
                  page.evaluate(extractConsentGate),
                  timeout,
                  `page.evaluate() reading the consent gate at ${url}`,
                )) as Awaited<ReturnType<typeof extractConsentGate>>),
              })
            : null;

        results.push({
          url,
          status: response?.status() ?? 0,
          finalUrl: page.url(),
          sha256: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
          ...(challenge === null ? {} : { challenged: challenge.marker }),
          ...(gate === null ? {} : { gated: describeConsentGate(gate) }),
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
