/**
 * The floor is declared in four places, and this is what stops them drifting apart (D-168).
 *
 * `apps/web/test`, `apps/worker/test` and `apps/worker/bin` each compile under `rootDir: "."` for
 * their own app, so a module shared between them would have to be a new package for a single
 * integer. Four declarations is the cheaper trade — but only with something asserting they agree,
 * because four copies of a number that must move together is how a floor quietly becomes three
 * different floors, the lowest of which is the one that governs.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const FIXTURES = 'fixtures/reports';

/** Every file that declares the floor. The web test cannot import from the worker's rootDir. */
const DECLARING = [
  'apps/web/test/anchors.test.ts',
  'apps/worker/test/copy.test.ts',
  'apps/worker/test/requirement.test.ts',
  'apps/worker/bin/compose-check.ts',
];

const declaredIn = (path: string): number | null => {
  const match = /const REPORT_FIXTURE_FLOOR = (\d+);/.exec(readFileSync(path, 'utf8'));
  return match === null ? null : Number(match[1]);
};

describe('the fixture floor', () => {
  it('is declared in every file that loads the corpus', () => {
    for (const path of DECLARING) expect(declaredIn(path), path).not.toBeNull();
  });

  it('is the same number in all of them', () => {
    const declared = DECLARING.map((path) => [path, declaredIn(path)] as const);
    const first = declared[0]?.[1];
    for (const [path, value] of declared) expect(value, path).toBe(first);
  });

  /**
   * A declared constant that nothing compares against is the D-131 shape: present, readable, and
   * doing nothing. Each loader must actually reject a short corpus, not merely name a number.
   */
  it('is compared against, not just declared', () => {
    for (const path of DECLARING) {
      expect(readFileSync(path, 'utf8'), path).toContain('< REPORT_FIXTURE_FLOOR');
    }
  });

  it('is satisfiable by the corpus that is actually committed', () => {
    const count = readdirSync(FIXTURES).filter((file) => file.endsWith('.json')).length;
    const floor = declaredIn(DECLARING[0] as string) as number;

    // A floor above the corpus would fail every load; a floor of zero would assert nothing. It is a
    // floor and not an equality on purpose — adding a fixture is fine and must not need a bump.
    expect(floor).toBeGreaterThan(0);
    expect(count).toBeGreaterThanOrEqual(floor);
  });
});
