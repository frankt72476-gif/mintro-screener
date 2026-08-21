/**
 * The migrations, checked as text.
 *
 * "RLS enabled on every table in the same migration that creates it — never after, never as a
 * follow-up" is a rule that is easy to state, easy to agree with, and easy to break six months
 * later in a hurry. `docs/DEPLOY.md` is explicit that turning RLS on after rows exist is where
 * people get caught.
 *
 * So it is checked mechanically. A migration that adds a table without enabling RLS in the same
 * file fails here, before it reaches a database with merchant evidence in it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';

const files = readdirSync(DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(DIR, file), 'utf8') }));

/** Tables created in a migration, excluding Supabase's own schemas. */
function tablesCreatedIn(sql: string): string[] {
  return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map(
    (match) => match[1]!,
  );
}

describe('migrations', () => {
  it('has migrations to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('numbers every migration so the order is unambiguous', () => {
    for (const { file } of files) {
      expect(file, `${file} is not numbered`).toMatch(/^\d{4}_[a-z_]+\.sql$/);
    }
  });

  /** The rule this file exists for. */
  it('enables RLS on every table in the same migration that creates it', () => {
    const problems: string[] = [];

    for (const { file, sql } of files) {
      for (const table of tablesCreatedIn(sql)) {
        const enabled = new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
          'i',
        ).test(sql);
        if (!enabled) problems.push(`${file}: public.${table} has no RLS in the same migration`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('revokes direct write access from anon and authenticated on every table', () => {
    // Writes are the worker's, through service_role. A browser that could insert a finding could
    // fabricate evidence, and a policy that merely omits INSERT is easier to add back by accident
    // than an explicit REVOKE is to remove.
    const problems: string[] = [];

    for (const { file, sql } of files) {
      for (const table of tablesCreatedIn(sql)) {
        const revoked = new RegExp(`revoke[\\s\\S]{0,80}on\\s+public\\.${table}\\s+from`, 'i').test(sql);
        if (!revoked) problems.push(`${file}: public.${table} does not revoke writes`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('creates every table the documented data model names', () => {
    const created = files.flatMap(({ sql }) => tablesCreatedIn(sql));
    // docs/ARCHITECTURE.md § Data model.
    for (const table of ['merchants', 'credentials', 'runs', 'findings', 'evidence', 'sends']) {
      expect(created, `${table} is missing`).toContain(table);
    }
  });

  it('gives the credentials table no column a secret could live in', () => {
    // Hard constraint 6. The table holds a vault reference; a schema with nowhere to put a
    // credential cannot leak one.
    const sql = files.find(({ file }) => file.includes('credentials'))?.sql ?? '';
    expect(sql).toContain('vault_ref');
    for (const forbidden of ['password', 'secret', 'token', 'api_key']) {
      expect(sql.toLowerCase(), `credentials has a ${forbidden} column`).not.toMatch(
        new RegExp(`^\\s+${forbidden}\\s`, 'm'),
      );
    }
  });

  it('gives credentials no policy for authenticated, so the browser cannot read it', () => {
    const sql = files.find(({ file }) => file.includes('credentials'))?.sql ?? '';
    expect(sql).not.toMatch(/create\s+policy[\s\S]*?to\s+authenticated/i);
  });

  it('guards append-only tables with a trigger, not only with RLS', () => {
    // service_role carries BYPASSRLS, so a policy would not stop the worker overwriting its own
    // evidence. A trigger is not bypassed, which makes it the only real enforcement.
    for (const table of ['findings', 'evidence', 'sends']) {
      const sql = files.find(({ file }) => file.includes(table))?.sql ?? '';
      expect(sql, `${table} has no append-only trigger`).toMatch(/create\s+trigger[\s\S]*?before\s+update\s+or\s+delete/i);
    }
  });

  it('freezes a run once it is finished (D-002)', () => {
    const sql = files.find(({ file }) => file.includes('runs'))?.sql ?? '';
    expect(sql).toMatch(/finished_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/create\s+trigger/i);
  });

  it('refuses to proceed if the evidence bucket is public', () => {
    const sql = files.find(({ file }) => file.includes('storage'))?.sql ?? '';
    expect(sql).toMatch(/raise\s+exception[\s\S]{0,120}public/i);
  });
});

describe('.env.example', () => {
  const env = readFileSync('.env.example', 'utf8');

  const keys = env
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split('=')[0]!);

  it('documents what the worker needs', () => {
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VAULT_TOKEN']) {
      expect(keys, `${key} is undocumented`).toContain(key);
    }
  });

  /**
   * Hard constraint 6, checked rather than remembered.
   *
   * Anything prefixed `VITE_` is compiled into the browser bundle and published. A service key
   * that reached this list would be a published credential, and the mistake looks entirely
   * ordinary in a diff.
   */
  it('lets no VITE_ variable carry a secret', () => {
    const exposed = keys.filter((key) => key.startsWith('VITE_'));
    expect(exposed.length).toBeGreaterThan(0);

    for (const key of exposed) {
      const lower = key.toLowerCase();
      for (const forbidden of ['service', 'secret', 'password', 'private']) {
        expect(lower, `${key} looks like a secret and is compiled into the bundle`).not.toContain(
          forbidden,
        );
      }
      // `VITE_SUPABASE_ANON_KEY` is the one legitimate "key": an identifier RLS constrains.
      if (lower.includes('token')) {
        expect(lower, `${key} looks like a secret`).toContain('anon');
      }
    }
  });
});
