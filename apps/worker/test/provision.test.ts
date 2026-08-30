/**
 * `make-credential-key --set`, and the one thing it must never do quietly (D-193).
 *
 * The paths that matter cannot be exercised against a live Fly app: the interesting ones either
 * overwrite a production secret or need one to already exist. So the effects sit behind `Hosts` and
 * the sequence is a function over it.
 *
 * The refusal is the reason this file exists. An existing `CREDENTIAL_PRIVATE_KEY` is the only key
 * that can open every credential already stored; replacing it is not an update, it is destroying the
 * ability to read all of them, with no recovery by design (D-038).
 */

import { describe, expect, it } from 'vitest';
import { provisionKeyPair, type CommandResult, type Hosts } from '../src/auth/provision.js';

const OK: CommandResult = { ok: true, code: 0, stdout: '', stderr: '' };
const FAILED: CommandResult = { ok: false, code: 1, stdout: '', stderr: 'the app refused it' };

const OPTIONS = {
  app: 'mintro-screener-worker',
  privateName: 'CREDENTIAL_PRIVATE_KEY',
  publicName: 'VITE_CREDENTIAL_PUBLIC_KEY',
  file: '/tmp/credential-public-key.txt',
  force: false,
};

interface Spy {
  readonly hosts: Hosts;
  readonly written: { path: string; contents: string }[];
  readonly secretsSet: { name: string; value: string }[];
  readonly netlifySet: { name: string; value: string }[];
  generated: number;
}

function spy(over: Partial<Hosts> = {}): Spy {
  const written: { path: string; contents: string }[] = [];
  const secretsSet: { name: string; value: string }[] = [];
  const netlifySet: { name: string; value: string }[] = [];
  const state = { generated: 0 };

  const hosts: Hosts = {
    flyAvailable: async () => true,
    secrets: async () => ({ reachable: true, names: ['SUPABASE_URL'] }),
    setSecret: async (_app, name, value) => {
      secretsSet.push({ name, value });
      return OK;
    },
    netlify: async () => ({ usable: false, siteArgs: [], reason: 'this directory is not linked to a site.' }),
    setNetlify: async (name, value) => {
      netlifySet.push({ name, value });
      return OK;
    },
    writePublic: (path, contents) => written.push({ path, contents }),
    generate: async () => {
      state.generated += 1;
      return { publicKey: '-----BEGIN PUBLIC KEY-----\nPUB\n-----END PUBLIC KEY-----', privateKey: '-----BEGIN PRIVATE KEY-----\nPRIV\n-----END PRIVATE KEY-----' };
    },
    ...over,
  };

  return {
    hosts,
    written,
    secretsSet,
    netlifySet,
    get generated() {
      return state.generated;
    },
  } as Spy;
}

describe('refusing to overwrite', () => {
  it('stops when the private key already exists', async () => {
    const s = spy({ secrets: async () => ({ reachable: true, names: ['CREDENTIAL_PRIVATE_KEY'] }) });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(result.code).toBe(1);
    expect(result.done).toBeUndefined();
    expect(result.errors.join(' ')).toContain('already set');
    expect(result.errors.join(' ')).toContain('permanently unopenable');
    expect(result.errors.join(' ')).toContain('--force');
  });

  it('generates nothing when it refuses', async () => {
    /*
      Checked before anything is created, not after. A pair generated and discarded is a pair that
      existed, and the ordering is what makes the refusal free of side effects.
    */
    const s = spy({ secrets: async () => ({ reachable: true, names: ['CREDENTIAL_PRIVATE_KEY'] }) });
    await provisionKeyPair(s.hosts, OPTIONS);

    expect(s.generated).toBe(0);
    expect(s.secretsSet).toHaveLength(0);
    expect(s.written).toHaveLength(0);
  });

  it('proceeds under --force, and says the old key is gone', async () => {
    const s = spy({ secrets: async () => ({ reachable: true, names: ['CREDENTIAL_PRIVATE_KEY'] }) });
    const result = await provisionKeyPair(s.hosts, { ...OPTIONS, force: true });

    expect(result.code).toBe(0);
    expect(result.done?.forced).toBe(true);
    expect(s.secretsSet).toHaveLength(1);
  });

  it('does not refuse when some other secret is set', async () => {
    // The check is for this name, not for the app having secrets.
    const s = spy({ secrets: async () => ({ reachable: true, names: ['SUPABASE_URL', 'RESEND_API_KEY'] }) });

    expect((await provisionKeyPair(s.hosts, OPTIONS)).code).toBe(0);
  });
});

describe('the private half', () => {
  it('is set on the app and never returned for printing', async () => {
    const s = spy();
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(s.secretsSet[0]?.name).toBe('CREDENTIAL_PRIVATE_KEY');
    expect(s.secretsSet[0]?.value).toContain('PRIVATE KEY');

    // The only key material that comes back is the public half.
    expect(JSON.stringify(result.done)).not.toContain('PRIVATE KEY');
  });

  it('leaves nothing behind when the app rejects it', async () => {
    const s = spy({ setSecret: async () => FAILED });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(result.code).toBe(1);
    expect(result.errors.join(' ')).toContain('Nothing was changed');
    // No public key file for a private half that never landed.
    expect(s.written).toHaveLength(0);
  });
});

describe('the public half', () => {
  it('is written to a file as well as returned for printing', async () => {
    const s = spy();
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(s.written[0]?.path).toBe(OPTIONS.file);
    expect(s.written[0]?.contents).toContain('PUBLIC KEY');
    expect(result.done?.publicKey).toContain('PUBLIC KEY');
  });

  it('is written with its newlines escaped, as an environment variable carries it', async () => {
    const s = spy();
    await provisionKeyPair(s.hosts, OPTIONS);

    expect(s.written[0]?.contents).toContain('\\n');
    expect(s.written[0]?.contents.split('\n')).toHaveLength(2); // one line plus the trailing break
  });
});

describe('Netlify', () => {
  it('is set when the CLI can identify a site', async () => {
    const s = spy({ netlify: async () => ({ usable: true, siteArgs: [], reason: '' }) });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(s.netlifySet[0]?.name).toBe('VITE_CREDENTIAL_PUBLIC_KEY');
    expect(result.done?.netlify).toBe('set');
  });

  it('says why it was skipped rather than skipping silently', async () => {
    /*
      An operator who assumes both halves were set leaves the frontend sealing to a key nothing
      holds — deposits that look successful and can never be opened.
    */
    const result = await provisionKeyPair(spy().hosts, OPTIONS);

    expect(result.code).toBe(0);
    expect(result.done?.netlify).toContain('not linked');
  });

  it('reports a Netlify refusal rather than claiming success', async () => {
    const s = spy({
      netlify: async () => ({ usable: true, siteArgs: [], reason: '' }),
      setNetlify: async () => FAILED,
    });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(result.done?.netlify).toContain('refused');
    // The Fly half still succeeded, so this is not a failure of the whole run.
    expect(result.code).toBe(0);
  });
});

describe('preconditions', () => {
  it('stops when fly is not installed', async () => {
    const s = spy({ flyAvailable: async () => false });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(result.code).toBe(1);
    expect(result.errors.join(' ')).toContain('fly is not installed');
    expect(s.generated).toBe(0);
  });

  it('stops when the app cannot be read, rather than assuming it is empty', async () => {
    // Treating an unreadable app as one with no secrets is how the overwrite guard would be
    // bypassed by a network blip.
    const s = spy({ secrets: async () => ({ reachable: false, names: [], problem: 'not authenticated' }) });
    const result = await provisionKeyPair(s.hosts, OPTIONS);

    expect(result.code).toBe(1);
    expect(result.errors.join(' ')).toContain('not authenticated');
    expect(s.generated).toBe(0);
  });
});
