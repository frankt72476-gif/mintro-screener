/**
 * The `/r/*` fronting, and the one property it exists to keep.
 *
 * A captured report has two spellings: the object at `<run>/<token>.html` in the `reports` bucket,
 * and the link `/r/<run>/<token>` that is actually delivered. The proxy is what makes them the
 * same thing, and if they ever drift the failure is silent in the worst way — a link that looks
 * right, resolves to nothing, and is already in an underwriter's inbox.
 *
 * So the substantive test here is not that the config contains the right string. It is that
 * **the link and the object key agree**, derived from the same owner rather than compared as text.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REPORT_BUCKET,
  REPORT_LINK_PATH,
  reportLinkFor,
  reportObjectKey,
} from '@mintro/engine';
import { headersFile, redirectsFile } from '../netlifyReportProxy.js';

const ORIGIN = 'https://mintro-screener-worker.fly.dev';
const SITE = 'https://screener.gomintro.com';
const RUN = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';

const deployed = (): string => redirectsFile({ workerOrigin: ORIGIN, onNetlify: true });

/** The proxy rule, as Netlify would read it: `from`, `to`, status. */
function proxyRule(file: string): { from: string; to: string; status: string } {
  const line = file
    .split('\n')
    .find((l) => l.startsWith(REPORT_LINK_PATH) && !l.startsWith('#'));
  if (line === undefined) throw new Error(`no ${REPORT_LINK_PATH} rule in:\n${file}`);

  const [from, to, status] = line.trim().split(/\s+/) as [string, string, string];
  return { from, to, status };
}

/** What Netlify does with `:splat`. */
const resolve = (to: string, splat: string): string => to.replace(':splat', splat);

describe('the link and the proxy', () => {
  it('resolve to one path, end to end', () => {
    /*
      The assertion this file exists for, now one hop longer.

      A delivered link is `/r/<run>/<token>` on the Mintro origin. Netlify proxies it to the same
      path on the worker. The worker parses that path and builds the object key. Every step is
      derived from `REPORT_LINK_PATH` and `reportObjectKey` — nothing here is a literal — so a
      change to the path scheme that broke one hop and not the others fails here rather than in an
      underwriter's inbox.
    */
    const link = reportLinkFor(SITE, RUN, TOKEN);

    const splat = link.slice(`${SITE}${REPORT_LINK_PATH}`.length);
    const proxied = resolve(proxyRule(deployed()).to, splat);

    // Netlify's hop: the same path, on the worker origin. The worker's hop — that this path
    // resolves to the object key — is asserted in `apps/worker/test/reportRoute.test.ts`, because
    // a test in this project may not import across the app boundary.
    expect(proxied).toBe(`${ORIGIN}${REPORT_LINK_PATH}${RUN}/${TOKEN}`);
    expect(new URL(proxied).pathname).toBe(`${REPORT_LINK_PATH}${RUN}/${TOKEN}`);
  });

  it('never sends the reader to storage', () => {
    /*
      The whole point of the ruling. Supabase serves public HTML as text/plain under a sandbox CSP
      whatever mimetype is stored, so a proxy pointed at storage delivers an unstyled document with
      no captures. The storage URL remains the fallback for a reader who has the path; it is not
      what the link resolves to.
    */
    const to = proxyRule(deployed()).to;

    expect(to).not.toContain('supabase');
    expect(to).not.toContain('storage/v1');
    expect(to).not.toContain(REPORT_BUCKET);
  });

  it('keeps the extension out of the delivered link and out of the proxy', () => {
    // The object carries `.html`; the link does not, because a URL handed to a person should not
    // advertise a file format. The worker now reconciles that, so the rewrite must not.
    expect(reportLinkFor(SITE, RUN, TOKEN)).not.toContain('.html');
    expect(proxyRule(deployed()).to).not.toContain('.html');
    expect(reportObjectKey(RUN, TOKEN)).toContain('.html');
  });
});

describe('the generated redirects', () => {
  it('proxies rather than redirecting', () => {
    /*
      200, never 301. A redirect hands the storage URL to the browser, which puts it in the address
      bar and the reader's history — the project ref is disclosed anyway and the indirection buys
      nothing.
    */
    expect(proxyRule(deployed()).status).toBe('200');
  });

  it('puts the report rule before the catch-all', () => {
    /*
      Order is the whole reason both rules live in this file. First match wins, and the SPA
      fallback matches everything — below it, `/r/*` would serve the analyst app in place of every
      delivered report.
    */
    const file = deployed();

    expect(file.indexOf(REPORT_LINK_PATH)).toBeLessThan(file.indexOf('/*  /index.html'));
  });

  it('still serves the single-page app', () => {
    // Moved here from `netlify.toml`, so this is now the only thing keeping the app routable.
    expect(deployed()).toContain('/*  /index.html  200');
  });

  it('tolerates a trailing slash on the worker origin', () => {
    const file = redirectsFile({ workerOrigin: `${ORIGIN}/`, onNetlify: true });

    expect(proxyRule(file).to).not.toContain('.dev//');
  });

  it('fails a Netlify build with no worker origin, rather than shipping dead links', () => {
    // A deploy whose report links 404 is worse than a build that stops, and Netlify is the only
    // place this file means anything.
    expect(() => redirectsFile({ workerOrigin: undefined, onNetlify: true })).toThrow(
      /VITE_REPORT_ORIGIN/,
    );
    expect(() => redirectsFile({ workerOrigin: '', onNetlify: true })).toThrow(/VITE_REPORT_ORIGIN/);
  });

  it('omits the rule on a local build without failing it', () => {
    /*
      `npm run web:build` and the bundle the worker renders from have no Netlify layer to
      configure, so the rule is absent rather than wrong — and the app must still be routable.
      This is what keeps `bundledControls.test.ts`, which runs a real `vite build` with no
      environment, from depending on deployment configuration.
    */
    const file = redirectsFile({ workerOrigin: undefined, onNetlify: false });

    expect(file).toContain('/*  /index.html  200');
    expect(() => proxyRule(file)).toThrow();
  });
});

describe('the headers', () => {
  it('sets X-Robots-Tag on the report path', () => {
    const file = headersFile();

    expect(file).toContain(`${REPORT_LINK_PATH}*`);
    expect(file).toContain('X-Robots-Tag: noindex, nofollow');
  });

  it('covers the same path the proxy serves', () => {
    // Both derived from the one owner. A header block guarding a path nothing serves is a header
    // block that does nothing, and it would look exactly like this one.
    expect(headersFile()).toContain(proxyRule(deployed()).from.replace('*', ''));
  });
});

describe('netlify.toml', () => {
  it('spells the report path nowhere', () => {
    /*
      The requirement in one line. `/r/` is owned by `REPORT_LINK_PATH`; a second copy here is a
      second thing to change, and the last URL shape stated in two places would have sent a
      merchant to a sign-in screen (D-034).
    */
    const toml = readFileSync('netlify.toml', 'utf8');
    const rules = toml
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(rules).not.toContain(REPORT_LINK_PATH);
    expect(rules).not.toContain('X-Robots-Tag');
  });

  it('declares no redirects, so the generated ones are reached', () => {
    // A `[[redirects]]` block here is evaluated before `_redirects`. A catch-all in this file
    // would swallow `/r/*` and nothing about the failure would point at the cause.
    const toml = readFileSync('netlify.toml', 'utf8');
    const rules = toml
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(rules).not.toContain('[[redirects]]');
  });
});
