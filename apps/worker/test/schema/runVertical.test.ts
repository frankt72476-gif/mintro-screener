/**
 * A run's vertical and referral policy version, against the real schema (migration 0088, D-284).
 *
 * What only a real Postgres can say:
 *
 *   - **0088 applies over a finished run without touching it (D-002).** The immutability trigger
 *     refuses every update to a finished run, so a migration that rewrote rows to fill the new column
 *     would fail against production. This builds the schema as it stood before 0088, freezes a run,
 *     then applies 0088 — the existing-rows case an empty-table migrate cannot show;
 *   - a run or request written without a vertical is `peptides`; one written with `adult_ai` keeps
 *     it; anything else is refused by the check constraint;
 *   - the row the worker opens a run with (`runRowFor`) carries the vertical it was given.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OWNER_ID,
  applyMigration,
  createSchema,
  seedRun,
  type SchemaFixture,
} from './harness.js';
import { runRowFor } from '../../src/store/persist.js';

describe('0088 over existing rows', () => {
  let before: SchemaFixture;

  beforeAll(async () => {
    before = await createSchema({ stopBefore: '0088' });
  }, 60_000);

  afterAll(async () => {
    await before?.close();
  });

  it('gives a run finished before 0088 the peptides vertical, with no update to the frozen row', async () => {
    const { runId } = await seedRun(before, 'finished-before.example');
    await before.query(
      `update public.runs set finished_at = now(), status = 'complete', report = '{}'::jsonb where id = $1`,
      [runId],
    );
    await before.query(`insert into public.scan_requests (url, requested_by) values ('https://queued-before.example', $1)`, [
      OWNER_ID,
    ]);

    // Would throw "is immutable (D-002)" if the migration rewrote finished rows.
    await applyMigration(before, '0088');

    const [run] = await before.query<{ vertical: string; referral_policy_version: string | null }>(
      `select vertical, referral_policy_version from public.runs where id = $1`,
      [runId],
    );
    expect(run).toEqual({ vertical: 'peptides', referral_policy_version: null });

    const [request] = await before.query<{ vertical: string }>(
      `select vertical from public.scan_requests where url = 'https://queued-before.example'`,
    );
    expect(request).toEqual({ vertical: 'peptides' });

    // And the run is still frozen afterwards.
    expect(
      await before.attempt(`update public.runs set vertical = 'adult_ai' where id = '${runId}'`),
    ).toMatch(/immutable/);
  });
});

describe('runs.vertical and scan_requests.vertical (0088)', () => {
  let schema: SchemaFixture;

  beforeAll(async () => {
    schema = await createSchema();
  }, 60_000);

  afterAll(async () => {
    await schema?.close();
  });

  const merchant = async (domain: string): Promise<string> =>
    (await schema.query<{ id: string }>(`insert into public.merchants (domain) values ($1) returning id`, [domain]))[0]!
      .id;

  const hostOrg = async (): Promise<string> =>
    (await schema.query<{ org_id: string }>(`select org_id from public.analysts where id = $1`, [OWNER_ID]))[0]!.org_id;

  it('makes a run created without a vertical a peptides run', async () => {
    const { runId } = await seedRun(schema, 'no-vertical.example');
    const [row] = await schema.query<{ vertical: string; referral_policy_version: string | null }>(
      `select vertical, referral_policy_version from public.runs where id = $1`,
      [runId],
    );
    expect(row).toEqual({ vertical: 'peptides', referral_policy_version: null });
  });

  it('keeps adult_ai on a run the worker opens with it', async () => {
    const runId = '00000000-0000-4000-8000-00000000a1a1';
    const row = runRowFor({
      runId,
      merchantId: await merchant('adult-ai.example'),
      report: { startedAt: new Date().toISOString(), mode: 'public', rulesetVersion: '0.1.0', politeness: 'none', truncations: [] },
      createdBy: OWNER_ID,
      orgId: await hostOrg(),
      vertical: 'adult_ai',
    });
    const columns = Object.keys(row);
    await schema.query(
      `insert into public.runs (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );

    const [stored] = await schema.query<{ vertical: string }>(`select vertical from public.runs where id = $1`, [runId]);
    expect(stored).toEqual({ vertical: 'adult_ai' });
  });

  it('stamps referral policy 1.0 on an adult_ai run and leaves a peptide run null (D-287)', async () => {
    const open = async (runId: string, domain: string, vertical: 'peptides' | 'adult_ai') => {
      const row = runRowFor({
        runId,
        merchantId: await merchant(domain),
        report: { startedAt: new Date().toISOString(), mode: 'public', rulesetVersion: '0.1.2', politeness: 'none', truncations: [] },
        createdBy: OWNER_ID,
        orgId: await hostOrg(),
        vertical,
      });
      const columns = Object.keys(row);
      await schema.query(
        `insert into public.runs (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row),
      );
      const [stored] = await schema.query<{ vertical: string; referral_policy_version: string | null }>(
        `select vertical, referral_policy_version from public.runs where id = $1`,
        [runId],
      );
      return stored;
    };

    expect(await open('00000000-0000-4000-8000-00000000a1a2', 'policy-adult.example', 'adult_ai')).toEqual({
      vertical: 'adult_ai',
      referral_policy_version: '1.0',
    });
    expect(await open('00000000-0000-4000-8000-00000000a1a3', 'policy-peptide.example', 'peptides')).toEqual({
      vertical: 'peptides',
      referral_policy_version: null,
    });
  });

  it('refuses a run vertical outside the two', async () => {
    const merchantId = await merchant('bad-vertical.example');
    expect(
      await schema.attempt(
        `insert into public.runs (merchant_id, mode, ruleset_version, status, created_by, org_id, vertical)
         values ($1, 'public', '2.4.0', 'running', $2, $3, 'gaming')`,
        [merchantId, OWNER_ID, await hostOrg()],
      ),
    ).toMatch(/runs_vertical_check/);
  });

  it('defaults a scan request to peptides, keeps adult_ai, and refuses anything else', async () => {
    await schema.query(`insert into public.scan_requests (url, requested_by) values ('https://default.example', $1)`, [
      OWNER_ID,
    ]);
    await schema.query(
      `insert into public.scan_requests (url, requested_by, vertical) values ('https://adult.example', $1, 'adult_ai')`,
      [OWNER_ID],
    );
    const rows = await schema.query<{ url: string; vertical: string }>(
      `select url, vertical from public.scan_requests where url in ('https://default.example', 'https://adult.example') order by url`,
    );
    expect(rows).toEqual([
      { url: 'https://adult.example', vertical: 'adult_ai' },
      { url: 'https://default.example', vertical: 'peptides' },
    ]);

    expect(
      await schema.attempt(
        `insert into public.scan_requests (url, requested_by, vertical) values ('https://bad.example', $1, 'Peptides')`,
        [OWNER_ID],
      ),
    ).toMatch(/scan_requests_vertical_check/);
  });
});
