/**
 * The captured report's path, built and read.
 *
 * Same argument as `commentLink.test.ts`: the path is composed in the worker and parsed elsewhere,
 * so the round trip is the test rather than two files being trusted to stay in step (D-034).
 *
 * The refusals carry more weight here than the round trip does. This path sits in a **public**
 * bucket, and every way of getting it slightly wrong produces something that looks like a working
 * link and is not one — a short token, an empty token, a run id with a slash in it. A builder that
 * quietly accepts those publishes a guessable URL and says nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  REPORT_BUCKET,
  isReportToken,
  reportCaptureRefFrom,
  reportCaptureRefFromKey,
  reportLinkFor,
  reportLinkForKey,
  reportObjectKey,
} from '@mintro/engine';

const RUN = '11111111-2222-4333-8444-555555555555';
/** What `issueReportToken` produces: 32 bytes, base64url, 43 characters. */
const TOKEN = 'x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';

/** How Supabase serves a public object. */
const publicUrl = (key: string): string =>
  `https://project.supabase.co/storage/v1/object/public/${REPORT_BUCKET}/${key}`;

describe('the path', () => {
  it('is the one the spec names', () => {
    // `reports/<runId>/<token>.html`, read off the public URL — bucket plus key.
    expect(publicUrl(reportObjectKey(RUN, TOKEN))).toContain(`/reports/${RUN}/${TOKEN}.html`);
  });

  it('reads back exactly the run and token it was given', () => {
    expect(reportCaptureRefFrom(publicUrl(reportObjectKey(RUN, TOKEN)))).toEqual({
      runId: RUN,
      token: TOKEN,
    });
  });

  it('survives base64url punctuation without mangling it', () => {
    // `-` and `_` are the two characters base64url adds, and the two most likely to be lost in an
    // encode/decode mismatch. A token off by one character opens nothing.
    for (const token of ['-'.repeat(43), '_'.repeat(43), `--__${TOKEN.slice(4)}`]) {
      const ref = reportCaptureRefFrom(publicUrl(reportObjectKey(RUN, token)));
      expect(ref?.token).toBe(token);
    }
  });

  it('reads the delivered link, which is not the storage URL', () => {
    /*
      What goes to IQwallet is `/r/<run>/<token>` on a Mintro origin, proxied to the object at
      `<run>/<token>.html` in the bucket. Indirection, so storage can move without invalidating a
      link already issued and so a partner is not handed the Supabase project ref.

      So one capture has two spellings and both must read back to the same run. A reader that knew
      only the storage form would fail on every URL the system actually delivers — which is the
      form the CI tripwire fetches.
    */
    const key = reportObjectKey(RUN, TOKEN);

    for (const url of [
      publicUrl(key),
      `https://screener.gomintro.com/r/${RUN}/${TOKEN}`,
      `https://screener.gomintro.com/r/${key}`,
    ]) {
      expect(reportCaptureRefFrom(url), url).toEqual({ runId: RUN, token: TOKEN });
    }
  });
});

describe('what it refuses', () => {
  it('will not build a path from a token that is not one', () => {
    // The empty case is the dangerous one: `<run-id>/.html` is a public key anybody can type.
    for (const token of ['', 'short', TOKEN.slice(0, 42), `${TOKEN}x`, 'has/slash', 'has.dot']) {
      expect(() => reportObjectKey(RUN, token), JSON.stringify(token)).toThrow(/token/i);
    }
  });

  it('will not build a path from something that is not a run id', () => {
    for (const runId of ['', 'not-a-uuid', `${RUN}/..`, '../../etc']) {
      expect(() => reportObjectKey(runId, TOKEN), JSON.stringify(runId)).toThrow(/run id/i);
    }
  });

  it('reads no capture out of a URL that is not one', () => {
    for (const url of [
      'not a url',
      'https://screener.example/',
      `https://screener.example/comment/${TOKEN}`,
      publicUrl(`${RUN}/${TOKEN}.pdf`),
      publicUrl(`${RUN}/.html`),
      publicUrl(`${RUN}/short.html`),
      // The extension is optional, which must not soften anything else. A bare `/r/<run>/` and a
      // token that is nearly right are still not captures.
      `https://screener.gomintro.com/r/${RUN}/`,
      `https://screener.gomintro.com/r/${RUN}/${TOKEN.slice(0, 42)}`,
      `https://screener.gomintro.com/r/${TOKEN}`,
    ]) {
      expect(reportCaptureRefFrom(url), url).toBeNull();
    }
  });
});

describe('the token shape', () => {
  it('accepts 43 base64url characters and nothing else', () => {
    expect(isReportToken(TOKEN)).toBe(true);
    // `+`, `/` and `=` are base64, not base64url. Any of them in a storage key reshapes the path
    // or has to be percent-encoded, and a token that is re-encoded on the way out is a dead link.
    expect(isReportToken(`${TOKEN.slice(0, 42)}+`)).toBe(false);
    expect(isReportToken(`${TOKEN.slice(0, 42)}/`)).toBe(false);
    expect(isReportToken(`${TOKEN.slice(0, 42)}=`)).toBe(false);
  });
});

describe('the delivered link', () => {
  it('is the shape the spec names, on a Mintro origin', () => {
    expect(reportLinkFor('https://screener.gomintro.com', RUN, TOKEN)).toBe(
      `https://screener.gomintro.com/r/${RUN}/${TOKEN}`,
    );
  });

  it('is built from the stored key, which is what callers actually hold', () => {
    const key = reportObjectKey(RUN, TOKEN);

    expect(reportLinkForKey('https://screener.gomintro.com', key)).toBe(
      `https://screener.gomintro.com/r/${RUN}/${TOKEN}`,
    );
  });

  it('round-trips: a link this module builds is one it reads', () => {
    // The assertion `commentLink.test.ts` exists for, applied here. The link is composed in the
    // worker for an email, rendered by the app, and stated in `netlify.toml` — three places.
    const link = reportLinkForKey('https://screener.gomintro.com', reportObjectKey(RUN, TOKEN));

    expect(reportCaptureRefFrom(link)).toEqual({ runId: RUN, token: TOKEN });
  });

  it('tolerates a trailing slash on the origin', () => {
    // The origin comes from configuration, and a doubled slash is the kind of thing nobody notices
    // until somebody reports a dead link.
    const link = reportLinkFor('https://screener.gomintro.com/', RUN, TOKEN);

    expect(link).not.toContain('com//');
    expect(reportCaptureRefFrom(link)).toEqual({ runId: RUN, token: TOKEN });
  });

  it('refuses to build a link from a malformed run or token', () => {
    expect(() => reportLinkFor('https://x.test', RUN, '')).toThrow();
    expect(() => reportLinkFor('https://x.test', 'not-a-uuid', TOKEN)).toThrow();
    expect(() => reportLinkForKey('https://x.test', `${RUN}/.html`)).toThrow(/not a capture key/);
    expect(() => reportLinkForKey('https://x.test', 'nonsense')).toThrow(/not a capture key/);
  });

  it('reads a run and token back out of a stored key', () => {
    expect(reportCaptureRefFromKey(reportObjectKey(RUN, TOKEN))).toEqual({ runId: RUN, token: TOKEN });
    // Not a key: the extension is required on the object, unlike on the delivered link.
    expect(reportCaptureRefFromKey(`${RUN}/${TOKEN}`)).toBeNull();
    expect(reportCaptureRefFromKey(`a/${RUN}/${TOKEN}.html`)).toBeNull();
  });
});
