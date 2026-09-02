/**
 * The phase columns, against the real schema (D-173, migration 0047).
 *
 * The denominator rule is enforced in three places: the worker's emitter drops a count on an
 * indeterminate phase, the run page refuses to render one, and these constraints refuse to store
 * one. That is deliberate over-enforcement of the single error this model exists to prevent — a
 * count whose denominator was invented reads as a hang and is a determination, not an observation
 * (D-001).
 *
 * A rule held only in application code is a rule until somebody writes a row another way.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let requestId: string;

beforeAll(async () => {
  schema = await createSchema();

  // `analysts.id` references `auth.users`, so the user comes first — the same order the other
  // schema tests use.
  const users = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('ops@mintro.example') returning id`,
  );
  const analyst = (users[0] as { id: string }).id;
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id) values ($1, 'ops@mintro.example', 'Ops', (select id from public.organizations where type = 'host'))`,
    [analyst],
  );

  const rows = await schema.query<{ id: string }>(
    `insert into public.scan_requests (url, requested_by, status)
     values ('https://shop.example', $1, 'running') returning id`,
    [analyst],
  );
  requestId = (rows[0] as { id: string }).id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

const setPhase = (
  phase: string | null,
  done: number | null,
  total: number | null,
): Promise<string | null> =>
  schema.attempt(
    `update public.scan_requests
       set phase = $1, phase_done = $2, phase_total = $3, phase_started_at = now()
     where id = $4`,
    [phase, done, total, requestId],
  );

describe('the phase vocabulary is closed', () => {
  it.each(['discovery', 'homepage', 'sample', 'escalate', 'surfaces', 'gate', 'assembly'])(
    'accepts %s',
    async (phase) => {
      const counted = phase === 'discovery' || phase === 'escalate' ? null : 1;
      expect(await setPhase(phase, counted, counted)).toBeNull();
    },
  );

  it('refuses a phase the UI has no label for', async () => {
    // A blank stage on the run page is an absent value shown as an answer, which is the shape
    // D-044 exists to refuse.
    expect(await setPhase('layer7', null, null)).toMatch(/scan_requests_phase_is_known/);
  });

  it('allows null, which is what an unclaimed request looks like', async () => {
    expect(await setPhase(null, null, null)).toBeNull();
  });
});

describe('a count is a pair or it is nothing', () => {
  it('refuses a numerator with nothing under it', async () => {
    // Exactly the shape a display would render as progress.
    expect(await setPhase('sample', 3, null)).toMatch(/scan_requests_counts_are_whole/);
  });

  it('refuses a denominator with no numerator', async () => {
    expect(await setPhase('sample', null, 5)).toMatch(/scan_requests_counts_are_whole/);
  });

  it('refuses a zero denominator, which is not a fraction', async () => {
    expect(await setPhase('sample', 0, 0)).toMatch(/scan_requests_counts_are_whole/);
  });

  it('refuses more done than there are to do', async () => {
    expect(await setPhase('sample', 6, 5)).toMatch(/scan_requests_counts_are_whole/);
  });

  it('accepts a whole one', async () => {
    expect(await setPhase('sample', 3, 5)).toBeNull();
    expect(await setPhase('surfaces', 0, 5)).toBeNull();
  });
});

describe('the phases that can never be counted', () => {
  /**
   * Discovery's sitemap queue *grows* as index documents are parsed, bounded only by `maxSitemaps`.
   * Sign-in is an attempt against an unknown form. Neither has a denominator while it runs, and a
   * writer that supplied one would be inventing it.
   */
  it.each(['discovery', 'escalate'])('refuses a count on %s', async (phase) => {
    expect(await setPhase(phase, 3, 5)).toMatch(
      /scan_requests_indeterminate_phases_are_uncounted/,
    );
  });

  it.each(['discovery', 'escalate'])('accepts %s with no count', async (phase) => {
    expect(await setPhase(phase, null, null)).toBeNull();
  });
});

describe('the queue is still analyst-only', () => {
  it('grants no write on the new columns to authenticated or anon', async () => {
    // 0012 revoked update and delete; 0047 adds columns and must not have re-granted anything.
    const grants = await schema.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_name = 'scan_requests' and grantee in ('authenticated', 'anon')`,
    );
    expect(grants.map((g) => `${g.grantee}:${g.privilege_type}`).sort()).not.toContain(
      'authenticated:UPDATE',
    );
    expect(grants.map((g) => `${g.grantee}:${g.privilege_type}`)).not.toContain('anon:UPDATE');
  });
});
