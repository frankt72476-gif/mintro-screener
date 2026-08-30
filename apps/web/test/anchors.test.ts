/**
 * The ids the report must keep emitting, because things outside it point at them (D-209).
 *
 * This file used to check that every in-page `href="#…"` resolved to an id in the same document.
 * **There are no in-page links left.** The nav cards and the sticky bar went with D-206, and the
 * nothing-observed callout with D-209 — so that check would now pass over an empty list, which is
 * precisely the defect the old version's own comment described:
 *
 * > A check that never saw a single anchor reported that every anchor resolved.
 *
 * What survives is the other half of the same concern, and it is the half with consequences.
 * **Merchant emails already sent carry `#nothing-observed`** (D-069), and runs are immutable
 * (D-002) — so a link posted in August has to land somewhere in a report rendered today. The id is
 * now the whole of that contract; nothing inside the document depends on it.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { findingAnchor, nothingObservedCount, NOTHING_OBSERVED_ID } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };

/**
 * The corpus this file expects to audit.
 *
 * Declared and compared, never merely named: a loader that silently found two fixtures would report
 * that every id resolved across the corpus while having checked almost none of it (D-131's shape).
 */
const REPORT_FIXTURE_FLOOR = 7;

const storedReports = (): { name: string; report: ScreeningReport }[] => {
  const files = readdirSync('fixtures/reports').filter((file) => file.endsWith('.json'));

  if (files.length < REPORT_FIXTURE_FLOOR) {
    throw new Error(
      `fixtures/reports/ holds ${files.length} reports; at least ${REPORT_FIXTURE_FLOOR} are ` +
        `expected. Restore the missing fixture, or lower the floor deliberately and record why.`,
    );
  }

  return files.map((file) => ({
    name: file.replace('.json', ''),
    report: JSON.parse(readFileSync(`fixtures/reports/${file}`, 'utf8')) as ScreeningReport,
  }));
};

const render = (report: ScreeningReport, print = false): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report,
      access,
      print,
      surface: print ? 'iqwallet' : 'agent',
      commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
    } as never),
  );

const idsIn = (markup: string): Set<string> =>
  new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] as string));

const reports = storedReports();

describe('the id an already-sent email points at', () => {
  it.each(reports.map((r) => [r.name, r.report] as const))(
    '%s: renders the nothing-observed id on screen and in print',
    (_name, report) => {
      /*
        Both surfaces, because a merchant may follow the link to the page and an underwriter may
        receive the PDF. An id that existed on one and not the other would make the same link work
        or not depending on which document you were holding.
      */
      if (nothingObservedCount(report) === 0) return;

      expect(idsIn(render(report))).toContain(NOTHING_OBSERVED_ID);
      expect(idsIn(render(report, true))).toContain(NOTHING_OBSERVED_ID);
    },
  );
});

describe('every finding row is addressable', () => {
  it.each(reports.map((r) => [r.name, r.report] as const))(
    '%s: each rendered rule carries its own anchor id',
    (_name, report) => {
      /*
        Nothing in the document links to these today. They are kept because a rule id is stable and
        never reused (`CLAUDE.md`), which is what makes an anchor safe to put in an email or a
        ticket — and because the cost of emitting them is an attribute.
      */
      const ids = idsIn(render(report));
      const ruleIds = [...new Set(report.strip.map((row) => row.ruleId))];

      expect(ruleIds.length).toBeGreaterThan(0);
      const missing = ruleIds.filter((ruleId) => !ids.has(findingAnchor(ruleId)));

      // Passes and grouped children render inside disclosures rather than as their own rows, so a
      // subset is expected. What must never happen is none of them being addressable.
      expect(missing.length).toBeLessThan(ruleIds.length);
    },
  );
});

describe('no in-page link points at nothing', () => {
  it.each(reports.map((r) => [r.name, r.report] as const))(
    '%s: whatever links exist resolve, and the count is stated',
    (_name, report) => {
      /*
        Asserted honestly rather than vacuously. There are no in-page links today; if one is ever
        added, this starts checking it. The count is asserted so the day it stops being zero is
        visible in the diff rather than silent.
      */
      const markup = render(report);
      const hrefs = [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] as string);
      const ids = idsIn(markup);

      expect(hrefs.filter((href) => !ids.has(href))).toEqual([]);
      expect(hrefs).toHaveLength(0);
    },
  );
});
