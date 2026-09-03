/**
 * Every binary `apps/web`'s scripts invoke is one `apps/web` declares.
 *
 * This exists because the frontend build failed on Netlify with `exit 127 — tsc: command not
 * found`, twice removed from anything a test was looking at.
 *
 * ## What actually went wrong
 *
 * `vite.config.ts` imports a plugin that imports `@mintro/engine`, and Vite pre-bundles its config
 * before `resolve.alias` applies — so the engine has to be *compiled* for the config to load. The
 * build script was changed to say so: `tsc --build ../../packages/engine && vite build`.
 *
 * `typescript` was a devDependency of the **repository root**, not of `apps/web`. Netlify installs
 * what `apps/web` declares — `vite` resolved, `tsc` did not — and the build died on the first
 * token of the new line.
 *
 * ## Why a test rather than a fixed build
 *
 * The reasoning that produced the bug was "typescript is a root devDependency and workspaces hoist
 * it, the way vite and react resolve". That is true of **module resolution** and says nothing about
 * **shell PATH**, and every check available at the time ran in a tree where the distinction did not
 * show: `node_modules/.bin` here holds both binaries, hoisted, so a local `npm run build` cannot
 * tell a root devDependency from a declared one.
 *
 * So the check has to be one no environment can answer favourably by accident. This reads
 * `package.json` and nothing else: for each script, the command it invokes must be a `bin` exported
 * by a package `apps/web` itself depends on. It is the same question Netlify asks at install time,
 * asked here where it is cheap.
 *
 * It generalises past this one line — any future script that reaches for a binary the root happens
 * to have will fail here rather than on a deploy.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('apps/web/package.json', 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};

const require = createRequire(new URL('../package.json', import.meta.url));

/**
 * Always present, and not something a package supplies.
 *
 * `node` is the runtime the build runs on and `npm`/`npx` are what invoke it. Nothing else gets a
 * free pass — the point is that a package binary must be traceable to a declared dependency.
 */
const ALWAYS_AVAILABLE = new Set(['node', 'npm', 'npx']);

/** Every `bin` name the packages `apps/web` declares would install. */
function declaredBinaries(): ReadonlySet<string> {
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const bins = new Set<string>();

  for (const name of names) {
    let pkgPath: string;
    try {
      pkgPath = require.resolve(`${name}/package.json`);
    } catch {
      // A package that does not export its own `package.json`. Workspace packages here have no
      // binaries, so this cannot hide one that matters.
      continue;
    }

    const pkg = require(pkgPath) as { name: string; bin?: string | Record<string, string> };
    if (typeof pkg.bin === 'string') bins.add(pkg.name);
    else for (const bin of Object.keys(pkg.bin ?? {})) bins.add(bin);
  }

  return bins;
}

/** The leading command of each `&&`-joined step. */
function commandsIn(script: string): readonly string[] {
  return script
    .split('&&')
    .map((step) => step.trim().split(/\s+/)[0] ?? '')
    .filter((command) => command !== '');
}

describe('what apps/web scripts invoke', () => {
  const available = declaredBinaries();

  it('declares vite, which it has always needed', () => {
    // The control. Without it, a set that came back empty would pass every assertion below.
    expect(available.has('vite')).toBe(true);
  });

  it('declares typescript, because the build compiles the engine before Vite loads its config', () => {
    /*
      The one this file was written for. `tsc` is invoked by `build`, and it resolved locally only
      because the root declares typescript and npm hoists it into a `node_modules/.bin` that
      `npm run` happens to put on PATH. Netlify installs what this package declares.
    */
    expect(available.has('tsc')).toBe(true);
  });

  it.each(Object.entries(manifest.scripts))(
    'has every binary %s invokes',
    (_name, script) => {
      const missing = commandsIn(script).filter(
        (command) => !ALWAYS_AVAILABLE.has(command) && !available.has(command),
      );

      expect(
        missing,
        `apps/web runs \`${script}\` but declares nothing providing: ${missing.join(', ')}. ` +
          'A binary the repository root happens to install is not one this package can rely on — ' +
          'Netlify installs what this package.json declares.',
      ).toEqual([]);
    },
  );
});
