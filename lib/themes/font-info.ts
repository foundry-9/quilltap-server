/**
 * What a font file is, read from the font (Calliope Live, Spec F decision 1).
 *
 * The only importer of `fontkit`. Given the bytes of an uploaded font it
 * returns the family (the typographic family where the font has one), the
 * weight (one value, or the `wght` axis range as `"100 900"`), the style,
 * whether it is variable, the licence text and URL from its name table and
 * its embedding permission; or a failure. It never throws on bad input, and
 * is only ever handed files already under the bundle's size limit.
 *
 * When a file cannot be parsed but its leading bytes are a font's, the
 * caller falls back to {@link guessFontFromFileName}.
 *
 * Server only (fontkit is a server external, `next.config.js`).
 *
 * @module themes/font-info
 */

import * as fontkit from 'fontkit';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('ThemeFontInfo');

export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';
export type FontStyle = 'normal' | 'italic' | 'oblique';

/**
 * What the font's OS/2 `fsType` says about embedding it: installable (no
 * restriction), editable, preview-and-print, or restricted (no embedding).
 */
export type FontEmbedding = 'installable' | 'editable' | 'preview-print' | 'restricted';

export interface FontInfo {
  format: FontFormat;
  family: string;
  /** `"400"`, or a variable font's `wght` range such as `"100 900"`. */
  weight: string;
  style: FontStyle;
  variable: boolean;
  /** Variation axis tags (`wght`, `wdth`, …), empty for a static font. */
  axes: string[];
  /** The licence description from the name table (ID 13), trimmed; a hint only. */
  licence: string | null;
  /** The licence URL from the name table (ID 14). */
  licenceUrl: string | null;
  embedding: FontEmbedding;
}

export type FontRead = { ok: true; info: FontInfo } | { ok: false; format: FontFormat | null; reason: string };

/** The longest licence text passed on as a hint. */
const LICENCE_HINT_MAX = 2000;

/** The font format the leading bytes announce, or null when they are not a font's. */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf';
  return null;
}

/**
 * Whether a file's extension agrees with its bytes. `.ttf` and `.otf` are both
 * the SFNT container, which may carry either outline format, so either
 * extension accepts either signature; `.woff` and `.woff2` must match exactly.
 */
export function fontExtensionMatches(extension: string, format: FontFormat): boolean {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (ext === 'ttf' || ext === 'otf') return format === 'ttf' || format === 'otf';
  return ext === format;
}

const clampHundred = (n: number) => Math.min(900, Math.max(100, n));

/** A `wght` range as the manifest writes it: whole hundreds inside the axis, 100–900. */
function weightRange(min: number, max: number): string {
  const lo = clampHundred(Math.ceil(min / 100) * 100);
  const hi = clampHundred(Math.floor(max / 100) * 100);
  return hi > lo ? `${lo} ${hi}` : `${lo}`;
}

function embeddingOf(fsType: NonNullable<fontkit.FontkitFont['OS/2']>['fsType']): FontEmbedding {
  if (!fsType) return 'installable';
  if (fsType.noEmbedding) return 'restricted';
  if (fsType.viewOnly) return 'preview-print';
  if (fsType.editable) return 'editable';
  return 'installable';
}

const clean = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/** Read what a font is. Never throws. */
export function readFontInfo(bytes: Buffer): FontRead {
  const format = sniffFontFormat(bytes);
  if (!format) return { ok: false, format: null, reason: 'the file does not begin like a font' };
  try {
    const opened = fontkit.create(bytes);
    if ('fonts' in opened) return { ok: false, format, reason: 'a font collection, not a single font' };
    const font = opened;
    const family = clean(font.getName('preferredFamily')) ?? clean(font.familyName);
    if (!family) return { ok: false, format, reason: 'the font names no family' };
    const os2 = font['OS/2'];
    const axes = Object.keys(font.variationAxes ?? {});
    const wght = font.variationAxes?.wght;
    const weight = wght ? weightRange(wght.min, wght.max) : `${clampHundred(Math.round((os2?.usWeightClass ?? 400) / 100) * 100)}`;
    const subfamily = (clean(font.getName('preferredSubfamily')) ?? clean(font.subfamilyName) ?? '').toLowerCase();
    const style: FontStyle = os2?.fsSelection?.oblique
      ? 'oblique'
      : os2?.fsSelection?.italic || font.italicAngle !== 0 || /italic/.test(subfamily)
        ? 'italic'
        : /oblique/.test(subfamily)
          ? 'oblique'
          : 'normal';
    const licence = clean(font.getName('license'));
    const info: FontInfo = {
      format,
      family: family.slice(0, 100),
      weight,
      style,
      variable: axes.length > 0,
      axes,
      licence: licence ? licence.slice(0, LICENCE_HINT_MAX) : null,
      licenceUrl: clean(font.getName('licenseURL')),
      embedding: embeddingOf(os2?.fsType),
    };
    logger.debug('Read a font', { format, family: info.family, weight, style, variable: info.variable, embedding: info.embedding });
    return { ok: true, info };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.debug('A font could not be parsed', { format, reason });
    return { ok: false, format, reason };
  }
}

/** Weight words in file names, longest first so "ExtraBold" wins over "Bold". */
const WEIGHT_WORDS: ReadonlyArray<[RegExp, number]> = [
  [/(extra|ultra)[-_ ]?light/i, 200],
  [/(semi|demi)[-_ ]?bold/i, 600],
  [/(extra|ultra)[-_ ]?bold/i, 800],
  [/hairline|thin/i, 100],
  [/light/i, 300],
  [/regular|normal|book|roman/i, 400],
  [/medium/i, 500],
  [/bold/i, 700],
  [/black|heavy/i, 900],
];

export interface FontNameGuess {
  family: string;
  weight: string;
  style: FontStyle;
  variable: boolean;
}

/**
 * The family, weight and style a font file's name suggests — the fallback
 * when the font itself cannot be read. Knows the common weight words (Thin
 * to Black), `Italic`, `Oblique`, `Variable` / `VF`, and a `wght` range in
 * brackets (`Inter[wght].ttf`, `Inter[wght,slnt]`, `Foo[wght=100..900]`).
 */
export function guessFontFromFileName(fileName: string): FontNameGuess {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(woff2?|ttf|otf)$/i, '');
  let rest = base;
  let variable = false;
  let weight: string | null = null;

  const bracket = /\[([^\]]*)\]/.exec(rest);
  if (bracket) {
    const axes = bracket[1];
    if (/wght/i.test(axes)) {
      variable = true;
      const range = /wght\s*[=:]?\s*(\d{3})\s*(?:\.\.|-|–|,)\s*(\d{3})/i.exec(axes);
      weight = range ? weightRange(Number(range[1]), Number(range[2])) : '100 900';
    } else if (axes.trim()) {
      variable = true;
    }
    rest = rest.replace(bracket[0], ' ');
  }
  if (/(^|[-_ ])(variable|vf)($|[-_ ])/i.test(rest) || /Variable/.test(rest)) {
    variable = true;
    rest = rest.replace(/[-_ ]?(Variable|VF)\b/gi, ' ');
    weight ??= '100 900';
  }

  const style: FontStyle = /oblique/i.test(rest) ? 'oblique' : /italic/i.test(rest) ? 'italic' : 'normal';
  rest = rest.replace(/italic|oblique/gi, ' ');

  // The weight word is read from the part after the family: the last hyphen
  // or underscore segment when there is one, else trailing words.
  const dash = rest.search(/[-_](?=[^-_]*$)/);
  let familyPart = rest;
  let stylePart = '';
  if (dash > 0) {
    familyPart = rest.slice(0, dash);
    stylePart = rest.slice(dash + 1);
  }
  if (!weight) {
    const hit = WEIGHT_WORDS.find(([re]) => re.test(stylePart));
    if (hit) weight = `${hit[1]}`;
    else {
      // "Lora Bold" — a trailing weight word with no separator.
      const trailing = WEIGHT_WORDS.find(([re]) => new RegExp(`(?:^|\\s|(?<=[a-z]))(${re.source})\\s*$`, 'i').test(familyPart));
      if (trailing) {
        weight = `${trailing[1]}`;
        familyPart = familyPart.replace(new RegExp(`(${trailing[0].source})\\s*$`, 'i'), '');
      }
    }
  }
  const family =
    familyPart
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || base || 'Font';
  return { family: family.slice(0, 100), weight: weight ?? '400', style, variable };
}
