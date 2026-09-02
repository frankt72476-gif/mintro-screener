/**
 * The owner/host filter over the run list (D-228, D-229, D-232).
 *
 * Everyone is the default and not Mine, chips come from the runs rather than the roster, and a
 * suspended organisation is marked rather than dropped. All three are decisions rather than
 * rendering, so they are asserted here.
 */

import { describe, expect, it } from 'vitest';
import { EVERYONE, applyFilter, orgChips } from '../src/lib/runFilter.js';

const RUNS = [
  { runId: 'r1', createdBy: 'me', orgId: 'host', orgName: 'Mintro', runBy: 'Owner' },
  { runId: 'r2', createdBy: 'them', orgId: 'pa', orgName: 'Partner A', runBy: 'A One' },
  { runId: 'r3', createdBy: 'them', orgId: 'pa', orgName: 'Partner A', runBy: 'A Two' },
  { runId: 'r4', createdBy: 'other', orgId: 'pb', orgName: 'Partner B', runBy: 'B One' },
];

describe('the default', () => {
  it('is Everyone, because the full picture is the job', () => {
    // Defaulting to Mine would mean the owner has to remember to look.
    expect(applyFilter(RUNS, EVERYONE, 'me')).toHaveLength(4);
  });
});

describe('filtering', () => {
  it('narrows to the reader’s own runs by id, never by name', () => {
    // Two people can share a display name; ids do not collide.
    expect(applyFilter(RUNS, { kind: 'mine' }, 'me').map((r) => r.runId)).toEqual(['r1']);
  });

  it('narrows to one organisation', () => {
    expect(applyFilter(RUNS, { kind: 'org', orgId: 'pa' }, 'me').map((r) => r.runId)).toEqual([
      'r2',
      'r3',
    ]);
  });
});

describe('the chips', () => {
  it('are built from the runs, so none of them comes back empty', () => {
    const chips = orgChips(RUNS);
    expect(chips.map((c) => c.name)).toEqual(['Mintro', 'Partner A', 'Partner B']);
    expect(chips.find((c) => c.orgId === 'pa')?.runs).toBe(2);
  });

  it('offers no chip for an organisation whose runs the reader cannot see', () => {
    // The boundary, not an omission: a partner's list contains only their own org's runs, so only
    // their own chip appears.
    const partnerView = RUNS.filter((r) => r.orgId === 'pa');
    expect(orgChips(partnerView).map((c) => c.orgId)).toEqual(['pa']);
  });

  it('marks a suspended organisation rather than dropping it (D-232)', () => {
    const chips = orgChips(RUNS, ['pb']);
    expect(chips.find((c) => c.orgId === 'pb')?.suspended).toBe(true);
    expect(chips.find((c) => c.orgId === 'pa')?.suspended).toBe(false);
    // Still there, and still counted.
    expect(chips).toHaveLength(3);
  });
});
