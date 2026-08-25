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
import { NAV, Rail, type Pane } from '../src/components/Rail.js';
import { parseRuleset } from '@mintro/ruleset';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));

const html = (pane: Pane = 'scan'): string =>
  renderToStaticMarkup(
    createElement(Rail, { pane, onPane: () => undefined, ruleset: RULESET, analystEmail: 'a@example.com' }),
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
