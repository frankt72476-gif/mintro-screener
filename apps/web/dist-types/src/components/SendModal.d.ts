/**
 * Send to IQwallet.
 *
 * D-001: send is never blocked. There is no confirmation interstitial gated on the outcome, no
 * "are you sure", no supervisor override. This dialog collects a recipient and a note; the
 * report goes regardless of what it says.
 *
 * The default note states counts as facts. It does not characterise the merchant.
 */
import type { ScreeningReport } from '@mintro/engine';
interface Props {
    readonly report: ScreeningReport;
    readonly onCancel: () => void;
    readonly onSent: (to: string) => void;
}
export declare function SendModal({ report, onCancel, onSent }: Props): JSX.Element;
export {};
//# sourceMappingURL=SendModal.d.ts.map