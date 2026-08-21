/**
 * Entering a merchant's screening login.
 *
 * The merchant supplies a demo account so we can see product pages behind their wall. It is
 * sealed in this browser before it is sent (D-038) and cannot be read back by anyone here.
 *
 * ## What this screen says out loud
 *
 * Two things, because both change how someone uses it:
 *
 *   - **It cannot be retrieved.** There is no "view credential" anywhere in this application, and
 *     that is a property rather than a missing feature. Saying so prevents someone treating this
 *     as a password manager.
 *   - **It cannot make a merchant look better.** GATE-002 and GATE-003 are decided by a request
 *     that carries no session, always. Someone will eventually ask whether supplying an account
 *     changes the gate findings; the honest answer belongs where the question is asked.
 */

import { useState } from 'react';
import type { CredentialDeposit } from '../lib/credentials.js';

interface Props {
  readonly deposit: CredentialDeposit;
  readonly domain: string;
  readonly onClose: () => void;
  readonly onDeposited: (domain: string) => void;
}

export function CredentialModal({ deposit, domain, onClose, onDeposited }: Props): JSX.Element {
  const [merchantDomain, setMerchantDomain] = useState(domain);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    const result = await deposit.deposit(merchantDomain, {
      username,
      password,
      ...(loginUrl.trim() === '' ? {} : { loginUrl: loginUrl.trim() }),
    });

    setBusy(false);
    if (result.ok) {
      // Cleared immediately. There is no reason for a password to stay in a React state tree
      // after it has been sealed and sent.
      setPassword('');
      setUsername('');
      onDeposited(merchantDomain);
      return;
    }
    setError(result.error);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Merchant screening login">
      <div className="modal-body">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Screening account</div>
            <h2 style={{ margin: '2px 0 0' }}>Merchant-supplied login</h2>
          </div>
        </div>

        <p className="sub" style={{ marginTop: 0 }}>
          A demo account the merchant has given us, used to reach product pages behind their login.
        </p>

        <div className="field">
          <label className="flabel" htmlFor="cred-domain">
            Merchant
          </label>
          <input
            className="input"
            id="cred-domain"
            value={merchantDomain}
            placeholder="shop.example"
            onChange={(event) => setMerchantDomain(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="flabel" htmlFor="cred-user">
            Username or email
          </label>
          <input
            className="input"
            id="cred-user"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="flabel" htmlFor="cred-pass">
            Password
          </label>
          <input
            className="input"
            id="cred-pass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="flabel" htmlFor="cred-url">
            Login page <span style={{ fontWeight: 400 }}>— optional</span>
          </label>
          <p className="fhint">Only if it is somewhere other than the platform default.</p>
          <input
            className="input"
            id="cred-url"
            value={loginUrl}
            placeholder="https://shop.example/account/login"
            onChange={(event) => setLoginUrl(event.target.value)}
          />
        </div>

        <div className="cred-note">
          <p>
            <strong>Sealed in this browser before it is sent.</strong> It is encrypted to a key held
            only by the worker, so it cannot be read from the database, and it cannot be shown back
            to you or to anyone else in this application. If it is lost, we ask the merchant again.
          </p>
          <p>
            <strong>It cannot make a merchant look better.</strong> The gate checks — products
            hidden until an account exists, guest checkout disabled — are always decided by a
            request carrying no session. A supplied account widens what we can see; it never
            changes what is reported.
          </p>
        </div>

        {error !== null && <div className="err">{error}</div>}

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || username.trim() === '' || password === '' || merchantDomain.trim() === ''}
            onClick={() => void submit()}
          >
            {busy ? 'Sealing…' : 'Store credential'}
          </button>
        </div>
      </div>
    </div>
  );
}
