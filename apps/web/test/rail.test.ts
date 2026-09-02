/**
 * The left nav.
 *
 * One assertion that matters: **Rule set goes to the rule set page.** It was a dead link back to
 * the scan pane, which is worse than an inert one — a nav item that navigates somewhere unrelated
 * reads as a bug in whatever the reader was doing, not as an unfinished feature.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

/*
  The rail renders the sign-out button, which reads the auth context. This file is about where the
  nav items go, so the button is stubbed rather than the test being wrapped in a provider — a
  provider here would be testing auth wiring under a name that says nav.
*/
vi.mock('../src/components/SignIn.js', () => ({ SignOutButton: () => null }));

import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ADMIN_LINKS, NAV, Rail, visibleAdminLinks, type Pane } from '../src/components/Rail.js';
import { homeShape } from '../src/lib/homeShape.js';
import { parseRuleset } from '@mintro/ruleset';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));

const html = (pane: Pane = 'scan', showsAdministration = false): string =>
  renderToStaticMarkup(
    createElement(Rail, {
      pane,
      onPane: () => undefined,
      ruleset: RULESET,
      analystEmail: 'a@example.com',
      showsAdministration,
    }),
  );

describe('every nav item goes where it says', () => {
  /*
    The assertion a static render could not make until the destination became data.

    "Rule set" used to call `onPane('scan')` — a label over an unrelated destination, invisible to
    every test because the target lived inside a closure. `data-pane` puts it in the markup.
  */
  it('sends Rule set to the rule set pane and nowhere else', () => {
    const markup = html();
    const item = /<button[^>]*data-pane="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*Rule set/.exec(markup);
    expect(item?.[1]).toBe('rules');
  });

  it('has one destination per label, and no two labels share one', () => {
    const panes = NAV.flatMap((g) => g.items.map((i) => i.pane));
    expect(new Set(panes).size).toBe(panes.length);
    expect(panes).toEqual(['scan', 'docs', 'reports', 'rules']);
  });

  it('renders a button for every entry in the data', () => {
    const markup = html();
    for (const group of NAV) {
      for (const item of group.items) {
        expect(markup, `missing ${item.label}`).toContain(`data-pane="${item.pane}"`);
      }
    }
  });

  it('offers the four panes', () => {
    const markup = html();
    for (const label of ['Site check', 'Documents check', 'Past reports', 'Rule set']) {
      expect(markup, `missing ${label}`).toContain(label);
    }
  });

  it('marks Rule set as current when that pane is open', () => {
    // The behavioural half of "it is a real destination": a dead link can never be current.
    const markup = html('rules');
    const item = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Rule set[\s\S]*?<\/button>/.exec(markup)?.[0] ?? '';
    expect(item).toContain('aria-current="true"');
  });

  it('does not mark it current when another pane is open', () => {
    const item = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Rule set[\s\S]*?<\/button>/.exec(html('scan'))?.[0] ?? '';
    expect(item).not.toContain('aria-current');
  });

  it('reads the rule set version and count from the loaded file', () => {
    const markup = html();
    expect(markup).toContain(`v${RULESET.version}`);
    expect(markup).toContain(`${RULESET.rules.length} rules`);
  });

  it('carries no SOON pill on Documents check', () => {
    expect(html()).not.toContain('SOON');
  });
});

/**
 * People and the access log (D-229).
 *
 * ## The defect this exists for
 *
 * The routes were built in Stage 3 and guarded correctly. `homeShape.showsAdministration` was
 * computed in Stage 4, documented, and asserted true for the owner in three tests. **No component
 * ever read it.** So the owner's own screens shipped reachable only by typing `/people` into the
 * address bar, and every check was green — the flag was right, the guard was right, the route was
 * right, and nothing joined them.
 *
 * `reachability.test.ts` could not catch it: `homeShape.ts` is imported, so the module is reachable.
 * `bundledControls.test.ts` could not either: `PeoplePane` is imported by `App`, so the string
 * "People" is in the bundle. The unreachable thing was one granularity finer than either guard —
 * an exported *field* with no consumer.
 *
 * So the assertions below are on **rendered markup**, and the presence half matters more than the
 * absence half. Stage 4 tested every absence and no presence, which is the shape of a check that
 * passes over nothing at all.
 */
describe('the owner’s screens are reachable from the rail', () => {
  it('renders People and Access log as real links for the owner', () => {
    const markup = html('scan', true);

    for (const link of ADMIN_LINKS) {
      expect(markup, `${link.label} is not in the markup`).toContain(link.label);
      // A real destination in the markup, not a handler hidden in a closure — the same reason the
      // nav carries `data-pane`.
      expect(markup, `${link.label} has no href`).toContain(`href="${link.href}"`);
    }
  });

  it('is ABSENT — not greyed — for a host member and for a partner', () => {
    const markup = html('scan', false);
    for (const link of ADMIN_LINKS) {
      expect(markup).not.toContain(link.label);
      expect(markup).not.toContain(`href="${link.href}"`);
    }
    // And no trace of the account area having had something removed from it.
    expect(markup).not.toContain('rail-admin');
  });

  it('joins homeShape to the markup, which is the join that was missing', () => {
    /*
      The assertion that would have failed before the fix. It runs the real viewer through the real
      `homeShape` and into the real component, so a future change that drops the prop, or renames
      the field, or stops passing it, breaks here rather than in production.
    */
    const owner = homeShape({
      role: 'owner',
      isHost: true,
      canRunDocumentsCheck: true,
      canSubmitToIqwallet: true,
    });
    expect(html('scan', owner.showsAdministration)).toContain('href="/people"');

    const hostMember = homeShape({
      role: 'admin',
      isHost: true,
      canRunDocumentsCheck: true,
      canSubmitToIqwallet: true,
    });
    expect(html('scan', hostMember.showsAdministration)).not.toContain('href="/people"');
  });

  it('sends each link to the route App actually resolves', () => {
    // `App` reads `window.location.pathname` with trailing slashes stripped and compares against
    // these two literals. A link to `/People` or `/access_log` would render, click, and land on the
    // screener with no explanation.
    expect(visibleAdminLinks(true).map((l) => l.href)).toEqual(['/people', '/access-log']);
  });

  it('gives nobody a half-set', () => {
    // Both or neither. The access log is owner-only on the same terms People is, so a rail showing
    // one and not the other would be describing a permission that does not exist.
    expect(visibleAdminLinks(true)).toHaveLength(ADMIN_LINKS.length);
    expect(visibleAdminLinks(false)).toHaveLength(0);
  });
});
