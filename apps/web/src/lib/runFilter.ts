/**
 * The owner/host filter over the run list (D-228, D-229).
 *
 * Everyone is the default, not Mine. The owner and host members are the people for whom the full
 * picture is the job, and defaulting to their own runs means having to remember to look.
 *
 * A pure function so the defaulting and the chip set can be asserted without a browser.
 */

export interface FilterableRun {
  readonly runId: string;
  readonly runBy?: string;
  readonly orgId?: string;
  readonly orgName?: string;
}

export type RunFilter =
  | { readonly kind: 'everyone' }
  | { readonly kind: 'mine' }
  | { readonly kind: 'org'; readonly orgId: string };

export const EVERYONE: RunFilter = { kind: 'everyone' };

export interface OrgChip {
  readonly orgId: string;
  readonly name: string;
  readonly runs: number;
  /** Marked, not hidden: a suspended organisation's work is still there (D-232). */
  readonly suspended: boolean;
}

/**
 * One chip per organisation that actually has runs in the list.
 *
 * Built from the runs rather than from the roster, so a chip never offers a filter that would come
 * back empty — and an organisation whose runs the reader cannot see does not appear at all, which
 * is the boundary rather than an omission.
 */
export function orgChips(
  runs: readonly FilterableRun[],
  suspendedOrgIds: readonly string[] = [],
): readonly OrgChip[] {
  const byOrg = new Map<string, OrgChip>();
  for (const run of runs) {
    if (run.orgId === undefined) continue;
    const existing = byOrg.get(run.orgId);
    byOrg.set(run.orgId, {
      orgId: run.orgId,
      name: run.orgName ?? '—',
      runs: (existing?.runs ?? 0) + 1,
      suspended: suspendedOrgIds.includes(run.orgId),
    });
  }
  return [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Applies a filter. `mine` is by the reader's own id, never by name — names are not unique. */
export function applyFilter<T extends FilterableRun & { readonly createdBy?: string }>(
  runs: readonly T[],
  filter: RunFilter,
  viewerId: string,
): readonly T[] {
  if (filter.kind === 'everyone') return runs;
  if (filter.kind === 'mine') return runs.filter((run) => run.createdBy === viewerId);
  return runs.filter((run) => run.orgId === filter.orgId);
}
