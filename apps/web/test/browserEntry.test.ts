/**
 * Every symbol `apps/web/src` imports from a workspace package is exported by the **browser** entry
 * that the app's bundle actually resolves to (D-172).
 *
 * ## Why this is easy to get wrong
 *
 * One specifier, `@mintro/engine`, resolves three different ways depending on who is asking:
 *
 * | asks | resolves to | via |
 * |---|---|---|
 * | `vite build apps/web` | `packages/engine/src/browser.ts` | the alias in `apps/web/vite.config.ts` |
 * | `tsc --build` | `packages/engine/dist/src/index.d.ts` | `package.json` `exports` |
 * | `vitest` | `packages/engine/src/index.ts` | the alias in `vitest.config.ts` |
 *
 * So a symbol exported from `index.ts` and forgotten in `browser.ts` typechecks, passes every test,
 * and fails only when the bundle is built. **Both instances so far were found that way**:
 * `distinctRuleCount` (D-170) and `HEARTBEAT_MS` (D-171) — a real check, in the wrong place,
 * arriving after the mistake had stopped being cheap.
 *
 * Note the third row especially. A web *test* importing an index-only symbol proves nothing about
 * the browser entry, because vitest reads `index.ts` too. `heartbeat.test.ts` importing
 * `HEARTBEAT_MS` from `@mintro/engine` is exactly that: green either way. Which is why this reads
 * `browser.ts` as a **file** rather than importing from it — an import here would resolve through
 * the same alias it exists to check.
 *
 * ## What is in scope
 *
 * `apps/web/src` only, because that is precisely the set `vite build` compiles. `apps/web/test`
 * is deliberately excluded: those files are run by vitest against `index.ts` and are never bundled,
 * so an index-only import there is legitimate and flagging it would be a false failure.
 *
 * ## How the two sides are read
 *
 * Syntactically, with the TypeScript parser rather than regular expressions, so `export { a as b }`
 * contributes `b` and `import { type T }` is not mistaken for a value. No program and no package
 * resolution is needed: the names are all in the source. `export *` is followed one file at a time
 * — `packages/ruleset/src/browser.ts` uses it, and a check that could not read the real entry would
 * be a check of something else — and a `export *` from a *package* rather than a relative path
 * would defeat that, so it throws rather than silently contributing nothing.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

/** The alias table in `apps/web/vite.config.ts`, which is what the bundle follows. */
const BROWSER_ENTRY: Readonly<Record<string, string>> = {
  '@mintro/engine': 'packages/engine/src/browser.ts',
  '@mintro/ruleset': 'packages/ruleset/src/browser.ts',
};

const WEB_SRC = 'apps/web/src';

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `./slug.js` as written in a specifier → the `.ts` file it means, beside the importer. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return join(dirname(fromFile), specifier.replace(/\.js$/, '.ts'));
}

/**
 * Every name a module exposes, as an importer would name it.
 *
 * `export *` is followed rather than refused: `packages/ruleset/src/browser.ts` uses it, and a
 * check that could not read the real entry would be a check of something else. Following it needs
 * only a relative path and another parse — the names are all in the source, and nothing here has to
 * resolve a package.
 */
function exportedNames(path: string, seen: Set<string> = new Set()): Set<string> {
  const names = new Set<string>();
  if (seen.has(path)) return names;
  seen.add(path);

  const file = parse(path);

  for (const statement of file.statements) {
    // export { a, b as c } / export type { T } / export * / export * as ns
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;

      if (clause === undefined) {
        const target =
          statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
            ? resolveRelative(path, statement.moduleSpecifier.text)
            : null;
        if (target === null) {
          throw new Error(
            `${path} re-exports * from a non-relative module, which this check cannot follow.`,
          );
        }
        for (const name of exportedNames(target, seen)) names.add(name);
        continue;
      }

      // `.name` is the exported name, so `export { a as b }` correctly contributes `b`.
      if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.add(element.name.text);
      } else {
        names.add(clause.name.text); // export * as ns from '...'
      }
      continue;
    }

    // Declarations exported where they are written.
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }

  return names;
}

/**
 * What one web file imports **as a value** from each aliased package.
 *
 * Type-only imports are excluded, and that is not a convenience — it is what makes this check
 * correct. `import type { documents } from '@mintro/engine'` is erased by esbuild before the
 * bundle resolves anything, so it never reaches the browser entry and cannot break the build; the
 * type comes from `index.d.ts` via `tsc`, which is a different question with a different answer.
 * The first version of this test flagged three such imports as missing exports. They are not.
 *
 * The distinction is reliable because `tsconfig.base.json` sets `verbatimModuleSyntax: true`: an
 * import not marked `type` is emitted as a real import, so what is written is what is bundled.
 */
function importsByPackage(path: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const file = parse(path);

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const pkg = statement.moduleSpecifier.text;
    if (BROWSER_ENTRY[pkg] === undefined) continue;

    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue; // `import type { … }`, erased

    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;

    const set = found.get(pkg) ?? new Set<string>();
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue; // `import { type X }`, also erased
      // `.propertyName ?? .name` is the name in the *source* module, which is what must be exported.
      set.add((element.propertyName ?? element.name).text);
    }
    found.set(pkg, set);
  }
  return found;
}

describe('the browser entry exports everything the app imports', () => {
  const files = sourceFiles(WEB_SRC);

  it('has web sources to read, so this cannot pass by finding none', () => {
    // D-168: a check that iterates a collection fails when the collection is absent.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(BROWSER_ENTRY))('%s → %s', (pkg, entry) => {
    const exported = exportedNames(entry);
    expect(exported.size, `${entry} exported nothing, which cannot be right`).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of files) {
      for (const name of importsByPackage(file).get(pkg) ?? []) {
        if (!exported.has(name)) missing.push(`${name} — imported by ${file}`);
      }
    }

    expect(
      missing,
      `${entry} does not export these, so \`vite build apps/web\` will fail:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The `export *` traversal, pinned directly.
   *
   * Nothing `apps/web/src` imports as a value currently reaches `@mintro/ruleset`'s entry through
   * `export * from './vocabulary.js'` — every one comes from an explicit clause. So if that
   * traversal silently returned nothing, the check above would still pass, having simply not known
   * about a whole file. That is the shape D-168 is about, in this file.
   *
   * `STATES` is declared in `vocabulary.ts` and reaches the entry only that way.
   */
  it('follows `export *`, rather than passing by not seeing it', () => {
    expect(exportedNames('packages/ruleset/src/browser.ts')).toContain('STATES');
  });

  /**
   * The regression that prompted this. Both symbols are imported by `apps/web/src` and were, at
   * different times, exported only from `index.ts`.
   */
  it('covers the two that got through', () => {
    const exported = exportedNames(BROWSER_ENTRY['@mintro/engine'] as string);
    expect(exported).toContain('distinctRuleCount');
    expect(exported).toContain('HEARTBEAT_MS');
    expect(exported).toContain('HEARTBEAT_QUIET_MS');
  });
});
