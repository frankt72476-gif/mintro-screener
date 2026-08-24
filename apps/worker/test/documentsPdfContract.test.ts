/**
 * The two declarations of the print payload agree.
 *
 * `apps/worker` cannot import a `.tsx`, so `documentsPdfTypes.ts` restates the shape the React
 * component owns. Two declarations of one contract is a real cost, taken because the alternatives
 * are a package for a single interface or a worker build that compiles React.
 *
 * This is the guard that makes it survivable: a structural comparison of the two, so a field added
 * to the component and not to the worker fails here rather than in a PDF missing its masthead.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** The `readonly x: ...;` field names declared by one interface in a source file. */
function fieldsOf(path: string, name: string): string[] {
  const src = readFileSync(path, 'utf8');
  const start = src.indexOf(`interface ${name} {`);
  if (start === -1) throw new Error(`${name} not found in ${path}`);
  const body = src.slice(start, src.indexOf('\n}', start));
  return [...body.matchAll(/^\s*readonly\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]!).sort();
}

describe('the print payload has one shape', () => {
  it('the worker and the component declare the same fields', () => {
    const worker = fieldsOf('apps/worker/src/documentsPdfTypes.ts', 'DocumentsReportViewProps');
    const component = fieldsOf('apps/web/src/components/DocumentsReportView.tsx', 'DocumentsReportViewProps');
    expect(worker).toEqual(component);
    expect(worker.length).toBeGreaterThan(0);
  });
});
