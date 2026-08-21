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
export declare function Rail({ pane, onPane, ruleset }: Props): JSX.Element;
export {};
//# sourceMappingURL=Rail.d.ts.map