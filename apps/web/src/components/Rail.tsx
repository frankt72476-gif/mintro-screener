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
export type Pane = 'scan' | 'docs' | 'reports';

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

      <div>
        <div className="nav-label">Screening</div>
        <button
          className="nav-item"
          aria-current={pane === 'scan' ? 'true' : undefined}
          onClick={() => onPane('scan')}
        >
          <span className="ic">◎</span>Site check
        </button>
        {/* Stubbed on purpose — Documents Check is a later phase. */}
        <button
          className="nav-item"
          aria-current={pane === 'docs' ? 'true' : undefined}
          onClick={() => onPane('docs')}
        >
          <span className="ic">▤</span>Documents check<span className="soon">SOON</span>
        </button>
      </div>

      <div>
        <div className="nav-label">Library</div>
        {/* Was a dead link that returned to the scan pane. It is the run library now (D-047),
            and the only way to reach an old report — the dropdown it duplicated is gone. */}
        <button
          className="nav-item"
          aria-current={pane === 'reports' ? 'true' : undefined}
          onClick={() => onPane('reports')}
        >
          <span className="ic">⛁</span>Past reports
        </button>
        {/* Still dead. Left as it was rather than wired to something that is not built —
            a nav item that goes somewhere unfinished is worse than one that is honestly inert. */}
        <button className="nav-item" onClick={() => onPane('scan')}>
          <span className="ic">⚙</span>Rule set
        </button>
      </div>

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
