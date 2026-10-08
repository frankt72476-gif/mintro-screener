/**
 * The refusal banner says what the way forward is, and offers nothing that cannot help (D-291).
 *
 * Run dd48f232 (app.thepeptide.com) was refused as `run_did_not_see_storefront`, and the banner
 * said "It can be repaired here, or generated again" beside a Regenerate button. There was no draft
 * to repair, and regenerating reads the same run and is refused the same way. For that run a
 * re-screen cannot help either: every request was sent to `/login`, and a new run meets the same page.
 *
 * Rendered, not read from the source (D-246). Asserted for presence as well as absence.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefusedNotice } from '../src/components/EvaluationEditor.js';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const render = (status: string, message: string | null, cause: string | null): string =>
  renderToStaticMarkup(
    createElement(RefusedNotice, {
      status,
      message,
      cause,
      // An editor: the one viewer who was offered Regenerate.
      onRegenerate: () => undefined,
      regenerating: false,
    }),
  );

const SIGN_IN =
  'This run did not see the storefront: most of the pages it requested anonymously ended at the ' +
  'sign-in page https://app.thepeptide.com/login. No prompt was sent. A login is on file for this merchant, ' +
  'and the screener has no sign-in method for this site, so no sign-in was attempted.';

const COLLAPSE =
  'This run did not see the storefront: one text accounted for 28 of the 30 pages selected. ' +
  'No prompt was sent.';

describe('a run that did not see the storefront, behind a sign-in wall', () => {
  const markup = render('run_did_not_see_storefront', SIGN_IN, 'sign_in_wall');

  it('shows the cause message', () => {
    expect(text(markup)).toContain('ended at the sign-in page https://app.thepeptide.com/login');
    expect(text(markup)).toContain('no sign-in method for this site');
  });

  it('offers no repair, no Regenerate and no Re-screen', () => {
    expect(text(markup)).not.toContain('repaired here');
    expect(text(markup)).not.toContain('generated again');
    expect(markup).not.toContain('<button');
    expect(text(markup)).not.toContain('Regenerate');
    expect(text(markup)).not.toMatch(/re-screen/i);
  });
});

/*
  The merchant's consent gate and bot protection are each met again by a re-screen, and their
  messages say so. The banner agrees with them: the message, and no prompt to do what cannot help.
*/
const GATE =
  "This run did not see the storefront: the merchant's own consent gate stands in front of 16 of " +
  'the pages it rendered, and Mintro does not attest through it on a visitor’s behalf. No prompt ' +
  'was sent. Nothing here is a shortfall of the merchant’s, and re-scanning will meet the same gate.';

const CHALLENGE =
  "This run did not see the storefront: the site's bot protection answered 21 of the pages it " +
  'rendered. No prompt was sent. Re-scanning from the same place will meet the same challenge, so a ' +
  're-scan is not the repair.';

describe.each([
  ['consent_gate', GATE, 'consent gate stands in front of 16'],
  ['bot_challenge', CHALLENGE, 'bot protection answered 21'],
])('a run that did not see the storefront, with cause %s', (cause, message, quoted) => {
  const markup = render('run_did_not_see_storefront', message, cause);

  it('shows the cause message', () => {
    expect(text(markup)).toContain(quoted);
  });

  it('offers no repair, no Regenerate and no Re-screen prompt', () => {
    expect(text(markup)).not.toContain('repaired here');
    expect(markup).not.toContain('<button');
    expect(text(markup)).not.toContain('Regenerate');
    expect(text(markup)).not.toContain('Re-screen the merchant');
  });
});

describe('a run that did not see the storefront, for any other reason', () => {
  const markup = render('run_did_not_see_storefront', COLLAPSE, null);

  it('shows the message and points to Re-screen', () => {
    expect(text(markup)).toContain('one text accounted for 28 of the 30 pages');
    expect(text(markup)).toContain('Re-screen the merchant to produce a new run');
  });

  it('offers no repair and no Regenerate', () => {
    expect(text(markup)).not.toContain('repaired here');
    expect(markup).not.toContain('<button');
    expect(text(markup)).not.toContain('Regenerate');
  });
});

describe('every other refusal is unchanged', () => {
  const markup = render('rejected', 'section 3 cites f-999, which is not a finding of this run', null);

  it('still offers the repair and Regenerate', () => {
    expect(text(markup)).toContain('This draft was stored as rejected');
    expect(text(markup)).toContain('It can be repaired here, or generated again');
    expect(markup).toContain('<button');
    expect(text(markup)).toContain('Regenerate');
  });
});
