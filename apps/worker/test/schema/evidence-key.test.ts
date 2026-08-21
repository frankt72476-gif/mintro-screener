/**
 * A finding may only cite a capture that exists — and the two must agree on its name.
 *
 * This is the defect that closed the five runs while their layer-0 captures had no row. The
 * writer filed each gzipped artifact under its *storage path* (`<key>.gz`) while every finding
 * cited the *artifact key* (`<key>`). Both records existed. Neither could find the other.
 *
 * Screenshots hid it: their path and key are the same string, so the captures anyone actually
 * looked at resolved. The invisible half was robots.txt and sitemap.xml — the documentary
 * evidence behind hard constraint 3.
 *
 * These tests are written the way the README asks for: they reproduce the defect against the
 * schema, not the fix.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

const SHA = 'a'.repeat(64);

/** Inserts an evidence row under whatever name the caller chooses, correct or not. */
async function storeEvidence(runId: string, key: string, kind = 'sitemap'): Promise<void> {
  await schema.query(
    `insert into public.evidence (key, run_id, kind, sha256, bytes, content_type, url)
     values ($1, $2, $3, $4, 1, 'application/gzip', 'https://shop.example/sitemap.xml')`,
    [key, runId, kind, SHA],
  );
}

async function citeEvidence(runId: string, ordinal: number, evidenceKey: string): Promise<string | null> {
  return schema.attempt(
    `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind, evidence_key)
     values ($1, $2, 'CATG-001', 'pass', 'Observed.', 'document', $3)`,
    [runId, ordinal, evidenceKey],
  );
}

describe('a finding cannot cite a capture that is not there', () => {
  it('rejects an evidence_key with no evidence row', async () => {
    const { runId } = await seedRun(schema, 'orphan.example');

    const error = await citeEvidence(runId, 0, `${runId}/layer0/${SHA}`);

    // Hard constraint 3, as a schema property rather than a convention the writer must remember.
    expect(error).toMatch(/findings_evidence_key_exists|foreign key/i);
  });

  it('accepts it once the capture is recorded under the key the finding cites', async () => {
    const { runId } = await seedRun(schema, 'joined.example');
    const key = `${runId}/layer0/${SHA}`;

    await storeEvidence(runId, key);

    expect(await citeEvidence(runId, 0, key)).toBeNull();
  });

  /**
   * The defect itself. The row is present, the object is present, and the finding still cannot
   * reach it — because the row was filed under the storage path.
   */
  it('still rejects the citation when the row is keyed by the storage path instead', async () => {
    const { runId } = await seedRun(schema, 'gz-divergence.example');
    const key = `${runId}/layer0/${SHA}`;

    await storeEvidence(runId, `${key}.gz`);

    const error = await citeEvidence(runId, 0, key);
    expect(error, 'the .gz divergence went undetected').toMatch(
      /findings_evidence_key_exists|foreign key/i,
    );
  });

  it('does not hide the divergence for screenshots, whose key and path are the same string', async () => {
    // Why this shipped: the only captures a person looks at were unaffected, so every screenshot
    // resolved and the report looked correct.
    const { runId } = await seedRun(schema, 'screenshot.example');
    const key = `${runId}/layer1/${SHA}.png`;

    await storeEvidence(runId, key, 'screenshot');

    expect(await citeEvidence(runId, 0, key)).toBeNull();
  });

  it('leaves a finding that cites nothing alone, since not every finding has a primary capture', async () => {
    const { runId } = await seedRun(schema, 'no-citation.example');

    const error = await schema.attempt(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind, not_evaluable_reason)
       values ($1, 0, 'CATG-001', 'not_evaluable', 'Not observable.', 'document', 'no sitemap was served')`,
      [runId],
    );

    expect(error).toBeNull();
  });
});

describe('closing a run before verifying it is unrecoverable', () => {
  /**
   * Not a schema defect — the trigger is right. This records what the ordering defect cost, so
   * the reason `finishRun` must run last is written down somewhere that fails if it stops being
   * true.
   */
  it('freezes the run with its findings incomplete, and offers no way back', async () => {
    const { runId } = await seedRun(schema, 'closed-early.example');

    // Closed while a cited capture is still missing — exactly what the old order did.
    await schema.query(
      `update public.runs set status = 'complete', finished_at = now() where id = $1`,
      [runId],
    );

    // Nothing can be added, because the run is frozen...
    const addFinding = await schema.attempt(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'CATG-001', 'pass', 'Observed.', 'document')`,
      [runId],
    );
    // ...findings themselves still insert; it is the run that cannot be reopened.
    expect(addFinding).toBeNull();

    const reopen = await schema.attempt(
      `update public.runs set status = 'running', finished_at = null where id = $1`,
      [runId],
    );
    expect(reopen).toMatch(/immutable|finished/i);

    const remove = await schema.attempt(`delete from public.runs where id = $1`, [runId]);
    expect(remove).not.toBeNull();

    // Stuck by design. D-002 is worth more than the run, so the fix is upstream: never close a
    // run until it has been verified.
  });

  it('leaves a failed run open, which is what makes a resumed write possible', async () => {
    const { runId } = await seedRun(schema, 'left-open.example');

    await schema.query(`update public.runs set status = 'failed' where id = $1`, [runId]);

    const resumed = await schema.attempt(
      `update public.runs set status = 'running' where id = $1`,
      [runId],
    );
    expect(resumed).toBeNull();
  });
});
