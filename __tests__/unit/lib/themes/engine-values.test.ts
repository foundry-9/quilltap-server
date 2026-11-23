/**
 * @jest-environment node
 *
 * The token value parsers (Calliope Live, Spec E, Stage 0.2): every default
 * and every bundled theme's value of the types each serves, and the rules —
 * `parse` refuses what it does not fully understand; `format(parse(v))` is
 * `v` (up to spacing after commas and quoting, which render the same);
 * a `var()` part is kept as written.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  collapseCorners,
  formatBlur,
  formatDuration,
  formatFontStack,
  formatFontWeight,
  formatImage,
  formatLengthList,
  formatOpacity,
  formatShadow,
  formatTransition,
  formatZIndex,
  parseBlur,
  parseDuration,
  parseFontStack,
  parseFontWeight,
  parseImage,
  parseLengthList,
  parseOpacity,
  parseShadow,
  parseTransition,
  parseZIndex,
  radiusCorners,
  splitTopLevel,
  tokenModes,
  typeProblem,
} from '@/lib/themes/engine/client';
import { THEME_TOKENS, type TokenType } from '@/lib/themes/registry';

const BUNDLED = path.resolve(__dirname, '../../../../themes/bundled');

/** Every value of each type: registry defaults (authorable tokens) and the bundled themes' tokens and primitives. */
function corpus(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (type: string, v: string) => {
    if (!out.has(type)) out.set(type, new Set());
    out.get(type)!.add(v);
  };
  const byName = new Map(THEME_TOKENS.map((t) => [t.name, t]));
  for (const t of THEME_TOKENS) {
    if (t.visibility === 'internal') continue;
    add(t.type, t.default);
    if (t.defaultDark) add(t.type, t.defaultDark);
    for (const options of Object.values(t.byChoice ?? {})) for (const v of Object.values(options)) add(t.type, v);
  }
  for (const dir of readdirSync(BUNDLED)) {
    const file = path.join(BUNDLED, dir, 'tokens.json');
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, entry] of Object.entries<any>(doc.tokens ?? {})) {
      const token = byName.get(name);
      if (!token) continue;
      const { value, dark } = tokenModes(entry);
      add(token.type, value);
      if (dark) add(token.type, dark);
    }
    for (const p of Object.values<any>(doc.primitives ?? {})) {
      add(p.type, p.value);
      if (p.dark) add(p.type, p.dark);
    }
  }
  return out;
}

/** Spacing after commas, quote style and quotes a one-word family name does not need render the same. */
const canonical = (v: string) =>
  v.trim().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/'/g, '"').replace(/"(-?[A-Za-z_][\w-]*)"(?=,|$)/g, '$1');

const PARSERS: Partial<Record<TokenType, (v: string) => string | null>> = {
  length: (v) => { const p = parseLengthList(v); return p && formatLengthList(p); },
  radius: (v) => { const p = parseLengthList(v); return p && formatLengthList(p); },
  blur: (v) => { const p = parseBlur(v); return p && formatBlur(p); },
  shadow: (v) => { const p = parseShadow(v); return p && formatShadow(p); },
  'font-family': (v) => { const p = parseFontStack(v); return p && formatFontStack(p); },
  transition: (v) => { const p = parseTransition(v); return p && formatTransition(p); },
  duration: (v) => { const p = parseDuration(v); return p && formatDuration(p); },
  opacity: (v) => { const p = parseOpacity(v); return p && formatOpacity(p); },
  'z-index': (v) => { const p = parseZIndex(v); return p && formatZIndex(p); },
  'font-weight': (v) => { const p = parseFontWeight(v); return p && formatFontWeight(p); },
  image: (v) => { const p = parseImage(v); return p && formatImage(p); },
};

describe('value parsers against every default and bundled value', () => {
  const values = corpus();

  for (const [type, run] of Object.entries(PARSERS)) {
    it(`${type}: round-trips every value it accepts`, () => {
      const all = [...(values.get(type) ?? [])];
      expect(all.length).toBeGreaterThan(0);
      for (const v of all) {
        const out = run!(v);
        if (out === null) continue;
        expect(canonical(out)).toBe(canonical(v));
        // A formatted value parses again to the same text.
        expect(run!(out)).toBe(out);
      }
    });
  }

  it('parses the shapes the bundled themes lean on', () => {
    // Every literal shadow and font stack in the corpus parses; only references and functions fall to text.
    for (const v of values.get('shadow') ?? []) if (!/^var\(/.test(v)) expect(parseShadow(v)).not.toBeNull();
    for (const v of values.get('font-family') ?? []) expect(parseFontStack(v)).not.toBeNull();
    for (const v of values.get('transition') ?? []) expect(parseTransition(v)).not.toBeNull();
  });
});

describe('the rules', () => {
  it('refuses what it does not fully understand', () => {
    expect(parseLengthList('calc(1rem + 2px)')).toBeNull();
    expect(parseLengthList('clamp(1rem, 2vw, 3rem)')).toBeNull();
    expect(parseLengthList('4px / 8px')).toBeNull();
    expect(parseLengthList('1 2 3 4 5')).toBeNull();
    expect(parseLengthList('12')).toBeNull();
    expect(parseShadow('var(--p-card-shadow)')).toBeNull();
    expect(parseShadow('0 1px 2px 3px 4px red')).toBeNull();
    expect(parseShadow('0 calc(1px * 2) 3px red')).toBeNull();
    expect(parseShadow('0 1px bogus')).toBeNull();
    expect(parseFontStack('"serif"')).toBeNull();
    expect(parseFontStack('"Unclosed, serif')).toBeNull();
    expect(parseTransition('all var(--speed) ease')).toBeNull();
    expect(parseTransition('ease 150ms')).toBeNull();
    expect(parseOpacity('1.5')).toBeNull();
    expect(parseOpacity('var(--x)')).toBeNull();
    expect(parseDuration('150')).toBeNull();
    expect(parseFontWeight('450.5')).toBeNull();
    expect(parseZIndex('1.5')).toBeNull();
    expect(parseBlur('blur(2px) brightness(0.5)')).toBeNull();
    expect(parseImage('linear-gradient(red, blue)')).toBeNull();
    expect(parseImage("url('https://example.com/a.png')")).toBeNull();
  });

  it('keeps a var() part as written', () => {
    const radius = parseLengthList('var(--radius-md) var(--radius-md) 0 0')!;
    expect(radius[0]).toEqual({ kind: 'reference', text: 'var(--radius-md)' });
    expect(formatLengthList(radius)).toBe('var(--radius-md) var(--radius-md) 0 0');
    const shadow = parseShadow('0 0 0 4px var(--p-rotor-glow-soft)')!;
    expect(shadow.layers[0].color).toBe('var(--p-rotor-glow-soft)');
    expect(shadow.layers[0].spread).toEqual({ kind: 'number', number: 4, unit: 'px' });
    expect(parseFontStack('var(--p-font-sans), serif')!.families).toEqual(['var(--p-font-sans)', 'serif']);
  });

  it('reads shadows in either order, with inset', () => {
    expect(parseShadow('inset 0 1px 2px red')!.layers[0]).toMatchObject({ inset: true, color: 'red' });
    expect(parseShadow('red 0 1px 2px inset')!.layers[0]).toMatchObject({ inset: true, color: 'red' });
    expect(formatShadow(parseShadow('red 0 1px 2px inset')!)).toBe('inset 0 1px 2px red');
    expect(formatShadow({ layers: [] })).toBe('none');
  });

  it('quotes a family name only when CSS needs it', () => {
    expect(formatFontStack({ families: ['Segoe UI', 'Inter', 'sans-serif', '3D Font'] })).toBe('"Segoe UI", Inter, sans-serif, "3D Font"');
  });

  it('collapses four corners to the shortest form', () => {
    const corners = radiusCorners(parseLengthList('4px 8px')!);
    expect(corners.map((c) => (c.kind === 'number' ? c.number : 0))).toEqual([4, 8, 4, 8]);
    expect(formatLengthList(collapseCorners(corners))).toBe('4px 8px');
    expect(formatLengthList(collapseCorners(radiusCorners(parseLengthList('4px 4px 4px 4px')!)))).toBe('4px');
    expect(formatLengthList(collapseCorners(radiusCorners(parseLengthList('1px 2px 3px 4px')!)))).toBe('1px 2px 3px 4px');
  });

  it('splits at the top level only', () => {
    expect(splitTopLevel('a, color-mix(in srgb, red 5%, blue), "x, y"', ',')).toEqual(['a', 'color-mix(in srgb, red 5%, blue)', '"x, y"']);
    expect(splitTopLevel('a (b', ',')).toBeNull();
  });
});

describe('the type check (browser-safe)', () => {
  it('refuses a keyword outside the token options', () => {
    const scheme = THEME_TOKENS.find((t) => t.name === '--qt-color-scheme')!;
    expect(typeProblem('keyword', 'dark', scheme.options)).toBeNull();
    expect(typeProblem('keyword', 'light dark', scheme.options)).toBeNull();
    expect(typeProblem('keyword', 'midnight', scheme.options)).toMatch(/is not one of/);
    expect(typeProblem('keyword', 'var(--p-x)', scheme.options)).toBeNull();
    expect(typeProblem('keyword', 'inherit', scheme.options)).toBeNull();
  });

  it('gives every keyword token a list of options that holds its default', () => {
    const keywords = THEME_TOKENS.filter((t) => t.type === 'keyword');
    expect(keywords.length).toBe(8);
    for (const t of keywords) {
      expect(t.options?.length).toBeGreaterThan(1);
      expect(t.options).toContain(t.default);
    }
  });

  it('says what it always said for other types', () => {
    expect(typeProblem('color', 'nope')).toMatch(/not a colour/);
    expect(typeProblem('length', '12')).toMatch(/not a length/);
    expect(typeProblem('length', 'calc(1px + 2px)')).toBeNull();
  });
});
