/**
 * Crawl-delay handling (D-013).
 *
 * Two failure modes are ruled out: silently ignoring a declared delay, and silently obeying an
 * unbounded one. Both are tested, because both are silent by nature — neither would show up as
 * a broken run.
 */

import { describe, expect, it } from 'vitest';
import {
  createPacer,
  describeCrawlDelay,
  MAX_CRAWL_DELAY_SECONDS,
  parseRobotsTxt,
  resolveCrawlDelay,
  type PacerClock,
} from '../src/index.js';

describe('parsing Crawl-delay', () => {
  it('reads a declared delay', () => {
    expect(parseRobotsTxt('User-agent: *\nCrawl-delay: 3', 'https://s.example').crawlDelaySeconds).toBe(3);
  });

  it('reads a fractional delay', () => {
    expect(parseRobotsTxt('Crawl-delay: 0.5', 'https://s.example').crawlDelaySeconds).toBe(0.5);
  });

  it('is null when none is declared', () => {
    expect(parseRobotsTxt('User-agent: *\nDisallow: /x', 'https://s.example').crawlDelaySeconds).toBeNull();
  });

  it('takes the largest when several are declared', () => {
    // Different agents may be given different delays; the politest reading is the one the site
    // asked anyone to observe.
    const robots = parseRobotsTxt(
      'User-agent: a\nCrawl-delay: 2\nUser-agent: b\nCrawl-delay: 7',
      'https://s.example',
    );
    expect(robots.crawlDelaySeconds).toBe(7);
  });

  it.each(['Crawl-delay: soon', 'Crawl-delay: -5', 'Crawl-delay: 0'])('ignores %s', (line) => {
    expect(parseRobotsTxt(line, 'https://s.example').crawlDelaySeconds).toBeNull();
  });
});

describe('resolveCrawlDelay', () => {
  it('honours a delay within the cap', () => {
    expect(resolveCrawlDelay(3)).toEqual({ declaredSeconds: 3, effectiveMs: 3000, clamped: false });
  });

  it('honours a delay exactly at the cap', () => {
    expect(resolveCrawlDelay(MAX_CRAWL_DELAY_SECONDS).clamped).toBe(false);
  });

  it('clamps a delay above the cap and records the declared value', () => {
    const delay = resolveCrawlDelay(3600);

    expect(delay.effectiveMs).toBe(MAX_CRAWL_DELAY_SECONDS * 1000);
    expect(delay.clamped).toBe(true);
    // Never silently ignored: what the merchant asked for is still on the record.
    expect(delay.declaredSeconds).toBe(3600);
  });

  it('waits for nothing when none was declared', () => {
    expect(resolveCrawlDelay(null).effectiveMs).toBe(0);
  });
});

describe('describeCrawlDelay', () => {
  it('states a clamp along with the declared value', () => {
    const line = describeCrawlDelay(resolveCrawlDelay(3600));
    expect(line).toContain('3600');
    expect(line).toContain('cap');
  });

  it('says so when nothing was declared, rather than staying silent', () => {
    expect(describeCrawlDelay(resolveCrawlDelay(null))).toContain('declared no Crawl-delay');
  });
});

describe('pacer', () => {
  /** A clock that advances only when the pacer sleeps, so tests do not actually wait. */
  function fakeClock(): PacerClock & { elapsed: () => number } {
    let time = 0;
    return {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      elapsed: () => time,
    };
  }

  it('does not delay the first request', async () => {
    const clock = fakeClock();
    const pacer = createPacer(resolveCrawlDelay(5), clock);

    await pacer.before();
    expect(pacer.waitedMs()).toBe(0);
  });

  it('spaces subsequent requests by the declared delay', async () => {
    const clock = fakeClock();
    const pacer = createPacer(resolveCrawlDelay(3), clock);

    await pacer.before();
    await pacer.before();

    expect(pacer.waitedMs()).toBe(3000);
  });

  it('counts work already done toward the delay rather than adding to it', async () => {
    // A 5s delay plus a 4s render should space requests 5s apart, not 9s. Otherwise honouring
    // a delay would slow a run far more than the site actually asked for.
    let time = 0;
    const clock: PacerClock = {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    };
    const pacer = createPacer(resolveCrawlDelay(5), clock);

    await pacer.before();
    time += 4000; // rendering
    await pacer.before();

    expect(pacer.waitedMs()).toBe(1000);
  });

  it('does not wait at all when work already exceeded the delay', async () => {
    let time = 0;
    const clock: PacerClock = {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    };
    const pacer = createPacer(resolveCrawlDelay(2), clock);

    await pacer.before();
    time += 9000;
    await pacer.before();

    expect(pacer.waitedMs()).toBe(0);
  });

  it('never waits when no delay was declared', async () => {
    const clock = fakeClock();
    const pacer = createPacer(resolveCrawlDelay(null), clock);

    await pacer.before();
    await pacer.before();
    await pacer.before();

    expect(pacer.waitedMs()).toBe(0);
  });

  it('caps the wait even when the site asked for an hour', async () => {
    const clock = fakeClock();
    const pacer = createPacer(resolveCrawlDelay(3600), clock);

    await pacer.before();
    await pacer.before();

    expect(pacer.waitedMs()).toBe(MAX_CRAWL_DELAY_SECONDS * 1000);
  });
});
