/**
 * Who sees run attribution, asserted by rendering (D-229).
 *
 * ## The defect this exists for
 *
 * `homeShape.showsRunBy` was computed correctly — false for a partner — and read by nothing.
 * `DomainGroups` drew the Run by column whenever `analysts_select` handed back a name, which for a
 * partner is their own colleagues. So partners saw run attribution, `homeShape` said they did not,
 * and both were green. Nobody chose the behaviour that shipped; it was what an unconsumed field
 * leaves behind.
 *
 * The ruling is that attribution visibility is a **named decision** and not an emergent property of
 * RLS: the boundary the database draws says which names *can* resolve, and `homeShape` says which
 * readers get the column at all. Two different questions, and the second had no answer in the code.
 *
 * ## Why these assertions are on markup
 *
 * Because the last version of this was on the pure function, and passed. A flag is a fact about an
 * object; a column is a fact about a screen. Only one of them is what a partner sees.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PastReports } from '../src/components/PastReports.js';
import { DomainGroups } from '../src/components/DomainGroups.js';
import { groupByDomain } from '../src/lib/domainGroups.js';
import { homeShape } from '../src/lib/homeShape.js';
import type { RunSummary } from '../src/lib/runs.js';

const OWNER = { role: 'owner' as const, isHost: true, canRunDocumentsCheck: true, canSubmitToIqwallet: true };
const HOST = { role: 'admin' as const, isHost: true, canRunDocumentsCheck: true, canSubmitToIqwallet: true };
const PARTNER = { role: 'admin' as const, isHost: false, canRunDocumentsCheck: false, canSubmitToIqwallet: false };

/**
 * A run whose creator's name DID resolve.
 *
 * This is the case that matters. A partner reading their own organisation's run gets a colleague's
 * name back from `analysts_select` — the read succeeds, the boundary is working, and the question is
 * whether the column is drawn anyway. A fixture with `runBy` absent would pass whatever the gate did.
 */
const RUN: RunSummary = {
  runId: 'run-1',
  domain: 'shop.example',
  finishedAt: '2026-09-02T12:00:00.000Z',
  counts: { fail: 0, review: 1 },
  quarantine: null,
  responded: false,
  awaitingReview: false,
  runBy: 'A Colleague',
};

const library = (viewer: typeof PARTNER | typeof OWNER | typeof HOST): string => {
  const shape = homeShape(viewer);
  return renderToStaticMarkup(
    createElement(PastReports, {
      listing: { ok: true, runs: [RUN], unreadable: 0 },
      source: 'Supabase',
      onOpen: () => {},
      showsRunBy: shape.showsRunBy,
      /*
        `onFilter` as well as `viewer`, because `PastReports` draws the filter row only when it has
        somewhere to send a change — a row that cannot be clicked is not a filter. The same pair
        `App` passes.
      */
      ...(shape.showsOrgFilter
        ? {
            viewer: { id: 'me', seesEveryOrg: shape.showsOrgFilter },
            filter: { kind: 'everyone' },
            onFilter: () => {},
          }
        : { showsDisclosure: shape.showsDisclosure }),
    } as never),
  );
};

describe('the fixture is sound', () => {
  it('carries a resolved name, so an absent column is a decision and not an empty read', () => {
    // The vacuous pass this project keeps catching: a column missing because there was nothing to
    // put in it proves nothing about who is allowed to see it.
    expect(RUN.runBy).toBe('A Colleague');
    expect(library(OWNER)).toContain('A Colleague');
  });
});

describe('a partner home shows no run attribution', () => {
  const markup = library(PARTNER);

  it('does not render the colleague’s name', () => {
    expect(markup).not.toContain('A Colleague');
  });

  it('does not render the column at all — absent, not emptied', () => {
    // `drun-by` is the span itself. An empty one would still be a column, and a stylesheet or a
    // dev-tools reader would find the shape of what had been taken out.
    expect(markup).not.toContain('drun-by');
  });

  it('still renders the run, so the absence is the column and not the row', () => {
    expect(markup).toContain('shop.example');
    expect(markup).toContain('0 not met');
  });

  it('shows no org filter either, and no chip naming an organisation', () => {
    expect(markup).not.toContain('runfilter');
  });
});

describe('an owner home shows both', () => {
  const markup = library(OWNER);

  it('renders the Run by column with the name in it', () => {
    expect(markup).toContain('drun-by');
    expect(markup).toContain('A Colleague');
  });

  it('renders the org filter row', () => {
    expect(markup).toContain('runfilter');
  });
});

describe('a host member gets attribution, because they see every organisation’s work', () => {
  it('renders the column', () => {
    // Attribution follows `seesEveryOrg`, not the owner-only administration axis (D-229). A host
    // member has the owner's view of the work.
    expect(homeShape(HOST).showsRunBy).toBe(true);
    expect(library(HOST)).toContain('drun-by');
  });
});

describe('the scan form’s recent strip obeys the same ruling', () => {
  /*
    The same `DomainGroups` in a second place. A list that disagreed with the library about who sees
    attribution would be the harder half of this defect to find — the reader would see a name on the
    home screen and not in the library and have no way to tell which was right.
  */
  const strip = (showsRunBy: boolean): string =>
    renderToStaticMarkup(
      createElement(DomainGroups, {
        groups: groupByDomain([RUN]),
        onOpen: () => {},
        startOpen: true,
        showsRunBy,
      } as never),
    );

  it('draws the name for a viewer who gets attribution', () => {
    expect(strip(homeShape(OWNER).showsRunBy)).toContain('A Colleague');
  });

  it('draws nothing for a partner', () => {
    expect(strip(homeShape(PARTNER).showsRunBy)).not.toContain('A Colleague');
    expect(strip(homeShape(PARTNER).showsRunBy)).not.toContain('drun-by');
  });
});
