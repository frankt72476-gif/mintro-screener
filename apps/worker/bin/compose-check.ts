/**
 * Does the document compose well **at any size**?
 *
 *     npm run compose-check
 *
 * ## The question this answers, and the one it does not
 *
 * `page-budget` measures one run. That was the right tool for finding *which rule was wrong* —
 * without it the guess would probably have landed on capture size, which D-047 had already
 * measured and settled. But one run at 97 findings is one point, and a 5-finding report and a
 * 200-finding report compose differently.
 *
 * So this asserts a **property of the generation rules** rather than a fact about a document:
 *
 * > A printed report must not occupy materially more pages than its content fills.
 *
 * A document printing well beyond its content height means something is forcing breaks it should
 * not — which is exactly what `break-inside: avoid` on every finding row was doing, at a cost of
 * 27% of the printed document (D-075). The ratio catches that shape returning, in any report, at
 * any size, without anyone remembering to measure again.
 *
 * ## Why a range of shapes
 *
 * A near-empty report, a dense one, and a synthetic large one. A rule that behaves at 97 findings
 * can misbehave at 12 — a fixed block that is 3% of a long document is 30% of a short one — and a
 * check run against one storefront would report on that storefront rather than on the rules.
 */

import { chromium, type Browser } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { startReportServer } from '../src/reportServer.js';
import { renderReportPdf } from '../src/pdf.js';

const WEB_ROOT = process.env['WEB_ROOT'] ?? 'apps/web/dist';

/** A4 at 96dpi, less the 14mm margins `renderReportPdf` prints with. */
const PAGE_CONTENT_PX = (297 - 28) * (96 / 25.4);

/**
 * How much of the printed document may be page-break whitespace.
 *
 * **26%.** Some is unavoidable and wanted: an evidence slip must not split from its caption, and a
 * finding carrying a merchant response must stay whole (D-075), so every report ends pages early
 * sometimes. What this refuses is the *systemic* case — a rule ending a page early on every block
 * rather than on the few that need it.
 *
 * Measured, and chosen to separate the two cleanly rather than to sit just above today's number:
 *
 *     with `break-inside: avoid` on every finding row     27–30%   (the defect D-075 removed)
 *     with it on the slip and responses only              19–21%
 *
 * 26% sits in the gap. Restoring the old rule fails every report of a real size, which is what a
 * guard has to do — a ceiling at 30% caught one shape out of seven and would have read as noise.
 */
const MAX_BREAK_WASTE = 0.26;

/**
 * Below this, the ratio is not informative and is reported rather than asserted.
 *
 * The header, verdict, tick strip, coverage and participation record are a fixed cost. On a
 * six-finding report they are most of the document, so its waste ratio describes the preamble
 * rather than the rules this check is about — and both the good and the bad rule measure ~25%
 * there, which is a check that cannot fail.
 *
 * Reported anyway, and never silently skipped: *"this number does not tell you anything here"* and
 * *"this number is fine"* are different statements, and conflating them is the habit this codebase
 * spends most of its effort refusing (D-036).
 */
const RATIO_INFORMATIVE_ABOVE = 20;

interface Shape {
  readonly name: string;
  readonly report: ScreeningReport;
}

/** Tracked, so there is always something to check. See `fixtures/reports/README.md`. */
const REPORT_FIXTURES = 'fixtures/reports';

/**
 * The pinned reports, or an error.
 *
 * This read the gitignored `reports/` behind `if (!existsSync('reports')) return []`, and on a
 * clean checkout that returned nothing — which took the two synthetic shapes with it, since both
 * are derived from the smallest and largest real report. The whole check then ran over an empty
 * list and reported no problems. That is the conflation the header above objects to, in the
 * function that feeds it.
 */
function stored(): ScreeningReport[] {
  const files = readdirSync(REPORT_FIXTURES).filter((file) => file.endsWith('.json'));
  if (files.length === 0) throw new Error(`no report fixtures in ${REPORT_FIXTURES}/`);
  return files.map(
    (file) => JSON.parse(readFileSync(`${REPORT_FIXTURES}/${file}`, 'utf8')) as ScreeningReport,
  );
}

/**
 * The shapes to check.
 *
 * Real storefronts where they exist, because a fixture would only exercise the composition a
 * fixture author imagined. Two synthetic ones for the sizes no real run currently reaches: a report
 * far shorter than any we hold, and one twice as long.
 */
function shapes(reports: readonly ScreeningReport[]): Shape[] {
  const bySize = [...reports].sort(
    (a, b) => countFindings(a) - countFindings(b),
  );
  const smallest = bySize[0];
  const largest = bySize[bySize.length - 1];
  const chosen: Shape[] = [];

  for (const report of reports) {
    chosen.push({ name: `${report.merchantDomain} (${countFindings(report)})`, report });
  }

  if (smallest !== undefined) {
    const tiny = truncated(smallest, 6);
    chosen.push({ name: `synthetic short (${countFindings(tiny)})`, report: tiny });
  }
  if (largest !== undefined) {
    const huge = doubled(largest);
    chosen.push({ name: `synthetic long (${countFindings(huge)})`, report: huge });
  }

  return chosen;
}

const countFindings = (report: ScreeningReport): number =>
  report.categories.reduce((total, category) => total + category.findings.length, 0);

/** A short report: the first few findings, so fixed blocks are a large share of the whole. */
function truncated(report: ScreeningReport, keep: number): ScreeningReport {
  let left = keep;
  const categories = report.categories
    .map((category) => {
      const findings = category.findings.slice(0, Math.max(0, left));
      left -= findings.length;
      return { ...category, findings };
    })
    .filter((category) => category.findings.length > 0);

  return { ...report, categories };
}

/** A long report: every category twice, for a size no real run currently reaches. */
function doubled(report: ScreeningReport): ScreeningReport {
  return {
    ...report,
    categories: [
      ...report.categories,
      ...report.categories.map((category, index) => ({ ...category, id: `${category.id}-x${index}` })),
    ],
  };
}

async function measure(
  browser: Browser,
  origin: string,
  report: ScreeningReport,
): Promise<{ readonly pages: number; readonly contentPx: number }> {
  const page = await browser.newPage();
  await page.addInitScript((payload) => {
    (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
  }, { report, evidence: {} });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cat', { timeout: 20_000 });
  const contentPx = await page.evaluate(() => document.body.scrollHeight);
  await page.close();

  const pdf = await renderReportPdf(browser, {
    origin,
    domain: report.merchantDomain,
    inject: { report, evidence: {} },
  });

  return { pages: pdf.pages, contentPx };
}

async function main(): Promise<number> {
  const reports = stored();
  if (reports.length === 0) {
    console.error('No reports/ directory. Run `npm run scan-full -- --report-dir ./reports <url>` first.');
    return 1;
  }

  const browser = await chromium.launch();
  const server = await startReportServer({ webRoot: WEB_ROOT, mounts: {} });
  let failures = 0;

  try {
    console.log('compose-check · does the document compose well at any size?\n');
    console.log('  report                          findings   content   pages   waste');
    console.log('  ' + '-'.repeat(66));

    for (const shape of shapes(reports)) {
      const { pages, contentPx } = await measure(browser, server.origin, shape.report);
      const paperPx = pages * PAGE_CONTENT_PX;
      const waste = (paperPx - contentPx) / paperPx;
      const findings = countFindings(shape.report);
      const informative = findings > RATIO_INFORMATIVE_ABOVE;
      const ok = !informative || waste <= MAX_BREAK_WASTE;
      if (!ok) failures += 1;

      console.log(
        `  ${ok ? (informative ? 'ok  ' : '--  ') : 'FAIL'} ${shape.name.padEnd(30)} ` +
          `${String(findings).padStart(4)}  ` +
          `${(contentPx / PAGE_CONTENT_PX).toFixed(1).padStart(8)}  ` +
          `${String(pages).padStart(6)}  ` +
          `${(waste * 100).toFixed(0).padStart(5)}%` +
          (informative ? '' : '   fixed blocks dominate — reported, not asserted'),
      );
    }

    console.log('  ' + '-'.repeat(66));
    console.log(`  ceiling: ${(MAX_BREAK_WASTE * 100).toFixed(0)}% of the printed document\n`);

    if (failures > 0) {
      console.log(
        '  A report printing materially more pages than its content fills means something is\n' +
          '  forcing page breaks it should not. Run `npm run page-budget -- <run-id>` to see which\n' +
          '  section, and do not raise the ceiling to make this pass.',
      );
    }
  } finally {
    await server.close();
    await browser.close();
  }

  console.log(failures === 0 ? 'All shapes compose within the ceiling.' : `${failures} shape(s) over the ceiling.`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
