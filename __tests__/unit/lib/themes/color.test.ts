/**
 * @jest-environment node
 *
 * The theme colour evaluator (lib/themes/color). Its results were also checked
 * against Chrome's computed colours for every colour expression in the theme
 * snapshot fixtures (1,587 distinct; worst difference 0.5/255, Chrome's own
 * 8-bit rounding).
 */

import { deltaEOK, parseColor, renderAlike, sameColor, splitColors } from '@/lib/themes/color';

const rgb = (r: number, g: number, b: number, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });

describe('parseColor', () => {
  it.each([
    ['#fff', rgb(255, 255, 255)],
    ['#00000080', rgb(0, 0, 0, 128 / 255)],
    ['white', rgb(255, 255, 255)],
    ['transparent', rgb(0, 0, 0, 0)],
    ['rgb(10 20 30 / 0.5)', rgb(10, 20, 30, 0.5)],
    ['rgba(10, 20, 30, 0.5)', rgb(10, 20, 30, 0.5)],
    ['hsl(0 100% 50%)', rgb(255, 0, 0)],
    ['hsla(120, 100%, 25%, 0.25)', rgb(0, 127.5, 0, 0.25)],
    ['hsl(0.5turn 100% 50%)', rgb(0, 255, 255)],
  ])('%s', (input, expected) => {
    const c = parseColor(input);
    expect(c).not.toBeNull();
    expect(sameColor(c!, expected)).toBe(true);
  });

  it('mixes in srgb with premultiplied alpha and the percentage rules', () => {
    expect(sameColor(parseColor('color-mix(in srgb, red 25%, blue)')!, rgb(63.75, 0, 191.25))).toBe(true);
    expect(sameColor(parseColor('color-mix(in srgb, hsl(225 55% 55%) 12%, transparent)')!, parseColor('hsl(225 55% 55% / 0.12)')!)).toBe(true);
    // percentages summing under 100% scale the alpha
    expect(parseColor('color-mix(in srgb, red 40%, blue 40%)')!.a).toBeCloseTo(0.8);
    expect(parseColor('color-mix(in oklab, red, blue)')).toBeNull();
  });

  it('declines what it does not evaluate', () => {
    for (const v of ['currentColor', 'var(--x)', 'hsl(from red h s l)', 'url(x.png)', '1px solid']) expect(parseColor(v)).toBeNull();
  });
});

describe('renderAlike', () => {
  it('treats an equal formula as unchanged', () => {
    expect(renderAlike('hsl(152 60% 38% / 0.08)', 'color-mix(in srgb, hsl(152 60% 38%) 8%, transparent)')).toBe(true);
    expect(renderAlike('0 1px 3px rgb(0 0 0 / 0.1)', '0 1px 3px rgba(0, 0, 0, 0.1)')).toBe(true);
  });

  it('notices a changed colour or changed text', () => {
    expect(renderAlike('hsl(152 60% 38% / 0.08)', 'hsl(152 60% 38% / 0.1)')).toBe(false);
    expect(renderAlike('0 1px 3px black', '0 2px 3px black')).toBe(false);
    expect(renderAlike('1.25rem', '1.5rem')).toBe(false);
  });

  it('splits values into text and colours', () => {
    const parts = splitColors('0 0 8px color-mix(in srgb, red 50%, transparent), inset 0 0 0 1px #000');
    expect(parts.filter((p) => 'color' in p)).toHaveLength(2);
  });
});

describe('deltaEOK', () => {
  it('is zero for equal colours and about 0.2+ for very different ones', () => {
    expect(deltaEOK(rgb(10, 20, 30), rgb(10, 20, 30))).toBe(0);
    expect(deltaEOK(rgb(255, 0, 0), rgb(0, 0, 255))).toBeGreaterThan(0.2);
  });

  it('composites translucent colours over the backdrop', () => {
    expect(deltaEOK(rgb(0, 0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(0, 6);
  });
});
