/** Formatting shared by the report surfaces. */
import type { State } from '@mintro/ruleset';
/**
 * The demo's class names for the four states.
 *
 * `not_evaluable` maps to `na` so the ported CSS applies unchanged. The data keeps its own name;
 * only the presentation layer uses the short one.
 */
export declare function stateClass(state: State): 'fail' | 'review' | 'pass' | 'na';
export declare const STATE_LABEL: Record<State, string>;
/** `20 Aug 2026, 10:42 ET`, matching the demo's report header. */
export declare function formatReportDate(iso: string): string;
/** `2026-08-20 10:42:11 ET`, for an evidence stamp. */
export declare function formatStamp(iso: string): string;
/** First and last bytes of a digest — enough to compare by eye, short enough to read. */
export declare function shortHash(sha256: string): string;
//# sourceMappingURL=format.d.ts.map