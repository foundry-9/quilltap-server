/**
 * Theme engine — the contrast check.
 *
 * Measures each registry contrast pair (`lib/themes/registry/contrast.ts`) in
 * light and dark against a resolved theme: the WCAG ratio, the threshold for
 * its kind, and pass or fail. A translucent foreground is composited over
 * its background; a translucent background over the mode's page background
 * (`--theme-background`). A value that does not come down to one colour this
 * engine can evaluate — a gradient, an image, an unsupported colour function
 * — is reported as `unchecked`, never as a pass.
 *
 * Findings are warnings (Calliope Live, Spec D decision 5): a theme that
 * fails a pair still loads, saves and installs. Pure and browser-safe.
 *
 * @module themes/engine/contrast
 */

import { contrastRatio, parseColor, type Rgba } from '../color';
import { CONTRAST_PAIRS, CONTRAST_THRESHOLDS, type ContrastPair } from '../registry/contrast';
import { resolveLiteral } from './literal';
import type { ResolvedTheme, ResolvedValue } from './resolve';

export type ContrastMode = 'light' | 'dark';

export interface ContrastFinding {
  pair: ContrastPair;
  mode: ContrastMode;
  status: 'pass' | 'fail' | 'unchecked';
  /** The ratio, rounded to two places; absent when unchecked. */
  ratio?: number;
  threshold: number;
  /** The foreground and background as literals (when they resolved). */
  foreground?: string;
  background?: string;
  /** Why it was not checked. */
  reason?: string;
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function colourOf(values: Record<string, ResolvedValue>, name: string): { literal?: string; colour?: Rgba; reason?: string } {
  if (!values[name]) return { reason: `${name} is not set` };
  const literal = resolveLiteral(values, name);
  if (literal === null) return { reason: `${name} does not resolve` };
  const colour = parseColor(literal);
  if (!colour) return { literal, reason: `${name} is not a single colour ("${literal}")` };
  return { literal, colour };
}

/** Every pair in both modes. `pairs` defaults to the registry's. */
export function checkContrast(resolved: ResolvedTheme, pairs: readonly ContrastPair[] = CONTRAST_PAIRS): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const values = resolved[mode];
    const page = colourOf(values, '--theme-background').colour;
    // The page itself sits on the browser canvas: white in light, black in dark.
    const canvas = mode === 'dark' ? BLACK : WHITE;
    const backdrop = page ? flatten(page, canvas) : canvas;
    for (const pair of pairs) {
      const threshold = CONTRAST_THRESHOLDS[pair.kind];
      const fg = colourOf(values, pair.foreground);
      const bg = colourOf(values, pair.background);
      const base: ContrastFinding = { pair, mode, status: 'unchecked', threshold, foreground: fg.literal, background: bg.literal };
      if (!fg.colour || !bg.colour) {
        findings.push({ ...base, reason: fg.reason ?? bg.reason });
        continue;
      }
      const ratio = Math.round(contrastRatio(fg.colour, bg.colour, backdrop) * 100) / 100;
      findings.push({ ...base, status: ratio >= threshold ? 'pass' : 'fail', ratio });
    }
  }
  return findings;
}

function flatten(c: Rgba, under: Rgba): Rgba {
  return { r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a), a: 1 };
}

/** One line per failed or unchecked finding, as `validateThemeDocument` reports them. */
export function contrastWarnings(findings: readonly ContrastFinding[]): string[] {
  return findings
    .filter((f) => f.status !== 'pass')
    .map((f) =>
      f.status === 'fail'
        ? `contrast (${f.mode}): ${f.pair.foreground} on ${f.pair.background} is ${f.ratio}:1; ${f.pair.kind} needs ${f.threshold}:1`
        : `contrast (${f.mode}): ${f.pair.foreground} on ${f.pair.background} not checked: ${f.reason}`
    );
}
