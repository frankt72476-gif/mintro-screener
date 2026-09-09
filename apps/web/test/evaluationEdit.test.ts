/**
 * The operator editor: what an edit does, and who is offered one (D-261).
 *
 * ## The split, and what each half can prove
 *
 * **What an edit produces** is data, and `evaluationEdit.ts` answers it — every helper is asserted
 * here directly, which is what "round-trips through save" means when Save sends the document the
 * helpers built. vitest runs `environment: 'node'`, so an edit applied inside a component could
 * only be reached by rendering markup and pretending to click, and that would test the click rather
 * than the edit.
 *
 * **Which controls exist** is markup, and `renderToStaticMarkup` answers it: the same component with
 * `edit` and without it, compared. The addendum asks for one rendering in two modes, and the way to
 * know it is one rendering is that the read-mode markup is the document and the edit-mode markup is
 * the document with controls in it.
 *
 * What neither half reaches is the network call. `edit_evaluation_draft` and the queue insert are
 * the database's, gated there (0081), and this file does not pretend to test a gate that lives in
 * SQL — `apps/worker/test/schema/` is where that is asked.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_SHORE_UPS } from '@mintro/engine';
import { EvaluationReport, type EvaluationEdit } from '../src/components/EvaluationReport.js';
import { EVALUATION_LABELS as LABELS } from '../src/lib/evaluationLabels.js';
import { homeShape, type Viewer } from '../src/lib/homeShape.js';
import {
  EDITABLE_LEANS,
  EDITABLE_PLACEMENTS,
  EDITABLE_ROUTING_STATUSES,
  canAddShoreUp,
  withLean,
  withOperatorNote,
  withParagraph,
  withPlacement,
  withRoutingStatus,
  withShoreUp,
  withShoreUpText,
  withSpectrum,
  withoutShoreUp,
} from '../src/lib/evaluationEdit.js';
import type {
  EvaluationRunContext,
  FindingState,
  StoredDraft,
} from '../src/lib/evaluationView.js';

interface Fixture {
  readonly runId: string;
  readonly merchantDomain: string | null;
  readonly screenedAt: string | null;
  readonly rulesetVersion: string;
  readonly anglesVersion: string;
  readonly model: string;
  readonly handles: EvaluationRunContext['handles'];
  readonly findings: readonly {
    id: string;
    ruleId: string;
    state: string;
    evidenceKey: string | null;
  }[];
  readonly evidence: readonly { key: string; kind: string; url: string }[];
  readonly draft: StoredDraft;
}

const FIXTURE = JSON.parse(
  readFileSync('fixtures/evaluation/draft-9011b2d7.json', 'utf8'),
) as Fixture;

const DRAFT = FIXTURE.draft;

const RUN: EvaluationRunContext = {
  runId: FIXTURE.runId,
  merchantDomain: FIXTURE.merchantDomain,
  screenedAt: FIXTURE.screenedAt,
  rulesetVersion: FIXTURE.rulesetVersion,
  anglesVersion: FIXTURE.anglesVersion,
  model: FIXTURE.model,
  handles: FIXTURE.handles,
  findings: FIXTURE.findings.map((f) => ({ ...f, state: f.state as FindingState })),
  evidence: FIXTURE.evidence,
};

const ACCESS = { description: 'test', urlFor: async () => null };

const render = (draft: StoredDraft, edit?: EvaluationEdit): string =>
  renderToStaticMarkup(
    createElement(EvaluationReport, {
      draft,
      run: RUN,
      access: ACCESS,
      labels: LABELS,
      ...(edit === undefined ? {} : { edit }),
    }),
  );

/** An edit controller that records what it was handed, which is what Save would send. */
const capturing = (): { edit: EvaluationEdit; sent: StoredDraft[] } => {
  const sent: StoredDraft[] = [];
  return { edit: { onChange: (next) => sent.push(next) }, sent };
};

const READ_ONLY = render(DRAFT);
const EDITING = render(DRAFT, capturing().edit);

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

/* ── the gate ─────────────────────────────────────────────────────────────────────────────────── */

describe('editing is offered to Mintro operators and to nobody else', () => {
  const viewer = (over: Partial<Viewer>): Viewer => ({
    role: 'admin',
    isHost: false,
    canRunDocumentsCheck: false,
    canSubmitToIqwallet: false,
    ...over,
  });

  it('hides editing from a partner analyst, whatever else they hold', () => {
    expect(homeShape(viewer({})).showsEvaluationEditing).toBe(false);
    // Holding every capability a partner can hold does not make them Mintro.
    expect(
      homeShape(viewer({ canRunDocumentsCheck: true, canSubmitToIqwallet: true }))
        .showsEvaluationEditing,
    ).toBe(false);
  });

  it('offers it to a host member and to the owner', () => {
    expect(homeShape(viewer({ isHost: true })).showsEvaluationEditing).toBe(true);
    expect(homeShape(viewer({ role: 'owner', isHost: true })).showsEvaluationEditing).toBe(true);
  });

  /*
    Absent, not disabled, and absent by having nothing to call.

    A read-only render carries no control at all — not a greyed one. The same shape `ReportActions`
    uses for Send: there is nothing to pass, so there is nothing to get wrong (D-066).
  */
  it('renders no control at all without an edit callback', () => {
    expect(READ_ONLY).not.toContain('eval-edit-text');
    expect(READ_ONLY).not.toContain('eval-edit-select');
    expect(READ_ONLY).not.toContain('eval-focal-choice');
    expect(READ_ONLY).not.toContain('eval-edit-remove');
    expect(READ_ONLY).not.toContain('<textarea');
    expect(READ_ONLY).not.toContain('<select');
  });

  it('draws every control the addendum names once an edit callback is there', () => {
    // Placement, spectrum, leans, routing, paragraph, shore-ups, operator note.
    expect(EDITING).toContain('eval-focal-choice');
    expect(EDITING).toContain('eval-position-choose');
    expect(EDITING).toContain('eval-edit-select');
    expect(EDITING).toContain('eval-edit-text');
    expect(EDITING).toContain('eval-edit-remove');
    expect(EDITING).toContain('aria-label="Operator notes"');
    expect(EDITING).toContain('aria-label="Placement paragraph"');
  });

  /* The read-mode document is unchanged by the mode existing — the same rendering, twice. */
  it('shows the same document either way', () => {
    for (const angleId of LABELS.angleOrder) {
      expect(text(EDITING), angleId).toContain(LABELS.angleTitle[angleId]!);
    }
    expect(text(EDITING)).toContain('Recommended placement');
    expect(EDITING).toContain('eval-spectrum');
    expect(EDITING).toContain('eval-table');
  });
});

/* ── each field, through the change the control makes ─────────────────────────────────────────── */

describe('every editable field round-trips through the document Save sends', () => {
  it('changes the recommended placement and nothing else', () => {
    const next = withPlacement(DRAFT, 'domestic');
    expect(next.placement.recommended).toBe('domestic');
    expect(next.placement.spectrum).toBe(DRAFT.placement.spectrum);
    expect(next.angles).toEqual(DRAFT.angles);
    // The original is untouched: React sees a new object, and an in-place edit would not move.
    expect(DRAFT.placement.recommended).not.toBe('domestic');
  });

  it('changes the spectrum position', () => {
    const next = withSpectrum(DRAFT, 'research_supplier');
    expect(next.placement.spectrum).toBe('research_supplier');
    expect(next.placement.recommended).toBe(DRAFT.placement.recommended);
  });

  it('changes one angle’s lean and leaves the other six', () => {
    const target = DRAFT.angles[2]!;
    const next = withLean(DRAFT, target.angleId, 'research');
    expect(next.angles.find((a) => a.angleId === target.angleId)!.lean).toBe('research');
    for (const angle of DRAFT.angles) {
      if (angle.angleId === target.angleId) continue;
      expect(next.angles.find((a) => a.angleId === angle.angleId)!.lean, angle.angleId).toBe(
        angle.lean,
      );
    }
  });

  /*
    Every routing row, the two the application answers included.

    Those are the ones an operator is most likely to change: the crawl cannot read them and the
    operator has the application in front of them, so a read-only row there would leave the one
    person who knows the answer unable to record it.
  */
  it.each(FIXTURE.draft.routing.map((row) => row.conditionId))(
    'changes the status of %s',
    (conditionId) => {
      const next = withRoutingStatus(DRAFT, conditionId, 'met');
      expect(next.routing.find((r) => r.conditionId === conditionId)!.status).toBe('met');
      expect(next.routing).toHaveLength(DRAFT.routing.length);
    },
  );

  it('covers the two application conditions, so this is not asserted over observable rows only', () => {
    const unobservable = DRAFT.routing.filter((row) => row.status === 'not_observable');
    expect(unobservable.length).toBe(2);
    for (const row of unobservable) {
      expect(withRoutingStatus(DRAFT, row.conditionId, 'met').routing).toContainEqual({
        ...row,
        status: 'met',
      });
    }
  });

  it('changes the placement paragraph', () => {
    const next = withParagraph(DRAFT, 'A shorter reading.');
    expect(next.placement.paragraph).toBe('A shorter reading.');
    expect(next.placement.citations).toEqual(DRAFT.placement.citations);
  });

  it('edits, deletes and adds a shore-up, up to the validator’s own cap', () => {
    const edited = withShoreUpText(DRAFT, 0, 'Publish a research-use statement.');
    expect(edited.shoreUps[0]!.text).toBe('Publish a research-use statement.');
    expect(edited.shoreUps[0]!.citation).toEqual(DRAFT.shoreUps[0]!.citation);

    const deleted = withoutShoreUp(DRAFT, 0);
    expect(deleted.shoreUps).toHaveLength(DRAFT.shoreUps.length - 1);
    expect(deleted.shoreUps[0]).toEqual(DRAFT.shoreUps[1]);

    const added = withShoreUp(deleted, 'One more.', DRAFT.shoreUps[0]!.citation);
    expect(added.shoreUps).toHaveLength(DRAFT.shoreUps.length);
    expect(added.shoreUps.at(-1)!.text).toBe('One more.');
  });

  /*
    The cap is the engine's, read rather than restated.

    An editor that let an operator write a seventh would be offering a document the publish path
    refuses, and the refusal would arrive after the work rather than instead of it.
  */
  it('refuses a shore-up past the cap, and says so before the control is drawn', () => {
    let full = DRAFT;
    while (canAddShoreUp(full)) {
      full = withShoreUp(full, 'Another.', DRAFT.shoreUps[0]!.citation);
    }
    expect(full.shoreUps).toHaveLength(MAX_SHORE_UPS);
    expect(canAddShoreUp(full)).toBe(false);
    expect(withShoreUp(full, 'One too many.', DRAFT.shoreUps[0]!.citation)).toBe(full);
  });

  it('writes an operator note, and removes the field when it is emptied', () => {
    const noted = withOperatorNote(DRAFT, 'Spoke to the merchant; the gate is being built.');
    expect(noted.operatorNote).toBe('Spoke to the merchant; the gate is being built.');

    // Absent rather than `""`. Two ways to say "no note" is one question with two answers.
    const cleared = withOperatorNote(noted, '   ');
    expect('operatorNote' in cleared).toBe(false);
  });

  /* The vocabularies the controls offer are the ones the document uses. */
  it('offers exactly the values the document can hold', () => {
    expect([...EDITABLE_PLACEMENTS]).toEqual(['referred_out', 'international', 'domestic']);
    expect([...EDITABLE_LEANS]).toEqual(['research', 'neutral', 'consumer']);
    expect([...EDITABLE_ROUTING_STATUSES]).toEqual(['met', 'not_met', 'not_observable']);
  });
});

/* ── the operator note, rendered ──────────────────────────────────────────────────────────────── */

describe('the operator note is its own section under the placement paragraph', () => {
  const noted = withOperatorNote(DRAFT, 'The registration gate is being built this month.');

  it('renders nothing when nobody has written one', () => {
    expect(READ_ONLY).not.toContain('eval-row-note');
    expect(text(READ_ONLY)).not.toContain('Operator notes');
  });

  it('renders as a labelled section once there is one', () => {
    const markup = render(noted);
    expect(markup).toContain('eval-row-note');
    expect(text(markup)).toContain('Operator notes');
    expect(text(markup)).toContain('The registration gate is being built this month.');
  });

  /*
    Under the paragraph, and after it.

    The paragraph is the model's and the note is a person's. A reader who cannot tell them apart is
    reading two voices as one, and a regeneration would silently take the operator's words with it.
  */
  it('sits below the placement paragraph and outside it', () => {
    const markup = render(noted);
    expect(markup.indexOf('eval-row-note')).toBeGreaterThan(markup.indexOf('eval-lede'));
    expect(markup).not.toContain(`${DRAFT.placement.paragraph}The registration gate`);
  });

  it('offers the box in edit mode even when the note is empty', () => {
    expect(EDITING).toContain('aria-label="Operator notes"');
  });
});

/* ── regenerate ───────────────────────────────────────────────────────────────────────────────── */

/*
  Regenerate is a queue row, and this asserts the row.

  Generating a draft opens a browser, reads stored DOM artifacts and calls the vendor — none of it
  reachable from a tab. So the button inserts into `evaluation_requests` and the worker does the
  work, exactly as Rescan and Download PDF already do. Asserted against the source rather than a
  live client: there is no DOM here and no database, and what would go wrong is the editor calling
  something else — a direct write to `evaluation_drafts`, or a fetch to a route that does not exist.
*/
describe('regenerate enqueues rather than doing the work', () => {
  const EDITOR = readFileSync('apps/web/src/components/EvaluationEditor.tsx', 'utf8');

  it('inserts a queued row into the evaluation queue', () => {
    expect(EDITOR).toContain("from('evaluation_requests')");
    expect(EDITOR).toMatch(/\.insert\(\{[^}]*status: 'queued'/s);
    expect(EDITOR).toMatch(/\.insert\(\{[^}]*run_id: runId/s);
  });

  it('saves through the function that resolves the editor from auth.uid()', () => {
    expect(EDITOR).toContain("rpc('edit_evaluation_draft'");
    // Never a direct write: the draft table revokes update from authenticated (0075).
    expect(EDITOR).not.toMatch(/from\('evaluation_drafts'\)[\s\S]{0,120}\.update\(/);
  });

  /* The worker is the other half, and it closes the row it claimed. */
  it('is drained by the worker, which records the job and not the verdict', () => {
    const loop = readFileSync('apps/worker/bin/worker.ts', 'utf8');
    expect(loop).toContain('claimNextEvaluation');
    expect(loop).toContain('finishEvaluation');
  });
});
