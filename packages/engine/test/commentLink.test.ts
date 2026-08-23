/**
 * The comment link, built and read (D-063).
 *
 * This exists because the two halves disagreed. The worker composed `/comment/<token>` into the
 * invitation and the page looked for `?comment=<token>`, so the first real invitation would have
 * delivered a merchant to the analyst sign-in screen while holding the only token that report will
 * ever have — and nothing in either package could have noticed, because neither one was wrong on
 * its own.
 *
 * The round trip is the test. A URL that this module builds is a URL this module reads, asserted
 * here rather than trusted to two files staying in step (D-034).
 */

import { describe, expect, it } from 'vitest';
import { commentLinkFor, commentTokenFrom } from '@mintro/engine';

/** What `issueToken` produces: 32 bytes, base64url. */
const TOKEN = 'x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';

describe('the round trip', () => {
  it('reads back exactly the token it was given', () => {
    expect(commentTokenFrom(commentLinkFor('https://screener.example', TOKEN))).toBe(TOKEN);
  });

  it('survives base64url punctuation without mangling it', () => {
    // `-` and `_` are the two characters base64url adds, and the two most likely to be eaten by an
    // encode/decode mismatch. A token off by one character opens nothing.
    for (const token of ['-_-_-_', 'a-b_c', '__--__', TOKEN]) {
      expect(commentTokenFrom(commentLinkFor('https://screener.example', token))).toBe(token);
    }
  });

  it('tolerates a trailing slash on the origin', () => {
    // The origin comes from an environment variable, and a doubled slash is the kind of thing
    // nobody notices until a merchant reports a dead link.
    const withSlash = commentLinkFor('https://screener.example/', TOKEN);

    expect(withSlash).not.toContain('example//');
    expect(commentTokenFrom(withSlash)).toBe(TOKEN);
  });
});

describe('what is not a comment link', () => {
  it('finds no token on the analyst app', () => {
    // Null means "an ordinary visit", never "the token is wrong" — that answer comes from the
    // database, which treats unknown and expired identically.
    expect(commentTokenFrom('https://screener.example/')).toBeNull();
    expect(commentTokenFrom('https://screener.example/reports')).toBeNull();
  });

  it('finds no token on the bare comment path', () => {
    expect(commentTokenFrom('https://screener.example/comment/')).toBeNull();
  });

  it('does not read a token out of a query string', () => {
    // The old shape. If this ever passes, both forms are live and only one is issued — which is
    // the ambiguity that produced the defect.
    expect(commentTokenFrom(`https://screener.example/?comment=${TOKEN}`)).toBeNull();
  });

  it('returns null rather than throwing on something that is not a URL', () => {
    expect(commentTokenFrom('not a url')).toBeNull();
    expect(commentTokenFrom('')).toBeNull();
  });
});
