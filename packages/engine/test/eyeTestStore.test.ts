/**
 * The five things "there is no eye test" can mean (D-198, D-200).
 *
 * The read arrives after the run, so a report can be on screen before its read exists. That makes
 * absence ambiguous in a way it was not when the layer ran at assembly, and every assertion here
 * holds one pair apart:
 *
 * - **pending is not failed.** A job that has not run yet, shown in the failure treatment, tells a
 *   reader the layer broke — thirty seconds before it succeeds. This is the one that would be
 *   noticed last and matter most, because it is a false negative about Mintro's own work.
 * - **predates is not pending.** A run screened before the layer existed will never have a read.
 *   Promising one is a wait that never ends.
 * - **a failed read is not a pending job.** It was, and that is how an eye test with a recorded
 *   absence rendered as nothing at all (D-200).
 *
 * The historical case is decided by the run's own manifest rather than by comparing dates against
 * the rubric's `effective`. A date comparison gives a different answer every time the rubric is
 * revised, and would eventually claim that runs which *do* carry reads predate the layer.
 */

import { describe, expect, it } from 'vitest';
import { resolveEyeTest, readRunEyeTest, type EyeTestRow } from '../src/eyeTestStore.js';
import type { EyeTestOutcome } from '../src/eyetest.js';
import type { ScreeningReport } from '../src/report.js';

const WITH_MANIFEST = {
  eyeTestCaptures: [{ surface: 'homepage', sourceUrl: 'https://x.test/', evidenceKey: 'k.png', text: '' }],
} as Pick<ScreeningReport, 'eyeTestCaptures'>;

const WITHOUT_MANIFEST = {} as Pick<ScreeningReport, 'eyeTestCaptures'>;

const RAN: EyeTestOutcome = {
  kind: 'ran',
  test: {
    read: 'A catalogue site.',
    rubricVersion: '2.1.0',
    model: 'claude-sonnet-5',
    ranAt: '2026-08-30T00:00:00.000Z',
    elapsedMs: 22_000,
    verdicts: [],
    captures: [],
  },
};

/** A successful read that found a row. */
const row = (over: Partial<EyeTestRow>) =>
  ({
    ok: true as const,
    row: { status: 'queued', outcome: null, error: null, finished_at: null, ...over },
  });

/** A successful read that found nothing — the job has not written yet. */
const nothing = { ok: true as const, row: null };

/** A read that did not happen. A different fact, and kept as one (D-200). */
const broke = { ok: false as const, error: 'permission denied for table eye_tests' };

describe('resolveEyeTest keeps the five apart', () => {
  it('a finished job is the outcome, whatever the outcome says', () => {
    const got = resolveEyeTest(WITH_MANIFEST, row({ status: 'done', outcome: RAN }));
    expect(got.kind).toBe('recorded');
  });

  it('an evidenced absence is still a recorded outcome, not a failure of the job', () => {
    /*
      `runEyeTest` returns an absence for every vendor condition, and that absence carries the
      capture list hard constraint 3 requires. It is a result, and the panel shows it as one.
    */
    const absent: EyeTestOutcome = {
      kind: 'absent',
      absence: { rubricVersion: '2.1.0', reason: 'the model did not answer within 20s', captures: [] },
    };
    const got = resolveEyeTest(WITH_MANIFEST, row({ status: 'done', outcome: absent }));

    expect(got.kind).toBe('recorded');
    if (got.kind !== 'recorded') return;
    expect(got.outcome.kind).toBe('absent');
  });

  it('no row is pending, never failed', () => {
    expect(resolveEyeTest(WITH_MANIFEST, nothing).kind).toBe('pending');
  });

  it.each(['queued', 'running'])('a %s job is pending, never failed', (status) => {
    expect(resolveEyeTest(WITH_MANIFEST, row({ status })).kind).toBe('pending');
  });

  it('a done row whose outcome did not survive the read is pending, not recorded', () => {
    // The database refuses this combination, so reaching it means the read lost the column. Better
    // to say nothing has been recorded than to render a panel with no content in it.
    expect(resolveEyeTest(WITH_MANIFEST, row({ status: 'done', outcome: null })).kind).toBe('pending');
  });

  it('a failed job says why', () => {
    const got = resolveEyeTest(WITH_MANIFEST, row({ status: 'failed', error: 'run has no stored report' }));

    expect(got.kind).toBe('failed');
    if (got.kind !== 'failed') return;
    expect(got.reason).toBe('run has no stored report');
  });

  it('a failed job with no reason still says something rather than nothing', () => {
    const got = resolveEyeTest(WITH_MANIFEST, row({ status: 'failed', error: null }));

    expect(got.kind).toBe('failed');
    if (got.kind !== 'failed') return;
    expect(got.reason).not.toBe('');
  });

  it('a failed read says so, and is never mistaken for a job that has not run', () => {
    /*
      The defect this replaced: a failed query returned `null`, which read as *pending*. So a
      broken read rendered "not recorded yet" — an assertion about the job, made by code that
      could not see the job at all. On a run whose eye test had recorded an evidenced absence,
      that showed a reader nothing where there was something to show.
    */
    expect(resolveEyeTest(WITH_MANIFEST, broke).kind).toBe('unreadable');
    expect(resolveEyeTest(WITH_MANIFEST, nothing).kind).toBe('pending');
  });

  it('a run with no manifest predates the layer, whatever rows exist', () => {
    /*
      The manifest is the signal, and it beats the row.

      A backfill would have to invent one, and a read taken today under today's rubric, filed
      against a run screened weeks ago, is a read nothing could attribute — which is the one thing
      `rubricVersion` exists to prevent.
    */
    expect(resolveEyeTest(WITHOUT_MANIFEST, nothing).kind).toBe('predates');
    expect(resolveEyeTest(WITHOUT_MANIFEST, row({ status: 'done', outcome: RAN })).kind).toBe('predates');
    expect(resolveEyeTest(WITHOUT_MANIFEST, row({ status: 'failed', error: 'x' })).kind).toBe('predates');
    // Including when the read failed: a run that never carried a manifest will never have a read,
    // and that is knowable from the run alone.
    expect(resolveEyeTest(WITHOUT_MANIFEST, broke).kind).toBe('predates');
  });

  it('an empty manifest is not the same as no manifest', () => {
    // A run that recorded a manifest with nothing in it did have the layer; it simply captured
    // nothing worth reading. That is pending, then an evidenced absence — not a historical run.
    expect(resolveEyeTest({ eyeTestCaptures: [] }, nothing).kind).toBe('pending');
  });
});

describe('readRunEyeTest', () => {
  const reader = (data: unknown[] | null, error: { message: string } | null = null) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data, error }) }),
        }),
      }),
    }),
  });

  it('reads the newest attempt', async () => {
    const got = await readRunEyeTest(reader([{ status: 'done', outcome: RAN, error: null, finished_at: 'x' }]), 'r');
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.row?.status).toBe('done');
  });

  it('carries the failure out rather than flattening it into an absence', async () => {
    /*
      The attestation convention — a failed read renders nothing — is right where the alternative is
      a merchant's silence invented from Mintro's error (D-036). It is wrong here, and this is where
      that departure is held: the vendor's own words survive the read so the panel can say what
      happened (D-200).
    */
    const got = await readRunEyeTest(reader(null, { message: 'permission denied' }), 'r');

    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error).toBe('permission denied');
  });

  it('distinguishes no attempt from a failed read', async () => {
    const got = await readRunEyeTest(reader([]), 'r');
    expect(got).toEqual({ ok: true, row: null });
  });
});
