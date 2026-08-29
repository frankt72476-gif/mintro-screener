/**
 * The cheap Layer 3 probe, and the one rule it must never break (D-182).
 *
 * The probe removes renders. It must remove no findings — a candidate wrongly rejected becomes a
 * surface the merchant published that the report says they did not, which is the false `not_exposed`
 * hard constraint 2 exists to prevent. So the asymmetry is deliberate and these pin it: rejection
 * happens only on the origin's own error status, and every other outcome renders.
 */

import { describe, expect, it, vi } from 'vitest';
import { probeSurface } from '../src/surfaceProbe.js';

const URL_UNDER_TEST = 'https://shop.example/terms';

/**
 * A fetch that answers with one status.
 *
 * Typed as `fetch` itself rather than narrowed, so the mock stays assignable to the option it
 * fills and `mock.calls` still carries the init object the assertions read back.
 */
const answering = (status: number, finalUrl = URL_UNDER_TEST) =>
  vi.fn<typeof fetch>(async () => ({ status, url: finalUrl }) as unknown as Response);

describe('the predicate', () => {
  it.each([200, 201, 204, 299])('accepts %i, which is the origin serving something', async (status) => {
    const probe = await probeSurface(URL_UNDER_TEST, { fetchImpl: answering(status) });

    expect(probe.verdict).toBe('answered');
    expect(probe.status).toBe(status);
  });

  it.each([404, 410, 403, 500, 503])('rejects %i, which is the origin answering that it will not serve it', async (status) => {
    const probe = await probeSurface(URL_UNDER_TEST, { fetchImpl: answering(status) });

    expect(probe.verdict).toBe('rejected');
    expect(probe.status).toBe(status);
  });

  it('records the status the origin actually returned, never a synthesised one', async () => {
    // D-181: a field that looks like an HTTP status carries one. This is the number a finding's
    // attempts will show a reader, so it is the real one or the probe has no business reporting it.
    const probe = await probeSurface(URL_UNDER_TEST, { fetchImpl: answering(418) });

    expect(probe.status).toBe(418);
  });

  it('follows redirects and judges where it landed', async () => {
    // A 301 from `/terms` to `/policies/terms-of-service` is a merchant serving the document at a
    // path they spell differently. Judging the redirect rather than its destination would reject
    // every storefront that tidies its URLs.
    const redirected = answering(200, 'https://shop.example/policies/terms-of-service');
    const probe = await probeSurface(URL_UNDER_TEST, { fetchImpl: redirected });

    expect(probe.verdict).toBe('answered');
    expect(probe.finalUrl).toBe('https://shop.example/policies/terms-of-service');
    expect(redirected.mock.calls[0]?.[1]).toMatchObject({ redirect: 'follow' });
  });

  it('asks with GET, because HEAD is answered wrongly by a meaningful minority of storefronts', async () => {
    const spy = answering(200);
    await probeSurface(URL_UNDER_TEST, { fetchImpl: spy });

    expect(spy.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });
});

/**
 * The half that protects findings.
 *
 * A probe that observed nothing has not learned that a path is absent, and must not be allowed to
 * act as though it had.
 */
describe('when it cannot decide', () => {
  it('is undecided on a network error, not rejected', async () => {
    const probe = await probeSurface(URL_UNDER_TEST, {
      fetchImpl: vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND shop.example');
      }),
    });

    expect(probe.verdict).toBe('undecided');
    expect(probe.error).toContain('ENOTFOUND');
  });

  it('is undecided on its own timeout, not rejected', async () => {
    const probe = await probeSurface(URL_UNDER_TEST, {
      timeoutMs: 20,
      fetchImpl: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
        })) as unknown as typeof fetch,
    });

    expect(probe.verdict).toBe('undecided');
  });

  it('never throws, so the caller can render on ambiguity', async () => {
    // The caller's rule is "if it cannot decide, it renders". That is only expressible if the
    // failure arrives as data rather than as an exception unwinding the loop.
    await expect(
      probeSurface('not a url at all', { fetchImpl: vi.fn(async () => { throw new TypeError('Invalid URL'); }) }),
    ).resolves.toMatchObject({ verdict: 'undecided', status: 0 });
  });

  it('reports status 0 when nothing answered, which is what FetchAttempt means by it', async () => {
    const probe = await probeSurface(URL_UNDER_TEST, {
      fetchImpl: vi.fn(async () => { throw new Error('socket hang up'); }),
    });

    expect(probe.status).toBe(0);
  });
});

describe('politeness', () => {
  it('waits on the pacer before requesting, because this adds requests to the run', async () => {
    // D-013: a declared Crawl-delay applies to every request to the origin. The probe replaces
    // renders that were paced, and would otherwise quietly raise the request rate.
    const before = vi.fn(async () => undefined);
    const pacer = { before, waitedMs: () => 0, delay: { seconds: 0, source: 'default' } };

    await probeSurface(URL_UNDER_TEST, { fetchImpl: answering(200), pacer: pacer as never });

    expect(before).toHaveBeenCalledOnce();
  });
});

/**
 * The record of an undecided probe has to reach somewhere a reader will see it (D-182).
 *
 * The first cut of this wrote the count with `say()`, the progress callback — which the scan CLI
 * does not print and which reaches no report. A probe layer failing on every request would then
 * produce a run indistinguishable from a healthy one: same findings, same cost, no note anywhere.
 * That is the exact failure this item exists to prevent, so the destination is asserted, not the
 * wording.
 */
describe('an undecided probe is recorded where it can be read', () => {
  it('goes into the run truncations, which the report renders', async () => {
    const { probeUndecided } = await import('../src/screen.js');

    const line = probeUndecided({ undecided: 3, total: 24 })[0] ?? '';
    expect(line).toContain('3 of 24');
    // States what it means for the findings, because "the check failed" invites the wrong reading.
    expect(line).toContain('rendered in full');
  });

  it('says nothing when every candidate was decided', () => {
    // A permanent "0 undecided" is noise on every run where nothing went wrong.
    return import('../src/screen.js').then(({ probeUndecided }) => {
      expect(probeUndecided({ undecided: 0, total: 24 })).toEqual([]);
    });
  });
});
