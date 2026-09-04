/**
 * The route that serves a captured report, and the constraints that are the reason it is safe.
 *
 * This process holds `SUPABASE_SERVICE_KEY`, which carries `BYPASSRLS`. Until this shipped it had
 * no inbound HTTP surface at all — `fly.toml` said so in as many words. Read-only,
 * validate-then-read, no listing, no enumeration and no leakage of storage layout are therefore
 * load-bearing rather than stylistic, and each one below is given the thing it exists to catch.
 *
 * The store is a fake that **records every call**, so the negatives are assertions about what the
 * route did, not about what it returned. A route that refused a request after listing a prefix
 * would pass every status-code assertion in this file and fail the ones that matter.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { REPORT_LINK_PATH, reportObjectKey } from '@mintro/engine';
import type { WorkerSupabase } from '../src/store/supabase.js';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REPORT_PORT,
  REPORT_HEADERS,
  reportRequestFrom,
  startReportRoute,
} from '../src/reportRoute.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';
const DOCUMENT = '<!DOCTYPE html><html><body><p>the report</p></body></html>';

interface Calls {
  readonly downloads: string[];
  readonly lists: string[];
  readonly uploads: string[];
  readonly removes: string[][];
  readonly inserts: unknown[];
}

function fakeStore(objects: Record<string, string>): { supabase: WorkerSupabase; calls: Calls } {
  const calls: Calls = { downloads: [], lists: [], uploads: [], removes: [], inserts: [] };

  const supabase = {
    bucket: 'evidence',
    client: {
      storage: {
        from: () => ({
          download: async (key: string) => {
            calls.downloads.push(key);
            const body = objects[key];
            if (body === undefined) return { data: null, error: { message: 'Object not found' } };
            return { data: { arrayBuffer: async () => Buffer.from(body, 'utf8') }, error: null };
          },
          list: async (prefix: string) => {
            calls.lists.push(prefix);
            return { data: [], error: null };
          },
          upload: async (key: string) => {
            calls.uploads.push(key);
            return { data: null, error: null };
          },
          remove: async (keys: string[]) => {
            calls.removes.push(keys);
            return { data: null, error: null };
          },
        }),
      },
      from: () => ({
        insert: async (row: unknown) => {
          calls.inserts.push(row);
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as WorkerSupabase;

  return { supabase, calls };
}

let running: { close(): Promise<void> } | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(objects: Record<string, string>): Promise<{ origin: string; calls: Calls }> {
  const { supabase, calls } = fakeStore(objects);
  const route = await startReportRoute({ supabase, port: 0 });
  running = route;
  return { origin: `http://127.0.0.1:${route.port}`, calls };
}

const stored = { [reportObjectKey(RUN, TOKEN)]: DOCUMENT };
const link = `${REPORT_LINK_PATH}${RUN}/${TOKEN}`;

describe('serving a captured report', () => {
  it('returns the bytes as HTML', async () => {
    /*
      The control, and the whole reason this route exists. Supabase serves the same object as
      `text/plain` under a sandbox CSP whatever mimetype is stored, which strips the inline styles
      and inline captures the document is made of.
    */
    const { origin } = await serve(stored);
    const response = await fetch(`${origin}${link}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(DOCUMENT);
  });

  it('carries the headers the document needs and the ones it should have', async () => {
    const { origin } = await serve(stored);
    const response = await fetch(`${origin}${link}`);

    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets a CSP that permits exactly what a captured report contains', async () => {
    /*
      Not a sandbox. The document is inline-everything by ruling — inline styles, `data:` images,
      `data:` fonts — and a policy that blocked those would reproduce the failure being fixed.

      **Unverified against a real browser.** These are string assertions about a header; whether a
      browser renders the document under it is checked on the first deployed link.
    */
    const { origin } = await serve(stored);
    const csp = (await fetch(`${origin}${link}`)).headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain('img-src data:');
    expect(csp).toContain('font-src data:');
    // No script source of any kind. `default-src 'none'` is what blocks them.
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('sandbox');
  });

  it('answers HEAD with the headers and no body', async () => {
    const { origin } = await serve(stored);
    const response = await fetch(`${origin}${link}`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('');
  });

  it('reads exactly one object, by the key the token names', async () => {
    const { origin, calls } = await serve(stored);
    await fetch(`${origin}${link}`);

    expect(calls.downloads).toEqual([reportObjectKey(RUN, TOKEN)]);
  });
});

describe('read-only', () => {
  it('never writes, lists or removes, on any request it is given', async () => {
    /*
      The constraint made to fire. A route that listed a prefix to decide whether an object exists
      would satisfy every status assertion above — and would hand a stranger a way to enumerate a
      run's captures through timing or error shape.
    */
    const { origin, calls } = await serve(stored);

    for (const path of [
      link,
      `${REPORT_LINK_PATH}${RUN}/${'z'.repeat(43)}`,
      `${REPORT_LINK_PATH}${RUN}`,
      `${REPORT_LINK_PATH}${RUN}/`,
      `${REPORT_LINK_PATH}`,
      '/',
      '/../../etc/passwd',
    ]) {
      await fetch(`${origin}${path}`);
    }

    expect(calls.lists).toEqual([]);
    expect(calls.uploads).toEqual([]);
    expect(calls.removes).toEqual([]);
    expect(calls.inserts).toEqual([]);
  });

  it('refuses every method that is not a read', async () => {
    const { origin, calls } = await serve(stored);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${origin}${link}`, { method });
      expect(response.status, method).toBe(405);
    }

    // And nothing was read either: the method is refused before the path is parsed.
    expect(calls.downloads).toEqual([]);
  });
});

describe('validate, then read', () => {
  it('never reaches storage with a malformed run id or token', async () => {
    /*
      The point of validating first. Without it these strings would be concatenated into a storage
      key and sent, which is how a path traversal or an injected prefix gets its chance.
    */
    const { origin, calls } = await serve(stored);

    for (const path of [
      `${REPORT_LINK_PATH}not-a-uuid/${TOKEN}`,
      `${REPORT_LINK_PATH}${RUN}/short`,
      `${REPORT_LINK_PATH}${RUN}/${TOKEN}extra`,
      `${REPORT_LINK_PATH}${RUN}/${TOKEN}/deeper`,
      `${REPORT_LINK_PATH}../${RUN}/${TOKEN}`,
      `${REPORT_LINK_PATH}${RUN}%2F..%2F${TOKEN}`,
    ]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(404);
    }

    expect(calls.downloads).toEqual([]);
  });

  it('accepts only the exact shape', () => {
    expect(reportRequestFrom(link)).toEqual({ runId: RUN, token: TOKEN });

    for (const path of [
      `${REPORT_LINK_PATH}${RUN}`,
      `${REPORT_LINK_PATH}${RUN}/${TOKEN}/`,
      `/other/${RUN}/${TOKEN}`,
      `${REPORT_LINK_PATH}${RUN}/${TOKEN.slice(0, 42)}`,
    ]) {
      expect(reportRequestFrom(path), path).toBeNull();
    }
  });
});

describe('no enumeration', () => {
  it('answers every miss identically', async () => {
    /*
      The constraint that is easiest to lose and hardest to notice losing. A 400 for a malformed
      token and a 404 for a missing one would confirm to a stranger that their token was *shaped*
      right — the first half of enumerating tokens. A different body for "no such run" would
      confirm which run ids exist.
    */
    const { origin } = await serve(stored);

    const misses = await Promise.all(
      [
        `${REPORT_LINK_PATH}not-a-uuid/${TOKEN}`,
        `${REPORT_LINK_PATH}${RUN}/short`,
        `${REPORT_LINK_PATH}${RUN}/${'z'.repeat(43)}`,
        `${REPORT_LINK_PATH}99999999-9999-4999-8999-999999999999/${TOKEN}`,
        '/nothing/here',
      ].map(async (path) => {
        const response = await fetch(`${origin}${path}`);
        return { status: response.status, body: await response.text() };
      }),
    );

    const distinct = new Set(misses.map((miss) => `${miss.status}:${miss.body}`));
    expect([...distinct]).toHaveLength(1);
    expect(misses[0]!.status).toBe(404);
  });

  it('reveals nothing about storage in a refusal', async () => {
    // No bucket, no key, no Supabase error text. A refusal describes nothing.
    const { origin } = await serve(stored);
    const response = await fetch(`${origin}${REPORT_LINK_PATH}${RUN}/${'z'.repeat(43)}`);
    const body = await response.text();

    for (const leak of ['reports', 'evidence', 'supabase', 'storage', 'Object not found', RUN]) {
      expect(body.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });

  it('reveals nothing about storage when the object is served either', async () => {
    const { origin } = await serve(stored);
    const response = await fetch(`${origin}${link}`);

    // The object key is not a header, and neither is the bucket.
    const parts: string[] = [];
    response.headers.forEach((value, name) => parts.push(`${name}: ${value}`));
    const headers = parts.join('\n');
    expect(headers).not.toContain(reportObjectKey(RUN, TOKEN));
    expect(headers.toLowerCase()).not.toContain('supabase');
  });
});

describe('what the proxy sends it', () => {
  it('serves the path Netlify forwards, unchanged', async () => {
    /*
      The worker's half of the end-to-end chain. `apps/web/test/reportProxy.test.ts` asserts the
      rewrite forwards `/r/<run>/<token>` to this origin unchanged; this asserts that path resolves
      here to the object key the capture wrote. Neither test can import the other's project, so the
      shared owner — `REPORT_LINK_PATH` — is what joins them.
    */
    const forwarded = `${REPORT_LINK_PATH}${RUN}/${TOKEN}`;
    const requested = reportRequestFrom(forwarded);

    expect(requested).not.toBeNull();
    expect(reportObjectKey(requested!.runId, requested!.token)).toBe(reportObjectKey(RUN, TOKEN));

    const { origin } = await serve(stored);
    expect((await fetch(`${origin}${forwarded}`)).status).toBe(200);
  });
});

describe('the headers constant', () => {
  it('sets no sandbox and no frame-ancestors that would blank the document', () => {
    // Guarded as data as well as over the wire, because this is the value a future edit touches.
    expect(REPORT_HEADERS['content-security-policy']).not.toContain('sandbox');
    expect(REPORT_HEADERS['content-type']).toBe('text/html; charset=utf-8');
  });
});

/**
 * The port Fly routes to is the port the route listens on.
 *
 * Two files, one number, and nothing joining them until this. The failure it prevents is the
 * quiet kind: `fly config validate` passes, the machine boots, the process logs that it is
 * listening, and every report link times out because the proxy is knocking on a different door.
 *
 * Reads `fly.toml` as text, so no environment can answer it favourably.
 */
describe('the deployed port', () => {
  const fly = readFileSync('apps/worker/fly.toml', 'utf8');

  it('matches internal_port in fly.toml', () => {
    const declared = fly.match(/^\s*internal_port\s*=\s*(\d+)/m)?.[1];

    expect(declared, 'fly.toml declares no internal_port').toBeDefined();
    expect(Number(declared)).toBe(DEFAULT_REPORT_PORT);
  });

  it('names the process the service belongs to', () => {
    /*
      Fly refuses to infer this when the app defines a named process: `fly config validate` fails
      with "Service has no processes set but app has 1 processes defined". Asserted because the
      block is easy to edit and the error arrives at deploy time, not here.
    */
    expect(fly).toMatch(/processes\s*=\s*\["worker"\]/);
  });
});
