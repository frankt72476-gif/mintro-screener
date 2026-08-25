/**
 * Every module in the app is reachable from the app.
 *
 * ## The defect this exists for
 *
 * `lib/exportVerification.ts` was written, typechecked, unit-tested and committed. Its tests import
 * it directly; **nothing in the app did**. Vite tree-shook it out, and the deployed bundle contained
 * no verification flow at all — a milestone reported as built, shipped as absent, and green the
 * whole way.
 *
 * Tests import modules directly, so a test suite cannot tell a wired module from an orphan. Neither
 * can `tsc`: an unimported file still compiles. The only thing that distinguishes them is the
 * import graph from the entry point, which is what this walks.
 *
 * ## Why this is a real guard and not a proxy
 *
 * It asserts the exact property that failed: **reachable from `main.tsx`**. Not "has a test", not
 * "is referenced somewhere" — reachable from the thing the browser loads, by the same edges the
 * bundler follows.
 *
 * The allowlist below is empty and should stay that way. A file that genuinely belongs outside the
 * app graph belongs outside `src/`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve('apps/web/src');
const ENTRY = join(SRC, 'main.tsx');

/**
 * Modules deliberately outside the app graph.
 *
 * Empty. Each entry would be a module the app cannot reach, kept anyway — so each needs a reason
 * that survives being read out loud, and "we might wire it later" is not one. That sentence is what
 * shipped an empty verification flow.
 */
const ALLOWED_ORPHANS: readonly string[] = [];

/** Resolve a relative specifier the way the bundler does, including the `.js` TS callers write. */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.jsx?$/, '.ts'),
    base.replace(/\.jsx?$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not that one.
    }
  }
  return null;
}

/** Every `.ts`/`.tsx` under a directory, excluding declaration files. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function reachableFromEntry(): Set<string> {
  const seen = new Set<string>();
  const stack = [ENTRY];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const text = readFileSync(current, 'utf8');
    // Static imports, re-exports and dynamic `import(...)` — the three edges a bundler follows.
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const target = resolveImport(current, match[1]!);
      if (target !== null) stack.push(target);
    }
  }
  return seen;
}

describe('a module nothing imports is not built', () => {
  it('has no source file the app cannot reach', () => {
    const reachable = reachableFromEntry();
    const orphans = sourceFiles(SRC)
      .filter((file) => !reachable.has(file))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'))
      .filter((file) => !ALLOWED_ORPHANS.includes(file))
      .sort();

    expect(
      orphans,
      'these compile and are tested and are NOT in the bundle — the app imports nothing that ' +
        `reaches them:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('walks a graph big enough to be meaningful', () => {
    // A resolver that silently resolved nothing would make the assertion above pass for every file
    // by making the reachable set empty — and it would look exactly like a clean result.
    expect(reachableFromEntry().size).toBeGreaterThan(20);
  });

  it('starts from the file the browser actually loads', () => {
    // If the entry moved, the walk above would be over a graph nobody visits.
    const html = readFileSync('apps/web/index.html', 'utf8');
    expect(html).toContain('/src/main.tsx');
  });
});
