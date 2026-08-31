/**
 * Nothing asks the merchant for anything unless a link was sent (D-218).
 *
 * The report solicited a comment five times — in a document whose own participation record read
 * **"No comment link was transmitted for this run, so the merchant was not asked to respond."**
 * Nobody could act on any of them, and an underwriter reading both would reasonably conclude the
 * merchant had been asked and had ignored it.
 *
 * One flag, read at every call site. These assert the two directions of it and that the two
 * surfaces agree, since the PDF and the screen render the same component from the same parts.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { Participation, ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { reportParts } from '../src/lib/grouping.js';

const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS: readonly (readonly [string, ScreeningReport])[] = [
  ['5b29036d', load('run-5b29036d')],
  ['c268f8d7', load('run-c268f8d7')],
  ['live-comopeptides', load('live-comopeptides')],
];

/** Every string in the report that asks the merchant to say something. */
const ASKS = [
  'Tell us if we have the',
  'Tell us where we have it wrong',
  'your comment helps',
  'comment where it helps',
  'tell us where we have it wrong',
] as const;

const access = { description: 'test', urlFor: async () => null };

const participation = (invited: boolean): Participation => ({
  invited,
  sentTo: invited ? ['merchant@example.test'] : [],
  firstOpenedAt: null,
  visits: [],
  offered: 0,
  answered: 0,
  unanswered: 0,
  findings: [],
});

const render = (
  report: ScreeningReport,
  props: Record<string, unknown>,
): string =>
  renderToStaticMarkup(createElement(ReportView, { report, access, ...props } as never))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');

describe('no link was transmitted', () => {
  it.each(RUNS)('%s: the report asks for nothing', (_label, report) => {
    const body = render(report, { participation: participation(false) });

    for (const ask of ASKS) expect(body, ask).not.toContain(ask);
  });

  it.each(RUNS)('%s: and the PDF asks for nothing either', (_label, report) => {
    /*
      The same component, the same parts, one flag. The two surfaces cannot disagree about this
      unless somebody adds a second derivation — which is what this asserts.
    */
    const body = render(report, { participation: participation(false), print: true });

    for (const ask of ASKS) expect(body, ask).not.toContain(ask);
  });

  it.each(RUNS)('%s: it still states everything it observed', (_label, report) => {
    /*
      Only the invitation is conditional. A section that dropped its count or its observation with
      the ask would be hiding a finding because nobody was asked about it.
    */
    const asked = render(report, { participation: participation(true) });
    const unasked = render(report, { participation: participation(false) });

    expect(unasked).toContain('did not meet a standard');
    expect(unasked.length).toBeLessThan(asked.length);
    // Not the stopping band: `run-5b29036d` predates the blocking record and renders the panel's
    // "screened before stopping conditions were recorded" branch instead (D-161).
    for (const heading of ['Not met', 'For your review']) {
      expect(unasked).toContain(heading);
    }
  });
});

describe('a link was transmitted', () => {
  it.each(RUNS)('%s: the report asks', (_label, report) => {
    const body = render(report, { participation: participation(true) });

    expect(ASKS.some((ask) => body.includes(ask))).toBe(true);
  });
});

describe('the merchant’s own page', () => {
  it.each(RUNS)('%s: asks, because the page is the link', (_label, report) => {
    /*
      `CommentPane` passes no participation record — the record is *about* the merchant and is not
      shown to them — and that page is reachable only with a link token. Gating on the record alone
      removed every invitation from the one page whose purpose is to invite.
    */
    const body = render(report, { surface: 'merchant' });

    expect(ASKS.some((ask) => body.includes(ask))).toBe(true);
  });
});

describe('nothing knows whether a link exists', () => {
  it.each(RUNS)('%s: does not ask on a maybe', (_label, report) => {
    // The analyst's own ?print=1 path, which reads no commentary at all.
    const body = render(report, { print: true });

    for (const ask of ASKS) expect(body, ask).not.toContain(ask);
  });
});

describe('the flag reaches every part', () => {
  it.each(RUNS)('%s: each part records whether it may ask', (_label, report) => {
    const asked = reportParts(report, 'agent', { invited: true });
    const unasked = reportParts(report, 'agent', { invited: false });

    expect(asked.filter((part) => part.solicits).length).toBeGreaterThan(0);
    expect(unasked.every((part) => !part.solicits)).toBe(true);
  });

  it.each(RUNS)('%s: defaults to not asking', (_label, report) => {
    expect(reportParts(report, 'agent').every((part) => !part.solicits)).toBe(true);
  });
});
