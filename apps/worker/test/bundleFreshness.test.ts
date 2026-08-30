/**
 * The stale-bundle refusal (D-187).
 *
 * `apps/web/dist` comes from `vite build`. `tsc --build` does not produce it, and every script that
 * renders a report runs `tsc --build` first — so the obvious way to prepare a measurement leaves
 * the bundle untouched, and the result is not a crash but a correct-looking PDF of older code.
 *
 * The case that has to keep working is the last one here: **no source tree, no complaint**. On Fly
 * the bundle is built into the image and `apps/web/src` is not present, and a production render
 * must not fail because it cannot find something that was never shipped.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleFreshness } from '../src/bundleFreshness.js';

let root = '';
const dist = () => join(root, 'dist');
const src = () => join(root, 'src');

/** Seconds since the epoch, so mtimes can be set deliberately rather than raced. */
const at = (isoSeconds: number) => isoSeconds;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'freshness-'));
  mkdirSync(dist(), { recursive: true });
  mkdirSync(join(src(), 'components'), { recursive: true });
  writeFileSync(join(dist(), 'index.html'), '<html></html>');
  writeFileSync(join(src(), 'components', 'ReportView.tsx'), 'export const x = 1;');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a bundle older than its source', () => {
  it('is refused, and says which file is newer', () => {
    utimesSync(join(dist(), 'index.html'), at(1_000_000), at(1_000_000));
    utimesSync(join(src(), 'components', 'ReportView.tsx'), at(1_000_500), at(1_000_500));

    const result = bundleFreshness(dist(), [src()]);

    expect(result.stale).toBe(true);
    expect(result.reason).toContain('ReportView.tsx');
    expect(result.reason).toContain('older than its source');
    // The remedy, because the whole loss was not knowing there was a problem.
    expect(result.reason).toContain('run build');
  });

  it('is refused when there is no bundle at all', () => {
    rmSync(join(dist(), 'index.html'));

    expect(bundleFreshness(dist(), [src()]).stale).toBe(true);
  });

  it('reads index.html rather than the directory mtime', () => {
    /*
      A directory's timestamp moves when anything inside it is touched, including by a tool that
      did not rebuild — so a directory comparison would call a stale bundle fresh.
    */
    utimesSync(join(dist(), 'index.html'), at(1_000_000), at(1_000_000));
    utimesSync(join(src(), 'components', 'ReportView.tsx'), at(1_000_500), at(1_000_500));
    // Touch the dist directory itself, which is what a copy or a listing would do.
    utimesSync(dist(), at(2_000_000), at(2_000_000));

    expect(bundleFreshness(dist(), [src()]).stale).toBe(true);
  });
});

describe('a bundle newer than its source', () => {
  it('passes', () => {
    utimesSync(join(src(), 'components', 'ReportView.tsx'), at(1_000_000), at(1_000_000));
    utimesSync(join(dist(), 'index.html'), at(1_000_500), at(1_000_500));

    expect(bundleFreshness(dist(), [src()])).toEqual({ stale: false, reason: '' });
  });

  it('passes when they are the same instant', () => {
    utimesSync(join(src(), 'components', 'ReportView.tsx'), at(1_000_000), at(1_000_000));
    utimesSync(join(dist(), 'index.html'), at(1_000_000), at(1_000_000));

    expect(bundleFreshness(dist(), [src()]).stale).toBe(false);
  });

  it('looks at every file, not only the top level', () => {
    // The newest file is nested. A shallow read would miss the edit that matters.
    utimesSync(join(dist(), 'index.html'), at(1_000_000), at(1_000_000));
    // The sibling is older than the bundle, so the nested file is the only thing that can fail it.
    utimesSync(join(src(), 'components', 'ReportView.tsx'), at(999_000), at(999_000));
    writeFileSync(join(src(), 'components', 'Deep.tsx'), 'x');
    utimesSync(join(src(), 'components', 'Deep.tsx'), at(1_000_900), at(1_000_900));

    expect(bundleFreshness(dist(), [src()]).stale).toBe(true);
    expect(bundleFreshness(dist(), [src()]).reason).toContain('Deep.tsx');
  });
});

describe('a deployed image with no source tree', () => {
  it('says nothing, because there is nothing to compare', () => {
    /*
      The case that must not break. `pdfJob` renders on Fly from an image where `apps/web/src` does
      not exist — absence of the source is not evidence of staleness, and refusing there would be a
      guard that only ever fires in production.
    */
    utimesSync(join(dist(), 'index.html'), at(1_000_000), at(1_000_000));

    expect(bundleFreshness(dist(), [join(root, 'nowhere')])).toEqual({ stale: false, reason: '' });
  });

  it('still refuses when the bundle itself is missing, source or no source', () => {
    // A missing bundle is knowable without any source to compare against.
    rmSync(join(dist(), 'index.html'));

    expect(bundleFreshness(dist(), [join(root, 'nowhere')]).stale).toBe(true);
  });
});
