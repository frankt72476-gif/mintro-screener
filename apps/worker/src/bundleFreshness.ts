/**
 * Refusing to render a report from a stale bundle (D-187).
 *
 * `apps/web/dist` is produced by **`vite build`**. `tsc --build` does not produce it, and every
 * `npm run` script that renders a report runs `tsc --build` first — so the obvious way to prepare a
 * measurement leaves the bundle exactly as it was.
 *
 * The failure mode is not a crash. It is a **PDF that renders correctly from month-old code**, and
 * a page count taken from it that looks like a result. A before/after measurement is the worst case:
 * both sides render the same stale bundle, both numbers agree, and the agreement reads as evidence
 * that a change had no effect.
 *
 * That happened. Three page counts came back identical across a change that added a nine-row
 * checklist and raised every section heading by six points.
 *
 * ## Refuse rather than build
 *
 * Two ways to close it: have the renderer run `vite build` itself, or have it refuse when the
 * bundle is older than the source. **It refuses**, for three reasons:
 *
 *   - **A renderer that builds is a renderer whose output cannot be traced to a build.** These PDFs
 *     are the deliverable of a defensibility tool. "Which bundle produced this?" must have an
 *     answer, and a command that silently rebuilds underneath the render makes the answer "whichever
 *     one it made at the time".
 *   - **The deployed worker has no build toolchain.** `pdfJob` renders on Fly from an image where
 *     `vite` and the source tree are not present. A renderer that builds would work locally and
 *     fail in production, which is the direction that gets found late.
 *   - **The remedy is one command and the diagnosis is the whole cost.** Nobody who sees this
 *     message is confused about what to do; the entire loss was not knowing there was a problem.
 *
 * ## Where it lives
 *
 * In `startReportServer`, not in one CLI. Four callers serve this bundle — `report-pdf`,
 * `page-budget`, `compose-check`, `loop-check` — and `page-budget` is the tool whose entire output
 * is page counts. Fixing the one that was noticed and leaving three is how a defect of this shape
 * survives (D-181).
 *
 * ## When it says nothing
 *
 * No source tree, no check. On Fly the bundle is built into the image and `apps/web/src` does not
 * exist; there is nothing to compare against and nothing to warn about. Absence of the source is
 * not evidence of staleness, and a production render must not fail on it.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where the sources that produce the bundle live, relative to the repository root. */
const SOURCE_DIRS = ['apps/web/src', 'apps/web/index.html'] as const;

export interface Freshness {
  readonly stale: boolean;
  /** Why, in words a caller can print. Empty when the bundle is fresh or unknowable. */
  readonly reason: string;
}

/**
 * Whether `webRoot` was built after the newest file that feeds it.
 *
 * Compares against `index.html` in the bundle rather than the directory's own mtime: a directory's
 * timestamp moves when anything inside it is touched, including by a tool that did not rebuild.
 */
export function bundleFreshness(webRoot: string, sourceDirs: readonly string[] = SOURCE_DIRS): Freshness {
  const entry = join(webRoot, 'index.html');
  if (!existsSync(entry)) {
    return {
      stale: true,
      reason:
        `no built web app at ${resolve(webRoot)} — ${entry} does not exist.\n` +
        `  Build it with:  npm --prefix apps/web run build`,
    };
  }

  const builtAt = statSync(entry).mtimeMs;

  let newest = 0;
  let newestPath = '';
  let sawSource = false;

  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue;
    sawSource = true;
    for (const file of walk(dir)) {
      const at = statSync(file).mtimeMs;
      if (at > newest) {
        newest = at;
        newestPath = file;
      }
    }
  }

  // No source tree — a deployed image. Nothing to compare, so nothing to say.
  if (!sawSource) return { stale: false, reason: '' };

  if (newest <= builtAt) return { stale: false, reason: '' };

  const behind = Math.round((newest - builtAt) / 1000);
  return {
    stale: true,
    reason:
      `the built web app is older than its source.\n` +
      `  ${resolve(entry)}\n` +
      `    built  ${new Date(builtAt).toISOString()}\n` +
      `  ${resolve(newestPath)}\n` +
      `    edited ${new Date(newest).toISOString()}  (${behind}s newer)\n\n` +
      `  'tsc --build' does not produce this bundle. Rendering now would print a report from\n` +
      `  code that is no longer in the tree — and a page count taken from it would look like a\n` +
      `  result. Build it with:  npm --prefix apps/web run build`,
  };
}

/** Every file under a path, or the path itself when it is a file. */
function* walk(target: string): Generator<string> {
  const info = statSync(target);
  if (!info.isDirectory()) {
    yield target;
    return;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(target, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else yield child;
  }
}
