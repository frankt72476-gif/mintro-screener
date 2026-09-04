/**
 * Nothing the operator's send dialog contributes may claim an attachment.
 *
 * ## The defect this was written for
 *
 * D-255 replaced the attached PDF with a link, and the worker's half of the email was changed to
 * say so. The dialog was not. It defaulted the note to *"… Captures attached."* and drew a row
 * showing a pending `.pdf` filename.
 *
 * The row was cosmetic. **The note was not.** It is stored on the `send_requests` row, read by the
 * worker, and placed *first in the email body*, immediately above the line stating the report is a
 * link — so a send would have delivered a message contradicting itself, in the analyst's voice, to
 * IQwallet.
 *
 * ## Why the audit that missed it was not enough
 *
 * When the attachment came out of `send.ts`, every caller of the PDF render was checked, and that
 * check was correct: no delivery path renders a PDF. But **the email has two authors**. Grepping
 * for the code that *makes* an attachment cannot find copy that *claims* one, and the conclusion
 * was reported as "no path does this" when it was really "no path in the set I searched does this".
 *
 * So this audits the other author. It reads source rather than behaviour, because the string that
 * caused the problem was a default value in a component that no test rendered.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sendModal = readFileSync('apps/web/src/components/SendModal.tsx', 'utf8');

/** Everything in this file is stripped of comments first: prose about the defect is not the defect. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/**
 * Claims a file is travelling with the message.
 *
 * Deliberately narrow. "No worker attached" elsewhere in the app is about a machine, and a guard
 * that flagged it would be turned off.
 */
const ATTACHMENT_CLAIMS = [
  'attached',
  'attachment',
  'Captures attached',
  '.pdf',
  'PDF',
];

describe('the send dialog composes no attachment claim', () => {
  const source = code(sendModal);

  it.each(ATTACHMENT_CLAIMS)('does not say %s', (claim) => {
    expect(source.toLowerCase()).not.toContain(claim.toLowerCase());
  });

  it('defaults the note to empty, because the note lands in the email body', () => {
    /*
      A default is sent; a placeholder is not. The distinction is the whole finding: whatever this
      state initialises to travels to IQwallet above a link, so it has to be something that is
      still true there. Nothing is.
    */
    expect(source).toContain("useState('')");
    expect(source).toContain('placeholder=');
  });

  it('draws no attachment row', () => {
    // It showed a filename and a "pending" status for a file the send will not produce.
    expect(source).not.toContain('className="attach"');
    expect(source).not.toContain('fsize');
  });
});

describe('the Documents Check dialog is left alone', () => {
  /*
    The control, and it matters. The rule is not "the word attachment is banned": the Documents
    Check report is a different artifact and is genuinely sent as a file, so its dialog says so
    correctly. A guard that failed this one would be a guard that had learned the wrong rule.
  */
  const documents = code(readFileSync('apps/web/src/components/DocumentsSendModal.tsx', 'utf8'));

  it('still shows its attachment, because that send really carries one', () => {
    expect(documents).toContain('className="attach"');
  });
});
