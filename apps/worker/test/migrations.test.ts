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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/**
 * The frontend has its own environment file, and it is not interchangeable with the root one.
 *
 * Vite reads the `.env` in its own root. A `VITE_` variable set only at the repository root gives
 * a frontend that builds cleanly and then reports "Not connected" at runtime — which reads as a
 * broken deployment rather than a missing file.
 */
describe('apps/web/.env.example', () => {
  const env = readFileSync('apps/web/.env.example', 'utf8');

  const keys = env
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split('=')[0]!);

  it('documents what the frontend needs', () => {
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      expect(keys, `${key} is undocumented`).toContain(key);
    }
  });

  /**
   * Everything in this file is compiled into the bundle, so a non-`VITE_` entry is worse than
   * useless: Vite ignores it silently, and someone reads the file as documentation of what the
   * frontend uses. A secret listed here would look configured and be published.
   */
  it('holds nothing but VITE_ variables', () => {
    for (const key of keys) {
      expect(key, `${key} is not VITE_-prefixed and would be silently ignored`).toMatch(/^VITE_/);
    }
  });

  it('lets none of them look like a secret', () => {
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const forbidden of ['service', 'secret', 'password', 'private']) {
        expect(lower, `${key} is compiled into the bundle`).not.toContain(forbidden);
      }
    }
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
    // CREDENTIAL_PRIVATE_KEY replaced VAULT_TOKEN at D-038: the vault stopped being a symmetric
    // store and became an envelope sealed to a key pair, so there is no shared token any more.
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'CREDENTIAL_PRIVATE_KEY']) {
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

/**
 * The Dockerfile's workspace list.
 *
 * `npm ci` needs every workspace manifest present before it runs, so the Dockerfile enumerates them
 * — and an enumerated list is one somebody forgets to extend. `packages/extraction` was added at M0
 * and the list was not, which nothing caught until the first deploy after it: locally the workspace
 * link already exists, so every test passed while the image could not resolve the package at all.
 *
 * This compares the list against the workspaces that actually exist. It fails in CI rather than in
 * a deploy, which is the difference between a minute and a build.
 */
describe('the worker image copies every workspace manifest', () => {
  it('has a COPY line for each one', () => {
    const dockerfile = readFileSync('apps/worker/Dockerfile', 'utf8');
    const root = JSON.parse(readFileSync('package.json', 'utf8')) as { workspaces: string[] };

    const workspaces = root.workspaces.flatMap((pattern) => {
      const dir = pattern.replace(/\/\*$/, '');
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(`${dir}/${e.name}/package.json`))
        .map((e) => `${dir}/${e.name}`);
    });

    const missing = workspaces.filter((w) => !dockerfile.includes(`COPY ${w}/package.json`));
    expect(missing, `not copied into the image before npm ci: ${missing.join(', ')}`).toEqual([]);
    expect(workspaces.length).toBeGreaterThan(3);
  });
});

/**
 * Project references match the imports that actually exist.
 *
 * A workspace importing `@mintro/x` needs `x` in its tsconfig `references`, not merely a
 * node_modules link. Without the reference, `tsc --build` leaves `x` out of that project's build
 * graph and its `dist` may not exist when the project compiles.
 *
 * **This is invisible in any local run.** A root `tsc --build` has already produced every `dist`,
 * so resolution succeeds by accident of order. A container starts with none — which is where it
 * surfaced: `packages/ruleset/test` imported `@mintro/extraction` with no reference, and the deploy
 * build failed on it after every one of 1304 local tests passed.
 */
describe('project references cover the workspace imports', () => {
  const strip = (json: string): string => json.replace(/^\s*\/\/.*$/gm, '');

  it('every @mintro import in a workspace is a reference in its tsconfig', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8')) as { workspaces: string[] };
    const dirs = root.workspaces.flatMap((pattern) => {
      const base = pattern.replace(/\/\*$/, '');
      return readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(`${base}/${e.name}/tsconfig.json`))
        .map((e) => `${base}/${e.name}`);
    });

    const gaps: string[] = [];
    for (const dir of dirs) {
      const config = JSON.parse(strip(readFileSync(`${dir}/tsconfig.json`, 'utf8'))) as {
        references?: { path: string }[];
      };
      const referenced = new Set(
        (config.references ?? []).map((r) => r.path.split('/').filter(Boolean).pop()),
      );

      const sources: string[] = [];
      const walk = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.name === 'dist' || e.name === 'node_modules') continue;
          if (e.isDirectory()) walk(`${d}/${e.name}`);
          else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) sources.push(`${d}/${e.name}`);
        }
      };
      for (const sub of ['src', 'test', 'bin']) if (existsSync(`${dir}/${sub}`)) walk(`${dir}/${sub}`);

      const imported = new Set<string>();
      for (const file of sources) {
        for (const m of readFileSync(file, 'utf8').matchAll(/['"]@mintro\/([a-z]+)['"]/g)) {
          imported.add(m[1]!);
        }
      }
      imported.delete(dir.split('/').pop()!);

      for (const name of imported) {
        if (!referenced.has(name)) gaps.push(`${dir} imports @mintro/${name} without referencing it`);
      }
    }

    expect(gaps, gaps.join('; ')).toEqual([]);
  });
});
