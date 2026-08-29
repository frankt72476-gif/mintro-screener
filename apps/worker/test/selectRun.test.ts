/**
 * Choosing a run, and refusing to (D-169).
 *
 * The defect this guards is not a crash. It is a CLI that renders a document about a run nobody
 * asked for, prints a merchant domain that is genuinely correct, and gives the reader nothing to
 * notice — two runs of one storefront at different rule-set versions look identical in every line
 * of output except the one nobody was printing.
 *
 * So the assertions that matter are the **refusals**. A resolver that returns something for every
 * input is the bug; these check it declines the two inputs where declining is the only honest
 * answer, and that the message names what to type instead.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreeningReport } from '@mintro/engine';
import { describeRun, readStoredRuns, requireSingleRun, selectRun, type StoredRun } from '../src/selectRun.js';
import { flagValue, positionals } from '../src/cliArgs.js';

const run = (runId: string, merchantDomain: string, rulesetVersion = '3.1.0'): StoredRun => ({
  file: `${runId}.json`,
  report: {
    runId,
    merchantDomain,
    rulesetVersion,
    startedAt: '2026-08-28T00:00:00.000Z',
  } as ScreeningReport,
});

/** The corpus that caused this: one storefront, two runs, two rule-set versions. */
const RUNS = [
  run('c268f8d7-1111-4000-8000-000000000001', 'sportstechnologylabs.com', '3.1.0'),
  run('71bea35a-2222-4000-8000-000000000002', 'sportstechnologylabs.com', '2.9.0'),
  run('74eefa47-3333-4000-8000-000000000003', 'swisschems.is', '2.9.0'),
  run('5b29036d-4444-4000-8000-000000000004', 'www.comopeptides.com', '3.1.0'),
];

describe('a run id selects', () => {
  it('matches in full', () => {
    expect(selectRun(RUNS, '74eefa47-3333-4000-8000-000000000003').report.merchantDomain).toBe(
      'swisschems.is',
    );
  });

  it('matches on the eight-character prefix everything else prints', () => {
    expect(selectRun(RUNS, '71bea35a').report.rulesetVersion).toBe('2.9.0');
  });

  it('is tried before the domain, so an id is never reread as a domain', () => {
    // Both runs share a domain; the id is what separates them, and it wins.
    expect(selectRun(RUNS, 'c268f8d7').report.rulesetVersion).toBe('3.1.0');
  });

  it('refuses a prefix too short to be a choice', () => {
    // "7" prefixes two ids. Matching it would pick one by array order, which is the whole defect.
    expect(() => selectRun(RUNS, '7')).toThrow(/no stored run matches/);
  });
});

describe('a domain selects only when it names one run', () => {
  it('resolves where the storefront was scanned once', () => {
    expect(selectRun(RUNS, 'swisschems.is').report.runId).toContain('74eefa47');
  });

  it('ignores a leading www., which is noise for selection', () => {
    expect(selectRun(RUNS, 'comopeptides.com').report.runId).toContain('5b29036d');
    expect(selectRun(RUNS, 'www.comopeptides.com').report.runId).toContain('5b29036d');
  });

  /** The reason this module exists. */
  it('refuses two runs of one storefront, and names both', () => {
    let message = '';
    try {
      selectRun(RUNS, 'sportstechnologylabs.com');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('matches 2 stored runs');
    // Both ids, so the operator can retype one. A message that said only "ambiguous" would leave
    // them running the same command again.
    expect(message).toContain('c268f8d7');
    expect(message).toContain('71bea35a');
    // And what tells them apart, which is not the domain.
    expect(message).toContain('3.1.0');
    expect(message).toContain('2.9.0');
  });

  it('lists what there is when nothing matches', () => {
    const message = (() => {
      try {
        selectRun(RUNS, 'nosuchshop.example');
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(message).toContain('no stored run matches');
    for (const stored of RUNS) expect(message).toContain(stored.report.runId.slice(0, 8));
  });
});

describe('no selector at all', () => {
  it('resolves when there is exactly one run and nothing to choose', () => {
    expect(requireSingleRun([RUNS[0] as StoredRun]).report.merchantDomain).toBe(
      'sportstechnologylabs.com',
    );
  });

  it('refuses to fall back to file order', () => {
    // `print-check` took `readdirSync(...).find(...)` — the first file — and named whichever
    // merchant that was. It read like a choice and was not one.
    expect(() => requireSingleRun(RUNS)).toThrow(/no selector/);
  });

  it('says plainly when there is nothing stored', () => {
    expect(() => requireSingleRun([])).toThrow(/no stored runs/);
  });
});

describe('describeRun prints what separates two runs', () => {
  it('carries the id, the rule-set version, the domain and the date', () => {
    expect(describeRun(RUNS[0] as StoredRun)).toBe(
      'c268f8d7 · 3.1.0 · sportstechnologylabs.com · 2026-08-28',
    );
  });
});

describe('reading a directory of runs', () => {
  it('skips a .json that carries no runId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify({ runId: 'abc', merchantDomain: 'a.example' }));
      // What `link-runs` writes beside the reports. Parsing it as a report would fail far from here.
      writeFileSync(join(dir, 'index.json'), JSON.stringify(['a']));
      expect(readStoredRuns(dir).map((r) => r.file)).toEqual(['a.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('argument parsing does not confuse a flag value for a positional', () => {
  const VALUE_FLAGS = ['--send', '--out', '--report-dir'];

  it('skips the token a flag consumes', () => {
    // The bug: `fixtures/reports` read as the run selector, the run id ignored.
    expect(positionals(['--report-dir', 'fixtures/reports', 'c268f8d7'], VALUE_FLAGS)).toEqual([
      'c268f8d7',
    ]);
  });

  it('reads the same either side of the positional', () => {
    expect(positionals(['c268f8d7', '--out', 'out/x'], VALUE_FLAGS)).toEqual(['c268f8d7']);
  });

  it('keeps a value that looks like a flag', () => {
    expect(flagValue(['--out', '--weird'], '--out', 'out')).toBe('--weird');
  });

  it('falls back when the flag ends the arguments', () => {
    expect(flagValue(['--out'], '--out', 'out')).toBe('out');
    expect(flagValue([], '--out', 'out')).toBe('out');
  });
});
