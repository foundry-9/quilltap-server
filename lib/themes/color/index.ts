/**
 * CSS colour evaluation — just enough of CSS Color 4/5 for theme tooling.
 *
 * Parses the colour forms Quilltap's theme CSS uses — hex (3, 4, 6, 8 digits),
 * `rgb()` / `rgba()` and `hsl()` / `hsla()` in modern and legacy syntax, the
 * named colours, `transparent`, and `color-mix(in srgb, …)` — into sRGB with
 * alpha, and compares colours in OKLab. Used by the theme snapshot to decide
 * whether two resolved values render alike, and by the Spec A fit report to
 * measure how close a derivation comes to a theme's literal, and by the
 * contrast check (engine/contrast.ts) for WCAG luminance and ratios.
 *
 * Anything else (`currentColor`, other mixing spaces, relative colour syntax,
 * `var()` left unresolved) is "not a colour I can evaluate": `parseColor`
 * returns null, and callers fall back to comparing text.
 *
 * Framework-free and pure.
 *
 * @module themes/color
 */

/** sRGB channels and alpha, each 0..1, not premultiplied. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
  darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa',
  lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00',
  limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa',
  mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585',
  midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead',
  navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500',
  orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093',
  papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6',
  purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1',
  saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee',
  sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090',
  slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080',
  thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
  whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'color-mix']);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Split a function's argument text on top-level commas. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/** Top-level whitespace-separated words of `text` (parenthesised groups kept whole). */
function words(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseHex(hex: string): Rgba | null {
  const h = hex.toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
}

/** A number, or a percentage of `percentOf`. 'none' is 0. */
function num(token: string, percentOf: number): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] ? (v / 100) * percentOf : v;
}

function hue(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case 'rad':
      return (v * 180) / Math.PI;
    case 'grad':
      return v * 0.9;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

/** Channel tokens and an optional alpha, for modern (space / slash) or legacy (comma) syntax. */
function channels(args: string): { parts: string[]; alpha: string | null } | null {
  if (args.includes(',')) {
    const parts = splitTopLevel(args, ',');
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { parts: parts.slice(0, 3), alpha: parts[3] ?? null };
  }
  const [main, alpha, extra] = splitTopLevel(args, '/');
  if (extra !== undefined) return null;
  const parts = words(main);
  if (parts.length !== 3) return null;
  return { parts, alpha: alpha ?? null };
}

function alphaOf(token: string | null): number | null {
  if (token === null) return 1;
  const a = num(token, 1);
  return a === null ? null : clamp01(a);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function parseMix(args: string): Rgba | null {
  const parts = splitTopLevel(args, ',');
  if (parts.length !== 3) return null;
  if (!/^in\s+srgb$/i.test(parts[0].trim())) return null;
  const side = (text: string): { color: Rgba; pct: number | null } | null => {
    const ws = words(text);
    let pct: number | null = null;
    const rest: string[] = [];
    for (const w of ws) {
      if (/%$/.test(w) && num(w, 100) !== null && pct === null) pct = num(w, 100);
      else rest.push(w);
    }
    const color = parseColor(rest.join(' '));
    return color ? { color, pct } : null;
  };
  const a = side(parts[1]);
  const b = side(parts[2]);
  if (!a || !b) return null;
  let p1 = a.pct;
  let p2 = b.pct;
  if (p1 === null && p2 === null) p1 = p2 = 50;
  else if (p1 === null) p1 = 100 - (p2 as number);
  else if (p2 === null) p2 = 100 - p1;
  if ((p1 as number) < 0 || (p2 as number) < 0) return null;
  const sum = (p1 as number) + (p2 as number);
  if (sum === 0) return null;
  const multiplier = sum < 100 ? sum / 100 : 1;
  const w1 = (p1 as number) / sum;
  const w2 = (p2 as number) / sum;
  const alpha = a.color.a * w1 + b.color.a * w2;
  const ch = (k: 'r' | 'g' | 'b') => (alpha === 0 ? 0 : (a.color[k] * a.color.a * w1 + b.color[k] * b.color.a * w2) / alpha);
  return { r: ch('r'), g: ch('g'), b: ch('b'), a: alpha * multiplier };
}

/** Parse one CSS colour expression, or null when it is not one this module evaluates. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (lower.startsWith('#')) return parseHex(lower.slice(1));
  if (NAMED[lower]) return parseHex(NAMED[lower]);
  const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(text);
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const args = m[2];
  if (fn === 'color-mix') return parseMix(args);
  if (fn === 'rgb' || fn === 'rgba') {
    const c = channels(args);
    if (!c) return null;
    const [r, g, b] = c.parts.map((p) => num(p, 255));
    const a = alphaOf(c.alpha);
    if (r === null || g === null || b === null || a === null) return null;
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a };
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const c = channels(args);
    if (!c) return null;
    const h = hue(c.parts[0]);
    const s = num(c.parts[1].endsWith('%') ? c.parts[1] : `${c.parts[1]}%`, 1);
    const l = num(c.parts[2].endsWith('%') ? c.parts[2] : `${c.parts[2]}%`, 1);
    const a = alphaOf(c.alpha);
    if (h === null || s === null || l === null || a === null) return null;
    const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l));
    return { r, g, b, a };
  }
  return null;
}

/** sRGB → OKLab (Björn Ottosson). */
export function toOklab(c: Rgba): [number, number, number] {
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const r = lin(c.r);
  const g = lin(c.g);
  const b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Perceptual difference between two colours: Euclidean distance in OKLab of
 * each colour composited over `backdrop` (white by default), so an alpha
 * difference counts by what it does on the page. ~0.02 is a just-noticeable
 * difference.
 */
export function deltaEOK(a: Rgba, b: Rgba, backdrop: Rgba = { r: 1, g: 1, b: 1, a: 1 }): number {
  const over = (c: Rgba): Rgba => ({
    r: c.r * c.a + backdrop.r * (1 - c.a),
    g: c.g * c.a + backdrop.g * (1 - c.a),
    b: c.b * c.a + backdrop.b * (1 - c.a),
    a: 1,
  });
  const [l1, a1, b1] = toOklab(over(a));
  const [l2, a2, b2] = toOklab(over(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** `top` composited over `bottom` (source-over), returned opaque when `bottom` is. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (k: 'r' | 'g' | 'b') => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
  return { r: ch('r'), g: ch('g'), b: ch('b'), a };
}

/** WCAG 2.x relative luminance of an opaque sRGB colour (alpha ignored). */
export function relativeLuminance(c: Rgba): number {
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * WCAG 2.x contrast ratio (1..21) of `foreground` on `background`. A
 * translucent foreground is composited over the background first; a
 * translucent background over `backdrop` (the page colour of the mode,
 * white by default).
 */
export function contrastRatio(foreground: Rgba, background: Rgba, backdrop: Rgba = { r: 1, g: 1, b: 1, a: 1 }): number {
  const bg = compositeOver(background, { ...backdrop, a: 1 });
  const fg = compositeOver(foreground, bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** True when the two colours are the same 8-bit RGBA (each channel within half a step). */
export function sameColor(a: Rgba, b: Rgba): boolean {
  const step = 0.5 / 255 + 1e-9;
  if (Math.abs(a.a - b.a) > step) return false;
  if (a.a <= step && b.a <= step) return true; // fully transparent: channels do not matter
  return Math.abs(a.r - b.r) <= step && Math.abs(a.g - b.g) <= step && Math.abs(a.b - b.b) <= step;
}

/** A value broken into literal text and the colour expressions inside it. */
export type ValuePart = { text: string } | { color: Rgba; source: string };

/**
 * Split a CSS value into text and colour parts: each top-level-or-nested
 * colour function, hex literal or named colour becomes a colour part when it
 * evaluates; everything else stays text (whitespace collapsed).
 */
export function splitColors(value: string): ValuePart[] {
  const parts: ValuePart[] = [];
  let text = '';
  const flushText = () => {
    if (text) parts.push({ text });
    text = '';
  };
  let i = 0;
  while (i < value.length) {
    const rest = value.slice(i);
    const fn = /^([a-z-]+)\(/i.exec(rest);
    const prev = value[i - 1] ?? '';
    if (fn && COLOR_FUNCTIONS.has(fn[1].toLowerCase()) && !/[\w-]/.test(prev)) {
      let depth = 0;
      let j = i + fn[1].length;
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')' && --depth === 0) break;
      }
      const source = value.slice(i, j + 1);
      const color = parseColor(source);
      if (color) {
        flushText();
        parts.push({ color, source });
        i = j + 1;
        continue;
      }
    }
    const hex = /^#[0-9a-f]{3,8}\b/i.exec(rest);
    if (hex && !/[\w-]/.test(prev)) {
      const color = parseColor(hex[0]);
      if (color) {
        flushText();
        parts.push({ color, source: hex[0] });
        i += hex[0].length;
        continue;
      }
    }
    const ident = /^[a-z]+/i.exec(rest);
    if (ident && !/[\w-]/.test(prev) && !/^[\w-(]/.test(value[i + ident[0].length] ?? '')) {
      const lower = ident[0].toLowerCase();
      if (lower === 'transparent' || NAMED[lower]) {
        flushText();
        parts.push({ color: parseColor(lower) as Rgba, source: ident[0] });
        i += ident[0].length;
        continue;
      }
    }
    if (ident) {
      text += ident[0];
      i += ident[0].length;
      continue;
    }
    text += value[i];
    i++;
  }
  flushText();
  return parts.map((p) => ('text' in p ? { text: p.text.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ') } : p));
}

/**
 * Do two resolved values render alike? True when they are the same text, or
 * when they split into the same text with the same colours in the same places
 * (same 8-bit RGBA). `hsl(152 60% 38% / 0.08)` and
 * `color-mix(in srgb, hsl(152 60% 38%) 8%, transparent)` render alike.
 */
export function renderAlike(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (norm(a) === norm(b)) return true;
  const pa = splitColors(norm(a));
  const pb = splitColors(norm(b));
  if (pa.length !== pb.length) return false;
  return pa.every((p, i) => {
    const q = pb[i];
    if ('text' in p) return 'text' in q && p.text.trim() === q.text.trim();
    return 'color' in q && sameColor(p.color, q.color);
  });
}
