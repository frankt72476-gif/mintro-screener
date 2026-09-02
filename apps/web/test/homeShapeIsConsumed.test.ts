/**
 * Every field `homeShape` emits is read by something that renders.
 *
 * ## The defect this exists for
 *
 * `showsAdministration` was computed correctly, documented at length, and asserted true for the
 * owner in three tests. **No component read it.** People and the access log shipped reachable only
 * by typing the URL, and the whole suite was green — because a flag that is correct and a screen
 * that renders it are two different facts, and only the first one was ever checked.
 *
 * ## Why the guards already here could not catch it
 *
 * `reachability.test.ts` walks the import graph from `main.tsx` and asserts every module is
 * reachable. `homeShape.ts` is imported by `App.tsx`, so it passed.
 *
 * `bundledControls.test.ts` reads the built JavaScript for the strings each control needs.
 * `PeoplePane` is imported by `App.tsx`, so "People" was in the bundle. It passed too.
 *
 * The orphan was one granularity finer than either: not a module, not a string, but an exported
 * **field** with no consumer. This is that granularity. Same family as the other two, and written
 * for the same reason — the thing that failed was invisible to typechecking, to unit tests, and to
 * a person reading the diff.
 *
 * ## What it does and does not prove
 *
 * It proves each field is *referenced* outside its own definition. It does not prove the reference
 * is correct, or that the reference reaches the screen — a field read into a variable that is then
 * dropped would satisfy this. That is what `rail.test.ts` and `reviewPathSurface.test.ts` are for,
 * asserting rendered markup. This one catches the coarser and more embarrassing failure: a field
 * nothing anywhere consumes at all.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve('apps/web/src');
const DEFINITION = join(SRC, 'lib', 'homeShape.ts');

/** Every `.ts`/`.tsx` under `src/`, except the file that defines the shape. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    if (!/\.tsx?$/.test(entry)) return [];
    if (full === DEFINITION) return [];
    return [full];
  });
}

/**
 * The field names, read from the interface rather than listed here.
 *
 * A hand-written list is a list that goes stale the moment somebody adds a field — and going stale
 * would make this file report full coverage of a shape it had stopped describing, which is the
 * failure it exists to prevent, one level up.
 */
function fieldsOfHomeShape(): string[] {
  const text = readFileSync(DEFINITION, 'utf8');
  const body = /export interface HomeShape \{([\s\S]*?)\n\}/.exec(text)?.[1];
  if (body === undefined) throw new Error('could not find `export interface HomeShape` in homeShape.ts');

  const names = [...body.matchAll(/^\s*readonly\s+(\w+)\s*:/gm)].map((m) => m[1] as string);
  if (names.length === 0) throw new Error('HomeShape parsed to zero fields — the regex has drifted');
  return names;
}

describe('homeShape emits nothing that nobody reads', () => {
  const fields = fieldsOfHomeShape();
  const corpus = sources(SRC)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('finds the fields, so this is not passing over an empty list', () => {
    // The check `anchors.test.ts` learned the hard way: a scan that saw no items reported that every
    // item was fine.
    expect(fields.length).toBeGreaterThanOrEqual(7);
    expect(fields).toContain('showsAdministration');
  });

  /*
    Asserted as a boolean, not with `toContain` on the corpus.

    `expect(corpus).toContain(field)` fails by printing every line of every source file, which
    buries the one sentence that matters. A guard whose failure output nobody reads is a guard
    nobody acts on.
  */
  it.each(fields)('%s is read by something outside homeShape.ts', (field) => {
    const consumed = corpus.includes(field);
    expect(
      consumed,
      `homeShape emits "${field}" and no file under apps/web/src reads it. ` +
        `Either render it or stop computing it — a flag nothing consumes is a screen nobody gets.`,
    ).toBe(true);
  });
});
