/**
 * The sidebar rail.
 *
 * Ported from the demo, with one substitution required by D-007: the demo drew a CSS placeholder
 * mark. The supplied lockup carries its own violet tile which sits very close to the rail's
 * violet and reads as a mismatched rectangle, so the rail uses the alpha-masked **glyph** beside
 * white wordmark text. The tiled lockup is correct on white — the PDF header and the Resend
 * email — and nowhere else.
 */

import type { Ruleset } from '@mintro/ruleset';
import { SignOutButton } from './SignIn.js';

/** Panes the rail can reach. `reports` is the run library the dropdown used to stand in for. */
export type Pane = 'scan' | 'docs' | 'reports' | 'rules';

/**
 * The nav, as data.
 *
 * It was four near-identical button blocks, and **the destination lived inside a closure** — so
 * `onPane('scan')` sitting under a label saying "Rule set" was invisible to a static render and to
 * every test. That is exactly the state this nav was in: a dead link back to the scan pane, which
 * reads as a bug in whatever the reader was doing rather than as an unfinished feature.
 *
 * As data the destination is assertable, and `data-pane` puts it in the markup where a test can see
 * it without a DOM.
 */
export const NAV: readonly {
  readonly label: string;
  readonly items: readonly { readonly pane: Pane; readonly label: string; readonly icon: string }[];
}[] = [
  {
    label: 'Screening',
    items: [
      { pane: 'scan', label: 'Site check', icon: '\u25CE' },
      { pane: 'docs', label: 'Documents check', icon: '\u25A4' },
    ],
  },
  {
    label: 'Library',
    items: [
      // The run library (D-047), and the only way to reach an old report.
      { pane: 'reports', label: 'Past reports', icon: '\u26C1' },
      { pane: 'rules', label: 'Rule set', icon: '\u2699' },
    ],
  },
];

/**
 * The nav a viewer actually gets (D-230).
 *
 * Pure, and separate from the component, because `Rail` renders `SignOutButton` and therefore needs
 * an `AuthProvider`. The thing worth asserting is not the chrome but which items survive. A group
 * left with nothing in it is dropped rather than rendered as a heading over an absence.
 *
 * **Assert the rendered markup as well as this.** Testing only the pure function is what let the
 * administration links ship unreachable: `homeShape.showsAdministration` was computed, documented
 * and asserted true for the owner, and no component read it. A pure function whose output nothing
 * renders is a fact about an object, not about a screen.
 */
export function visibleNav(hidePanes: readonly Pane[] = []): typeof NAV {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !hidePanes.includes(item.pane)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The owner's two screens, as data (D-229).
 *
 * Whole routes rather than panes — `/people` and `/access-log` are read from
 * `window.location.pathname` in `App`, above `Screener`, because they are screens rather than panes
 * inside one. So these are real `href`s and a real navigation, not `onPane` calls.
 *
 * As data for the reason `NAV` is: a destination that lives inside a closure is invisible to a
 * static render and to every test, which is exactly the state the nav was in when it had a dead
 * link back to the scan pane.
 */
export const ADMIN_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/people', label: 'People' },
  { href: '/access-log', label: 'Access log' },
];

/**
 * The administration links this viewer gets — all of them, or none.
 *
 * Administration is owner-only, not host-member (D-229): a second Mintro person has the owner's view
 * of the work and none of the owner's controls. Absent, not disabled — a greyed *People* would tell
 * a host member that a roster screen exists and that they are shut out of it.
 */
export function visibleAdminLinks(showsAdministration: boolean): typeof ADMIN_LINKS {
  return showsAdministration ? ADMIN_LINKS : [];
}

interface Props {
  readonly pane: Pane;
  /**
   * Panes this viewer has no item for (D-230).
   *
   * Absent, not disabled: a greyed control teaches somebody that a feature exists and that they
   * are excluded from it. Filtered out of `NAV` before it renders, so the string is not in the
   * markup at all — which is the only way a test can tell absent from styled-away.
   */
  readonly hidePanes?: readonly Pane[];
  /**
   * Whether to draw People and the access log (D-229).
   *
   * **Required, deliberately.** It was going to be optional with a `false` default, and a default
   * here is how this was broken in the first place: `showsAdministration` existed, was correct, and
   * no caller passed it anywhere, so the owner's own screens were reachable only by typing the URL.
   * A required prop makes forgetting it a compile error rather than a silently empty account area.
   */
  readonly showsAdministration: boolean;
  readonly onPane: (pane: Pane) => void;
  readonly ruleset: Ruleset;
  readonly analystEmail: string;
}

export function Rail({
  pane,
  onPane,
  ruleset,
  analystEmail,
  hidePanes = [],
  showsAdministration,
}: Props): JSX.Element {
  return (
    <nav className="rail">
      <div className="brand">
        <img className="brand-glyph" src="/brand/mintro-glyph.png" alt="" />
        <div className="brand-word">
          M<i>i</i>ntro
        </div>
      </div>

      {visibleNav(hidePanes).map((group) => (
        <div key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items.map((item) => (
            <button
              key={item.pane}
              className="nav-item"
              data-pane={item.pane}
              aria-current={pane === item.pane ? 'true' : undefined}
              onClick={() => onPane(item.pane)}
            >
              <span className="ic">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ))}

      {/* Who is signed in. An analyst reading a merchant's evidence should be able to see, at a
          glance, which account is doing so. */}
      <div className="rail-user">
        {/*
          The owner's screens, above the address they belong to (D-229).

          Plain anchors, because `/people` and `/access-log` are routes resolved from
          `window.location.pathname` rather than panes — a click has to be a real navigation, and a
          button calling `assign` would be the same thing with the destination hidden from the
          markup.

          Nothing is rendered at all for anybody else: no group, no heading, no disabled row.
        */}
        {visibleAdminLinks(showsAdministration).map((link) => (
          <a key={link.href} className="rail-admin" data-admin={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
        <span className="who">{analystEmail}</span>
        <SignOutButton />
      </div>

      {/* Read from the loaded rule set, not typed in — the demo's "v2.4 / 26 May 2026" was copy. */}
      <div className="rail-foot">
        Rule set v{ruleset.version}
        <br />
        Effective {ruleset.effective}
        <br />
        {ruleset.rules.length} rules
      </div>
    </nav>
  );
}
