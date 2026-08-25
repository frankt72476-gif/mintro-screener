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

interface Props {
  readonly pane: Pane;
  readonly onPane: (pane: Pane) => void;
  readonly ruleset: Ruleset;
  readonly analystEmail: string;
}

export function Rail({ pane, onPane, ruleset, analystEmail }: Props): JSX.Element {
  return (
    <nav className="rail">
      <div className="brand">
        <img className="brand-glyph" src="/brand/mintro-glyph.png" alt="" />
        <div className="brand-word">
          M<i>i</i>ntro
        </div>
      </div>

      {NAV.map((group) => (
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
