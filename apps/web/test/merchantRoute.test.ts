/**
 * Nothing on the merchant route acts on Mintro's behalf (D-066).
 *
 * Found in first use: **"Send to IQwallet" was rendered on the merchant page.** It was inert — the
 * handler was `() => undefined` — but it was one refactor away from not being, and a merchant or
 * their agent could see a control that transmits their own screening report to an underwriter.
 *
 * The cause was the prop shape. `onSend` and `onDownload` were required, so the merchant view
 * satisfied them with no-ops, and satisfying a required prop rendered the button. Correctness
 * depended on what the handlers happened to do rather than on what the page was allowed to hold.
 *
 * They are now one optional `actions` group: omit it and no operator control exists. This test
 * pins the page against the source rather than against a rendering, because the assertion that
 * matters is *which props the merchant route passes* — and that is a statement about the file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const pane = readFileSync('apps/web/src/components/CommentPane.tsx', 'utf8');

describe('the merchant page holds no operator action', () => {
  it('passes no actions to the report', () => {
    // The whole fix in one line. If `actions` ever appears here, every operator control returns.
    expect(pane).not.toMatch(/\bactions\s*=/);
  });

  it('passes no handler that could become one', () => {
    /*
      The no-op handlers are what made this possible, so their *shape* is refused rather than the
      specific names. A page that renders a button because a prop was satisfiable is a page whose
      safety depends on the handler's body — and bodies change.
    */
    expect(pane).not.toMatch(/on(Send|Download|Invite)\s*=/);
  });

  it('still renders the report and the comment boxes', () => {
    // The route must not be made safe by rendering nothing. It exists so a merchant can respond
    // while looking at the evidence (D-063).
    expect(pane).toContain('<ReportView');
    expect(pane).toContain('commentBox=');
  });

  it('does not narrate the reader back at themselves', () => {
    /*
      `MerchantResponse` is written for an underwriter — it explains what a blank space means.
      On this page it would tell the reader, finding by finding, that they left no comment on it
      (D-067). The page's one rule is never to imply that saying nothing is a failure.

      Asserted on the prop rather than on the rendering, because passing `commentaryOf` is exactly
      what would bring it back.
    */
    expect(pane).not.toMatch(/commentaryOf=\{/);
  });
});

describe('the exported document holds none either', () => {
  it('passes no actions from the print paths', () => {
    // Both print paths also satisfied the required props with no-ops. A PDF cannot have buttons,
    // so nothing was visible — but the same shape produced both defects, and only one was visible.
    const app = readFileSync('apps/web/src/App.tsx', 'utf8');
    const printBlocks = app.match(/<ReportView[^>]*\bprint\b[\s\S]{0,400}?\/>/g) ?? [];

    expect(printBlocks.length).toBeGreaterThan(0);
    for (const block of printBlocks) {
      expect(block, block).not.toMatch(/\bactions\s*=|on(Send|Download|Invite)\s*=/);
    }
  });
});
