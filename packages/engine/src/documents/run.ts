/**
 * A run: one pass over a snapshot, producing findings.
 *
 * **Append-only and immutable (D-002).** Nothing here mutates a prior run, because nothing here can
 * see one — a run is a value returned from a pure function over a snapshot, and re-running produces
 * a second value rather than an edit to the first. Persistence is the worker's, and the schema
 * refuses updates besides.
 *
 * **No aggregate verdict, and there will not be one.** This returns findings and a count of each
 * state, and nothing that reduces a package to a judgement. A check fails; a merchant never does
 * (D-001).
 */

import type { DocumentsRules } from '@mintro/ruleset';
import { assertFindingWellFormed } from './findings.js';
import { runFamilyA } from './familyA.js';
import { runFamilyB } from './familyB.js';
import { runFamilyC, type RoutingDirectory } from './familyC.js';
import { runFamilyD } from './familyD.js';
import type { CheckState, DocumentFinding, DocumentsRun, PackageSnapshot } from './types.js';

export interface RunOptions {
  readonly runId: string;
  readonly families?: readonly ('A' | 'B' | 'C' | 'D')[];
  /**
   * The Federal Reserve E-Payments routing directory, for C-10 — the only external check in v1.
   *
   * A port, not an import: a multi-megabyte file that changes weekly has no business being loaded
   * by a pure check function. Absent, C-10 says so and returns `routing_directory_unavailable`
   * rather than passing on a lookup it never made.
   */
  readonly routingDirectory?: RoutingDirectory;
}

/** Counts by state. Not a score, not a verdict — four numbers a reader can see the basis of. */
export function tally(findings: readonly DocumentFinding[]): Record<CheckState, number> {
  const counts: Record<CheckState, number> = { fail: 0, review: 0, pass: 0, not_evaluable: 0 };
  for (const finding of findings) counts[finding.state] += 1;
  return counts;
}

export function runDocumentChecks(
  snapshot: PackageSnapshot,
  rules: DocumentsRules,
  options: RunOptions,
): DocumentsRun {
  const families = options.families ?? ['A', 'B'];

  // v1 only. A deferred check is one nobody has agreed to ship, and running it would put findings
  // in a report from a rule that is not in the release.
  const byId = new Map(
    rules.checks.checks.filter((c) => c.release === 'v1').map((c) => [c.id, c]),
  );
  const markers = new Map<string, readonly string[]>(
    rules.checks.catalog.flatMap((c) => (c.markers === undefined ? [] : [[c.key, c.markers] as const])),
  );

  const findings: DocumentFinding[] = [];
  if (families.includes('A')) findings.push(...runFamilyA({ snapshot, checks: byId, markers }));
  if (families.includes('B')) findings.push(...runFamilyB({ snapshot, checks: byId }));
  if (families.includes('C')) {
    findings.push(...runFamilyC({
      snapshot,
      checks: byId,
      ...(options.routingDirectory === undefined ? {} : { routingDirectory: options.routingDirectory }),
    }));
  }
  if (families.includes('D')) findings.push(...runFamilyD({ snapshot, checks: byId }));

  // Every finding re-checked against the check that produced it. Cheap, and it is the difference
  // between the constructors being a discipline and being a guarantee.
  for (const finding of findings) {
    const check = byId.get(finding.checkId);
    if (check === undefined) {
      throw new Error(`${finding.checkId} produced a finding but is not a v1 check`);
    }
    assertFindingWellFormed(finding, check);
  }

  return {
    runId: options.runId,
    packageId: snapshot.packageId,
    runAt: snapshot.runAt.toISOString(),
    rulesVersion: rules.checks.version,
    findings,
  };
}
