/**
 * The evaluation layer refuses every run that is not the peptide programme's (D-284, D-285).
 *
 * Run 6571d6a9 (adult_ai) was drafted through it on 2026-09-19. Each job is driven here against a
 * fake store that records every table it touches and every write it attempts: an adult_ai run must
 * be refused with the recorded reason, and nothing may be written.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluationRefusal } from '../src/evaluationVertical.js';
import { runEvaluationRequest } from '../src/evaluationRun.js';
import { runPublish } from '../src/evaluationPublishJob.js';

const REASON = 'evaluation layer does not apply to vertical adult_ai (D-284)';

/** A store that answers reads from `tables` and records every write. */
function fakeStore(tables: Record<string, unknown>) {
  const touched: string[] = [];
  const writes: string[] = [];
  const from = (table: string) => {
    touched.push(table);
    const result = { data: tables[table] ?? null, error: null };
    const write = () => {
      writes.push(table);
      return chain;
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      insert: write,
      update: write,
      upsert: write,
      delete: write,
    };
    return chain;
  };
  const rpc = async (name: string) => {
    writes.push(`rpc:${name}`);
    return { data: null, error: null };
  };
  return { supabase: { client: { from, rpc } } as never, touched, writes };
}

describe('evaluationRefusal', () => {
  it('lets a peptide run through and refuses every other vertical with the recorded reason', () => {
    expect(evaluationRefusal('peptides')).toBeNull();
    expect(evaluationRefusal('adult_ai')).toBe(REASON);
    expect(evaluationRefusal(undefined)).toMatch(/does not apply/);
  });
});

describe('the draft job (Regenerate)', () => {
  it('refuses an adult_ai run before reading anything else, and writes no draft', async () => {
    const store = fakeStore({ runs: { report: {}, status: 'complete', vertical: 'adult_ai' } });
    expect(await runEvaluationRequest(store.supabase, '6571d6a9-c0f9-4c55-82b5-1bcb71098ce1')).toBe(REASON);
    expect(store.touched).toEqual(['runs']);
    expect(store.writes).toEqual([]);
  });
});

describe('the publish job', () => {
  it('refuses an adult_ai run even where a draft exists, and publishes nothing', async () => {
    const store = fakeStore({
      runs: { report: {}, vertical: 'adult_ai' },
      evaluation_drafts: { content: {}, validator_status: 'rejected', handles: {} },
      findings: [],
      evidence: [],
    });
    const outcome = await runPublish(store.supabase, { id: 'p1', run_id: '6571d6a9-c0f9-4c55-82b5-1bcb71098ce1' } as never);
    expect(outcome).toEqual({ kind: 'refused', refusal: REASON });
    expect(store.writes).toEqual([]);
  });
});

describe('the command-line generator', () => {
  it('refuses before it generates: the guard runs on the run it read, ahead of any draft', () => {
    const source = readFileSync('apps/worker/bin/evaluate.ts', 'utf8');
    const guard = source.indexOf('evaluationRefusal(');
    const generate = source.indexOf('generateDraft(');
    expect(guard).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(guard);
    expect(source).toMatch(/select\('report, status, vertical'\)/);
  });
});
