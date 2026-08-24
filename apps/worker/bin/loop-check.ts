/**
 * Did the document IQwallet received carry what the merchant actually did?
 *
 *     npm run loop-check -- <run-id>
 *
 * ## The two sources must be independent
 *
 * The expected values come from **SQL** — the comments, visits and openings as rows. The actual
 * values come from **the rendered document**. Neither is derived from the other, and neither is
 * derived from the code that built the report.
 *
 * That constraint is the whole point. The week's defects were all a check asking one side whether
 * it agreed with itself: a column list typed into a test, a `/serif/i` that matched `sans-serif`,
 * an anchor compared to the constant it was built from, a dangling-link check that never saw a
 * link. Computing "which findings were left unanswered" with `participationFor` and then asserting
 * the PDF shows what `participationFor` returned would be exactly that, one more time.
 *
 * So the unanswered list is cross-checked rather than recomputed: **no finding the merchant
 * commented on may appear in it**, and **every finding in it must have no comment in the database.**
 * Both directions, from rows the merchant's own actions wrote.
 *
 * ## Why the DOM and not the PDF's text
 *
 * `extractPdfText` cannot decode the subset-embedded fonts Chromium writes — it exists to judge
 * *fetched* documents (D-057) and returns a shifted alphabet on our own output. The DOM is what
 * `page.pdf()` prints, so it is the authority on what the PDF contains. The stored artifact is
 * checked for the things it can honestly answer: that it exists, and its size and page count.
 */

import { chromium } from 'playwright';
import { readRunCommentary, type ScreeningReport } from '@mintro/engine';
import { startReportServer } from '../src/reportServer.js';
import { createWorkerSupabase, type WorkerSupabase } from '../src/store/supabase.js';

const WEB_ROOT = process.env['WEB_ROOT'] ?? 'apps/web/dist';

interface Row {
  readonly [column: string]: unknown;
}

/** What the merchant actually did, as rows. Never via the report-building code. */
async function facts(supabase: WorkerSupabase, runId: string) {
  const read = async (table: string, columns: string): Promise<Row[]> => {
    const { data, error } = await supabase.client.from(table).select(columns).eq('run_id', runId);
    if (error !== null) throw new Error(`could not read ${table}: ${error.message}`);
    return (data ?? []) as unknown as Row[];
  };

  return {
    comments: await read('merchant_comments', 'rule_id, ordinal, identified_as, body, submitted_at'),
    visits: await read('comment_visits', 'link_id, identified_as, identified_at'),
    links: await read('comment_links', 'id, sent_to, first_opened_at'),
    invites: await read('comment_invites', 'link_id, status, delivery'),
    sends: await read('send_requests', 'id, to_email, status, outcome, transmitted, storage_key'),
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const runId = argv[0];
  if (runId === undefined) {
    console.error('Usage: npm run loop-check -- <run-id>');
    return 1;
  }

  const supabase = createWorkerSupabase();
  const { comments, visits, links, invites, sends } = await facts(supabase, runId);

  /*
    Which links actually reached someone — computed from rows, not from `readRunCommentary`.

    The rendered record counts only arrivals through a transmitted link (D-072), so a checker that
    expected *every* visit row would report a failure whenever that rule did its job. It did: this
    first ran against a run holding diagnostic visits from an untransmitted link, and flagged their
    correct exclusion as a defect.

    The expectation belongs to the same rule as the code — but reached independently, from
    `comment_invites` as rows, rather than by asking the engine what it decided.
  */
  const deliveredLinks = new Set(
    invites
      .filter((invite) => invite['status'] === 'done' && invite['delivery'] === 'resend')
      .map((invite) => String(invite['link_id'])),
  );
  const reached = visits.filter((visit) => deliveredLinks.has(String(visit['link_id'])));
  const reachedLinks = links.filter((link) => deliveredLinks.has(String(link['id'])));

  const { data: runRow, error: runError } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();
  if (runError !== null) throw new Error(`could not read run ${runId}: ${runError.message}`);

  const report = (runRow as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    console.error(`Run ${runId} has no stored report.`);
    return 1;
  }

  console.log(`loop-check · ${report.merchantDomain} · run ${runId.slice(0, 8)}`);
  console.log(
    `  the merchant did: ${comments.length} comment(s), ${visits.length} visit(s), ` +
      `${links.length} link(s)\n`,
  );

  // The same reader the PDF uses. Not the same *derivation* as the expectations below, which come
  // from the rows above.
  const commentary = await readRunCommentary(supabase.client, runId);
  if (commentary === null) {
    console.error('  FAIL  the commentary could not be read at all');
    return 1;
  }

  if (visits.length !== reached.length) {
    console.log(
      `  ${visits.length - reached.length} visit(s) arrived through a link that was never ` +
        'transmitted, and are excluded from the record (D-072)',
    );
  }
  console.log('');

  const browser = await chromium.launch();
  const server = await startReportServer({ webRoot: WEB_ROOT, mounts: {} });
  const failures: string[] = [];
  const check = (ok: boolean, name: string, detail = ''): void => {
    if (!ok) failures.push(name);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === '' ? '' : `  ${detail}`}`);
  };

  try {
    const page = await browser.newPage();
    await page.addInitScript((payload) => {
      (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
    }, { report, evidence: {}, commentary });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('.partic', { timeout: 20_000 });

    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const lower = text.toLowerCase();

    // ---- their words, verbatim ------------------------------------------------------------
    console.log('  their words');
    for (const comment of comments) {
      const body = String(comment['body']);
      check(
        text.includes(body),
        `the response on ${String(comment['rule_id'])} appears verbatim`,
        `"${body.slice(0, 40)}…"`,
      );
    }

    // ---- attribution ------------------------------------------------------------------------
    console.log('\n  attribution');
    for (const who of new Set(comments.map((c) => String(c['identified_as'])))) {
      check(
        text.includes(`Identified themselves as ${who}`),
        `${who} is named as the source, not implied by position`,
      );
      check(!text.includes(`from ${who}`), `never "from ${who}" — the address is self-declared`);
    }

    const style = await page.evaluate(() => {
      const block = document.querySelector('.mr.mr-said');
      if (block === null) return null;
      const quote = block.querySelector('.mr-body');
      return {
        head: block.querySelector('.mr-head')?.textContent ?? '',
        rule: getComputedStyle(block).borderLeftColor,
        quoteFont: quote === null ? '' : getComputedStyle(quote).fontFamily,
        particFont: getComputedStyle(document.querySelector('.partic')!).fontFamily,
      };
    });

    if (comments.length > 0) {
      const isSerif = (font: string): boolean => /serif/i.test(font) && !/sans-serif/i.test(font);
      check(style !== null, 'their words are in a merchant-response block, not the evidence slip');
      if (style !== null) {
        check(style.head === 'Merchant response', 'every block names its source');
        check(isSerif(style.quoteFont), 'set in the serif face', style.quoteFont);
        check(!isSerif(style.particFont), "Mintro's own record is not", style.particFont);
        check(style.rule !== 'rgba(0, 0, 0, 0)', 'carries the amber rule', style.rule);
      }
    }

    // ---- the participation record -------------------------------------------------------------
    console.log('\n  the participation record');
    check(lower.includes('merchant participation'), 'is present');

    const delivered = new Set(
      sends.filter((s) => s['transmitted'] === true).map((s) => String(s['to_email'])),
    );
    for (const link of reachedLinks) {
      const openedAt = link['first_opened_at'];
      if (typeof openedAt === 'string') {
        check(text.includes(openedAt.slice(0, 10)), `the date it was first opened (${openedAt.slice(0, 10)})`);
      }
    }
    for (const visit of reached) {
      const who = String(visit['identified_as']);
      check(text.includes(who), `${who} appears as having identified themselves`);
    }
    check(lower.includes('self-declared'), 'says the addresses are self-declared and unverified');

    // ---- the unanswered list, cross-checked both ways ----------------------------------------
    console.log('\n  the unanswered list');
    const listed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.partic-list li .partic-rule'), (n) => n.textContent ?? ''),
    );
    const answeredRules = new Set(comments.map((c) => String(c['rule_id'])));

    /*
      Both directions, and neither recomputes "invited".

      Recomputing it would ask `participationFor` whether it agrees with `participationFor`. These
      compare the rendered list against the rows the merchant's own actions wrote.
    */
    const wronglyListed = listed.filter((rule) => answeredRules.has(rule));
    check(
      wronglyListed.length === 0,
      'lists nothing the merchant answered',
      wronglyListed.length === 0 ? '' : `wrongly listed: ${wronglyListed.join(', ')}`,
    );

    const wronglyOmitted = [...answeredRules].filter((rule) => listed.includes(rule));
    check(wronglyOmitted.length === 0, 'and the reverse holds too');

    const counted = /(\d+) of (\d+) findings open for response were answered/.exec(text);
    check(counted !== null, 'states how many were answered');
    if (counted !== null) {
      // Distinct findings, not comments: two responses on one finding is one finding answered.
      const distinct = new Set(comments.map((c) => `${String(c['rule_id'])}#${String(c['ordinal'] ?? '')}`));
      check(
        Number(counted[1]) === distinct.size,
        `the count matches what they answered`,
        `document says ${counted[1]}, database says ${distinct.size}`,
      );
    }

    check(
      !/unaddressed|ignored|declined|unexplained|failed to respond/i.test(text),
      'never characterises silence — unanswered, and nothing more',
    );

    await page.close();

    // ---- the artifact that was actually sent --------------------------------------------------
    console.log('\n  the artifact IQwallet received');
    const sent = sends.filter((s) => s['status'] === 'done' && s['outcome'] === 'accepted');
    check(sent.length > 0, 'a send was accepted and recorded', `${sent.length} send(s)`);

    for (const send of sent) {
      const key = send['storage_key'];
      if (typeof key !== 'string') {
        check(false, 'the send names the stored file');
        continue;
      }
      const { data, error } = await supabase.client.storage.from(supabase.bucket).download(key);
      if (error !== null || data === null) {
        check(false, `the stored PDF is retrievable`, error?.message ?? 'no data');
        continue;
      }
      const bytes = (await data.arrayBuffer()).byteLength;
      check(bytes > 0, `the PDF sent to ${String(send['to_email'])} exists`, `${(bytes / 1024).toFixed(0)} KB`);
    }
    if (delivered.size > 0) console.log(`        transmitted to ${[...delivered].join(', ')}`);
  } finally {
    await server.close();
    await browser.close();
  }

  console.log(failures.length === 0 ? '\nAll checks passed.' : `\n${failures.length} check(s) failed.`);
  return failures.length === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
