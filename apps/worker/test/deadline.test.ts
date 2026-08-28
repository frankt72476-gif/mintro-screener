/**
 * The wall-clock bound on Playwright calls that carry no timeout (D-153).
 *
 * These tests pin the property the fix depends on and the one the old code got wrong: a `.catch`
 * bounds a *rejection*, not a call that never settles. Everything here uses a promise that never
 * resolves, because that is the shape `page.content()` and `page.evaluate` take against a wedged
 * page — the measured behaviour recorded in `deadline.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { DeadlineExceeded, withDeadline, withDeadlineOr } from '../src/deadline.js';

/** A promise that never settles. The thing a `.catch` cannot help with. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

describe('withDeadline', () => {
  it('rejects a call that never settles', async () => {
    await expect(withDeadline(never<string>(), 20, 'page.content()')).rejects.toBeInstanceOf(
      DeadlineExceeded,
    );
  });

  it('names the call and the bound, so a report can say which one stopped', async () => {
    let caught: unknown;
    try {
      await withDeadline(never<string>(), 20, 'page.evaluate() extracting /x');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DeadlineExceeded);
    const error = caught as DeadlineExceeded;
    expect(error.what).toBe('page.evaluate() extracting /x');
    expect(error.ms).toBe(20);
    expect(error.message).toContain('page.evaluate() extracting /x');
    expect(error.message).toContain('20ms');
  });

  it('passes a value straight through when the call beats the deadline', async () => {
    await expect(withDeadline(Promise.resolve('<html>'), 1_000, 'x')).resolves.toBe('<html>');
  });

  it('propagates a genuine rejection rather than masking it as a timeout', async () => {
    const boom = Promise.reject(new Error('Target page, context or browser has been closed'));
    await expect(withDeadline(boom, 1_000, 'x')).rejects.toThrow('has been closed');
  });

  it('clears its timer on the success path', async () => {
    // A timer left pending holds the event loop open for the full deadline after every call —
    // in the worker that is a process that will not exit for 25 minutes after its last scan.
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const before = clear.mock.calls.length;
    await withDeadline(Promise.resolve(1), 60_000, 'x');
    expect(clear.mock.calls.length).toBeGreaterThan(before);
    clear.mockRestore();
  });

  it('leaves no unhandled rejection when the abandoned call fails later', async () => {
    // This is the sequence a watchdog termination produces: the deadline fires, the caller closes
    // the page, and the abandoned call then rejects. Unhandled, that exits the worker process.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    let reject!: (e: Error) => void;
    const work = new Promise<string>((_r, rj) => {
      reject = rj;
    });

    await expect(withDeadline(work, 10, 'page.content()')).rejects.toBeInstanceOf(DeadlineExceeded);
    reject(new Error('Target closed'));
    await new Promise((r) => setTimeout(r, 50));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});

describe('withDeadlineOr', () => {
  it('returns the fallback instead of throwing, for call sites that treat failure as an observation', async () => {
    await expect(withDeadlineOr(never<number>(), 20, 'locator.count()', 0)).resolves.toBe(0);
  });

  it('returns the fallback on a genuine rejection too', async () => {
    const boom = Promise.reject(new Error('closed'));
    await expect(withDeadlineOr(boom, 1_000, 'x', null)).resolves.toBeNull();
  });

  it('passes a real value through untouched', async () => {
    await expect(withDeadlineOr(Promise.resolve(true), 1_000, 'x', null)).resolves.toBe(true);
  });
});
