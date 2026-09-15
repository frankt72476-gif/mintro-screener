/**
 * One browser identity in the worker (D-278).
 *
 * Run `2f9cc2ee` (legendarypeptides.com, 2026-09-15) crawled through `createCrawlContext` and signed
 * in through a bare `browser.newContext()`. The two declare different identities — the bare one
 * says `HeadlessChrome` — and the merchant's edge answered them differently: the product sample was
 * served the login wall, and the login page itself was served a 403 Cloudflare block. The report
 * said the stored account "did not sign in" about a form nobody had been shown.
 *
 * Four more bare contexts were sitting beside it. None was a decision; each was the default
 * Playwright hands you when you do not ask for anything. This is the tripwire that would have
 * caught all five: a context is made by `createCrawlContext`, and nowhere else in `src`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(fileURLToPath(import.meta.url), '../../src');
const FACTORY = join(SRC, 'render.ts');
const CALL = /newContext\(/;

/**
 * A file with its comments blanked, line numbers kept.
 *
 * The factory's own documentation names the call it replaces, and so does D-278's history in the
 * files it touched. A comment is not a context; a call is.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe('browser contexts in the worker', () => {
  it('walks the tree it claims to', () => {
    // A guard over an empty list passes. Presence first, so a moved `src` fails here, not silently.
    const files = sources(SRC);
    expect(files).toContain(FACTORY);
    expect(files).toContain(join(SRC, 'auth', 'login.ts'));
    expect(files).toContain(join(SRC, 'probe.ts'));
  });

  it('are created nowhere in src but render.ts', () => {
    const offenders = sources(SRC)
      .filter((path) => path !== FACTORY)
      .flatMap((path) =>
        code(path)
          .split('\n')
          .flatMap((line, index) =>
            CALL.test(line) ? [`${relative(SRC, path)}:${index + 1}  ${line.trim()}`] : [],
          ),
      );

    expect(offenders, 'create browser contexts with createCrawlContext (render.ts)').toEqual([]);
  });

  it('are created exactly once in render.ts, inside createCrawlContext', () => {
    const text = code(FACTORY);
    expect(text.match(new RegExp(CALL.source, 'g'))).toHaveLength(1);

    const start = text.indexOf('export async function createCrawlContext(');
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('\n}\n', start));
    expect(body).toMatch(CALL);
  });
});
