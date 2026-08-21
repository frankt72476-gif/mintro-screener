/**
 * The report.
 *
 * Structure ported from `demo/index.html` (D-004): verdict banner, tick strip, filter chips with
 * the coverage line, then collapsible categories of findings each opening an evidence slip.
 *
 * The demo's `na` class name is kept for the not-evaluable state so the ported CSS applies
 * unchanged; the data's own name for it is `not_evaluable`.
 */
import type { ScreeningReport } from '@mintro/engine';
import type { EvidenceAccess } from '../lib/evidence.js';
interface Props {
    readonly report: ScreeningReport;
    readonly access: EvidenceAccess;
    readonly onSend: () => void;
    readonly onDownload: () => void;
}
export declare function ReportView({ report, access, onSend, onDownload }: Props): JSX.Element;
export {};
//# sourceMappingURL=ReportView.d.ts.map