/**
 * Pinning a run to the build it started with (D-061).
 *
 * `tsc --build` rewrites the files a running scan is executing from. Node loads a module once, so
 * what is already loaded survives — but anything loaded lazily afterwards comes from the new
 * build, and a run can end up spanning two versions of the code.
 *
 * That happened on 2026-08-22, to the author of the rule forbidding it, two hours after writing
 * it, during a fix, on the run whose output was about to be reviewed. Those are the conditions the
 * rule exists for; nobody rebuilds mid-scan when nothing is urgent.
 *
 * ## What this does and does not do
 *
 * It does **not** prevent the rebuild. It prevents the rebuild from producing a result anyone
 * keeps — the same posture as reporting `not_evaluable` rather than guessing: when the run cannot
 * vouch for itself, it says so instead of handing over an answer that looks ordinary.
 *
 * **It aborts. It never warns.** A warning on a run that takes ten minutes is read after the
 * report is written, which is after the damage. And a run spanning two builds produces output that
 * looks entirely normal — there is nothing for a reader to notice, which is why the check has to
 * be the thing that notices.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildPin {
  /** Where the pinned tree lives. */
  readonly root: string;
  /** The newest file in it when the run started, and when it was last written. */
  readonly newestFile: string;
  readonly newestMs: number;
  readonly pinnedAt: string;
}

/** Raised when the build changed under a running scan. Carries what a person needs to act. */
export class BuildChangedError extends Error {
  constructor(
    readonly pin: BuildPin,
    readonly changedFile: string,
    readonly changedMs: number,
  ) {
    super(
      `the build changed while this run was executing, so its results cannot be trusted and ` +
        `nothing has been written.\n\n` +
        `  pinned at start   ${stamp(pin.newestMs)}  ${pin.newestFile}\n` +
        `  changed to        ${stamp(changedMs)}  ${changedFile}\n\n` +
        `A run spanning two builds produces results that look ordinary, so this is checked rather ` +
        `than noticed. Re-run the scan; do not read the results of the interrupted one.`,
    );
    this.name = 'BuildChangedError';
  }
}

/**
 * Records the newest file in the build tree, to compare against later.
 *
 * The newest mtime alone would say *that* something changed; the file name says *what*, and both
 * timestamps say by how much. A guard reporting only "the build changed" sends someone hunting,
 * which is a guard people learn to ignore.
 */
export function pinBuild(root: string, now: () => Date = () => new Date()): BuildPin {
  const newest = newestIn(root);
  return {
    root,
    newestFile: newest.file,
    newestMs: newest.ms,
    pinnedAt: now().toISOString(),
  };
}

/**
 * Throws if the build tree changed since it was pinned.
 *
 * Called before anything is written — a report, an artifact, a database row. Checking at the end
 * would let a run that spanned two builds finish and hand over its output.
 */
export function assertBuildUnchanged(pin: BuildPin): void {
  const newest = newestIn(pin.root);

  // Newer *or* different: a rebuild can leave an identical mtime on a machine with coarse
  // timestamps, and can also remove the file that was newest. Either means a different tree.
  if (newest.ms > pin.newestMs || newest.file !== pin.newestFile) {
    throw new BuildChangedError(pin, newest.file, newest.ms);
  }
}

/** The newest file under a directory, by modification time, with its path. */
function newestIn(root: string): { readonly file: string; readonly ms: number } {
  let file = '';
  let ms = 0;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory that cannot be read tells us nothing about the build; it is not a change.
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      try {
        const at = statSync(path).mtimeMs;
        if (at > ms) {
          ms = at;
          file = path;
        }
      } catch {
        // Vanished between listing and stat — a rebuild in progress. The next check catches it.
      }
    }
  };

  walk(root);
  return { file, ms };
}

const stamp = (ms: number): string =>
  ms === 0 ? '(no files found)' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
