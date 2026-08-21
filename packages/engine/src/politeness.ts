/**
 * Crawl-delay handling (D-013).
 *
 * The merchant applied to the program and we screen at their request. A tool that ignores a
 * site's stated crawl preferences while collecting evidence for an underwriting decision holds
 * itself to a lower standard than the one it is measuring the merchant against.
 *
 * Two failure modes are ruled out here, and the type makes both visible rather than silent:
 *
 *   - **Silently ignoring a declared delay.** `declaredSeconds` always records what the site
 *     asked for, whether or not we could honour it in full.
 *   - **Silently obeying an unbounded one.** `Crawl-delay: 3600` would stall a run for an
 *     hour. It is clamped to five seconds and `clamped` records that we did so.
 *
 * Applies to the Playwright worker as much as to Layer 0 fetches.
 */

/** The most we will wait between requests, however much a site asks for. */
export const MAX_CRAWL_DELAY_SECONDS = 5;

export interface CrawlDelay {
  /** What robots.txt asked for, in seconds. Null when it asked for nothing. */
  readonly declaredSeconds: number | null;
  /** What we actually wait between requests, in milliseconds. */
  readonly effectiveMs: number;
  /** True when the declared value exceeded the cap and was reduced. */
  readonly clamped: boolean;
}

export const NO_CRAWL_DELAY: CrawlDelay = {
  declaredSeconds: null,
  effectiveMs: 0,
  clamped: false,
};

/**
 * Resolves a declared crawl delay into the delay we will actually observe.
 *
 *     declared <= 5s     honour it
 *     declared >  5s     wait 5s, and record both the clamp and the declared value
 *     not declared       no delay
 */
export function resolveCrawlDelay(declaredSeconds: number | null): CrawlDelay {
  if (declaredSeconds === null || !Number.isFinite(declaredSeconds) || declaredSeconds <= 0) {
    return NO_CRAWL_DELAY;
  }

  const clamped = declaredSeconds > MAX_CRAWL_DELAY_SECONDS;
  const effectiveSeconds = clamped ? MAX_CRAWL_DELAY_SECONDS : declaredSeconds;

  return {
    declaredSeconds,
    effectiveMs: Math.round(effectiveSeconds * 1000),
    clamped,
  };
}

/**
 * One line for the run record, stating what the site asked for and what we did.
 *
 * Always produced, including for the no-delay case, so a report can show that the question was
 * considered rather than leaving a reader to infer it from silence.
 */
export function describeCrawlDelay(delay: CrawlDelay): string {
  if (delay.declaredSeconds === null) {
    return 'robots.txt declared no Crawl-delay; requests were not additionally spaced.';
  }
  if (delay.clamped) {
    return `robots.txt declared Crawl-delay: ${delay.declaredSeconds}s, above the ${MAX_CRAWL_DELAY_SECONDS}s cap; requests were spaced ${delay.effectiveMs / 1000}s apart.`;
  }
  return `robots.txt declared Crawl-delay: ${delay.declaredSeconds}s; requests were spaced accordingly.`;
}

/** Suspends for `ms`. Injectable so tests need not actually wait. */
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Spaces requests to one origin.
 *
 * `before()` is awaited immediately before each request. It waits only for the remainder of the
 * interval since the last one, so time already spent rendering a page counts toward the delay
 * rather than being added to it — otherwise a 5s delay plus a 4s render would space requests
 * nine seconds apart, which is not what the site asked for.
 */
export interface Pacer {
  /** Waits until the next request to this origin is due. */
  before(): Promise<void>;
  /** Total time spent waiting, for the run record. */
  waitedMs(): number;
  readonly delay: CrawlDelay;
}

export interface PacerClock {
  now: () => number;
  sleep: Sleep;
}

const realClock: PacerClock = { now: () => Date.now(), sleep: realSleep };

export function createPacer(delay: CrawlDelay, clock: PacerClock = realClock): Pacer {
  let lastRequestAt: number | null = null;
  let waited = 0;

  return {
    delay,
    waitedMs: () => waited,
    async before(): Promise<void> {
      const now = clock.now();

      if (lastRequestAt !== null && delay.effectiveMs > 0) {
        const remaining = delay.effectiveMs - (now - lastRequestAt);
        if (remaining > 0) {
          waited += remaining;
          await clock.sleep(remaining);
        }
      }

      lastRequestAt = clock.now();
    },
  };
}
