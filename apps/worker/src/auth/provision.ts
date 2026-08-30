/**
 * Setting the credential key pair on the hosts, rather than transcribing it (D-193).
 *
 * `make-credential-key` printed two PEMs with their newlines escaped and left an operator to paste
 * one into `fly secrets set` and the other into a Netlify field. A 2048-bit key is ~1,700 characters
 * of base64; the failure mode of copying it by hand is not "it does not work", it is **a truncated
 * or re-wrapped key that imports fine and cannot open what the browser sealed** — and by the time
 * that shows, a merchant's login is in a deposit nobody can read (D-038).
 *
 * So the private half goes straight from the generator into the secret store and is never printed.
 *
 * ## The private key is passed on stdin, never in argv
 *
 * `fly secrets set NAME=VALUE` puts the key in the process arguments, where it is visible to
 * anything that can list processes and lands in shell history. `fly secrets import` reads
 * `NAME=VALUE` pairs from stdin instead. Same result, and the key never exists as a command line.
 *
 * ## Refusing to overwrite
 *
 * An existing `CREDENTIAL_PRIVATE_KEY` is the only key that can open every credential already
 * stored. Replacing it is not an update — it is destroying the ability to read all of them, with no
 * recovery by design. So this checks first and stops, and `--force` is the only way past.
 */

import { spawn } from 'node:child_process';

export interface CommandResult {
  readonly ok: boolean;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command, optionally feeding it stdin. Never throws; a missing binary is a result. */
export function run(
  command: string,
  args: readonly string[],
  stdin?: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    child.on('error', (error) =>
      resolve({ ok: false, code: -1, stdout, stderr: error.message }),
    );
    child.on('close', (code) =>
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr }),
    );

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** Whether a command exists and answers. */
export async function available(command: string, args: readonly string[]): Promise<boolean> {
  return (await run(command, args)).ok;
}

export interface SecretsState {
  readonly reachable: boolean;
  readonly names: readonly string[];
  /** Why the app could not be read, when it could not. */
  readonly problem?: string;
}

/**
 * The secret names already set on a Fly app.
 *
 * Names and digests only — `fly secrets list` never returns values, which is why it is safe to run
 * before deciding anything.
 */
export async function flySecrets(app: string): Promise<SecretsState> {
  const result = await run('fly', ['secrets', 'list', '--app', app, '--json']);
  if (!result.ok) {
    return { reachable: false, names: [], problem: firstLine(result.stderr || result.stdout) };
  }

  try {
    const rows = JSON.parse(result.stdout) as { name: string }[];
    return { reachable: true, names: rows.map((row) => row.name) };
  } catch {
    return { reachable: false, names: [], problem: 'fly secrets list did not return JSON' };
  }
}

/**
 * Sets the private half, reading it from stdin so it never appears in a command line.
 *
 * `--stage` is deliberately not used: a staged secret is one the running worker does not have, and
 * the preflight (D-191) would pass on a machine that has not restarted while the frontend seals to
 * a key the worker cannot use.
 */
export async function setFlySecret(app: string, name: string, value: string): Promise<CommandResult> {
  return run('fly', ['secrets', 'import', '--app', app], `${name}=${escapeNewlines(value)}\n`);
}

export interface NetlifyTarget {
  readonly usable: boolean;
  /** What to tell the operator when it is not usable. */
  readonly reason: string;
  /** Extra arguments identifying the site, when one was found other than by linking. */
  readonly siteArgs: readonly string[];
}

/**
 * Whether the Netlify half can be set from here too.
 *
 * Three things have to hold: the CLI is installed, it is signed in, and it knows which site. The
 * third is the one that usually fails — `netlify env:set` needs a linked directory or an explicit
 * site, and this repository is not linked.
 */
export async function netlifyTarget(env: NodeJS.ProcessEnv = process.env): Promise<NetlifyTarget> {
  const status = await run('netlify', ['status', '--json']);

  if (status.code === -1) {
    return {
      usable: false,
      siteArgs: [],
      reason: 'the Netlify CLI is not installed (npm i -g netlify-cli).',
    };
  }

  const siteId = env['NETLIFY_SITE_ID'];
  if (typeof siteId === 'string' && siteId.trim() !== '') {
    return { usable: true, siteArgs: ['--filter', siteId.trim()], reason: '' };
  }

  if (!status.ok) {
    const text = `${status.stdout}${status.stderr}`;
    return {
      usable: false,
      siteArgs: [],
      reason: /not.*linked|linked to a project/i.test(text)
        ? 'the Netlify CLI is signed in but this directory is not linked to a site. Run `netlify link`, or set NETLIFY_SITE_ID.'
        : 'the Netlify CLI is not signed in. Run `netlify login`.',
    };
  }

  return { usable: true, siteArgs: [], reason: '' };
}

export async function setNetlifyVariable(
  name: string,
  value: string,
  siteArgs: readonly string[],
): Promise<CommandResult> {
  return run('netlify', ['env:set', name, value, '--force', ...siteArgs]);
}

/** PEM newlines become `\n` so a single environment variable carries the whole key. */
export const escapeNewlines = (pem: string): string => pem.split('\n').join('\\n');

export const firstLine = (text: string): string =>
  text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? '';


/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   The decision, separated from the doing
   ═══════════════════════════════════════════════════════════════════════════════════════════════

   What `--set` decides — whether to refuse, what to write, what to tell the operator — is worth
   testing, and it cannot be tested against a live Fly app: the interesting paths either overwrite a
   production secret or require one to already exist. So the effects go behind an interface and the
   sequence is a function over it (D-193).
*/

export interface Hosts {
  flyAvailable(): Promise<boolean>;
  secrets(app: string): Promise<SecretsState>;
  setSecret(app: string, name: string, value: string): Promise<CommandResult>;
  netlify(): Promise<NetlifyTarget>;
  setNetlify(name: string, value: string, siteArgs: readonly string[]): Promise<CommandResult>;
  writePublic(path: string, contents: string): void;
  generate(): Promise<{ publicKey: string; privateKey: string }>;
}

export interface ProvisionOutcome {
  readonly code: number;
  /** Lines for stderr, when it refused. */
  readonly errors: readonly string[];
  /** What happened, for the report. Absent when it refused. */
  readonly done?: {
    readonly publicKey: string;
    readonly path: string;
    readonly netlify: string;
    readonly forced: boolean;
  };
}

export async function provisionKeyPair(
  hosts: Hosts,
  options: { readonly app: string; readonly privateName: string; readonly publicName: string; readonly file: string; readonly force: boolean },
): Promise<ProvisionOutcome> {
  const { app, privateName, publicName, file, force } = options;

  if (!(await hosts.flyAvailable())) {
    return {
      code: 1,
      errors: [
        'fly is not installed, so --set cannot reach the worker.',
        'Install it from https://fly.io/docs/flyctl/install/, or run without --set and',
        'paste the values by hand.',
      ],
    };
  }

  /*
    Read what is there before generating anything.

    An existing private key is the only key that can open every credential already stored. Replacing
    it is not an update, it is destroying the ability to read all of them — so the check comes first,
    and a pair that would be discarded is never even created.
  */
  const state = await hosts.secrets(app);
  if (!state.reachable) {
    return {
      code: 1,
      errors: [
        `Could not read the secrets on ${app}: ${state.problem ?? 'unknown'}`,
        'Check `fly auth whoami` and that the app name is right.',
      ],
    };
  }

  if (state.names.includes(privateName) && !force) {
    return {
      code: 1,
      errors: [
        `${privateName} is already set on ${app}.`,
        '',
        'Overwriting it makes every credential already stored permanently unopenable.',
        'There is no recovery — that is deliberate (D-038) — and each affected merchant',
        'would have to supply their login again.',
        '',
        'If that is what you intend:  npm run make-credential-key -- --set --force',
      ],
    };
  }

  const { publicKey, privateKey } = await hosts.generate();

  const wrote = await hosts.setSecret(app, privateName, privateKey);
  if (!wrote.ok) {
    return {
      code: 1,
      errors: [
        `Could not set ${privateName} on ${app}: ${firstLine(wrote.stderr || wrote.stdout)}`,
        'Nothing was changed. The pair just generated is discarded.',
      ],
    };
  }

  hosts.writePublic(file, `${escapeNewlines(publicKey)}
`);

  /*
    Netlify gets the same treatment where it can.

    Said plainly when it cannot: an operator who assumes both halves were set would leave the
    frontend sealing to a key nothing holds.
  */
  const target = await hosts.netlify();
  let netlify = target.reason;

  if (target.usable) {
    const result = await hosts.setNetlify(publicName, escapeNewlines(publicKey), target.siteArgs);
    netlify = result.ok ? 'set' : `Netlify refused it: ${firstLine(result.stderr || result.stdout)}`;
  }

  return { code: 0, errors: [], done: { publicKey, path: file, netlify, forced: force } };
}


/**
 * What `--set` says afterwards, as lines (D-193).
 *
 * A pure function so the wording is testable and can be shown without setting a production secret.
 * Three things have to land, because each one is a mistake somebody would otherwise make:
 *
 *   - **the private half was set and never shown**, so nobody goes looking for it in the scrollback;
 *   - **the public half is the only thing to copy**, delimited so it can be selected cleanly;
 *   - **whether Netlify was done too**, because assuming it was leaves the frontend sealing to a key
 *     nothing holds.
 */
export function reportLines(
  done: NonNullable<ProvisionOutcome['done']>,
  names: { readonly app: string; readonly privateName: string; readonly publicName: string },
): readonly string[] {
  const rule = (label: string): string =>
    `
─── ${label} ${'─'.repeat(Math.max(0, 66 - label.length))}
`;

  const netlifyDone = done.netlify === 'set';

  return [
    rule('Done'),
    `  ${names.privateName}`,
    `      set on ${names.app}, read from stdin so it never appeared in a command line.`,
    '      It was not printed here and cannot be shown again.',
    ...(done.forced
      ? ['      The previous key was replaced. Credentials stored under it are now unopenable.']
      : []),
    '',
    `  ${names.publicName}`,
    ...(netlifyDone
      ? [
          '      set on Netlify. Trigger a deploy — Netlify reads variables at build time, so the',
          '      site keeps the old value until it rebuilds.',
        ]
      : [
          `      not set automatically: ${done.netlify}`,
          '      Set it by hand at Site configuration → Environment variables.',
        ]),
    `      Written to ${done.path}`,
    rule(`${names.publicName} — the only thing to copy`),
    escapeNewlines(done.publicKey),
    rule('end'),
    'This half is public: it can only seal, never open. The private half is on Fly and',
    'nowhere else. Losing it is unrecoverable by design (D-038) — every stored credential',
    'becomes unreadable and merchants are asked again.',
    '',
  ];
}
