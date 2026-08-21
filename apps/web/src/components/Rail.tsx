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

interface Props {
  readonly pane: 'scan' | 'docs';
  readonly onPane: (pane: 'scan' | 'docs') => void;
  readonly ruleset: Ruleset;
}

export function Rail({ pane, onPane, ruleset }: Props): JSX.Element {
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
        <button className="nav-item" onClick={() => onPane('scan')}>
          <span className="ic">⛁</span>Past reports
        </button>
        <button className="nav-item" onClick={() => onPane('scan')}>
          <span className="ic">⚙</span>Rule set
        </button>
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
