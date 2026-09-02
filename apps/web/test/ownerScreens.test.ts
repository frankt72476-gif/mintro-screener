/**
 * What the owner's screens must and must not render.
 *
 * `People` and `AccessLog` are written as pure components taking rows, so the conditions the
 * mockup states can be asserted over the markup rather than checked by eye. That shape is the
 * reason the tests exist at all: there is no DOM environment here, and a container that fetched
 * its own rows could not be rendered by `renderToStaticMarkup`.
 *
 * The load-bearing one is the last block. `bind_refused` carries the address an invitation was
 * scoped to and never the address that opened the link (D-239), and this page is where the owner
 * reads it — so it is where the decision would be undone by a well-meant join back to an email.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PeopleTable, PersonRow } from '../src/components/People.js';
import { AccessLogTable } from '../src/components/AccessLog.js';
import type { RosterEntry } from '../src/lib/people.js';
import type { AccessLogEntry } from '../src/lib/accessLog.js';

const person = (over: Partial<RosterEntry> = {}): RosterEntry => ({
  id: 'p1',
  name: 'Partner One',
  email: 'one@partnera.test',
  orgId: 'o1',
  orgName: 'Partner A',
  role: 'admin',
  status: 'active',
  canRunDocumentsCheck: false,
  canSubmitToIqwallet: false,
  runCount: 4,
  ...over,
});

const markup = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element);

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

describe('People', () => {
  it('shows the person, their organisation, role and run count', () => {
    const html = markup(createElement(PeopleTable, { roster: [person()] }));
    const body = text(html);
    expect(body).toContain('Partner One');
    expect(body).toContain('one@partnera.test');
    expect(body).toContain('Partner A');
    expect(body).toContain('Admin');
    expect(body).toContain('4');
  });

  it('states the owner’s capabilities rather than offering a toggle', () => {
    /*
      `analysts_owner_holds_every_capability` (0060) makes an owner without a capability
      unrepresentable, so a switch here could not move. A disabled control invites a click and then
      explains nothing.
    */
    const html = markup(
      createElement(PersonRow, {
        person: person({ role: 'owner', canRunDocumentsCheck: true, canSubmitToIqwallet: true }),
      }),
    );
    expect(text(html)).toContain('Always on');
    expect(html).not.toContain('type="checkbox"');
  });

  it('offers a toggle for everybody who is not the owner', () => {
    const html = markup(createElement(PersonRow, { person: person() }));
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });

  it('greys a suspended row, keeps the count, and says who can still see the work', () => {
    // D-232: suspension removes access and retains all work.
    const html = markup(createElement(PersonRow, { person: person({ status: 'suspended', runCount: 7 }) }));
    expect(html).toContain('people-suspended');
    expect(text(html)).toContain('7 runs still visible to you');
  });

  it('says “run” rather than “runs” for one', () => {
    const html = markup(createElement(PersonRow, { person: person({ status: 'suspended', runCount: 1 }) }));
    expect(text(html)).toContain('1 run still visible to you');
  });

  it('offers no delete, anywhere, for anyone', () => {
    // D-097: removing a person orphans their runs. The menu has three items and none of them is this.
    for (const status of ['invited', 'active', 'suspended'] as const) {
      const html = markup(createElement(PeopleTable, { roster: [person({ status })] }));
      expect(html.toLowerCase()).not.toContain('delete');
      expect(html.toLowerCase()).not.toContain('remove');
    }
  });

  it('gives the owner’s row no overflow menu at all', () => {
    const html = markup(createElement(PersonRow, { person: person({ role: 'owner' }) }));
    expect(html).not.toContain('people-menu');
  });
});

const entry = (over: Partial<AccessLogEntry> = {}): AccessLogEntry => ({
  id: 1,
  action: 'invited',
  createdAt: '2026-09-02T14:15:46.000Z',
  valueAfter: null,
  ...over,
});

describe('the access log page', () => {
  it('renders every action in words', () => {
    const actions = [
      'invited',
      'invite_resent',
      'activated',
      'bind_refused',
      'granted_documents_check',
      'revoked_documents_check',
      'granted_iqwallet_submit',
      'revoked_iqwallet_submit',
      'suspended',
      'reinstated',
      'replies_rerouted',
    ];
    const html = markup(
      createElement(AccessLogTable, {
        entries: actions.map((action, i) => entry({ id: i, action })),
      }),
    );
    const body = text(html);
    // Every action reads as a sentence, not as a slug.
    for (const action of actions) expect(body).not.toContain(action);
    expect(body).toContain('Account opened');
    expect(body).toContain('IQwallet submit granted');
  });

  it('renders a bind_refused row with the address it was SCOPED to', () => {
    const html = markup(
      createElement(AccessLogTable, {
        entries: [
          entry({
            action: 'bind_refused',
            valueAfter: { scopedTo: 'scoped-to@partnera.test', reason: 'address mismatch' },
          }),
        ],
      }),
    );
    const body = text(html);
    expect(body).toContain('Invitation refused');
    expect(body).toContain('scoped-to@partnera.test');
  });

  it('renders no address other than the scoped-to one, even if the row carried one', () => {
    /*
      The half that is an absence (D-239).

      A row should never carry the forwarded address — `bind_invited_analyst` reads it, compares it
      and discards it. This asserts the page would not print one *even if a future write put it
      there*, which is the failure this page could introduce on its own: the guarantee has to hold
      at the render as well as at the write.
    */
    const html = markup(
      createElement(AccessLogTable, {
        entries: [
          entry({
            action: 'bind_refused',
            valueAfter: {
              scopedTo: 'scoped-to@partnera.test',
              reason: 'address mismatch',
              attemptedBy: 'third-party@elsewhere.test',
            },
          }),
        ],
      }),
    );
    expect(html).toContain('scoped-to@partnera.test');
    expect(html).not.toContain('third-party@elsewhere.test');
    expect(html).not.toContain('elsewhere.test');
  });

  it('reconstructs nothing: the actor and subject ids are never rendered', () => {
    // The page is handed no ids to render — `readAccessLog` does not select them — and this holds
    // the component to the same rule, so a widened query cannot quietly start printing them.
    const html = markup(
      createElement(AccessLogTable, {
        entries: [entry({ action: 'activated' })],
      }),
    );
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('says so plainly when nothing has happened', () => {
    const html = markup(createElement(AccessLogTable, { entries: [] }));
    expect(text(html)).toContain('Nothing has changed on this account yet');
  });
});
