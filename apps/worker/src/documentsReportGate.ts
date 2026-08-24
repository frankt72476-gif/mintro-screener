/**
 * The stale-run precondition (D-117).
 *
 * B-06 was withdrawn from the engine because nothing in a snapshot distinguishes a fresh run from
 * an aged one: the run's timestamp is the same value whether it was created a minute ago or in
 * March, and it is the *report* that has aged. So the check lives here, where the package's current
 * state is available to compare against.
 *
 * **It refuses. It does not warn.** A report generated from a superseded run is wrong in a way its
 * reader cannot see — the slot table says a document is missing that arrived last week, and nothing
 * on the page says so. A warning would be a note the sender is free to click past, and the failure
 * mode it guards against is precisely the one where somebody is in a hurry.
 *
 * The remedy is a new run, which D-002 already requires and the schema already supports.
 */

import { createHash } from 'node:crypto';

/** The inputs whose change invalidates a run. */
export interface DigestInput {
  readonly slots: readonly {
    readonly slotId: string;
    readonly state: string;
    readonly reason: string | null;
    readonly requiredCount: number | null;
  }[];
  readonly documents: readonly { readonly versionId: string; readonly outcome: string }[];
}

/**
 * A digest over what the run read.
 *
 * Sorted before hashing, because row order from PostgREST is not a fact about the package and a
 * digest that changed with it would refuse every run for no reason.
 *
 * **Slot reasons and counts are in it, not only document ids.** Coverage moving is as invalidating
 * as a document arriving: a slot waived since the run means the report would show a chase for
 * something nobody is chasing any more.
 */
export function packageDigest(input: DigestInput): string {
  const slots = [...input.slots]
    .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0))
    .map((s) => `${s.slotId}:${s.state}:${s.reason ?? ''}:${s.requiredCount ?? ''}`);
  const documents = [...input.documents]
    .sort((a, b) => (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0))
    .map((d) => `${d.versionId}:${d.outcome}`);

  return createHash('sha256')
    .update(JSON.stringify({ slots, documents }))
    .digest('hex');
}

export class StaleRunError extends Error {
  readonly runId: string;
  readonly runDigest: string;
  readonly currentDigest: string;
  readonly changes: readonly string[];

  constructor(runId: string, runDigest: string, currentDigest: string, changes: readonly string[]) {
    super(
      `run ${runId} is stale: the package has changed since it executed, so a report from it would ` +
        `describe a package that no longer exists. ${changes.join('; ')}. ` +
        'Create a new run and generate the report from that (D-117, D-002).',
    );
    this.name = 'StaleRunError';
    this.runId = runId;
    this.runDigest = runDigest;
    this.currentDigest = currentDigest;
    this.changes = changes;
  }
}

/**
 * Name what moved.
 *
 * The digest alone answers yes or no, and "your run is stale" with no further detail is the kind of
 * refusal people learn to work around. This says which documents arrived and which slots changed,
 * so the operator can see the refusal is about something real.
 */
export function describeDrift(runInput: DigestInput, current: DigestInput): string[] {
  const changes: string[] = [];

  const before = new Set(runInput.documents.map((d) => d.versionId));
  const after = new Set(current.documents.map((d) => d.versionId));
  const added = [...after].filter((v) => !before.has(v));
  const gone = [...before].filter((v) => !after.has(v));
  if (added.length > 0) changes.push(`${added.length} document version(s) added since the run`);
  if (gone.length > 0) changes.push(`${gone.length} document version(s) no longer live`);

  const slotBefore = new Map(runInput.slots.map((s) => [s.slotId, s]));
  const moved: string[] = [];
  for (const slot of current.slots) {
    const was = slotBefore.get(slot.slotId);
    if (was === undefined) {
      moved.push('a slot was added');
      continue;
    }
    if (was.state !== slot.state) moved.push(`a slot moved from ${was.state} to ${slot.state}`);
    else if (was.reason !== slot.reason) moved.push('a slot reason changed');
    else if (was.requiredCount !== slot.requiredCount) moved.push('a slot required count changed');
  }
  if (moved.length > 0) changes.push(...[...new Set(moved)]);

  if (changes.length === 0) {
    // The digests differ and nothing above explains it. Refusing anyway is the safe direction:
    // an unexplained difference in the inputs is still a difference in the inputs.
    changes.push('the run inputs differ from the package in a way this summary does not capture');
  }
  return changes;
}

/**
 * Throw unless the run still describes the package.
 *
 * Called before generating a report, and before sending one. Both, deliberately: a report generated
 * and then sat on for an hour is exactly the case D-117 is about, and checking only at generation
 * would let it through.
 */
export function assertRunIsCurrent(
  runId: string,
  runDigest: string,
  runInput: DigestInput,
  current: DigestInput,
): void {
  const currentDigest = packageDigest(current);
  if (currentDigest === runDigest) return;
  throw new StaleRunError(runId, runDigest, currentDigest, describeDrift(runInput, current));
}
