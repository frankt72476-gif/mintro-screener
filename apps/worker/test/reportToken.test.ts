/**
 * The report token is not the comment token.
 *
 * Two tokens exist for one run and they reach different people. The comment link goes to the
 * merchant; the report link goes to IQwallet and to the agent. If a merchant holding the first
 * could compute the second, the IQwallet-facing report would be readable by the party it reports
 * on — and nothing about that failure would be visible in either link.
 *
 * "Generate them independently" is easy to write and easy to lose. The way it gets lost is not a
 * deliberate decision; it is someone noticing a run already has a token and reusing it, or hashing
 * one to seed the other because that looks tidier than a second `randomBytes`. So this asserts the
 * property three ways: the values differ, neither is a function of the run, and no ordinary
 * derivation of one produces the other. The last one is the only one that would survive a
 * plausible bad edit.
 */

import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { issueToken } from '../src/invite.js';
import { issueReportToken, REPORT_TOKEN_BYTES } from '../src/reportToken.js';
import { isReportToken } from '@mintro/engine';

const RUN = '11111111-2222-4333-8444-555555555555';

describe('the report token', () => {
  it('is 32 bytes of base64url', () => {
    const token = issueReportToken();

    expect(isReportToken(token)).toBe(true);
    expect(Buffer.from(token, 'base64url')).toHaveLength(REPORT_TOKEN_BYTES);
    // base64url and nothing else. `+` or `/` in a storage key would reshape the path.
    expect(token).not.toMatch(/[+/=]/);
  });

  it('differs from the comment token for the same run', () => {
    // The assertion the spec asks for, in its plainest form.
    const comment = issueToken();
    const report = issueReportToken();

    expect(report).not.toBe(comment.token);
    expect(report).not.toBe(comment.sha256);
  });

  it('is not a function of the run — two captures of the same run get different tokens', () => {
    // A token derived from the run id would be stable, and a stable token in a public path means
    // a re-capture overwrites the report that was already delivered (D-002).
    const tokens = new Set(Array.from({ length: 200 }, () => issueReportToken()));

    expect(tokens.size, `${RUN} produced a repeated token`).toBe(200);
  });

  /**
   * The one that would catch a real bad edit.
   *
   * Two independent draws differ by luck of 256 bits, so "they are not equal" passes for a broken
   * implementation that hashes one into the other. These are the derivations someone would
   * actually reach for.
   */
  it('is not any derivation of the comment token', () => {
    const comment = issueToken();
    const report = issueReportToken();

    const derivations: Record<string, string> = {
      identity: comment.token,
      sha256_hex: comment.sha256,
      sha256_base64url: createHash('sha256').update(comment.token, 'utf8').digest('base64url'),
      sha256_of_digest: createHash('sha256').update(comment.sha256, 'utf8').digest('base64url'),
      hmac_by_run: createHmac('sha256', comment.token).update(RUN).digest('base64url'),
      hmac_by_purpose: createHmac('sha256', comment.token).update('report').digest('base64url'),
      reversed: [...comment.token].reverse().join(''),
      truncated: comment.token.slice(0, 43),
    };

    for (const [how, derived] of Object.entries(derivations)) {
      expect(report, `the report token is the comment token via ${how}`).not.toBe(derived);
    }
  });

  /**
   * And structurally, because behaviour cannot see this coming.
   *
   * A future edit that reuses the comment token would have to import it. Nothing else in this
   * suite fails on the day someone writes that line.
   */
  it('is minted in a module that knows nothing about the comment token', () => {
    const source = readFileSync('apps/worker/src/reportToken.ts', 'utf8');
    const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);

    expect(imports, 'reportToken.ts imports the comment-token module').not.toContain('./invite.js');
    expect(imports).toEqual(['node:crypto']);
  });
});
