/**
 * Serving a captured report.
 *
 * Supabase serves public HTML as `text/plain` with `nosniff` and a sandbox CSP whatever mimetype
 * is stored — confirmed against both the proxy and the direct storage URL, with the object detail
 * showing `text/html; charset=utf-8`. A sandbox CSP strips inline styles and inline image data, so
 * the document arrives unstyled with no captures. A self-contained report that a sandbox strips is
 * not delivered. That path is closed, and the document is not being weakened to fit a header.
 *
 * So the bytes are served from here, where the headers are ours.
 *
 * ## This gives the worker a public HTTP surface it has never had
 *
 * `fly.toml` said, until this shipped, *"the worker polls the job queue, it does not serve
 * traffic"*. There was no `[http_service]`, no `EXPOSE`, and the only listener in the codebase was
 * `reportServer.ts` on loopback for rendering.
 *
 * **This process holds `SUPABASE_SERVICE_KEY`**, which carries `BYPASSRLS` and can read and write
 * every merchant's evidence. Making it internet-reachable is the security consequence of serving
 * reports ourselves, and it is why the constraints below are load-bearing rather than stylistic:
 *
 *   * **Read-only.** It downloads one object. It never writes, and there is no code path here that
 *     could.
 *   * **Validate, then read.** A run id and token that do not match their shapes never reach
 *     storage. Nothing from the URL is concatenated into a key until both have been checked.
 *   * **No listing, no enumeration.** It never lists a prefix, and every failure looks identical
 *     from outside — see `NOT_FOUND` below.
 *   * **Nothing about storage escapes.** No bucket name, no key, no Supabase error text, no run id
 *     it did not already receive. A 404 body is a fixed string.
 */

import { createServer, type Server } from 'node:http';
import { REPORT_BUCKET, REPORT_LINK_PATH, isReportToken, reportObjectKey } from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';

/** Run ids are uuids. Checked here rather than trusted, because this string arrives from a URL. */
const RUN_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * One body for every refusal, and one status.
 *
 * A malformed token, a well-formed token for a report that does not exist, and a well-formed token
 * for another run's report are indistinguishable from outside. Distinguishing them would confirm
 * to a stranger that a token was *shaped* correctly, or that a run id exists, which is the first
 * half of enumerating either.
 */
const NOT_FOUND = 'Not found.\n';

export interface ReportRouteDeps {
  readonly supabase: WorkerSupabase;
  /** Port to bind. 0 picks a free one, which is what the tests use. */
  readonly port?: number;
}

export interface RunningReportRoute {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The `{runId, token}` in a request path, or null.
 *
 * Exported for its own tests: this is where a bad input is stopped, and a test that drove only the
 * server would exercise it through two layers of framing.
 *
 * Null means *not a report request*. It never means "wrong token" — the caller cannot tell those
 * apart from this, and neither can anyone outside.
 */
export function reportRequestFrom(pathname: string): { runId: string; token: string } | null {
  if (!pathname.startsWith(REPORT_LINK_PATH)) return null;

  const rest = pathname.slice(REPORT_LINK_PATH.length);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;

  const [runId, token] = parts as [string, string];
  // Both, before anything is built from either. `reportObjectKey` throws on a bad value, and this
  // is what keeps that from being the only guard.
  if (!RUN_ID.test(runId) || !isReportToken(token)) return null;

  return { runId, token };
}

/**
 * The response headers a captured report is served with.
 *
 * `content-type` is the whole reason this route exists. `x-robots-tag` is defence in depth — the
 * `<meta name="robots">` inside the document remains the primary control, because it travels with
 * the bytes.
 *
 * The CSP permits exactly what the document contains and nothing else: inline styles, `data:`
 * images, `data:` fonts. No `script-src`, so `default-src 'none'` blocks scripts — a captured
 * report contains none and the capture step refuses one that does.
 *
 * **This CSP has not been checked against a real browser.** It is written to match what the
 * document uses, and if it is wrong the report renders unstyled — the failure being fixed here.
 * Verify on the first deployed link before trusting it.
 */
export const REPORT_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow',
  // The bytes at this key never change: a re-capture mints a new token and writes a new object.
  'cache-control': 'public, max-age=31536000, immutable',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/**
 * Starts the route.
 *
 * Bound to all interfaces, unlike `reportServer.ts`, because Fly routes to the container's port.
 * That is the difference between a render helper and a public surface, and it is why everything
 * above is asserted rather than assumed.
 */
export async function startReportRoute(deps: ReportRouteDeps): Promise<RunningReportRoute> {
  const server: Server = createServer((request, response) => {
    void handle(deps.supabase, request.method ?? 'GET', request.url ?? '/', response);
  });

  await new Promise<void>((ready) => server.listen(deps.port ?? 0, '0.0.0.0', ready));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (deps.port ?? 0);

  return {
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function handle(
  supabase: WorkerSupabase,
  method: string,
  url: string,
  response: import('node:http').ServerResponse,
): Promise<void> {
  const refuse = (): void => {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store',
    });
    response.end(NOT_FOUND);
  };

  // Reading only. Anything else is refused before the path is even parsed.
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed.\n');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://worker.invalid').pathname);
  } catch {
    refuse();
    return;
  }

  // Fly wants somewhere to check. It reveals nothing and reads nothing.
  if (pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok\n');
    return;
  }

  const requested = reportRequestFrom(pathname);
  if (requested === null) {
    refuse();
    return;
  }

  /*
    Straight to the object, with no database lookup.

    A `report_captures` read would add a second thing to be down and a second surface to probe, and
    it would answer a question this route does not need answered: the object either exists at the
    key the token names, or it does not. Storage is the authority on that.
  */
  let body: Buffer;
  try {
    const key = reportObjectKey(requested.runId, requested.token);
    const { data, error } = await supabase.client.storage.from(REPORT_BUCKET).download(key);
    if (error !== null || data === null) {
      refuse();
      return;
    }
    body = Buffer.from(await data.arrayBuffer());
  } catch {
    // Including anything `reportObjectKey` throws. A stranger learns nothing from a malformed
    // request that they would not learn from a well-formed one for a report that is not there.
    refuse();
    return;
  }

  if (body.length === 0) {
    refuse();
    return;
  }

  response.writeHead(200, { ...REPORT_HEADERS, 'content-length': String(body.length) });
  response.end(method === 'HEAD' ? undefined : body);
}
