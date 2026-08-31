/**
 * One partition, and every count on the page reconciles against it (D-216).
 *
 * The report counted the same findings three ways and agreed with itself nowhere. The coverage
 * sentence read `report.coverage` — findings by kind, over the whole run. The section headings read
 * `groupReport` — rows by worst outcome, minus the stopping conditions, minus anything nested. So
 * *"14 were looked for and not found on the site"* sat four lines above a block headed `7 rules · 11
 * findings`, and *"3 are checks Mintro has not built yet"* sat above no block at all: all three were
 * pages of NAME-003, a rule whose worst outcome was review.
 *
 * These pin the two halves of the fix. `censusOf` is the one partition; every heading counts what it
 * is a heading for; and what is counted under one heading and shown under another is named in the
 * sentence rather than left for a reader to fail to find.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { censusOf, coverageSentence, reportParts } from '../src/lib/grouping.js';

const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS: readonly (readonly [string, ScreeningReport])[] = [
  ['5b29036d', load('run-5b29036d')],
  ['c268f8d7', load('run-c268f8d7')],
  ['live-comopeptides', load('live-comopeptides')],
  ['swisschems', load('swisschems.is')],
  ['biotechpeptides', load('biotechpeptides.com')],
];

describe('the census is the run’s own record, recomputed', () => {
  it.each(RUNS)('%s: reproduces report.coverage exactly', (_label, report) => {
    /*
      `report.coverage` is what the run recorded and is never recalculated — a completed run says
      what it said (D-002). This asserts the renderer's partition is the same partition, so the two
      cannot drift into telling a reader different numbers.
    */
    const census = censusOf(report);
    const c = report.coverage;

    expect(census.total).toBe(c.total);
    expect(census.byBucket.not_reachable).toBe(c.notReachable);
    expect(census.byBucket.not_exposed).toBe(c.notExposed);
    expect(census.byBucket.no_check_built).toBe(c.noCheckBuilt);
    expect(census.byBucket.not_applicable).toBe(c.notApplicable);
    expect(census.byBucket.not_retrieved).toBe(c.notRetrieved ?? 0);
    expect(census.byBucket.unrecorded).toBe(c.kindNotRecorded);
  });

  it.each(RUNS)('%s: every finding is in exactly one bucket or one state', (_label, report) => {
    const census = censusOf(report);
    const buckets = Object.values(census.byBucket).reduce((sum, n) => sum + n, 0);
    const evaluated = census.byState.fail + census.byState.review + census.byState.pass;

    expect(buckets).toBe(census.byState.not_evaluable);
    expect(buckets + evaluated).toBe(census.total);
  });
});

describe('the sentence and the blocks under it add up', () => {
  it.each(RUNS)('%s: each kind is fully accounted for', (_label, report) => {
    /*
      For every not-evaluable kind: what the sentence claims equals what the blocks show plus what
      the sentence says is shown elsewhere. This is the arithmetic a reader would do, and before the
      fix it failed on two kinds out of four.
    */
    const census = censusOf(report);
    const review = reportParts(report, 'iqwallet').find((part) => part.id === 'review');
    const blocks = review?.blocks ?? [];

    for (const [bucket, claimed] of Object.entries(census.byBucket)) {
      if (claimed === 0) continue;

      const shownHere = blocks
        .filter((block) => block.bucket === bucket)
        .reduce((sum, block) => sum + block.tally.findings, 0);
      const shownElsewhere = census.displaced
        .filter((item) => item.bucket === bucket)
        .reduce((sum, item) => sum + item.count, 0);

      expect(shownHere + shownElsewhere, `${bucket}: ${shownHere} shown + ${shownElsewhere} elsewhere`).toBe(
        claimed,
      );
    }
  });

  it.each(RUNS)('%s: a block counts only findings of its own kind', (_label, report) => {
    /*
      *Looked for, not found on the site* said `11 findings` over nine of that kind and two passes
      belonging to PROD-003's other sentence. A heading that counts findings it is not a heading for
      cannot be reconciled with anything.
    */
    const review = reportParts(report, 'iqwallet').find((part) => part.id === 'review');

    for (const block of review?.blocks ?? []) {
      if (block.bucket === undefined) continue;
      const own = block.groups.reduce(
        (sum, group) =>
          sum +
          group.findings.filter(
            (finding) =>
              finding.state === 'not_evaluable' &&
              (finding.notEvaluableKind ?? 'unrecorded') === block.bucket,
          ).length,
        0,
      );
      expect(block.tally.findings, block.key).toBe(own);
    }
  });
});

describe('the coverage sentence', () => {
  it.each(RUNS)('%s: names findings as findings', (_label, report) => {
    expect(coverageSentence(report)).toMatch(/^Of \d+ findings/);
  });

  it('says where the ones counted here and shown elsewhere are', () => {
    const report = load('live-comopeptides');
    const sentence = coverageSentence(report);
    const displaced = censusOf(report).displaced.reduce((sum, item) => sum + item.count, 0);

    expect(displaced).toBeGreaterThan(0);
    expect(sentence).toContain(`${displaced} of them are shown with the rule they belong to`);
    // The three that could not be found anywhere: all of NAME-003's unbuilt pages.
    expect(sentence).toContain('NAME-003');
    // And the cascade D-164 nests under its root rather than in its own block.
    expect(sentence).toContain('COA-006');
  });

  it('says nothing about displacement when there is none', () => {
    const report = load('biotechpeptides.com');
    const sentence = coverageSentence(report);
    const displaced = censusOf(report).displaced.reduce((sum, item) => sum + item.count, 0);

    if (displaced === 0) expect(sentence).not.toContain('shown with the rule');
  });
});

describe('every count on a band names its unit', () => {
  it.each(RUNS)('%s: no bare "observations" over a row count', (_label, report) => {
    for (const part of reportParts(report, 'iqwallet')) {
      // `bandStats` is what the band prints; the questions section counts questions, not rules.
      if (part.id === 'questions') continue;
      const stats = part.tally.rules;
      if (stats === 0) continue;
      expect(part.tally.findings).toBeGreaterThanOrEqual(stats);
    }
  });
});
