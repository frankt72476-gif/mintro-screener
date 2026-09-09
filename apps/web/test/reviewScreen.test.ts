/**
 * What the run review screen mounts, and what it stopped mounting (D-262).
 *
 * ## Why this file exists
 *
 * Unmounting `ReportView` from the review screen broke **nothing**. The whole suite passed on the
 * commit that did it. Every test the architecture memo listed as locking the old layout —
 * `counting`, `numbering`, `sections`, `solicitation`, `respondZone` — renders `ReportView`
 * directly, so all of them kept passing over a component the screen no longer draws.
 *
 * That is the orphan shape D-246 names, pointing the other way: not a flag nothing renders, but a
 * removal nothing asserts. A later edit putting `ReportView` back on this screen, or restoring the
 * invite button, would be green.
 *
 * ## Read from the source, not rendered
 *
 * `App.tsx` is the whole application — a router, a session, five panes and a dozen dialogs — and
 * rendering it here would mean standing up a Supabase client and an auth provider to ask a question
 * about composition. The composition is in the file. What could go wrong is a component being
 * mounted again, and that is a line of JSX.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'apps', 'web', 'src');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');

/** The `stage === 'report'` branch: everything the review screen draws. */
const REVIEW = (() => {
  const at = APP.indexOf("{stage === 'report' && report !== null && (");
  expect(at, "the review screen's branch has moved").toBeGreaterThan(-1);
  // To the start of the next top-level block, which is the send dialog.
  const end = APP.indexOf('{sending && report !== null && (', at);
  expect(end, 'the send dialog has moved').toBeGreaterThan(at);
  /*
    Comments removed.

    They name the components they explain the absence of — "no `onInvite`", "`ReportView` is not
    mounted here" — so a scan over the raw text finds every word it is looking for in the prose
    saying that word is gone. The same correction the migration revoke scan and the CSS selector
    scan both needed: read the code, not the commentary on it.
  */
  return APP.slice(at, end)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
})();

describe('the evaluation is the report on the review screen', () => {
  it('mounts the evaluation and the run controls', () => {
    expect(REVIEW).toContain('<EvaluationEditor');
    expect(REVIEW).toContain('<RunActions');
  });

  /*
    The checklist is not drawn here.

    It is not deleted — the capture route still renders it — so this asserts the mount and not the
    file. `ReportView` existing is fine; `ReportView` on this screen is the thing D-256 decided
    against, because two documents saying the same thing in two vocabularies is one document too
    many and the reader has to work out which is which.
  */
  it('does not mount the checklist report', () => {
    expect(REVIEW).not.toContain('<ReportView');
  });

  it('keeps the checklist component, because the capture still renders it', () => {
    expect(() => readFileSync(join(SRC, 'components', 'ReportView.tsx'), 'utf8')).not.toThrow();
    expect(APP).toContain('<ReportView');
  });

  /*
    The five the memo lists as dormant.

    All five reach an analyst only through `ReportView`, which is why unmounting one component
    stopped all five. Asserted by name anyway: a later commit mounting `EyeTestPanel` directly on
    this screen would satisfy "no ReportView" and undo the ruling.
  */
  it.each([
    'AttestationSection',
    'AttestationForm',
    'EyeTestPanel',
    'MerchantResponse',
    'ParticipationRecord',
  ])('does not mount %s', (component) => {
    expect(REVIEW).not.toContain(`<${component}`);
    expect(APP, `${component} is still imported by the analyst surface`).not.toMatch(
      new RegExp(`import[^;]*\\b${component}\\b[^;]*;`),
    );
  });

  /*
    `CommentPane` is the exception, and it is not on this screen.

    It is the merchant's own page, reached with a link token. `MerchantRoute` stays routable — a
    link already sent still opens — so the import stays and the assertion is about where it mounts.
  */
  it('keeps CommentPane on the merchant route and off the review screen', () => {
    expect(APP).toContain('<CommentPane');
    expect(REVIEW).not.toContain('<CommentPane');
  });

  /*
    The invitation flow leaves the analyst surface with the checklist (layout memo).

    The dialog and its queue stay in the tree; what goes is the way in. A dialog with no control to
    open it is dead weight pretending to be a feature.
  */
  it('offers no way to invite a merchant response', () => {
    expect(REVIEW).not.toContain('onInvite');
    expect(APP).not.toContain('<InviteModal');
    expect(APP).not.toContain('setInviting');
  });

  it('keeps the invitation code, which is a later decision to remove', () => {
    const components = readdirSync(join(SRC, 'components'));
    for (const file of ['Attestations.tsx', 'CommentPane.tsx', 'MerchantResponse.tsx', 'Participation.tsx']) {
      expect(components, `${file} was deleted rather than left dormant`).toContain(file);
    }
  });
});

describe('the preview route is gone', () => {
  /*
    `/evaluation-preview` existed so the rendering could be looked at against real drafts while the
    operator surface was built. The operator surface is the review screen now, so the temporary
    path is a second way to reach the same document — and the one nobody would remember to update.
  */
  it('has no route, no component and no matcher', () => {
    expect(APP).not.toContain('evaluation-preview');
    expect(APP).not.toContain('EvaluationPreview');
    expect(() => readFileSync(join(SRC, 'components', 'EvaluationPreview.tsx'), 'utf8')).toThrow();
    expect(() => readFileSync(join(SRC, 'lib', 'evaluationRoute.ts'), 'utf8')).toThrow();
  });
});

describe('a run with no evaluation says so', () => {
  const EDITOR = readFileSync(join(SRC, 'components', 'EvaluationEditor.tsx'), 'utf8');

  /*
    It returned null while `ReportView` filled the screen behind it. Nothing fills it now, so a
    finished but unevaluated run would render an empty page — a reader with no way to tell that
    from a broken one.
  */
  it('offers a Generate button in place of the document', () => {
    expect(EDITOR).toContain('No evaluation drafted yet');
    expect(EDITOR).toContain('Generate');
    expect(EDITOR).toContain('eval-empty');
  });

  it('queues the same job Regenerate does, rather than a second path', () => {
    expect([...EDITOR.matchAll(/from\('evaluation_requests'\)/g)]).toHaveLength(1);
  });
});
