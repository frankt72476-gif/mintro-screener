/**
 * Three homes from one page, and the removals are the feature (D-229, D-230).
 *
 * Every assertion that matters here is an absence, and an absence has one honest test: the string
 * is **not in the markup**. A disabled control, a greyed item and a hidden one all look the same to
 * a reader glancing at a screenshot, and only one of them is what D-230 asks for.
 *
 * The org filter is the sharpest case. A greyed-out chip row still names the organisations, so a
 * partner who opened dev tools would read the client list off a control they cannot click.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NAV, visibleNav } from '../src/components/Rail.js';
import { NotAvailable } from '../src/components/NotAvailable.js';
import { Disclosure, PartnerEmptyState } from '../src/components/PartnerNotes.js';
import { RunFilterRow } from '../src/components/RunFilterRow.js';
import { PARTNER_DISCLOSURE, POSTURE, homeShape } from '../src/lib/homeShape.js';

/*
  The owner holds both capabilities by construction — `analysts_owner_holds_every_capability` (0060)
  makes an owner without one unrepresentable.

  The host member does NOT. Capabilities are a separate axis from visibility (D-229): a second
  Mintro person sees every organisation's work and holds whatever the owner has granted them and
  nothing more. `HOST` therefore carries them explicitly rather than inheriting them from being
  host, and `HOST_WITH_SUBMIT` is the one who can actually finish a partner's run.
*/
const OWNER = {
  role: 'owner' as const,
  isHost: true,
  canRunDocumentsCheck: true,
  canSubmitToIqwallet: true,
};
const HOST = {
  role: 'admin' as const,
  isHost: true,
  canRunDocumentsCheck: true,
  canSubmitToIqwallet: false,
};
const HOST_WITH_SUBMIT = { ...HOST, canSubmitToIqwallet: true };
const PARTNER = {
  role: 'admin' as const,
  isHost: false,
  canRunDocumentsCheck: false,
  canSubmitToIqwallet: false,
};
const PARTNER_WITH_DOCS = { ...PARTNER, canRunDocumentsCheck: true };
const PARTNER_WITH_SUBMIT = { ...PARTNER, canSubmitToIqwallet: true };

/*
  The nav is asserted through `visibleNav` rather than by rendering `Rail`: the component renders
  `SignOutButton`, which needs an `AuthProvider`, and the thing worth checking is which items
  survive rather than the chrome around them.
*/
const railLabels = (hide: readonly ('docs' | 'scan' | 'reports' | 'rules')[]): string =>
  JSON.stringify(visibleNav(hide));

describe('the three shapes', () => {
  it('gives the owner everything', () => {
    const shape = homeShape(OWNER);
    expect(shape).toMatchObject({
      seesEveryOrg: true,
      showsRunBy: true,
      showsOrgFilter: true,
      showsAdministration: true,
      showsDisclosure: false,
    });
  });

  it('gives a host member the owner’s view of the work and none of the controls', () => {
    // The single line separating Michael's home from Frank's (D-229).
    const shape = homeShape(HOST);
    expect(shape.seesEveryOrg).toBe(true);
    expect(shape.showsRunBy).toBe(true);
    expect(shape.showsOrgFilter).toBe(true);
    expect(shape.showsAdministration).toBe(false);
    expect(shape.showsDisclosure).toBe(false);
  });

  it('gives a partner their own work and no sign the others exist', () => {
    const shape = homeShape(PARTNER);
    expect(shape.seesEveryOrg).toBe(false);
    expect(shape.showsRunBy).toBe(false);
    expect(shape.showsOrgFilter).toBe(false);
    expect(shape.showsAdministration).toBe(false);
    expect(shape.showsDisclosure).toBe(true);
  });
});

describe('the Documents Check nav item', () => {
  it('is drawn for somebody who holds the capability', () => {
    expect(homeShape(PARTNER_WITH_DOCS).showsDocumentsTab).toBe(true);
    expect(railLabels([])).toContain('Documents check');
  });

  it('is ABSENT — not greyed — for somebody who does not', () => {
    expect(homeShape(PARTNER).showsDocumentsTab).toBe(false);
    const nav = railLabels(['docs']);
    expect(nav).not.toContain('Documents check');
    // And no trace of it: the pane is gone from the list, not present-and-marked.
    expect(nav).not.toContain('"docs"');
  });

  it('keeps Rule set for everyone, because a run’s version has to be readable', () => {
    expect(railLabels(['docs'])).toContain('Rule set');
  });

  it('drops a nav group that has nothing left in it', () => {
    // A heading with no items under it is a label for an absence.
    const nav = railLabels(['scan', 'docs']);
    expect(nav).not.toContain('Screening');
    expect(nav).toContain('Library');
  });

  it('has a NAV that actually contains the item, so the absence test is not vacuous', () => {
    expect(NAV.flatMap((g) => g.items).map((i) => i.pane)).toContain('docs');
  });
});

describe('the org filter', () => {
  it('names organisations when it renders', () => {
    const markup = renderToStaticMarkup(
      createElement(RunFilterRow, {
        chips: [{ orgId: 'pa', name: 'Partner A', runs: 2, suspended: false }],
        filter: { kind: 'everyone' },
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('Partner A');
    // Which is exactly why a partner must not be handed it, greyed or otherwise.
    expect(homeShape(PARTNER).showsOrgFilter).toBe(false);
  });
});

describe('the disclosure line', () => {
  it('names Mintro as the actor and no person', () => {
    const markup = renderToStaticMarkup(createElement(Disclosure, {}));
    expect(markup).toContain('Mintro');
    // No operator identity anywhere a non-owner reads (D-233), and this one is standing text.
    expect(markup).not.toMatch(/@/);
    expect(markup).not.toMatch(/Michael|Frank|Drew/i);
  });

  it('says nothing about other organisations existing', () => {
    // "every organisation on the account" invites the question this build exists to prevent.
    expect(PARTNER_DISCLOSURE).not.toMatch(/other|every organisation|all organisations|agencies/i);
    expect(PARTNER_DISCLOSURE).toContain('your organisation');
  });

  it('appears on the empty state, where there is no list to caption', () => {
    const markup = renderToStaticMarkup(createElement(PartnerEmptyState, {}));
    expect(markup).toContain(PARTNER_DISCLOSURE);
  });

  it('carries the posture sentence verbatim from the invitation', () => {
    const markup = renderToStaticMarkup(createElement(PartnerEmptyState, {}));
    expect(markup).toContain(POSTURE);
    expect(POSTURE).toBe(
      'Mintro reports what it observed; it does not underwrite the account or decide the outcome.',
    );
  });

  it('names the space rather than the absence', () => {
    const markup = renderToStaticMarkup(createElement(PartnerEmptyState, {}));
    expect(markup).toContain('Your screenings');
    expect(markup.toLowerCase()).not.toContain('no runs');
    expect(markup).toContain('New screen');
  });
});

describe('the not-available page', () => {
  const markup = renderToStaticMarkup(createElement(NotAvailable, {}));

  it('says the thing is not available rather than pretending it is missing', () => {
    // A 404 lies about something that plainly exists, and a reader who catches the lie stops
    // believing every other message the tool shows.
    expect(markup).toContain('isn’t available to you');
    expect(markup).not.toContain('404');
    expect(markup.toLowerCase()).not.toContain('not found');
  });

  it('echoes nothing about what sits behind the URL', () => {
    /*
      The leak the guard exists to prevent. A helpful "you cannot see Partner A's screening of
      shop.example" hands over both facts while apologising.
    */
    for (const leak of [
      'shop.example',
      'Partner A',
      'Partner B',
      'complete',
      'quarantine',
      'merchant',
      'organisation',
    ]) {
      expect(markup.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('carries no run state, which is the half a helpful message would leak', () => {
    // "Back to your runs" is about the reader's own; nothing here describes the thing behind the
    // URL. These are the words that would say something about it.
    for (const state of ['complete', 'failed', 'running', 'quarantin', 'finding', 'evidence']) {
      expect(markup.toLowerCase()).not.toContain(state);
    }
  });

  it('offers a way back to the one place they can certainly go', () => {
    expect(markup).toContain('Back to your runs');
  });
});
