/**
 * The controls are in the bundle, not merely in the repository (D-130, P6).
 *
 * ## What this closes
 *
 * `lib/exportVerification.ts` was written, typechecked, unit-tested and committed, and shipped in a
 * bundle that contained none of it — nothing in the app imported it, so Vite removed it. A
 * milestone reported as built was absent from production, and every check was green.
 *
 * `reachability.test.ts` catches the *cause* by walking the import graph. This catches the
 * *symptom*, one layer further out: it reads the built JavaScript and looks for the strings each
 * control needs. Two guards on one defect, because the failure was invisible to typechecking, to
 * unit tests, and to a person reading the diff.
 *
 * ## Why it builds rather than skipping
 *
 * A test that skips when `dist` is missing passes in exactly the situation it exists to check.
 * So it builds, once, and accepts the cost — under a minute against the alternative of shipping an
 * absent feature again.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'apps/web/dist/assets';
let bundle = '';

beforeAll(() => {
  // `npx vite build` rather than the workspace script, so this does not depend on a package.json
  // name staying put. Output is swallowed; a failure throws and the message is the build's.
  execFileSync('npx', ['vite', 'build', 'apps/web', '--logLevel', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  expect(existsSync(DIST), `${DIST} does not exist after a build`).toBe(true);
  bundle = readdirSync(DIST)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .join('\n');
}, 180_000);

describe('the bundle is a real bundle', () => {
  it('is large enough to be the application', () => {
    // A guard on the guard: an empty or tiny bundle would make every "is absent" assertion below
    // pass, and would look exactly like a clean result.
    expect(bundle.length).toBeGreaterThan(200_000);
  });

  it('was built from the current source', () => {
    const newest = Math.max(
      ...readdirSync(DIST).map((f) => statSync(join(DIST, f)).mtimeMs),
    );
    expect(Date.now() - newest).toBeLessThan(10 * 60 * 1000);
  });
});

describe('every retention control reaches the bundle', () => {
  /*
    Strings an operator can see or that name a call the browser makes. Chosen because they survive
    minification: identifiers do not, string literals do.
  */
  const CONTROLS: readonly [string, string][] = [
    ['request an export', 'Request an export'],
    ['save and read back', 'Save and verify'],
    ['re-select the saved file', 'I saved it — check it'],
    ['record a declared hash', 'Record a hash by hand'],
    ['state where it went', 'Say where it went'],
    ['discard the staged copy', 'Discard the staged copy'],
    ['run a dry run', 'Run a dry run'],
    // The honest fallback. A browser with no File System Access API is told so; replacing this with
    // anything that reads like success would claim a verification nobody performed.
    ['the no-picker fallback message', 'This browser cannot save and read back'],
  ];

  it.each(CONTROLS)('has the control for %s', (_what, marker) => {
    expect(bundle).toContain(marker);
  });

  const CALLS: readonly [string, string][] = [
    ['the export queue', 'document_export_requests'],
    ['recording a verification', 'record_export_verification'],
    ['recording an attestation', 'record_vault_attestation'],
    ['requesting a discard', 'request_export_discard'],
    ['queueing a dry run', 'document_purge_plans'],
  ];

  it.each(CALLS)('makes the call for %s', (_what, marker) => {
    // The defect exactly: these were absent while the module that contains them was committed,
    // tested and green.
    expect(bundle).toContain(marker);
  });

  it('carries the file-picker path the read-back needs', () => {
    expect(bundle).toContain('showSaveFilePicker');
    expect(bundle).toContain('showOpenFilePicker');
  });
});

describe('nothing that could purge reaches the bundle', () => {
  const FORBIDDEN = [
    'begin_package_purge',
    'complete_package_purge',
    'approve_package_purge',
    'set_package_facts_and_purge',
    'purge_approver',
  ];

  it.each(FORBIDDEN)('does not contain %s', (marker) => {
    // A button that is safe only because nobody holds the flag becomes unsafe the moment somebody
    // does. The frontend has no path to the executor and this is what keeps it that way.
    expect(bundle).not.toContain(marker);
  });
});
