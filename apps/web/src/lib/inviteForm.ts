/**
 * What the invite form offers, decided once (D-229, D-230).
 *
 * The partner/staff choice is the highest-consequence control on the form: it decides whether the
 * person will see every organisation's work or only their own. Everything under it changes shape,
 * and the shape is decided here rather than in JSX conditionals, so it can be asserted.
 */

import type { OrgOption } from './people.js';

export type InviteKind = 'partner' | 'staff';

export interface InviteShape {
  /** Whether the org control lets a new agency be named. Never for staff. */
  readonly allowsNewOrg: boolean;
  /** Whether the org control can be changed at all. Fixed to the host for staff. */
  readonly orgIsEditable: boolean;
  /** The organisations offered. Only partners are ever offered as a choice. */
  readonly choices: readonly OrgOption[];
  /** The org selected when the form opens, where there is one. */
  readonly fixedOrgId?: string;
  /**
   * Capability defaults (D-229, D-230).
   *
   * Mintro staff are host-org members: they see every organisation's work and are, operationally,
   * the owner minus invite and grant — so both capabilities start on. A partner starts with
   * neither, because granting one to an agency is a decision the owner should make deliberately
   * rather than inherit from a default.
   *
   * Both are overridable in the form. A default is a starting point, not a policy.
   */
  readonly documentsCheck: boolean;
  readonly iqwalletSubmit: boolean;
}

export function inviteShape(kind: InviteKind, orgs: readonly OrgOption[]): InviteShape {
  const host = orgs.find((org) => org.type === 'host');

  if (kind === 'staff') {
    return {
      // No new-org control at all. `organizations_one_host` (0060) forbids a second host, and a
      // form that offered one would be asking for something the database will refuse — the third
      // place the same answer is given, and the one furthest from the button.
      allowsNewOrg: false,
      orgIsEditable: false,
      choices: host === undefined ? [] : [host],
      ...(host === undefined ? {} : { fixedOrgId: host.id }),
      documentsCheck: true,
      iqwalletSubmit: true,
    };
  }

  return {
    allowsNewOrg: true,
    orgIsEditable: true,
    choices: orgs.filter((org) => org.type === 'partner'),
    documentsCheck: false,
    iqwalletSubmit: false,
  };
}
