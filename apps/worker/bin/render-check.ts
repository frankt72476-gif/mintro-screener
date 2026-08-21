/**
 * Proves the browser stack end to end: launch Chromium, render one page, capture it, and
 * report what came back.
 *
 * This exists to be the first thing run in a new container. If it works, the image is sound;
 * if it does not, the failure is here rather than buried in a screening run.
 *
 *     npm run render-check                          # renders example.com
 *     npm run render-check -- https://shop.example
 */

import { chromium } from 'playwright';
import { createPacer, resolveCrawlDelay } from '@mintro/engine';
import { renderPage } from '../src/render.js';

async function main(argv: readonly string[]): Promise<number> {
  const url = argv[0] ?? 'https://example.com';
  const runId = 'render-check';

  console.log(`launching chromium…`);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  try {
    console.log(`chromium ${browser.version()}`);
    console.log(`rendering ${url}…\n`);

    const started = Date.now();
    const { page, artifacts } = await renderPage(browser, url, {
      runId,
      pacer: createPacer(resolveCrawlDelay(null)),
    });

    if (page.renderError !== undefined) {
      console.error(`RENDER FAILED: ${page.renderError}`);
      return 1;
    }

    const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot');
    const dom = artifacts.find((artifact) => artifact.kind === 'dom');

    console.log(`  status       ${page.httpStatus}`);
    console.log(`  final url    ${page.finalUrl}`);
    console.log(`  title        ${page.title}`);
    console.log(`  text         ${page.text.length} chars`);
    console.log(`  links        ${page.links.length}`);
    console.log(`  text runs    ${page.styledText.length} styled`);
    console.log(`  footer       ${page.footer.found ? `found via ${page.footer.locatedBy}` : 'not found'}`);
    console.log(`  screenshot   ${screenshot === undefined ? 'NOT CAPTURED' : `${format(screenshot.byteLength)} png`}`);
    console.log(`  dom snapshot ${dom === undefined ? 'NOT CAPTURED' : `${format(dom.byteLength)} (${format(dom.gzipByteLength)} gzipped)`}`);
    console.log(`  sha256       ${page.htmlSha256.slice(0, 16)}…`);
    console.log(`  elapsed      ${Date.now() - started}ms`);

    // The whole point of the check: a rendered-page finding needs both captures (D-012).
    if (screenshot === undefined || dom === undefined) {
      console.error('\nFAILED: a rendered page must produce both a screenshot and a DOM snapshot.');
      return 1;
    }

    console.log('\nOK — browser stack is working end to end.');
    return 0;
  } finally {
    await browser.close();
  }
}

const format = (bytes: number): string =>
  bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;

main(process.argv.slice(2)).then((code) => process.exit(code));
