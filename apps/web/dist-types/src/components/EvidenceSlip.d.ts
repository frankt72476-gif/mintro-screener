/**
 * The evidence slip — one of the design's two signature elements.
 *
 * Ported from the demo, with the change real data forces: the demo drew the same fake screenshot
 * beneath every finding. Real findings are backed by two different kinds of capture, and D-012
 * requires each to say which it is and never to be shown as the other.
 *
 *   `document`       a fetched file — a sitemap, robots.txt. Shows the stored artifact and its
 *                    digest. No screenshot exists, and none is drawn.
 *   `rendered_page`  a page rendered in a browser. Shows the full-page screenshot, loaded
 *                    through a short-expiry signed URL.
 */
import type { ReportFinding } from '@mintro/engine';
import type { EvidenceAccess } from '../lib/evidence.js';
interface Props {
    readonly finding: ReportFinding;
    readonly access: EvidenceAccess;
}
export declare function EvidenceSlip({ finding, access }: Props): JSX.Element;
export {};
//# sourceMappingURL=EvidenceSlip.d.ts.map