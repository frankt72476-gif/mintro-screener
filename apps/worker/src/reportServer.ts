/**
 * Serving the report route for PDF rendering.
 *
 * In production the PDF is printed from the deployed, authenticated report route on Netlify. This
 * is the local equivalent: it serves the built web app together with the run's reports and
 * evidence, so `page.pdf()` renders exactly the same component an analyst sees.
 *
 * It exists because the alternative — a separate PDF template — is what `docs/ARCHITECTURE.md`
 * rules out. One rendering stack means the PDF and the web report cannot say different things.
 *
 * Bound to loopback only. This serves merchant evidence and is not a public server.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { bundleFreshness } from './bundleFreshness.js';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface ReportServerOptions {
  /** Built web app, i.e. `apps/web/dist`. */
  readonly webRoot: string;
  /** Directories mounted at a URL prefix — reports and evidence. */
  readonly mounts: Readonly<Record<string, string>>;
  readonly port?: number;
  /**
   * Skips the staleness refusal (D-187).
   *
   * For a caller deliberately rendering an old bundle — comparing two builds, say. Never for
   * convenience: the refusal exists because a stale render produces a correct-looking document
   * from code that is no longer in the tree, and a measurement taken from it looks like a result.
   */
  readonly allowStaleBundle?: boolean;
}

export interface RunningReportServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startReportServer(options: ReportServerOptions): Promise<RunningReportServer> {
  /*
    Refuse before serving a byte (D-187).

    `apps/web/dist` comes from `vite build`; `tsc --build` does not produce it, and every script
    that renders a report runs `tsc --build` first. So the obvious way to prepare a measurement
    leaves the bundle untouched, and the result is not a crash — it is a correct-looking PDF of
    month-old code.

    Here rather than in one CLI because four callers serve this bundle, and one of them,
    `page-budget`, exists to produce page counts.
  */
  if (options.allowStaleBundle !== true) {
    const freshness = bundleFreshness(options.webRoot);
    if (freshness.stale) {
      throw new Error(`refusing to render: ${freshness.reason}`);
    }
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    for (const [prefix, root] of Object.entries(options.mounts)) {
      if (!path.startsWith(prefix)) continue;
      if (serveFrom(root, path.slice(prefix.length), response)) return;
      response.writeHead(404).end();
      return;
    }

    if (serveFrom(options.webRoot, path, response)) return;

    // Single-page app: unknown paths fall back to the shell, which reads the query string.
    if (serveFrom(options.webRoot, '/index.html', response)) return;
    response.writeHead(404).end();
  });

  await new Promise<void>((ready) => server.listen(options.port ?? 0, '127.0.0.1', ready));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/**
 * Streams a file, refusing anything that escapes the root.
 *
 * The traversal guard is not ceremonial: the mounted directories hold merchant evidence, and a
 * `..` in a request path would otherwise read anything the worker process can.
 */
function serveFrom(root: string, requestPath: string, response: import('node:http').ServerResponse): boolean {
  const rootPath = resolve(root);
  const target = resolve(join(rootPath, normalize(requestPath)));

  if (target !== rootPath && !target.startsWith(rootPath + sep)) return false;
  if (!existsSync(target) || !statSync(target).isFile()) return false;

  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
  return true;
}
