/**
 * Generates the credential deposit key pair.
 *
 *     npm run make-credential-key
 *
 * Prints both halves once and stores neither. The public half goes to Netlify, where being public
 * is exactly what it is for; the private half goes to Fly with `fly secrets set`.
 *
 * **There is no recovery.** Losing the private half makes every stored credential permanently
 * unreadable, and that is deliberate (D-038): a recovery path is a second route to plaintext,
 * which is the thing the two-key design is paying to avoid. Re-asking a merchant costs an email.
 */

import { generateKeyPair } from '@mintro/engine';

/** PEMs are multi-line; environment variables are easier to paste on one. `fromPem` accepts both. */
const oneLine = (pem: string): string => pem.split('\n').join('\\n');

const rule = (label: string): string => `\n─── ${label} ${'─'.repeat(Math.max(0, 66 - label.length))}\n`;

async function main(): Promise<number> {
  const { publicKey, privateKey } = await generateKeyPair();

  console.log(rule('Netlify — Site configuration → Environment variables'));
  console.log('VITE_CREDENTIAL_PUBLIC_KEY');
  console.log(oneLine(publicKey));

  console.log(rule('Fly — run from the repository root'));
  console.log(
    `fly secrets set CREDENTIAL_PRIVATE_KEY="${oneLine(privateKey)}" --app mintro-screener-worker`,
  );

  console.log(rule('Local .env, for scanning from a terminal'));
  console.log(`VITE_CREDENTIAL_PUBLIC_KEY="${oneLine(publicKey)}"`);
  console.log(`CREDENTIAL_PRIVATE_KEY="${oneLine(privateKey)}"`);

  console.log(
    '\nPrinted once, stored nowhere. Losing the private half is unrecoverable by design (D-038):' +
      '\nevery stored credential becomes unreadable and merchants are asked again.\n',
  );
  return 0;
}

main().then((code) => process.exit(code));
