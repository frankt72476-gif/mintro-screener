/**
 * What the printed report actually says about the merchant's side of it.
 *
 *     npm run print-check                                    # where one run is stored
 *     npm run print-check -- c268f8d7                        # by run id
 *     npm run print-check -- c268f8d7 --report-dir fixtures/reports
 *
 * It used to render `readdirSync('reports').find(...)` — the first `.json` in directory order — and
 * name the merchant it happened to land on. With more than one run stored that is a check on an
 * arbitrary document, and the report line it printed gave no way to notice: it read like a choice.
 * It now names a run or refuses to guess (D-169).
 *
 * ## Why this exists as a script and not as a unit test
 *
 * The PDF that reaches IQwallet was rendering **no merchant responses at all**. `ReportView`
 * accepted `commentaryOf`, the print branch passed it to `CategoryCard`, and `CategoryCard` had no
 * such prop — a spread of a conditional object, `{...(x === undefined ? {} : { x })}`, which JSX
 * accepts without an excess-property check. Every unit test passed. The screen showed a merchant's
 * account and the export did not, which is the one place D-063 says the two must not differ.
 *
 * Nothing that inspects the component tree would have caught it, because the component tree was
 * internally consistent. This asks the **rendered document** what it says.
 *
 * ## Why it reads the DOM rather than the PDF's text
 *
 * `extractPdfText` cannot decode the subset-embedded fonts Chromium writes — it exists to tell
 * whether a *fetched* document is readable prose (D-057), not to decode our own output. The DOM is
 * what `page.pdf()` prints, so it is the authority on what the PDF contains; the PDF is checked for
 * page count and size, which is what it can honestly answer.
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { readStoredRuns, requireSingleRun, selectRun } from '../src/selectRun.js';
import { flagValue, positionals } from '../src/cliArgs.js';
import type { CommentInvitation, MerchantComment, ScreeningReport } from '@mintro/engine';
import { startReportServer } from '../src/reportServer.js';
import { renderReportPdf } from '../src/pdf.js';

interface Scenario {
  readonly name: string;
  readonly invitation: CommentInvitation;
  readonly comments: readonly MerchantComment[];
  /** Text that must appear in the rendered document. */
  readonly expect: readonly string[];
  /** Text that must not. */
  readonly refuse?: readonly string[];
}

const SENTINEL = 'SENTINEL_MERCHANT_WORDS';

/**
 * Every commentary state, because each renders nearly blank and they mean opposite things.
 *
 * "Nobody opened it" and "someone identified themselves and wrote nothing" support opposite
 * inferences about a merchant. A document that rendered either as the other would put Mintro's
 * delivery failure in front of an underwriter as the merchant's silence (D-044).
 */
function scenarios(ruleId: string): readonly Scenario[] {
  const opened = '2026-08-23T23:29:54.000Z';
  const visits = [{ identifiedAs: 'ops@shop.example', identifiedAt: '2026-08-24T09:16:00.000Z' }];

  return [
    {
      name: 'commented — their words, attributed',
      invitation: { issued: true, firstOpenedAt: opened, sentTo: ['agent@example.com'], visits },
      comments: [
        {
          ruleId,
          body: `${SENTINEL}: we changed this on the 12th.`,
          identifiedAs: 'ops@shop.example',
          submittedAt: '2026-08-24T09:20:00.000Z',
        },
      ],
      expect: [
        'merchant participation',
        'agent@example.com',
        'report first opened',
        SENTINEL.toLowerCase(),
        'merchant response',
        'identified themselves as ops@shop.example',
        'self-declared',
        'carry no response',
      ],
    },
    {
      name: 'no_comment — identified, wrote nothing',
      invitation: { issued: true, firstOpenedAt: opened, sentTo: ['agent@example.com'], visits },
      comments: [],
      expect: ['left no comment on it', '0 of'],
      refuse: [SENTINEL.toLowerCase()],
    },
    {
      name: 'unidentified — opened, nobody said who',
      invitation: { issued: true, firstOpenedAt: opened, sentTo: ['agent@example.com'] },
      comments: [],
      expect: ['nobody identified themselves'],
      // Never "left no comment": nobody was there to leave one, and the two are different facts.
      refuse: ['left no comment on it'],
    },
    {
      name: 'unopened — sent, never opened',
      invitation: { issued: true, sentTo: ['agent@example.com'] },
      comments: [],
      expect: ['has not opened the report', 'not opened'],
      refuse: ['left no comment on it'],
    },
    {
      name: 'not_invited — nothing was transmitted',
      invitation: { issued: false },
      comments: [],
      expect: ['was not asked to respond'],
      // Mintro's inaction must never render as the merchant's silence (D-044).
      refuse: ['left no comment on it', 'has not opened the report'],
    },
  ];
}

async function main(argv: readonly string[]): Promise<number> {
  const selector = positionals(argv, ['--report-dir'])[0];
  const reportDir = flagValue(argv, '--report-dir', 'reports');

  if (!existsSync(reportDir)) {
    console.error(
      `No ${reportDir}/ directory. Run \`npm run scan-full -- --report-dir ./reports <url>\` first,
` +
        `  or point this at the tracked corpus: --report-dir fixtures/reports`,
    );
    return 1;
  }

  let report: ScreeningReport;
  try {
    const runs = readStoredRuns(reportDir);
    report = (selector === undefined ? requireSingleRun(runs) : selectRun(runs, selector)).report;
  } catch (error) {
    console.error(`${(error as Error).message}
`);
    return 1;
  }
  const invited = report.categories
    .flatMap((category) => category.findings)
    .filter((finding) => finding.state === 'fail' || finding.state === 'review');

  if (invited.length < 2) {
    console.error(`${report.merchantDomain} has fewer than two invited findings; nothing to check.`);
    return 1;
  }

  console.log(`print-check · ${report.merchantDomain} · ${invited.length} invited findings\n`);

  const browser = await chromium.launch();
  const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
  let failures = 0;

  try {
    for (const scenario of scenarios(invited[0]!.ruleId)) {
      const commentary = {
        invitation: scenario.invitation,
        comments: scenario.comments,
        undelivered: null,
      };

      const page = await browser.newPage();
      await page.addInitScript((payload) => {
        (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
      }, { report, evidence: {}, commentary });
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.waitForSelector('.partic', { timeout: 20_000 });

      // Lower-cased: several labels are uppercased by CSS, and innerText returns what renders.
      const text = (await page.evaluate(() => document.body.innerText))
        .replace(/\s+/g, ' ')
        .toLowerCase();

      const missing = scenario.expect.filter((probe) => !text.includes(probe));
      const present = (scenario.refuse ?? []).filter((probe) => text.includes(probe));

      const ok = missing.length === 0 && present.length === 0;
      if (!ok) failures += 1;

      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${scenario.name}`);
      for (const probe of missing) console.log(`          missing: ${probe}`);
      for (const probe of present) console.log(`          must not appear: ${probe}`);

      await page.close();
    }

    /*
      The attribution treatment, which was chosen partly for print (D-063).

      Amber and serif are not decoration: they are two of the four signals that keep a merchant's
      words unmistakably theirs. In a printed document a border can read as a table rule and colour
      fails a reader who cannot see it, which is exactly why the typeface carries it too.
    */
    const page = await browser.newPage();
    await page.addInitScript((payload) => {
      (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
    }, {
      report,
      evidence: {},
      commentary: {
        invitation: {
          issued: true,
          firstOpenedAt: '2026-08-23T23:29:54.000Z',
          sentTo: ['agent@example.com'],
          visits: [{ identifiedAs: 'ops@shop.example', identifiedAt: '2026-08-24T09:16:00.000Z' }],
        },
        comments: [
          {
            ruleId: invited[0]!.ruleId,
            body: SENTINEL,
            identifiedAs: 'ops@shop.example',
            submittedAt: '2026-08-24T09:20:00.000Z',
          },
        ],
        undelivered: null,
      },
    });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('.mr.mr-said', { timeout: 20_000 });

    const style = await page.evaluate(() => {
      const block = document.querySelector('.mr.mr-said')!;
      const quote = block.querySelector('.mr-body')!;
      const partic = document.querySelector('.partic')!;
      return {
        rule: getComputedStyle(block).borderLeftColor,
        quoteFont: getComputedStyle(quote).fontFamily,
        particFont: getComputedStyle(partic).fontFamily,
        head: block.querySelector('.mr-head')?.textContent ?? '',
        // D-074 replaced the collapsed unanswered enumeration with a named list of what *was*
        // responded to. There is no longer a `<details>` to be open, and nothing is hidden.
        listHidden: document.querySelector('.partic-list') === null,
      };
    });

    // `/serif/` matches "sans-serif" too, which passed this check for the wrong reason. The two
    // faces are asserted by what they are, and then asserted to differ.
    const isSerif = (font: string): boolean => /serif/i.test(font) && !/sans-serif/i.test(font);

    const checks: readonly [string, boolean][] = [
      ['merchant words are set in a serif face', isSerif(style.quoteFont)],
      ['the participation record is not', !isSerif(style.particFont)],
      ['the two faces differ, so the voices do', style.quoteFont !== style.particFont],
      ['their block carries an amber rule', style.rule !== 'rgba(0, 0, 0, 0)'],
      ['every block names its source', style.head === 'Merchant response'],
      ['what was responded to is listed, not collapsed', !style.listHidden],
    ];

    console.log('');
    for (const [name, ok] of checks) {
      if (!ok) failures += 1;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    }
    console.log(`        rule ${style.rule} · quote ${style.quoteFont}`);

    // And the document itself renders, which is the thing all of the above is about.
    const pdf = await renderReportPdf(browser, {
      origin: server.origin,
      domain: report.merchantDomain,
      inject: {
        report,
        evidence: {},
        commentary: {
          invitation: { issued: true, firstOpenedAt: '2026-08-23T23:29:54.000Z', sentTo: ['a@b.co'] },
          comments: [],
          undelivered: null,
          // Nothing has gone to IQwallet in this fixture, so no version of any response is one an
          // underwriter could hold (D-147).
          sentAt: [],
          invitedAddresses: [{ address: 'a@b.co', invitedAt: '2026-08-23T20:00:00.000Z' }],
        },
      },
    });
    console.log(`\n  ok    printed ${pdf.pages} page(s), ${(pdf.bytes.byteLength / 1024).toFixed(0)} KB`);

    await page.close();
  } finally {
    await server.close();
    await browser.close();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  return failures === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
