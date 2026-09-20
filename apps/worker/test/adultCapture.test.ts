/**
 * An adult AI run is captured as its findings report; a peptide run as before (cluster 4 commit 5).
 *
 * Three claims, each held on the path that makes it true:
 *
 *   - **Delivery.** `deliverCapture` is the only way a capture becomes real. For an adult run it stores
 *     a file carrying the findings report's statement of what it is, and refuses — writing nothing — a
 *     file that carries the evaluation's. A peptide capture still has to carry the evaluation's.
 *   - **The job.** `captureRunReport` never looks for an evaluation on an adult run, and still refuses a
 *     peptide run that has none, before a browser is touched.
 *   - **Send.** Still refused for an adult run: `latestCapture` finds the capture and then requires a
 *     published evaluation, which an adult run cannot have (0091). Nothing in `send.ts` changed.
 */

import { describe, expect, it } from 'vitest';
import { ADULT_REPORT_POSTURE, EVALUATION_POSTURE, assembleReport, type ScreeningReport } from '@mintro/engine';
import { loadRulesetFile } from '@mintro/ruleset';
import type { WorkerSupabase } from '../src/store/supabase.js';
import { captureRunReport, deliverCapture } from '../src/captureJob.js';
import { latestCapture } from '../src/sendJob.js';
import { assembleCapture } from '../src/capture/document.js';

const RUN = '11111111-2222-4333-8444-666666666666';
const PUBLISHED = { version: 1, publishedAt: '2026-09-09T17:32:19.244Z' };

interface Attempts {
  readonly uploads: string[];
  readonly inserts: Record<string, unknown>[];
}

/** Records what was attempted and succeeds at everything, so a refusal is the guard's and not the fake's. */
function recordingSupabase(): { supabase: WorkerSupabase; attempts: Attempts } {
  const attempts: Attempts = { uploads: [], inserts: [] };
  const supabase = {
    bucket: 'evidence',
    client: {
      storage: {
        from: () => ({
          upload: async (key: string) => {
            attempts.uploads.push(key);
            return { data: { path: key }, error: null };
          },
        }),
      },
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          attempts.inserts.push(row);
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as WorkerSupabase;
  return { supabase, attempts };
}

/** A deliverable document whose body says what it is. */
function documentSaying(body: string): string {
  return assembleCapture({
    html:
      '<!DOCTYPE html><html lang="en" class="printing"><head><title>a</title></head>' +
      `<body>${body}<p>Run ${RUN}</p><p>${'Observed on the terms page. '.repeat(400)}</p></body></html>`,
    css: [],
    fontCss: '',
    images: new Map(),
    merchantDomain: 'companion.example',
    runId: RUN,
  });
}

describe('delivering an adult AI findings report', () => {
  it('stores a file carrying the findings report\'s statement, with no published version behind it', async () => {
    const { supabase, attempts } = recordingSupabase();
    const stored = await deliverCapture(supabase, {
      runId: RUN,
      html: documentSaying(`<p class="posture">${ADULT_REPORT_POSTURE}</p>`),
      images: 0,
      findingsReport: 'adult_ai',
    });
    expect(stored.storageKey).toContain(RUN);
    expect(attempts.uploads).toHaveLength(1);
    expect(attempts.inserts).toHaveLength(1);
  });

  it.each([
    ['the evaluation\'s statement instead', `<p>${EVALUATION_POSTURE}</p>`, /does not carry the statement of what it is/],
    ['both statements', `<p>${ADULT_REPORT_POSTURE}</p><p>${EVALUATION_POSTURE}</p>`, /carries the evaluation's statement/],
    ['neither', '<p>A report.</p>', /does not carry the statement of what it is/],
  ])('refuses a file carrying %s, and writes nothing', async (_label, body, pattern) => {
    const { supabase, attempts } = recordingSupabase();
    await expect(
      deliverCapture(supabase, { runId: RUN, html: documentSaying(body), images: 0, findingsReport: 'adult_ai' }),
    ).rejects.toThrow(pattern);
    expect(attempts.uploads).toEqual([]);
    expect(attempts.inserts).toEqual([]);
  });
});

describe('delivering a peptide evaluation, unchanged', () => {
  it('refuses the findings report\'s statement in place of the evaluation\'s', async () => {
    const { supabase, attempts } = recordingSupabase();
    await expect(
      deliverCapture(supabase, {
        runId: RUN,
        html: documentSaying(`<p>${ADULT_REPORT_POSTURE}</p><span>Version 1</span>`),
        images: 0,
        published: PUBLISHED,
      }),
    ).rejects.toThrow(/captured evaluation does not carry the statement/);
    expect(attempts.uploads).toEqual([]);
  });

  it('still stores a published evaluation that says its version', async () => {
    const { supabase, attempts } = recordingSupabase();
    await deliverCapture(supabase, {
      runId: RUN,
      html: documentSaying(`<p>${EVALUATION_POSTURE}</p><span>Version 1 · published</span>`),
      images: 0,
      published: PUBLISHED,
    });
    expect(attempts.uploads).toHaveLength(1);
  });
});

/**
 * A read-only store for the capture job: one run row, and nothing else anywhere.
 *
 * Every table read is recorded, so "the job never looked for an evaluation" is asserted on what was
 * asked rather than inferred from what was thrown.
 */
function runStore(row: Record<string, unknown>): { supabase: WorkerSupabase; tables: string[] } {
  const tables: string[] = [];
  const chain = (table: string): unknown => {
    const result = table === 'runs' ? { data: row, error: null } : { data: table === 'report_captures' ? [] : null, error: null };
    const listResult = { data: [], error: null };
    const self: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'is', 'in', 'not', 'gte', 'lte']) {
      self[method] = () => self;
    }
    self['maybeSingle'] = async () => result;
    self['single'] = async () => result;
    self['then'] = (resolve: (value: unknown) => unknown) => resolve(table === 'runs' ? result : listResult);
    return self;
  };
  const supabase = {
    bucket: 'evidence',
    client: {
      from: (table: string) => {
        tables.push(table);
        return chain(table);
      },
      rpc: async () => ({ data: [], error: null }),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'none' } }) }) },
    },
  } as unknown as WorkerSupabase;
  return { supabase, tables };
}

const adult = loadRulesetFile('rules/ruleset-adult-ai.json');
const peptides = loadRulesetFile('rules/ruleset.json');

function reportUnder(ruleset: typeof adult): ScreeningReport {
  return assembleReport(
    {
      runId: RUN,
      merchantDomain: 'companion.example',
      mode: 'public',
      startedAt: '2026-09-19T00:00:00.000Z',
      finishedAt: '2026-09-19T00:01:00.000Z',
      findings: [],
      politeness: 'none declared',
    },
    ruleset,
  );
}

/** A browser that fails loudly the moment anything touches it. */
const noBrowser = new Proxy({}, {
  get: () => {
    throw new Error('BROWSER TOUCHED');
  },
}) as never;

describe('the capture job', () => {
  it('never looks for an evaluation on an adult AI run', async () => {
    const { supabase, tables } = runStore({ report: reportUnder(adult), vertical: 'adult_ai', referral_status: null });
    // It gets as far as rendering, which this test gives it nothing to do; what matters is what it asked first.
    await expect(captureRunReport(supabase, noBrowser, { runId: RUN, webRoot: 'no-such-web-root' })).rejects.toThrow();
    expect(tables).toContain('runs');
    expect(tables).not.toContain('evaluations');
  });

  it('refuses a peptide run with no published evaluation, before a browser is touched', async () => {
    const { supabase, tables } = runStore({ report: reportUnder(peptides), vertical: 'peptides' });
    await expect(captureRunReport(supabase, noBrowser, { runId: RUN, webRoot: 'no-such-web-root' })).rejects.toThrow(
      /has no published evaluation, so there is nothing to capture/,
    );
    expect(tables).toContain('evaluations');
  });
});

describe('send, for an adult AI run with a capture', () => {
  it('is still refused: a capture exists and no published evaluation can', async () => {
    const tables: string[] = [];
    const supabase = {
      client: {
        from: (table: string) => {
          tables.push(table);
          // The capture list is awaited as rows; the evaluation read ends in maybeSingle.
          const rows =
            table === 'report_captures'
              ? [{ storage_key: `reports/${RUN}/abc.html`, captured_at: '2026-09-19T00:02:00.000Z' }]
              : [];
          const self: Record<string, unknown> = {};
          for (const method of ['select', 'eq', 'order', 'limit']) self[method] = () => self;
          self['maybeSingle'] = async () => ({ data: rows[0] ?? null, error: null });
          self['then'] = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
          return self;
        },
      },
    } as unknown as WorkerSupabase;
    await expect(latestCapture(supabase, RUN)).rejects.toThrow(/has no published evaluation/);
    expect(tables).toEqual(['report_captures', 'evaluations']);
  });
});
