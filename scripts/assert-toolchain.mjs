/**
 * Confirms the build toolchain is the one we meant, before anything uses it.
 *
 * ## What went wrong
 *
 * The container build ran `npx tsc --build`. There was no local TypeScript, so npx did what npx
 * does: fetched a package called `tsc` from the registry — an unrelated 2016 stub whose entire
 * behaviour is to print *"This is not the tsc command you are looking for"* and exit 1.
 *
 * The riddle was the least of it. The real defect is that a build step **reached for a compiler,
 * got a stranger, and could not tell**. That is the shape of every defect in this project's recent
 * history: an operation that proceeded without establishing that its subject was what it assumed.
 *
 * ## Why the compiler was missing
 *
 * `ENV NODE_ENV=production` sits above `npm ci` in the Dockerfile, and **npm reads NODE_ENV**:
 * with it set to `production`, `omit` defaults to `dev`. So `npm ci --ignore-scripts` installed
 * production dependencies only. TypeScript and Vite are devDependencies. Neither arrived.
 *
 *     $ NODE_ENV=production npm config get omit
 *     dev
 *
 * The Dockerfile comment claimed the opposite — "dev dependencies are installed and then pruned,
 * rather than skipped" — and nothing checked. A comment is not a guarantee.
 *
 * The install now passes `--include=dev` explicitly, so it does not depend on an environment
 * variable set three layers earlier for an unrelated reason. This script is the guarantee that it
 * worked.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** Multi-line diagnostics are assembled from arrays; this is the joiner. */
const NL = String.fromCharCode(10);
const root = process.cwd();
const problems = [];
const notes = [];

/** The lockfile is what `npm ci` installs, so it is what the check compares against. */
function lockedVersion(name) {
  try {
    const lock = require(join(root, 'package-lock.json'));
    return lock.packages?.[`node_modules/${name}`]?.version ?? null;
  } catch {
    return null;
  }
}

function resolvedVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

// ---- TypeScript ---------------------------------------------------------------------------
const tsVersion = resolvedVersion('typescript');
const tsLocked = lockedVersion('typescript');

if (tsVersion === null) {
  problems.push(
    'typescript did not resolve from the project.\n' +
      '    It is a root devDependency, so this means the install omitted dev dependencies.\n' +
      '    Almost always NODE_ENV=production, which makes npm default `omit` to `dev`:\n' +
      '      $ NODE_ENV=production npm config get omit  ->  dev\n' +
      '    Install with --include=dev rather than relying on the environment.',
  );
} else {
  notes.push(`typescript ${tsVersion}${tsLocked === null ? '' : ` (lockfile ${tsLocked})`}`);
  if (tsLocked !== null && tsLocked !== tsVersion) {
    problems.push(
      `typescript resolved to ${tsVersion} but the lockfile pins ${tsLocked}. ` +
        'Something installed a different compiler than `npm ci` would.',
    );
  }
}

// ---- The binary, and that it is really tsc --------------------------------------------------
//
// Two checks, because two things can be wrong.
//
// The shim is checked for *existence* only. `npm run` puts `node_modules/.bin` on PATH, so that
// is the file the build will actually reach — but spawning it directly is platform-dependent
// (Windows needs a shell for `.cmd`, and Node 20 warns about that), and a guard that is awkward
// on the machine people run it on is a guard people stop running.
//
// The compiler is then executed through Node, which is identical everywhere. It is also the check
// that catches the original failure: the registry impostor is not at `typescript/bin/tsc` at all,
// so this either runs the real compiler or does not run.
const shim = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

if (!existsSync(shim)) {
  problems.push(
    [
      `no compiler shim at ${shim}.`,
      '    `npm run` relies on node_modules/.bin being on PATH.',
      '    Do NOT reach for `npx tsc` as a fallback: npx will fetch the unrelated `tsc` package',
      '    from the registry, which prints a riddle and exits 1.',
    ].join(NL),
  );
} else {
  notes.push('compiler shim present on node_modules/.bin');
}

if (tsVersion !== null) {
  let output = '';
  try {
    const entry = require.resolve('typescript/bin/tsc');
    output = execFileSync(process.execPath, [entry, '--version'], {
      encoding: 'utf8',
      timeout: 60_000,
    }).trim();
  } catch (error) {
    output = String(error instanceof Error ? error.message : error);
  }

  // The identifying check. Real tsc answers "Version 5.9.3"; the impostor answers with its joke.
  if (/^Version \d+\.\d+/.test(output)) {
    notes.push(`tsc --version -> ${output}`);
  } else {
    problems.push(
      [
        'the resolved compiler is not TypeScript. `tsc --version` said:',
        `      ${output}`,
        '    If that mentions "not the tsc command you are looking for", something installed the',
        '    registry package `tsc` instead of resolving the local TypeScript.',
      ].join(NL),
    );
  }
}

// ---- Vite, for the frontend the worker prints ------------------------------------------------
const viteVersion = resolvedVersion('vite');
if (viteVersion === null) {
  problems.push(
    'vite did not resolve. The container builds apps/web because the PDF is printed from the\n' +
      '    report route (D-040), and that build needs Vite — also a devDependency.',
  );
} else {
  notes.push(`vite ${viteVersion}`);
}

// ---- Report -----------------------------------------------------------------------------------
for (const note of notes) console.log(`  ok    ${note}`);

if (problems.length > 0) {
  console.error('\ntoolchain check FAILED\n');
  for (const problem of problems) console.error(`  FAIL  ${problem}\n`);
  console.error(`  NODE_ENV=${process.env['NODE_ENV'] ?? '(unset)'}`);
  process.exit(1);
}

console.log('  toolchain ok');
