/**
 * A storefront behind sign-in is refused as one, and the advice is not "re-scan" (D-291).
 *
 * Run dd48f232 (app.thepeptide.com, 2026-10-08) was refused by the text check: one distinct page
 * read, the sign-in page. The refusal was right and its advice was wrong — "Re-scan the merchant"
 * — because every anonymous request is sent to `/login`, and a new run meets the same page. The
 * crawl now records the wall on `report.access.signInWall`, and the guard reads that record ahead
 * of the text check, says which of the login's states held, and names the cause for the screen.
 */

import { describe, expect, it } from 'vitest';
import { notSeen, storefrontNotSeen, type EvaluationInputs } from '../src/evaluateJob.js';

const SIGN_IN_URL = 'https://app.thepeptide.com/login';

/** What run dd48f232's pages extracted to: one text, the sign-in page, read once. */
const ONE_SIGN_IN_PAGE = {
  selectedCount: 1,
  distinctTexts: 1,
  dominantTextCount: 1,
  dominantTextSample: 'Welcome Back Please sign in to access your account. Email Address Password Forgot Password?',
};

const HEALTHY = {
  selectedCount: 40,
  distinctTexts: 12,
  dominantTextCount: 3,
  dominantTextSample: 'Research peptides for laboratory use',
};

const inputs = (
  outcome: string | undefined,
  stats: Record<string, unknown> = ONE_SIGN_IN_PAGE,
  extra: Record<string, unknown> = {},
): EvaluationInputs =>
  ({
    report: {
      sample: { productsInScope: 0, productsSampled: 0 },
      access: {
        mode: 'public',
        wall: outcome !== undefined,
        usedCredential: false,
        note: '',
        ...(outcome === undefined ? {} : { signInWall: { url: SIGN_IN_URL, outcome } }),
      },
      ...extra,
    },
    pageStats: stats,
  }) as unknown as EvaluationInputs;

describe('a recorded sign-in wall', () => {
  it('refuses with cause sign_in_wall', () => {
    const refused = notSeen(inputs('no_sign_in_method'));

    expect(refused?.cause).toBe('sign_in_wall');
    expect(refused?.message).toContain(`most of the pages it requested anonymously ended at the sign-in page ${SIGN_IN_URL}`);
  });

  it('is taken ahead of the text check that fired on the same run', () => {
    // The text check would refuse this too, with the re-scan advice. The wall must answer first.
    expect(notSeen(inputs(undefined))?.cause).toBeNull();
    expect(notSeen(inputs('no_sign_in_method'))?.cause).toBe('sign_in_wall');
  });

  it('refuses even where the page texts look healthy: it is a record, not an inference', () => {
    expect(notSeen(inputs('no_credential', HEALTHY))?.cause).toBe('sign_in_wall');
  });

  it('never points to re-screening where a login is on file: a re-screen meets the same wall', () => {
    for (const outcome of ['not_consulted', 'no_sign_in_method', 'sign_in_failed', 'second_factor_required', 'signed_in']) {
      const message = storefrontNotSeen(inputs(outcome)) ?? '';
      expect(message, outcome).not.toMatch(/re-?scan/i);
      expect(message, outcome).not.toMatch(/re-?screen/i);
    }
  });

  /*
    The one state a new run can change. With no login on file, storing one and re-screening is the
    way through, and the message says so (D-291).
  */
  it('states the remedy where no login is on file', () => {
    const message = storefrontNotSeen(inputs('no_credential')) ?? '';
    expect(message).toContain(
      'No login is on file for this merchant. A screening login can be stored for this merchant and the merchant re-screened.',
    );
    expect(message).not.toMatch(/re-?scan\b/i);
  });
});

describe('which state the login is in, by reading alone', () => {
  const message = (outcome: string): string => storefrontNotSeen(inputs(outcome)) ?? '';

  it('no login on file', () => {
    expect(message('no_credential')).toContain(
      'No login is on file for this merchant. A screening login can be stored for this merchant and the merchant re-screened.',
    );
  });

  it('a login on file and no sign-in method for this site', () => {
    expect(message('no_sign_in_method')).toContain(
      'A login is on file for this merchant, and the screener has no sign-in method for this site, so no sign-in was attempted.',
    );
  });

  it('a sign-in attempted that failed', () => {
    expect(message('sign_in_failed')).toContain('a sign-in was attempted and it failed');
  });

  it('a sign-in that succeeded, with nothing read through it', () => {
    const text = message('signed_in');
    expect(text).toContain('it signed in successfully; only public pages were read, and no signed-in pages were crawled');
    expect(text).not.toMatch(/read with (it|the|a) /i);
  });

  it('the three read apart from each other', () => {
    const three = ['no_credential', 'no_sign_in_method', 'sign_in_failed'].map(message);
    expect(new Set(three).size).toBe(3);
  });

  /*
    The password was submitted and the site asked for a code (D-293). Not a failure, and not
    suppressed: its own sentence, under the same cause, with no re-screen pointed to.
  */
  it('a login submitted and then asked for a second-factor code', () => {
    const text = message('second_factor_required');
    expect(text).toContain(
      'A login is on file for this merchant. The stored login was submitted and the site then asked for a ' +
        'second-factor code, which the screener does not answer; a login without a second factor is needed to ' +
        'read signed-in pages.',
    );
    expect(text).not.toContain('failed');
    expect(notSeen(inputs('second_factor_required'))?.cause).toBe('sign_in_wall');
    expect(new Set(['sign_in_failed', 'sign_in_suppressed', 'second_factor_required'].map(message)).size).toBe(3);
  });
});

describe('what it does not displace', () => {
  it('leaves a recorded consent gate and challenge ahead of it, each under its own cause', () => {
    const gated = notSeen(inputs('no_credential', ONE_SIGN_IN_PAGE, { consentGate: { gated: 2 } }));
    expect(gated?.cause).toBe('consent_gate');
    expect(gated?.message).toContain('consent gate');

    const challenged = notSeen(inputs('no_credential', ONE_SIGN_IN_PAGE, { challenge: { challenged: 3 } }));
    expect(challenged?.cause).toBe('bot_challenge');
    expect(challenged?.message).toContain('bot protection');
  });

  it('names a consent gate and a challenge on runs with no sign-in wall too', () => {
    expect(notSeen(inputs(undefined, HEALTHY, { consentGate: { gated: 1 } }))?.cause).toBe('consent_gate');
    expect(notSeen(inputs(undefined, HEALTHY, { challenge: { challenged: 1 } }))?.cause).toBe('bot_challenge');
  });

  it('names no cause for an unserved catalogue', () => {
    const refused = notSeen(
      inputs(undefined, HEALTHY, { sample: { productsInScope: 18, productsSampled: 0 } }),
    );
    expect(refused?.message).toContain('none of the 18 product page(s) in scope');
    expect(refused?.cause).toBeNull();
  });

  /*
    D-002: a run recorded before the wall existed has no `signInWall`, and behaves exactly as it did —
    which for dd48f232's own stored record is the text refusal, now with its own text as the sample.
  */
  it('leaves a run with no sign-in record to the text check, with no cause', () => {
    const refused = notSeen(inputs(undefined));

    expect(refused?.cause).toBeNull();
    expect(refused?.message).toContain('only 1 distinct page text(s) were read');
    expect(refused?.message).toContain('The text read begins: "Welcome Back Please sign in');
    expect(refused?.message).not.toContain('(no text was read)');
  });

  it('keeps "repeated" for a text that was', () => {
    const message = storefrontNotSeen(
      inputs(undefined, { selectedCount: 30, distinctTexts: 3, dominantTextCount: 28, dominantTextSample: 'Site entry' }),
    );
    expect(message).toContain('The repeated text begins: "Site entry"');
  });

  it('says "(no text was read)" only where nothing was', () => {
    const message = storefrontNotSeen(
      inputs(undefined, { selectedCount: 1, distinctTexts: 0, dominantTextCount: 1, dominantTextSample: '' }),
    );
    expect(message).toContain('(no text was read)');
  });
});
