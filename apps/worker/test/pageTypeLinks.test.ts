/**
 * Page-type discovery reads rendered links from every established page (cluster 4 commit 3a).
 *
 * The first adult screen (run 6571d6a9, xchar.ai) reached terms and nothing else on the primary site:
 * create, generate, pricing, library, guidelines and removal all came back "no candidate paths were
 * available to try" although the homepage links every one. Two gaps, each held here against a real
 * browser and a storefront served locally:
 *
 *   - **Links are read after render.** The homepage's nav is built by script, so the bytes the server
 *     sends carry none of its links. Discovery reads the links `renderPage` extracted from the DOM.
 *   - **Every established page contributes its chrome.** The removal policy is linked from the terms
 *     page's footer and nowhere on the homepage, and it has no conventional path to guess.
 *
 * And the served origin: the scan was queued as the apex and served from www, and every candidate
 * was compared with the apex. `servedOriginOf` is held on its own below, since a local server cannot
 * be reached under two hostnames.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADULT_AI_PAGES, PEPTIDE_PAGES } from '@mintro/ruleset';
import { createPacer, resolveCrawlDelay, type PageContext } from '@mintro/engine';
import { renderPage } from '../src/render.js';
import { chromeLinksOf, discoverLayer3 } from '../src/signup.js';
import { servedOriginOf } from '../src/screen.js';

/** Enough prose to clear the 400-character floor that tells a document from a themed error page. */
const PROSE =
  '<p>This page describes how the service works, what members can expect from it, and how to reach ' +
  'the team behind it. It is written for anyone deciding whether the service suits them, and it is ' +
  'kept up to date as the service changes. Questions about anything here can be sent to the support ' +
  'address listed at the foot of every page, and a member of the team will answer them in turn.</p>';

const page = (title: string, body: string, footer: string): string =>
  `<!doctype html><html><head><title>${title}</title></head><body><main>${body}${PROSE}</main>` +
  `<footer><ul>${footer}</ul></footer></body></html>`;

/** The homepage: an empty nav the page fills in after load, and a footer linking only the terms. */
const HOMEPAGE =
  '<!doctype html><html><head><title>Companion</title></head><body>' +
  '<header><nav id="site-nav"></nav></header>' +
  '<main><h1>Make a companion</h1><p>Chat with characters you create.</p></main>' +
  '<footer><ul><li><a href="/terms-of-service">Terms of Service</a></li></ul></footer>' +
  '<script>document.addEventListener("DOMContentLoaded", function () {' +
  'var nav = document.getElementById("site-nav");' +
  'nav.innerHTML = \'<a href="/create-character">Create Character</a><a href="/pricing">Pricing</a>\';' +
  '});</script></body></html>';

const PAGES: Record<string, string> = {
  '/': HOMEPAGE,
  '/terms-of-service': page(
    'Terms of Service',
    '<h1>Terms of Service</h1><p>These terms govern your use of the service. You must be 18 or older.</p>',
    '<li><a href="/terms-of-service">Terms of Service</a></li>' +
      '<li><a href="/content-removal-policy">Content Removal Policy</a></li>',
  ),
  '/content-removal-policy': page(
    'Content Removal Policy',
    '<h1>Content Removal Policy</h1><p>To request removal of content, write to removals@example.test.</p>',
    '',
  ),
  '/create-character': page('Create Character', '<h1>Create a character</h1><p>Name, look, personality.</p>', ''),
  '/pricing': page('Pricing', '<h1>Pricing</h1><p>Monthly plans and credits.</p>', ''),
};

let browser: Browser;
let server: Server;
let origin: string;
const requested: string[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    requested.push(path);
    const body = PAGES[path];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html' });
    res.end(body ?? page('Not found', '<h1>Not found</h1>', ''));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

async function discover(): Promise<{ homepage: PageContext; found: Awaited<ReturnType<typeof discoverLayer3>> }> {
  const pacer = createPacer(resolveCrawlDelay(null));
  const rendered = await renderPage(browser, `${origin}/`, { runId: 'page-type-links', pacer });
  const found = await discoverLayer3(browser, origin, {
    runId: 'page-type-links',
    pacer,
    pages: ADULT_AI_PAGES,
    servedOrigin: servedOriginOf(rendered.page, origin),
    homepageLinks: rendered.page.links.map((link) => ({
      href: link.href,
      text: link.text,
      inNav: link.inNav,
      inFooter: link.inFooter,
    })),
  });
  return { homepage: rendered.page, found };
}

describe('a homepage whose nav is present only after render', () => {
  it('sends no nav link in its markup: the only mention is inside the script that builds the nav', () => {
    const markup = HOMEPAGE.replace(/<script>[^]*?<\/script>/g, '');
    expect(markup).toContain('<nav id="site-nav"></nav>');
    expect(markup).not.toContain('/create-character');
    expect(markup).not.toContain('/pricing');
  });

  it('has its nav read from the rendered DOM, and each linked page type located', async () => {
    const { homepage, found } = await discover();

    const nav = homepage.links.filter((link) => link.inNav === true).map((link) => new URL(link.href).pathname);
    expect(nav).toEqual(expect.arrayContaining(['/create-character', '/pricing']));

    expect(found.pageTypes.get('create')).toMatchObject({ located: true, url: `${origin}/create-character` });
    expect(found.pageTypes.get('pricing')).toMatchObject({ located: true, url: `${origin}/pricing` });
  }, 120_000);
});

describe('a removal link present only on an inner page\'s footer', () => {
  it('is on the terms page and nowhere on the homepage', async () => {
    const { homepage } = await discover();
    expect(homepage.links.some((link) => link.href.includes('content-removal'))).toBe(false);
    expect(PAGES['/terms-of-service']).toContain('href="/content-removal-policy"');
    // No conventional path is guessed for a removal page, so the link is the only way in.
    expect(ADULT_AI_PAGES.documents?.find((d) => d.pageType === 'removal')?.paths).toEqual([]);
  }, 120_000);

  it('is located through the established terms page\'s footer', async () => {
    const { found } = await discover();

    expect(found.pageTypes.get('terms')).toMatchObject({ located: true, url: `${origin}/terms-of-service` });
    expect(found.pageTypes.get('removal')).toMatchObject({ located: true, url: `${origin}/content-removal-policy` });
  }, 120_000);
});

describe('chromeLinksOf', () => {
  const inner = {
    links: [
      { href: 'https://www.x.test/content-removal-policy', text: 'Content Removal Policy', inNav: false, inFooter: true },
      { href: 'https://www.x.test/pricing', text: 'Pricing', inNav: true, inFooter: false },
      { href: 'https://www.x.test/blog/report-2025', text: 'our 2025 report', inNav: false, inFooter: false },
    ],
  } as unknown as PageContext;

  it('reads an established page\'s nav and footer, and not its body copy', () => {
    expect(chromeLinksOf([inner]).map((link) => link.href)).toEqual([
      'https://www.x.test/content-removal-policy',
      'https://www.x.test/pricing',
    ]);
  });
});

describe('servedOriginOf', () => {
  it('reads the origin the homepage was served from, with or without www', () => {
    expect(servedOriginOf({ finalUrl: 'https://www.xchar.ai/' }, 'https://xchar.ai')).toBe('https://www.xchar.ai');
    expect(servedOriginOf({ finalUrl: 'https://xchar.ai/' }, 'https://www.xchar.ai')).toBe('https://xchar.ai');
  });

  it('keeps the crawl\'s origin for a redirect off the site, or a page with no usable URL', () => {
    expect(servedOriginOf({ finalUrl: 'https://parked.example/' }, 'https://xchar.ai')).toBe('https://xchar.ai');
    expect(servedOriginOf({ finalUrl: 'https://app.xchar.ai/' }, 'https://xchar.ai')).toBe('https://xchar.ai');
    expect(servedOriginOf({ finalUrl: '' }, 'https://xchar.ai')).toBe('https://xchar.ai');
  });
});

describe('peptide discovery is unchanged', () => {
  it('declares no page-type documents, so the pass that reads servedOrigin and the pool never runs', () => {
    expect(PEPTIDE_PAGES.documents).toBeUndefined();
  });
});
