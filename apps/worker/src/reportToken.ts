/**
 * The token that makes a captured report's public path unguessable.
 *
 * A captured report lives in a **public** bucket (migration 0071) at `<run-id>/<token>.html`. The
 * run id is not a secret and is not doing any work; this token is the whole of the access control.
 * 32 bytes of `randomBytes`, base64url — 43 characters.
 *
 * ## It is not the comment token, and it is not derived from one
 *
 * `invite.ts` mints a token for the merchant's comment link. This one goes to IQwallet and to the
 * agent. Two audiences, two surfaces. If this were the same value, or a digest of it, or anything
 * else a holder of one could compute, then every merchant with a comment link would be one guess
 * — or none — away from the IQwallet-facing report. So the two are drawn independently from the
 * CSRNG and `test/reportToken.test.ts` asserts they cannot be turned into one another.
 *
 * That test includes a check that this module imports nothing from `invite.ts`. It reads as
 * paranoid until you notice that the cheapest future edit is "we already have a token for this
 * run, use it", which would be a one-line change that no behavioural test failing on random
 * values could ever catch reliably.
 *
 * ## Why no digest, when the comment token is stored only as a SHA-256
 *
 * `issueToken` returns the token and the digest, and only the digest is written: a leaked database
 * yields no working comment links. That posture cannot apply here, and pretending otherwise would
 * be worse than not trying.
 *
 * The token **is** the object's address. The delivered link has to be reproducible — the same
 * report goes out on the blocked-package path, and an operator has to be able to say what was
 * sent — so the path is stored as it is, in plaintext, and a database read discloses report URLs
 * to whoever can already read the runs those reports describe. Storing a digest instead would not
 * add secrecy; it would only mean nobody could ever produce the link again.
 *
 * What limits the blast radius is that the row is analyst-scoped under the same RLS as the run
 * (0058), and that the token opens exactly one report and nothing else.
 */

import { randomBytes } from 'node:crypto';

/**
 * 32 bytes, matching the comment token's strength.
 *
 * The relevant threat is enumeration of a public bucket that will not list its own contents, and
 * 256 bits is far past the point where that is the weak step.
 */
export const REPORT_TOKEN_BYTES = 32;

/** A fresh report token. Independent of every other token in the system. */
export function issueReportToken(): string {
  return randomBytes(REPORT_TOKEN_BYTES).toString('base64url');
}
