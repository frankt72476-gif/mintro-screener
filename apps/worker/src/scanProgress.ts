/**
 * The one place a run's progress facts are derived (D-173).
 *
 * ## Why this exists rather than a callback
 *
 * D-162 put `productsInScope`, `productsSampled` and `surfacesRead` on the finished report, and
 * noted that every number in it "was already computed and thrown away". Adding a live progress
 * display would have thrown them away a second time and recomputed them for the run page — the same
 * quantities derived twice, in two places, free to drift.
 *
 * So the facts are accumulated here as they become known, and read twice: by the progress events
 * while the crawl runs, and by `sampleBasis()` when the report is assembled. One derivation, two
 * readers.
 *
 * ## Where one derivation is not possible, and why
 *
 * `productsInScope` and `surfacesRead` unify exactly: the same value, computed once, read twice.
 *
 * **`productsSampled` does not, and cannot.** The stored field counts pages that came back
 * *served*; the live counter is how far through the sample loop the crawl has got. A page that has
 * not been rendered yet cannot be known to have been served, so mid-run there is no honest way to
 * report the stored quantity — reporting attempts as though they were successes is the overstatement
 * this whole model exists to avoid.
 *
 * They are therefore two numbers about two things, not one number computed twice, and both come
 * from this object. The live one is `attempted`, named for what it is. Nothing recomputes either
 * elsewhere.
 *
 * `sampled` is also **replaced wholesale** when a login wall forces a re-render with a screening
 * account, so `served` is recomputed from the current list rather than incremented — an incremental
 * counter would double-count the retry.
 */

import type { ProgressEvent, SampleBasis, ScanPhase } from '@mintro/engine';
import { INDETERMINATE_PHASES } from '@mintro/engine';

export interface ScanProgress {
  /** Move to a phase and say what it is doing. Resets any count. */
  readonly enter: (phase: ScanPhase, line: string) => void;
  /** Say something within the current phase, optionally with a real count. */
  readonly say: (line: string, count?: { readonly done: number; readonly total: number }) => void;
  /** Product URLs in scope, once classification has settled. */
  readonly scopeIs: (urls: number) => void;
  /** The current sample, whole — called again after an escalation replaces it. */
  readonly sampleIs: (served: number) => void;
  /** A Layer 3 surface that was actually read. Never called for one that was not. */
  readonly surfaceRead: (label: string) => void;
  /**
   * What the run left unrendered, and which kind (D-223).
   *
   * Recorded here with everything else the coverage line is built from, so the declaration and the
   * ratio it qualifies come from one derivation rather than two.
   */
  readonly notRenderedIs: (recognised: number, overCap: number) => void;
  /** What D-162 stores, from the same facts the run page was shown. */
  readonly sampleBasis: () => SampleBasis;
}

export function createScanProgress(emit: (event: ProgressEvent) => void): ScanProgress {
  let phase: ScanPhase = 'discovery';
  let productsInScope = 0;
  let notRendered: { recognised: number; overCap: number } | undefined;
  let productsSampled = 0;
  const surfacesRead: string[] = [];

  const send = (line: string, count?: { done: number; total: number }): void => {
    /*
      The denominator rule, enforced at the emitter rather than trusted to each call site.

      `discovery` and `escalate` have none — the sitemap queue grows as it is read, and a sign-in
      against an unknown form is not countable in advance. A count passed for one of them is
      dropped rather than shown: a wrong denominator reads as a hang, and the database refuses to
      store one anyway (0047).
    */
    const countable = count !== undefined && !INDETERMINATE_PHASES.includes(phase);
    emit({ phase, line, ...(countable ? { done: count.done, total: count.total } : {}) });
  };

  return {
    enter(next, line) {
      phase = next;
      send(line);
    },
    say(line, count) {
      send(line, count);
    },
    scopeIs(urls) {
      productsInScope = urls;
    },
    sampleIs(served) {
      productsSampled = served;
    },
    surfaceRead(label) {
      if (!surfacesRead.includes(label)) surfacesRead.push(label);
    },
    notRenderedIs(recognised, overCap) {
      notRendered = { recognised, overCap };
    },
    sampleBasis() {
      return {
        productsInScope,
        productsSampled,
        surfacesRead: [...surfacesRead],
        // Omitted rather than zeroed when nothing recorded it: a run that never declared what it
        // left out is not a run that left nothing out, and the coverage line has to tell those
        // apart (D-002, D-044's shape).
        ...(notRendered === undefined ? {} : { notRendered }),
      };
    },
  };
}
