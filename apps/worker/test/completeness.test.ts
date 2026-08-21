/**
 * What "present" means, checked in one place.
 *
 * The migration script and the verification script each had their own answer and disagreed: one
 * reported 5/5 present while the other reported 0 complete runs, reading the same database. The
 * migration's answer was wrong in the way that mattered — it tested for a row's *existence* and
 * reported "already migrated", so five half-written runs were skipped permanently.
 *
 * These tests pin the definition, not the plumbing.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, type Finding, type ScreeningReport } from '@mintro/engine';
import { citedEvidenceKeys, countFindings, describeCompleteness } from '../src/store/completeness.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

function report(): ScreeningReport {
  const findings: Finding[] = [
    {
      ruleId: 'NAME-001',
      state: 'fail',
      note: 'Observed.',
      evidenceKind: 'document',
      evidence: [
        {
          kind: 'document',
          sourceUrl: 'https://shop.example/sitemap.xml',
          sourceSha256: 'a'.repeat(64),
          evidenceKey: 'run-1/layer0/aaa',
          capturedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    },
    {
      ruleId: 'DISC-002',
      state: 'pass',
      note: 'Observed.',
      evidenceKind: 'rendered_page',
      evidence: [
        {
          kind: 'rendered_page',
          sourceUrl: 'https://shop.example/',
          sourceSha256: 'b'.repeat(64),
          evidenceKey: 'run-1/layer1/bbb.png',
          capturedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    },
  ];

  return assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      findings,
      politeness: 'none declared',
    },
    ruleset,
  );
}

describe('citedEvidenceKeys', () => {
  it('collects every distinct key the findings cite', () => {
    const keys = citedEvidenceKeys(report());
    expect(keys.has('run-1/layer0/aaa')).toBe(true);
    expect(keys.has('run-1/layer1/bbb.png')).toBe(true);
  });

  it('ignores empty keys, which mean nothing was retained', () => {
    // A finding with no capture cites nothing; counting '' as a key would make every run look
    // like it was missing an object that never existed.
    expect([...citedEvidenceKeys(report())].every((key) => key !== '')).toBe(true);
  });
});

describe('countFindings', () => {
  it('counts every finding, including the ones filled in for unrun rules', () => {
    // assembleReport adds a not_evaluable finding for every rule no layer ran, so the count is
    // the whole rule set, not the two findings supplied.
    expect(countFindings(report())).toBe(ruleset.rules.length);
  });
});

describe('describeCompleteness', () => {
  const base = {
    runId: 'run-1',
    exists: true,
    status: 'complete',
    finished: true,
    hasReport: true,
    findingsInDb: 53,
    findingsExpected: 53,
    evidenceRows: 17,
    evidenceKeysCited: 17,
    missingEvidenceKeys: [],
    missingObjects: [],
    complete: true,
    problems: [],
  };

  it('says complete only when it is', () => {
    expect(describeCompleteness(base)).toContain('complete');
  });

  /** The distinction the whole module exists for. */
  it('never calls a half-written run present', () => {
    const halfWritten = {
      ...base,
      status: 'running',
      finished: false,
      hasReport: false,
      findingsInDb: 0,
      evidenceRows: 0,
      complete: false,
      problems: ["status is 'running', not 'complete'", 'no assembled report is stored'],
    };

    const described = describeCompleteness(halfWritten);
    expect(described).toContain('INCOMPLETE');
    expect(described).toContain('no assembled report');
  });

  it('distinguishes absent from incomplete', () => {
    // "Never migrated" and "migrated badly" need different responses: one is a fresh write, the
    // other a resume.
    expect(describeCompleteness({ ...base, exists: false, complete: false })).toBe('not present');
  });

  it('names the missing pieces rather than only failing', () => {
    const missing = {
      ...base,
      complete: false,
      problems: ['3 cited evidence key(s) have no row'],
    };
    expect(describeCompleteness(missing)).toContain('3 cited evidence key(s)');
  });
});
