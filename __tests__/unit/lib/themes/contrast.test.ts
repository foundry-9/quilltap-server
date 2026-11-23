/**
 * @jest-environment node
 *
 * Contrast (Calliope Live, Spec D 0.2): WCAG luminance and ratio, the
 * registry's pairs, and the engine's check — pass, fail and "not checked".
 */

import { compositeOver, contrastRatio, parseColor, relativeLuminance } from '@/lib/themes/color';
import { checkContrast, contrastWarnings, resolveTheme } from '@/lib/themes/engine';
import { CONTRAST_PAIRS, isThemeToken } from '@/lib/themes/registry';
import { THEME_REGISTRY_VIEW } from '@/lib/themes/theme-bundle';

const c = (s: string) => parseColor(s)!;
const EMPTY = { primitives: {}, tokens: {}, choices: {} };

describe('WCAG colour maths', () => {
  it('black on white is 21:1 and a colour on itself 1:1', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(c('#777'), c('#777'))).toBeCloseTo(1, 5);
  });

  it('matches the reference ratio for #767676 on white (4.54:1)', () => {
    expect(contrastRatio(c('#767676'), c('#fff'))).toBeCloseTo(4.54, 2);
  });

  it('luminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance(c('black'))).toBe(0);
    expect(relativeLuminance(c('white'))).toBeCloseTo(1, 10);
  });

  it('composites a translucent foreground over its background', () => {
    // 50% black over white is mid grey, not black.
    expect(contrastRatio(c('rgb(0 0 0 / 0.5)'), c('#fff'))).toBeLessThan(5);
    expect(compositeOver(c('rgb(0 0 0 / 0.5)'), c('#fff')).a).toBe(1);
  });

  it('composites a translucent background over the backdrop', () => {
    const onWhite = contrastRatio(c('#fff'), c('rgb(0 0 0 / 0.1)'), c('#fff'));
    const onBlack = contrastRatio(c('#fff'), c('rgb(0 0 0 / 0.1)'), c('#000'));
    expect(onWhite).toBeLessThan(1.5);
    expect(onBlack).toBeCloseTo(21, 0);
  });
});

describe('the registry pairs', () => {
  it.each(CONTRAST_PAIRS.map((p) => [p.id, p] as const))('%s names registry tokens', (_id, pair) => {
    expect(isThemeToken(pair.foreground)).toBe(true);
    expect(isThemeToken(pair.background)).toBe(true);
  });

  it('ids are unique', () => {
    expect(new Set(CONTRAST_PAIRS.map((p) => p.id)).size).toBe(CONTRAST_PAIRS.length);
  });
});

describe('checkContrast', () => {
  it('measures every pair in both modes', () => {
    const findings = checkContrast(resolveTheme(EMPTY, THEME_REGISTRY_VIEW));
    expect(findings).toHaveLength(CONTRAST_PAIRS.length * 2);
    const page = findings.find((f) => f.pair.id === 'theme-foreground/theme-background' && f.mode === 'light')!;
    expect(page.status).toBe('pass');
    expect(page.ratio).toBeGreaterThan(10);
  });

  it('fails a pair below its threshold, in the mode it fails in', () => {
    const doc = { ...EMPTY, tokens: { '--theme-foreground': { value: 'hsl(225 18% 13%)', dark: 'hsl(225 18% 13%)' } } };
    const findings = checkContrast(resolveTheme(doc, THEME_REGISTRY_VIEW));
    const of = (mode: string) => findings.find((f) => f.pair.id === 'theme-foreground/theme-background' && f.mode === mode)!;
    expect(of('light').status).toBe('pass');
    expect(of('dark').status).toBe('fail');
    expect(contrastWarnings(findings).some((w) => w.startsWith('contrast (dark): --theme-foreground on --theme-background'))).toBe(true);
  });

  it('follows var() references and the --color-* aliases', () => {
    const doc = { ...EMPTY, tokens: { '--theme-card-foreground': 'var(--color-card)' } };
    const finding = checkContrast(resolveTheme(doc, THEME_REGISTRY_VIEW)).find((f) => f.pair.id === 'theme-card-foreground/theme-card' && f.mode === 'light')!;
    expect(finding.status).toBe('fail');
    expect(finding.ratio).toBe(1);
  });

  it('reports a value that is not one colour as not checked, never a pass', () => {
    const doc = { ...EMPTY, tokens: { '--theme-card': 'linear-gradient(red, blue)' } };
    const finding = checkContrast(resolveTheme(doc, THEME_REGISTRY_VIEW)).find((f) => f.pair.id === 'theme-card-foreground/theme-card' && f.mode === 'light')!;
    expect(finding.status).toBe('unchecked');
    expect(finding.ratio).toBeUndefined();
    expect(finding.reason).toMatch(/not a single colour/);
  });

  it('uses the non-text threshold for the focus ring', () => {
    const finding = checkContrast(resolveTheme(EMPTY, THEME_REGISTRY_VIEW)).find((f) => f.pair.id === 'theme-ring/theme-background')!;
    expect(finding.threshold).toBe(3);
  });
});
