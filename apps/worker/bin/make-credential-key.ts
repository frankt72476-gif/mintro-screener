/**
 * Generates the credential deposit key pair, and optionally sets it on the hosts.
 *
 *     npm run make-credential-key              # print both halves, set nothing
 *     npm run make-credential-key -- --set     # set the private half on Fly, write the public half
 *     npm run make-credential-key -- --set --force
 *
 * Without `--set` this prints both halves once and stores neither, which is what it always did.
 *
 * ## Why `--set` exists
 *
 * A 2048-bit key is roughly 1,700 characters of base64. Transcribing one into a `fly secrets set`
 * command and a Netlify field is slow and error-prone, and the error is not a loud one: a truncated
 * or re-wrapped key imports without complaint and then **cannot open what the browser sealed**. By
 * the time that shows, a merchant's login is sitting in a deposit nobody can read, and there is no
 * recovery (D-038).
 *
 * With `--set` the private half goes from the generator into the secret store and is never printed.
 * The public half is printed and written to a file, because it is public and because reading it out
 * of a terminal is the step this flag exists to remove.
 *
 * **There is no recovery.** Losing the private half makes every stored credential permanently
 * unreadable, and that is deliberate: a recovery path is a second route to plaintext, which is the
 * thing the two-key design is paying to avoid. Re-asking a merchant costs an email.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPair } from '@mintro/engine';
import {
  available,
  escapeNewlines,
  flySecrets,
  netlifyTarget,
  provisionKeyPair,
  reportLines,
  setFlySecret,
  setNetlifyVariable,
  type Hosts,
} from '../src/auth/provision.js';

const APP = 'mintro-screener-worker';
const PRIVATE = 'CREDENTIAL_PRIVATE_KEY';
const PUBLIC = 'VITE_CREDENTIAL_PUBLIC_KEY';
const PUBLIC_FILE = 'credential-public-key.txt';

const rule = (label: string): string => `\n─── ${label} ${'─'.repeat(Math.max(0, 66 - label.length))}\n`;

async function main(argv: readonly string[]): Promise<number> {
  const set = argv.includes('--set');
  const force = argv.includes('--force');

  return set ? await provision(force) : print();
}

/** The original behaviour: print both halves, store neither. */
async function print(): Promise<number> {
  const { publicKey, privateKey } = await generateKeyPair();

  console.log(rule('Netlify — Site configuration → Environment variables'));
  console.log(PUBLIC);
  console.log(escapeNewlines(publicKey));

  console.log(rule('Fly — run from the repository root'));
  console.log(`fly secrets set ${PRIVATE}="${escapeNewlines(privateKey)}" --app ${APP}`);

  console.log(rule('Local .env, for scanning from a terminal'));
  console.log(`${PUBLIC}="${escapeNewlines(publicKey)}"`);
  console.log(`${PRIVATE}="${escapeNewlines(privateKey)}"`);

  console.log(
    '\nPrinted once, stored nowhere. Losing the private half is unrecoverable by design (D-038):' +
      '\nevery stored credential becomes unreadable and merchants are asked again.' +
      '\n\nTo set it directly instead:  npm run make-credential-key -- --set\n',
  );
  return 0;
}

/** The real hosts. Everything that touches the outside world is here and nowhere else. */
const realHosts: Hosts = {
  flyAvailable: () => available('fly', ['version']),
  secrets: (app) => flySecrets(app),
  setSecret: (app, name, value) => setFlySecret(app, name, value),
  netlify: () => netlifyTarget(),
  setNetlify: (name, value, siteArgs) => setNetlifyVariable(name, value, siteArgs),
  writePublic: (path, contents) => writeFileSync(path, contents, 'utf8'),
  generate: () => generateKeyPair(),
};

async function provision(force: boolean): Promise<number> {
  const outcome = await provisionKeyPair(realHosts, {
    app: APP,
    privateName: PRIVATE,
    publicName: PUBLIC,
    file: resolve(PUBLIC_FILE),
    force,
  });

  if (outcome.done === undefined) {
    for (const line of outcome.errors) console.error(line);
    return outcome.code;
  }

  for (const line of reportLines(outcome.done, { app: APP, privateName: PRIVATE, publicName: PUBLIC })) {
    console.log(line);
  }
  return outcome.code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
