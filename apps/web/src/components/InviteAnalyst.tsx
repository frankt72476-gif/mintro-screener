/**
 * Asking for an invitation (D-228, D-229, D-230).
 *
 * The form does not issue anything. It writes a request to `analyst_invites` (0068) and the worker
 * issues it, because minting an account needs the service key and a browser must never hold one.
 * The owner sees the outcome on the row.
 *
 * The partner/staff control is first and largest because it is the highest-consequence choice on
 * the form: it decides whether this person will see every organisation's work or only their own.
 * Everything under it changes shape, and that shape is decided by `inviteShape` rather than by
 * conditionals here, so it can be asserted.
 */

import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPartnerOrg, type OrgOption } from '../lib/people.js';
import { inviteShape, type InviteKind } from '../lib/inviteForm.js';

export function InviteAnalyst({
  client,
  orgs,
  requestedBy,
  onAsked,
}: {
  readonly client: SupabaseClient;
  readonly orgs: readonly OrgOption[];
  readonly requestedBy: string;
  readonly onAsked?: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<InviteKind>('partner');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [pickedOrg, setPickedOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = useMemo(() => inviteShape(kind, orgs), [kind, orgs]);
  const [documentsCheck, setDocumentsCheck] = useState(shape.documentsCheck);
  const [iqwallet, setIqwallet] = useState(shape.iqwalletSubmit);

  // The defaults belong to the choice, so changing the choice resets them (D-229, D-230). A
  // partner who inherited staff defaults would be granted both by an unrelated click.
  const choose = (next: InviteKind): void => {
    const shapeOf = inviteShape(next, orgs);
    setKind(next);
    setDocumentsCheck(shapeOf.documentsCheck);
    setIqwallet(shapeOf.iqwalletSubmit);
    setPickedOrg('');
    setNewOrgName('');
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    let orgId = shape.fixedOrgId ?? pickedOrg;

    if (shape.allowsNewOrg && newOrgName.trim() !== '') {
      const made = await createPartnerOrg(client, newOrgName);
      if (!made.ok || made.id === undefined) {
        setBusy(false);
        setError(made.reason ?? 'the organisation could not be created');
        return;
      }
      orgId = made.id;
    }

    if (orgId === '') {
      setBusy(false);
      setError('Choose an organisation, or name a new agency.');
      return;
    }

    const { error: insertError } = await client.from('analyst_invites').insert({
      email: email.trim().toLowerCase(),
      full_name: name.trim(),
      org_id: orgId,
      can_run_documents_check: documentsCheck,
      can_submit_to_iqwallet: iqwallet,
      requested_by: requestedBy,
      status: 'queued',
    });

    setBusy(false);
    if (insertError !== null) {
      setError(insertError.message);
      return;
    }
    setEmail('');
    setName('');
    setNewOrgName('');
    onAsked?.();
  };

  return (
    <form
      className="invite"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="invite-kind">
        <legend>Who is this for?</legend>
        <label>
          <input type="radio" name="kind" checked={kind === 'partner'} onChange={() => choose('partner')} />
          <span className="invite-kind-name">A partner agency</span>
          <span className="invite-kind-what">Sees only their own organisation’s screenings.</span>
        </label>
        <label>
          <input type="radio" name="kind" checked={kind === 'staff'} onChange={() => choose('staff')} />
          <span className="invite-kind-name">Mintro staff</span>
          <span className="invite-kind-what">Sees every screening on the account.</span>
        </label>
      </fieldset>

      <label className="invite-label">
        Name
        <input className="invite-input" value={name} required onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="invite-label">
        Email
        <input
          className="invite-input"
          type="email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {shape.orgIsEditable ? (
        <>
          <label className="invite-label">
            New agency
            <input
              className="invite-input"
              value={newOrgName}
              placeholder="Name a new agency"
              onChange={(e) => setNewOrgName(e.target.value)}
            />
          </label>
          <label className="invite-label">
            or an existing one
            <select
              className="invite-input"
              value={pickedOrg}
              onChange={(e) => setPickedOrg(e.target.value)}
            >
              <option value="">—</option>
              {shape.choices.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="invite-fixed">
          {/* Fixed, not a disabled picker. There is one host and the form does not pretend otherwise. */}
          Organisation: Mintro
        </p>
      )}

      <fieldset className="invite-caps">
        <legend>Capabilities</legend>
        <label>
          <input type="checkbox" checked={documentsCheck} onChange={() => setDocumentsCheck((v) => !v)} />
          Documents check
        </label>
        <label>
          <input type="checkbox" checked={iqwallet} onChange={() => setIqwallet((v) => !v)} />
          Submit to IQwallet
        </label>
      </fieldset>

      {error !== null && <p className="people-error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Asking…' : 'Send invitation'}
      </button>
    </form>
  );
}
