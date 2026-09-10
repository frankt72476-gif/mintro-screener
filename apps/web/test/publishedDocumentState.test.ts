/**
 * What a published evaluation says about itself, and what an analyst may do with it (D-275).
 *
 * Three defects, all found on run `50a49af8` (cheatcodespeptides.com, published 2026-09-10
 * 16:46:30 ET, version 1), and all three the same shape: a screen stating something the database
 * could have told it.
 *
 * 1. **The masthead was blank.** `evaluations` carried `ruleset_version` 3.11.0 and
 *    `angles_version` 1.3.0 — `publish_evaluation` copies both from the draft it publishes — and
 *    the read never asked for them, so the fallback filled in empty strings. The document that
 *    exists to say what a merchant was read against said nothing.
 * 2. **Send was offered over a document that could not be sent.** The capture was still `running`;
 *    `send.ts` refuses to compose without a stored file, so pressing it could only fail.
 * 3. **The run list stated rule tallies.** `1 not met · 6 unclear` — the layer beneath what an
 *    agent opening a list of past screenings wants, which is what we concluded and whether it went
 *    out.
 *
 * Every assertion below is over the function the app calls. `environment: 'node'` means a component
 * effect cannot be exercised here, so the three decisions were lifted out of their effects into
 * `documentVersions`, `readEvaluationCaptureState`/`canDeliver` and `evaluationLine` — which is not
 * a testing convenience. A fallback nobody can assert is exactly what the first defect was.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { documentVersions } from '../src/components/EvaluationEditor.js';
import {
  canDeliver,
  captureStateLine,
  type EvaluationCaptureState,
} from '../src/lib/evaluationCaptureState.js';
import { evaluationLine, type EvaluationState } from '../src/lib/runs.js';

/** The row as run `50a49af8` holds it. */
const PUBLISHED = {
  ruleset_version: '3.11.0',
  angles_version: '1.3.0',
  model: 'claude-opus-5',
};

describe('the masthead of a published evaluation', () => {
  /*
    The defect itself. Publishing deletes the draft, so this is the shape every published run has.
  */
  it('reads its versions off the published row when the draft is gone', () => {
    expect(documentVersions(null, PUBLISHED)).toEqual({
      rulesetVersion: '3.11.0',
      anglesVersion: '1.3.0',
      model: 'claude-opus-5',
    });
  });

  /*
    And the draft keeps precedence, because an unpublished run has no published row at all and a
    run mid-edit is being read against the draft's versions, not a previous publication's.
  */
  it('prefers the draft while one exists', () => {
    const draft = { ruleset_version: '3.12.0', angles_version: '1.4.0', model: 'draft-model' };

    expect(documentVersions(draft, PUBLISHED).rulesetVersion).toBe('3.12.0');
    expect(documentVersions(draft, null).anglesVersion).toBe('1.4.0');
  });

  it('is empty only when neither row exists', () => {
    expect(documentVersions(null, null)).toEqual({
      rulesetVersion: '',
      anglesVersion: '',
      model: '',
    });
  });

  /*
    The read has to ask for the columns, and no pure function can say whether it does. Read out of
    the source, the way `embeds.test.ts` reads its embeds — the thing under test is the literal
    string PostgREST receives, and a second copy of it here would be the copy that goes stale.
  */
  it('asks the database for them', () => {
    const source = readFileSync('apps/web/src/components/EvaluationEditor.tsx', 'utf8');
    const select = /\.from\('evaluations'\)[\s\S]{0,2000}?\.select\(\s*([\s\S]*?)\)\s*\n/.exec(source);

    expect(select, 'the evaluations select could not be found').not.toBeNull();
    for (const column of ['ruleset_version', 'angles_version', 'model']) {
      expect(select?.[1], column).toContain(column);
    }
  });
});

describe('what an analyst may do with a published evaluation', () => {
  const READY: EvaluationCaptureState = { kind: 'ready', version: 1, url: '/r/abc' };
  const PENDING: EvaluationCaptureState = {
    kind: 'pending',
    version: 1,
    since: '2026-09-10T20:46:30.299Z',
  };

  it('is sendable once its capture is stored', () => {
    expect(canDeliver(READY, false)).toBe(true);
  });

  /*
    Run `50a49af8` at 20:56 UTC: published ten minutes earlier, capture still `running`, Send drawn.
  */
  it('is not sendable while the capture is still running', () => {
    expect(canDeliver(PENDING, false)).toBe(false);
    // Not even when an older checklist capture happens to exist — that file is not this document.
    expect(canDeliver(PENDING, true)).toBe(false);
  });

  it('is not sendable when the capture failed', () => {
    const failed: EvaluationCaptureState = { kind: 'failed', version: 1, reason: 'timed out' };

    expect(canDeliver(failed, true)).toBe(false);
  });

  /*
    A failed read is not an answer about the run (D-036, D-200, D-213). It must not open the
    control, and it must not claim the run has no evaluation either.
  */
  it('is not sendable when the state could not be read', () => {
    expect(canDeliver({ kind: 'unreadable', reason: 'PGRST201' }, true)).toBe(false);
    expect(captureStateLine({ kind: 'unreadable', reason: 'PGRST201' })).toContain('PGRST201');
  });

  /*
    Runs screened before evaluations existed keep exactly what they had. Nothing is back-filled
    (D-002), so `'none'` is permanent and their checklist capture is what was sent.
  */
  it('leaves a run that predates evaluations as it was', () => {
    expect(canDeliver({ kind: 'none' }, true)).toBe(true);
    expect(canDeliver({ kind: 'none' }, false)).toBe(false);
    expect(captureStateLine({ kind: 'none' })).toBeNull();
  });

  /*
    Absent rather than disabled is the rule, so something has to say why the controls are gone —
    otherwise *not yet* and *not for you* look identical (D-230).
  */
  it('says why the controls are absent, naming the version', () => {
    expect(captureStateLine(PENDING)).toContain('Version 1');
    expect(captureStateLine(READY)).toBeNull();
  });
});

describe('the run list line', () => {
  it('states the conclusion and the version for a published run', () => {
    const published: EvaluationState = {
      kind: 'published',
      version: 1,
      spectrum: 'consumer_leaning',
      placement: 'referred_out',
    };

    // Run 50a49af8's own values, in the reader's vocabulary.
    expect(evaluationLine(published)).toBe('Consumer-leaning · Referred out · v1 published');
  });

  it('distinguishes never-evaluated from drafted', () => {
    expect(evaluationLine({ kind: 'none' })).toBe('Not yet evaluated');
    expect(evaluationLine({ kind: 'draft' })).toBe('Draft');
  });

  /*
    Fourth instance of the class this project keeps rediscovering. A failed embed rendered as *Not
    yet evaluated* would tell an agent her colleague's finished work does not exist.
  */
  it('does not render an unreadable state as an unevaluated run', () => {
    expect(evaluationLine({ kind: 'unreadable' })).not.toBe('Not yet evaluated');
    expect(evaluationLine({ kind: 'unreadable' })).toContain('unreadable');
  });

  /*
    A spectrum position added to `angles.json` and not to `SPECTRUM_LABEL` shows up as itself.
    Visible is the point: blank would be the masthead defect again, one screen over.
  */
  it('falls through an unlabelled id rather than blanking it', () => {
    const line = evaluationLine({
      kind: 'published',
      version: 3,
      spectrum: 'not_a_position',
      placement: 'not_a_placement',
    });

    expect(line).toBe('not_a_position · not_a_placement · v3 published');
  });
});
