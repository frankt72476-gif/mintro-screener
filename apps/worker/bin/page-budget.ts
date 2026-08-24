/**
 * What the exported document costs, by section.
 *
 *     npm run page-budget -- <run-id>
 *
 * D-047 settled the capture-size trade by measuring page counts rather than estimating them, and
 * the table of options is what made that decision reviewable. Four legitimate additions have grown
 * the document since — the requirement column, the four-column coverage breakdown, the
 * participation record and the merchant response blocks — so the same method applies again.
 *
 * ## It measures space, and separates content from air
 *
 * Every section reports its own height and the height of what it contains. The gap is padding,
 * margin and reserved space: **the part that can be reduced without removing anything a reader
 * gets.** Block spacing chosen when a page held three findings is the usual culprit at twelve.
 *
 * Page equivalents are the printed page's content height, so a section's cost is stated in the
 * unit the decision is actually about.
 *
 * **Capture size is out of scope.** That trade was measured and settled (D-047); re-litigating it
 * blind is what that entry exists to prevent.
 */

import { chromium } from 'playwright';
import { readRunCommentary, type ScreeningReport } from '@mintro/engine';
import { startReportServer } from '../src/reportServer.js';
import { renderReportPdf } from '../src/pdf.js';
import { createWorkerSupabase } from '../src/store/supabase.js';

const WEB_ROOT = process.env['WEB_ROOT'] ?? 'apps/web/dist';

/** A4 at 96dpi, less the 14mm margins `renderReportPdf` prints with. */
const PAGE_CONTENT_PX = (297 - 28) * (96 / 25.4);

interface Measured {
  readonly section: string;
  readonly count: number;
  readonly totalPx: number;
  readonly contentPx: number;
}

async function main(argv: readonly string[]): Promise<number> {
  const runId = argv[0];
  if (runId === undefined) {
    console.error('Usage: npm run page-budget -- <run-id>');
    return 1;
  }

  const supabase = createWorkerSupabase();
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();
  if (error !== null) throw new Error(`could not read run ${runId}: ${error.message}`);

  const report = (data as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    console.error(`Run ${runId} has no stored report.`);
    return 1;
  }

  const commentary = await readRunCommentary(supabase.client, runId);

  const browser = await chromium.launch();
  const server = await startReportServer({ webRoot: WEB_ROOT, mounts: {} });

  try {
    const page = await browser.newPage();
    await page.addInitScript((payload) => {
      (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
    }, { report, evidence: {}, commentary });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cat', { timeout: 20_000 });

    /*
      Content height is the union of the children's boxes, so the difference from the element's own
      height is padding, margin collapse and reserved space — the air. Measured rather than read off
      the stylesheet, because what a rule computes to depends on everything around it.
    */
    const measured = (await page.evaluate(() => {
      const SECTIONS: readonly [string, string][] = [
        ['print header', '.print-head'],
        ['participation record', '.partic'],
        ['verdict banner', '.verdict'],
        ['tick strip', '.strip'],
        ['coverage breakdown', '.cov'],
        ['same-observation block', '.same-obs'],
        ['coverage', '.coverage'],
        ['category cards', '.cat'],
        ['finding rows', '.find'],
        ['requirement pairs', '.req'],
        ['evidence slips', '.slip'],
        ['merchant responses', '.mr'],
      ];

      return SECTIONS.map(([section, selector]) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        let totalPx = 0;
        let contentPx = 0;

        for (const node of nodes) {
          const box = node.getBoundingClientRect();
          totalPx += box.height;

          let top = Infinity;
          let bottom = -Infinity;
          for (const child of Array.from(node.children)) {
            const childBox = child.getBoundingClientRect();
            if (childBox.height === 0) continue;
            top = Math.min(top, childBox.top);
            bottom = Math.max(bottom, childBox.bottom);
          }
          contentPx += bottom > top ? bottom - top : box.height;
        }

        return { section, count: nodes.length, totalPx, contentPx };
      });
    })) as Measured[];

    const documentPx = await page.evaluate(() => document.body.scrollHeight);

    console.log(`page-budget - ${report.merchantDomain} - run ${runId.slice(0, 8)}`);
    console.log('');
    console.log('  section                  n     height   content       air   pages');
    console.log('  ' + '-'.repeat(64));

    for (const row of measured) {
      if (row.count === 0) continue;
      const air = row.totalPx - row.contentPx;
      console.log(
        `  ${row.section.padEnd(22)} ${String(row.count).padStart(3)}  ` +
          `${(row.totalPx / 1000).toFixed(1).padStart(7)}k  ` +
          `${(row.contentPx / 1000).toFixed(1).padStart(7)}k  ` +
          `${(air / 1000).toFixed(1).padStart(7)}k  ` +
          `${(row.totalPx / PAGE_CONTENT_PX).toFixed(1).padStart(5)}`,
      );
    }

    console.log('  ' + '-'.repeat(64));
    console.log(
      `  whole document              ${(documentPx / 1000).toFixed(1).padStart(7)}k` +
        `                     ${(documentPx / PAGE_CONTENT_PX).toFixed(1).padStart(5)}`,
    );

    // Per finding, which is the number that decides whether spacing chosen at three per page still
    // makes sense at twelve.
    const findings = measured.find((m) => m.section === 'finding rows');
    if (findings !== undefined && findings.count > 0) {
      const air = (findings.totalPx - findings.contentPx) / findings.count;
      console.log('');
      console.log(
        `  per finding: ${(findings.totalPx / findings.count).toFixed(0)}px, of which ` +
          `${air.toFixed(0)}px is air`,
      );
    }

    await page.close();

    const pdf = await renderReportPdf(browser, {
      origin: server.origin,
      domain: report.merchantDomain,
      inject: { report, evidence: {}, commentary },
    });

    /*
      The gap between content and paper is the number this exists to find.

      A block that must not split across a page - `break-inside: avoid` - pushes to the next page
      whenever it does not fit, leaving the rest of the current one blank. At three findings per
      page that is a small tax; at twelve it is paid ninety-seven times.

      **Dead space, not content**: no reader gets anything for it.
    */
    const paperPx = pdf.pages * PAGE_CONTENT_PX;
    const breakWaste = paperPx - documentPx;

    console.log('');
    console.log(`  printed: ${pdf.pages} pages, ${(pdf.bytes.byteLength / 1024).toFixed(0)} KB`);
    console.log(
      `  content fills ${(documentPx / PAGE_CONTENT_PX).toFixed(1)} pages; ` +
        `${(breakWaste / PAGE_CONTENT_PX).toFixed(1)} pages are page-break whitespace ` +
        `(${((breakWaste / paperPx) * 100).toFixed(0)}% of the printed document)`,
    );
    console.log('  (captures excluded here - the sent artifact was 76 pages with them)');
  
  } finally {
    await server.close();
    await browser.close();
  }

  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
