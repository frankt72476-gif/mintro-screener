/**
 * No stylesheet rule may target a state class unqualified.
 *
 * ## The defect this exists for
 *
 * `NotAvailable` was given a container class of `na`, and `na` is what `stateClass()` returns for
 * **not_evaluable** — it has been since M3. The stylesheet already carried `.find.na`, `.state.na`,
 * `.band-name.na`, `.tick.na`, `.pip.na` and `.stopcheck-row.na`, every one qualified by another
 * class. The new rule was not:
 *
 *     .na { max-width: 30rem; margin: 4rem auto; padding: 2rem; }
 *
 * Last in the file, so it won on every property nothing else set. On one report it matched **76**
 * elements — 37 finding rows and 39 state pills — capping each at 30rem, centring it with `margin:
 * auto` and indenting it 92px from its own group heading, with 64px of blank above. Measured on the
 * live site: disabling that single rule moved a row from left 217 to 0 and its width from 480 to
 * 913.
 *
 * Nothing caught it. It is valid CSS, the component renders, every test passed, and the two meanings
 * of `na` are three thousand lines apart in one file.
 *
 * ## What this asserts
 *
 * That no rule targets a bare state class. A state class is an adjective on something else — a
 * finding, a pill, a tick — and never a thing in its own right, so an unqualified rule is always
 * either a mistake or a name that wants changing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('apps/web/src/styles.css', 'utf8');

/** What `stateClass()` in `lib/format.ts` can return. Kept in step by the test below. */
const STATE_CLASSES = ['fail', 'review', 'pass', 'na'] as const;

/**
 * Selectors in the stylesheet, with comments and declaration bodies removed.
 *
 * Comments matter: several of them mention `.na` in prose, and a naive scan of the raw file would
 * report a violation for a sentence explaining the rule.
 */
function selectors(): string[] {
  const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/(^|[}])([^{}]+)\{/g)]
    .map((m) => (m[2] ?? '').trim())
    .filter((s) => s.length > 0 && !s.startsWith('@'));
}

describe('state classes are adjectives, never selectors of their own', () => {
  const all = selectors();

  it('found the selectors, so this is not passing over an empty list', () => {
    // The shape `anchors.test.ts` was rewritten for: a scan that saw nothing reported everything fine.
    expect(all.length).toBeGreaterThan(400);
    expect(all.join(' ')).toContain('.band-bar');
  });

  it.each(STATE_CLASSES)('has no rule targeting a bare .%s', (state) => {
    /*
      A bare occurrence is the class with nothing qualifying it on its own side of the combinator:
      `.na`, `.na:hover`, `.foo .na` — all unqualified on the `.na` element itself. `.find.na` and
      `.state.na` are qualified and are what every legitimate use looks like.
    */
    const offenders = all.filter((selector) =>
      selector
        .split(',')
        .map((s) => s.trim())
        .some((s) =>
          s
            .split(/[\s>+~]+/)
            .filter(Boolean)
            .some((part) => new RegExp(`^\\.${state}(?::[a-z-]+)?$`).test(part)),
        ),
    );

    expect(
      offenders,
      `"${state}" is a state class (stateClass() returns it for a finding's state). A rule ` +
        `targeting it unqualified matches every finding row and state pill in that state — the ` +
        `defect D-247 records. Qualify it (.find.${state}) or rename the class.`,
    ).toEqual([]);
  });

  it('keeps the list in step with stateClass()', () => {
    // If `stateClass` gains a return value, this test must learn about it — otherwise the guard
    // silently stops covering the newest state, which is how a guard rots.
    const source = readFileSync('apps/web/src/lib/format.ts', 'utf8');
    const signature = /stateClass\(state: State\): ((?:'[a-z_]+'\s*\|?\s*)+)/.exec(source)?.[1] ?? '';
    const declared = [...signature.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
    expect(declared.sort()).toEqual([...STATE_CLASSES].sort());
  });

  it('still has the qualified rules the report relies on', () => {
    // The fix must not have been "delete every .na rule". These are what style a not_evaluable
    // finding, and their absence would be a different defect wearing this test as cover.
    for (const selector of ['.state.na', '.band-name.na', '.find.na .find-head']) {
      expect(CSS, `${selector} is missing`).toContain(selector);
    }
  });
});
