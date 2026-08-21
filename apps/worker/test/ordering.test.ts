/**
 * Why the completeness check takes the report as an argument.
 *
 * `finishRun` must be last, and it must run only after the check passes. The obvious way to write
 * that is `if ((await assessRun(supabase, runId)).complete) await finishRun(...)` — and it is
 * wrong, because before `finishRun` there is no stored report. `assessRun` derives what a run
 * *should* contain from the report it reads back, so asked too early it finds no report, expects
 * nothing, and reports nothing missing.
 *
 * That is D-026 one layer up: a check whose own subject had not been established yet. The tests
 * below pin the distinction, because it is the kind of thing a later refactor "simplifies" away.
 *
 * These use a stub client and prove a property of the *logic*, not of Postgres. What the schema
 * does is covered in `test/schema/`, which executes real SQL — the two are not substitutes.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, type Finding, type ScreeningReport } from '@mintro/engine';
import { assessContents, assessRun } from '../src/store/completeness.js';
import type { WorkerSupabase } from '../src/store/supabase.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

const CITED_DOC = 'run-1/layer0/aaa';
const CITED_SHOT = 'run-1/layer1/bbb.png';

function report(): ScreeningReport {
  const findings: Finding[] = [
    {
      ruleId: 'NAME-001',
      state: 'fail',
      note: 'Observed.',
      evidenceKind: 'document',
      evidence: [
        {
          kind: 'document',
          sourceUrl: 'https://shop.example/sitemap.xml',
          sourceSha256: 'a'.repeat(64),
          evidenceKey: CITED_DOC,
          capturedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    },
    {
      ruleId: 'DISC-002',
      state: 'pass',
      note: 'Observed.',
      evidenceKind: 'rendered_page',
      evidence: [
        {
          kind: 'rendered_page',
          sourceUrl: 'https://shop.example/',
          sourceSha256: 'b'.repeat(64),
          evidenceKey: CITED_SHOT,
          capturedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    },
  ];

  return assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      findings,
      politeness: 'none declared',
    },
    ruleset,
  );
}

interface StubState {
  readonly run: { status: string; finished_at: string | null; report: ScreeningReport | null } | null;
  readonly findings: number;
  readonly evidence: ReadonlyArray<{ key: string; kind: string }>;
  /** Storage paths that resolve. Anything cited but not listed reads as an unreachable object. */
  readonly objects: readonly string[];
  /** A transport failure on the evidence select, as opposed to an empty result. */
  readonly evidenceError?: string;
  /** A transport failure on the findings count. */
  readonly findingsError?: string;
  /** A storage failure that is not "object not found". */
  readonly storageError?: string;
}

/** Just enough of the client for `assessRun` and `assessContents`, and nothing more. */
function stub(state: StubState): WorkerSupabase {
  const client = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => ({ data: state.run, error: null }),
        then: undefined,
      };

      if (table === 'runs') return builder;

      if (table === 'findings') {
        return {
          select: () => ({
            eq: async () => ({
              count: state.findingsError === undefined ? state.findings : null,
              data: null,
              error: state.findingsError === undefined ? null : { message: state.findingsError },
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: async () => ({
            // The shape a failed PostgREST call actually returns: data null, error set. The bug
            // was reading only `data` and coalescing it to [].
            data: state.evidenceError === undefined ? [...state.evidence] : null,
            error: state.evidenceError === undefined ? null : { message: state.evidenceError },
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          if (state.storageError !== undefined) {
            return { data: null, error: { message: state.storageError } };
          }
          return state.objects.includes(path)
            ? { data: { signedUrl: `https://signed/${path}` }, error: null }
            : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
  };

  return { client, bucket: 'evidence' } as unknown as WorkerSupabase;
}

const ALL_EVIDENCE = [
  { key: CITED_DOC, kind: 'sitemap' },
  { key: CITED_SHOT, kind: 'screenshot' },
];

// Note the `.gz`: the bytes for a gzipped artifact are not at its key.
const ALL_OBJECTS = [`${CITED_DOC}.gz`, CITED_SHOT];

describe('checking a run before it is closed', () => {
  const expected = ruleset.rules.length;

  it('catches a missing evidence row, given the report in hand', async () => {
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: [{ key: CITED_SHOT, kind: 'screenshot' }],
        objects: ALL_OBJECTS,
      }),
      'run-1',
      report(),
    );

    expect(contents.problems.join(' ')).toContain('cited evidence key');
    expect(contents.missingEvidenceKeys).toContain(CITED_DOC);
  });

  /**
   * The defect this ordering exists to prevent, stated as a test: ask the database what it should
   * contain before the report is in it, and it says "nothing missing".
   */
  it('would pass vacuously if it read the stored report instead', async () => {
    const assessment = await assessRun(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: 0,
        evidence: [],
        objects: [],
      }),
      'run-1',
    );

    // Not one word about missing evidence — because with no report there is nothing to compare
    // against. The only problems raised are that the run is unfinished, which is exactly what the
    // caller is about to "fix" by closing it.
    expect(assessment.missingEvidenceKeys).toHaveLength(0);
    expect(assessment.findingsExpected).toBe(0);
    expect(assessment.problems.join(' ')).not.toContain('cited evidence key');
  });

  it('passes when every finding and every cited capture is there', async () => {
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: ALL_OBJECTS,
      }),
      'run-1',
      report(),
      { checkObjects: true },
    );

    expect(contents.problems).toEqual([]);
  });

  it('catches a row whose object never made it to the bucket', async () => {
    // Rows and objects are written in separate systems that cannot share a transaction, so this
    // gap is permanent. It is checked rather than assumed.
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: [CITED_SHOT],
      }),
      'run-1',
      report(),
      { checkObjects: true },
    );

    expect(contents.missingObjects).toContain(CITED_DOC);
  });

  it('looks for a gzipped capture at its storage path, not at its key', async () => {
    // The inverse of the key defect: if the object check used the key directly it would report
    // every document capture missing, and no run would ever close.
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: [CITED_DOC, CITED_SHOT], // the bare key — where the bytes are *not*
      }),
      'run-1',
      report(),
      { checkObjects: true },
    );

    expect(contents.missingObjects).toContain(CITED_DOC);
  });

  it('names the keys it could not find, so a failure is actionable', async () => {
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: [],
        objects: [],
      }),
      'run-1',
      report(),
    );

    expect(contents.problems.join(' ')).toContain(CITED_DOC);
  });
});

/**
 * The corepeptides failure, as a test.
 *
 * That run wrote all 17 artifacts, all 17 evidence rows and all 97 findings, and was refused
 * anyway. `readContents` discarded the `error` from its own queries and coalesced the result, so a
 * transient failure on the evidence select produced *an empty database* and the check reported
 * every cited key as missing. The number in the output — 11 — was the count of keys the report
 * cites, not a count of anything that was actually absent.
 *
 * The reader could not tell "nothing is there" from "I could not look", and answered as though it
 * could. Same shape as the rest of the sequence, pointing the other way: a false failure rather
 * than a false pass. Survivable, but not a check.
 */
describe('a read that failed is not an empty database', () => {
  const expected = ruleset.rules.length;

  it('throws when the evidence rows cannot be read, rather than reporting them missing', async () => {
    const failing = assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: ALL_OBJECTS,
        evidenceError: 'fetch failed',
      }),
      'run-1',
      report(),
    );

    await expect(failing).rejects.toThrow(/could not read evidence rows/i);
    // Specifically NOT the old behaviour, which was to report every cited key as having no row.
    await expect(failing).rejects.not.toThrow(/cited evidence key/i);
  });

  it('throws when the findings cannot be counted, rather than reporting zero', async () => {
    // A null count coalesced to 0 reads as "no findings were written" — condemning a run that
    // wrote all of them.
    await expect(
      assessContents(
        stub({
          run: { status: 'running', finished_at: null, report: null },
          findings: expected,
          evidence: ALL_EVIDENCE,
          objects: ALL_OBJECTS,
          findingsError: 'statement timeout',
        }),
        'run-1',
        report(),
      ),
    ).rejects.toThrow(/could not count findings/i);
  });

  it('throws when the storage API fails, rather than calling the object missing', async () => {
    await expect(
      assessContents(
        stub({
          run: { status: 'running', finished_at: null, report: null },
          findings: expected,
          evidence: ALL_EVIDENCE,
          objects: ALL_OBJECTS,
          storageError: 'upstream connect error',
        }),
        'run-1',
        report(),
        { checkObjects: true },
      ),
    ).rejects.toThrow(/could not check the object/i);
  });

  it('still reports a genuinely absent object as absent', async () => {
    // The distinction has to cut both ways, or it is just a swallowed failure with extra steps.
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: [CITED_SHOT],
      }),
      'run-1',
      report(),
      { checkObjects: true },
    );

    expect(contents.missingObjects).toContain(CITED_DOC);
  });
});

/**
 * "The cited counts match" and "nothing was dropped" are different claims.
 *
 * A report names only the captures its findings cite — 10 or 11 of 17 for a typical run. The rest
 * are DOM snapshots and sitemap pages nothing happened to reference, and one of those going
 * missing would have passed every check. The writer holds the full list, so it passes it.
 */
describe('every captured artifact, not only the cited ones', () => {
  const expected = ruleset.rules.length;

  const UNCITED = 'run-1/layer1/ccc.html';

  it('catches a captured artifact that reached no evidence row', async () => {
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: ALL_OBJECTS,
      }),
      'run-1',
      report(),
      { artifactKeys: [CITED_DOC, CITED_SHOT, UNCITED] },
    );

    expect(contents.uncapturedArtifacts).toContain(UNCITED);
    expect(contents.problems.join(' ')).toContain('captured artifact');
  });

  it('would not have caught it from the report alone', async () => {
    // The check a reader gets, and the reason the writer has to supply the list.
    const contents = await assessContents(
      stub({
        run: { status: 'running', finished_at: null, report: null },
        findings: expected,
        evidence: ALL_EVIDENCE,
        objects: ALL_OBJECTS,
      }),
      'run-1',
      report(),
    );

    expect(contents.problems).toEqual([]);
  });
});
