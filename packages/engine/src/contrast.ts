/**
 * WCAG 2.1 contrast ratio.
 *
 * DISC-002 is `critical` / `auto_fail` and asserts `min_contrast: 4.5` — the WCAG AA threshold
 * for normal-size text. A merchant is failed automatically on the number this file computes,
 * so it implements the published formula exactly rather than an approximation, and is tested
 * against the reference values.
 */

import type { Rgb } from './page.js';

/**
 * Relative luminance, per WCAG 2.1.
 *
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(colour: Rgb): number {
  const channel = (value: number): number => {
    const c = clamp255(value) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

/**
 * Contrast ratio between two colours, from 1 (identical) to 21 (black on white).
 *
 * Order-independent: the lighter colour is always the numerator.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounds a ratio for display, e.g. `4.54`. */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100) / 100}:1`;
}

/**
 * Parses a CSS colour as a browser reports it — `rgb(r, g, b)` or `rgba(r, g, b, a)`.
 *
 * Returns null for anything else, including `transparent` and named colours. A colour that
 * cannot be parsed must not be guessed at: DISC-002 auto-fails, and inventing a background to
 * compare against would manufacture the number the failure rests on.
 */
export function parseCssColour(value: string): { colour: Rgb; alpha: number } | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
    value.trim(),
  );
  if (match === null) return null;

  const [, r, g, b, a] = match;
  if (r === undefined || g === undefined || b === undefined) return null;

  return {
    colour: { r: Number(r), g: Number(g), b: Number(b) },
    alpha: parseAlpha(a),
  };
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;
  const numeric = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : 1;
}

/**
 * Composites a semi-transparent colour over the one behind it.
 *
 * A disclaimer set in `rgba(0,0,0,0.15)` over white is far less legible than its nominal
 * colour suggests; comparing the nominal value would understate how faint it renders.
 */
export function compositeOver(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  const blend = (f: number, b: number): number => Math.round(f * alpha + b * (1 - alpha));
  return {
    r: blend(foreground.r, background.r),
    g: blend(foreground.g, background.g),
    b: blend(foreground.b, background.b),
  };
}

function clamp255(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 255);
}
