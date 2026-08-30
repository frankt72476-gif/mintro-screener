/**
 * Every PostgREST embed the app uses resolves to exactly one relationship (D-213).
 *
 * `merchant_comments ( count )` was unambiguous when it was written and became ambiguous later:
 * migration 0051 gave `merchant_comments` a second foreign key to `runs` for the inheritance
 * provenance, and PostgREST then refused the whole request with **PGRST201** — every role, every
 * call. Past reports rendered empty.
 *
 * **2691 tests passed over a query that failed 100% of the time.** The schema tests talk to Postgres
 * directly and never see relationship resolution; the web tests render components and never issue a
 * query. Nothing in the suite held the two together.
 *
 * So this reads the embeds out of the app's own source and asks the database how many relationships
 * each one has. It catches the *next* foreign key added to an embedded table rather than this one
 * instance, which is the only version worth having — the bug was not that someone wrote a bad
 * query, it was that a good query stopped being good.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

/** Every `.from('x').select('…')` pair the web app issues. */
interface Embed {
  readonly file: string;
  readonly parent: string;
  readonly child: string;
  /** True where the select already names the relationship, which is what fixes an ambiguous one. */
  readonly named: boolean;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : [],
  );
}

/** Strips comments, so prose *about* an embed is not scanned as one. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Reads the embeds out of the source.
 *
 * Deliberately textual, and by paren-matching rather than by regex over a window. The alternative is
 * exporting every query string for a test to import, which is a second copy of each query and the
 * copy is what goes stale — and the thing under test is the literal string PostgREST receives.
 *
 * The first attempt at this matched a fixed window after `.from(` and **missed the very embed it
 * exists for**, because the fix's own comment had made the call longer. It also scanned that comment
 * and reported the prose in it as two more embeds. Both are recorded here because a scanner that
 * quietly finds nothing is the failure mode this whole file is about.
 */
function embedsIn(files: readonly string[]): Embed[] {
  const found: Embed[] = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');

    for (const call of text.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)) {
      const parent = call[1] as string;
      const from = call.index ?? 0;
      const select = /\.select\(/.exec(text.slice(from, from + 900));
      if (select === undefined || select === null) continue;

      // The select's argument, by matching parens rather than guessing a length.
      let i = from + select.index + '.select('.length;
      let depth = 1;
      let argument = '';
      while (depth > 0 && i < text.length) {
        const ch = text[i] as string;
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        argument += ch;
        i += 1;
      }

      for (const embed of withoutComments(argument).matchAll(/([a-z_]+)(!([a-z_]+))?\s*\(/g)) {
        const child = embed[1] as string;
        if (child === parent || child === 'count') continue;
        found.push({ file, parent, child, named: embed[2] !== undefined });
      }
    }
  }

  return found;
}

const EMBEDS = embedsIn(sourceFiles('apps/web/src'));

/** How many foreign keys join a child table to a parent, in either direction. */
async function relationshipCount(parent: string, child: string): Promise<number> {
  const rows = await schema.query<{ n: number }>(
    `select count(*)::int as n
       from pg_constraint c
       join pg_class child  on child.oid  = c.conrelid
       join pg_class parent on parent.oid = c.confrelid
      where c.contype = 'f'
        and ((child.relname = $1 and parent.relname = $2)
          or (child.relname = $2 and parent.relname = $1))`,
    [child, parent],
  );
  return rows[0]?.n ?? 0;
}

describe('the embeds the app issues', () => {
  it('finds them, so this is not passing over an empty list', () => {
    /*
      The failure mode of a scan like this is finding nothing and reporting success — which is
      exactly what the whole suite did to the bug it exists for.
    */
    expect(EMBEDS.length).toBeGreaterThan(0);
    expect(EMBEDS.some((e) => e.parent === 'runs' && e.child === 'merchant_comments')).toBe(true);
  });

  it.each(EMBEDS.map((e) => [`${e.parent} → ${e.child}${e.named ? ' (named)' : ''}`, e] as const))(
    '%s resolves to exactly one relationship',
    async (_label, embed) => {
      const n = await relationshipCount(embed.parent, embed.child);

      // A named embed says which relationship it wants, so more than one is fine — that is the fix.
      if (embed.named) {
        expect(n).toBeGreaterThan(0);
        return;
      }

      expect(
        n,
        `${embed.parent} embeds ${embed.child} without naming a relationship, and there ` +
          `${n === 0 ? 'is none' : `are ${n}`}. PostgREST answers PGRST201 and the whole query ` +
          `fails. Name it: ${embed.child}!<constraint_name> ( … ). Seen in ${embed.file}.`,
      ).toBe(1);
    },
  );
});
