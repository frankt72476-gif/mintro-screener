/**
 * The partner/staff choice, which decides cross-org visibility (D-229, D-230).
 *
 * It is the highest-consequence control on the invite form, so what it changes is a pure function
 * and asserted here rather than spread through JSX conditionals nobody can test.
 */

import { describe, expect, it } from 'vitest';
import { inviteShape } from '../src/lib/inviteForm.js';
import type { OrgOption } from '../src/lib/people.js';

const ORGS: readonly OrgOption[] = [
  { id: 'host-1', name: 'Mintro', type: 'host' },
  { id: 'p-a', name: 'Partner A', type: 'partner' },
  { id: 'p-b', name: 'Partner B', type: 'partner' },
];

describe('inviting Mintro staff', () => {
  const shape = inviteShape('staff', ORGS);

  it('fixes the organisation to the host and does not let it be changed', () => {
    expect(shape.orgIsEditable).toBe(false);
    expect(shape.fixedOrgId).toBe('host-1');
  });

  it('offers no way to create an organisation', () => {
    // `organizations_one_host` (0060) forbids a second host. The form must not try.
    expect(shape.allowsNewOrg).toBe(false);
  });

  it('offers no partner organisation as a choice', () => {
    expect(shape.choices.map((o) => o.type)).toEqual(['host']);
  });

  it('starts with both capabilities on, because host members are (D-229)', () => {
    expect(shape.documentsCheck).toBe(true);
    expect(shape.iqwalletSubmit).toBe(true);
  });
});

describe('inviting a partner', () => {
  const shape = inviteShape('partner', ORGS);

  it('lets a new agency be named, or an existing one picked', () => {
    expect(shape.allowsNewOrg).toBe(true);
    expect(shape.orgIsEditable).toBe(true);
  });

  it('offers only partner organisations, never the host', () => {
    // A partner is never placed in Mintro's own organisation by this form.
    expect(shape.choices.map((o) => o.name)).toEqual(['Partner A', 'Partner B']);
  });

  it('starts with both capabilities off, so granting one is deliberate (D-230)', () => {
    expect(shape.documentsCheck).toBe(false);
    expect(shape.iqwalletSubmit).toBe(false);
  });
});

describe('when the host organisation cannot be read', () => {
  it('offers staff no organisation rather than guessing one', () => {
    // Better an empty control the owner can see is wrong than a partner org silently chosen for
    // somebody who was being made a host member.
    const shape = inviteShape('staff', [{ id: 'p-a', name: 'Partner A', type: 'partner' }]);
    expect(shape.fixedOrgId).toBeUndefined();
    expect(shape.choices).toEqual([]);
  });
});
