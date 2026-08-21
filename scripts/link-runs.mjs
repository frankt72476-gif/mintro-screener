/**
 * Copies worker output into the web app's public directory for local development.
 *
 * Production serves reports from Supabase and evidence from the private bucket through signed
 * URLs. This exists so the report can be developed against real scans rather than fixtures —
 * `reports/` and `evidence/` are gitignored, so nothing here reaches a deployment.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = 'apps/web/public';

for (const dir of ['reports', 'evidence']) {
  const target = join(publicDir, dir);
  rmSync(target, { recursive: true, force: true });
  if (!existsSync(dir)) {
    mkdirSync(target, { recursive: true });
    continue;
  }
  cpSync(dir, target, { recursive: true });
}

const names = existsSync('reports')
  ? readdirSync('reports')
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort()
  : [];

mkdirSync(join(publicDir, 'reports'), { recursive: true });
writeFileSync(join(publicDir, 'reports', 'index.json'), JSON.stringify(names, null, 2));
console.log(`linked ${names.length} report(s): ${names.join(', ') || 'none'}`);
