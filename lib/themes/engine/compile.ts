/**
 * Theme engine — compile a validated version 2 theme into what the app serves.
 *
 * The CSS the injector writes for a version 2 theme, in order: `@font-face`
 * rules, the emitted token CSS, icon overrides, the scoped custom CSS. All
 * of it is built here, server-side, from validated input, with manifest
 * strings escaped where they are written. Also derives the `data-qt-*`
 * switches (choices and app-owned features) and the swatches the theme
 * picker shows.
 *
 * @module themes/engine/compile
 */

import { substituteVars } from '../snapshot/cascade';
import { bundleAssetUrl, bundleFontUrl, cssString } from './css-text';
import type { ThemeDocument } from './document';
import { emitThemeCss, resolveTheme, type RegistryView, type ResolvedValue } from './resolve';
import { tailwindAlias } from './validate';

/** App-owned behaviour a theme switches on (see THEME_FEATURE_ATTRIBUTES). */
export interface CompiledThemeFeatures {
  pageBackground: boolean;
  focusRing: boolean;
  scrollbar: boolean;
}

export interface PreviewSwatch {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
}

export interface CompiledThemeV2 {
  css: {
    fontFaces: string;
    tokens: string;
    icons: string;
    custom: string;
  };
  /** Every registry choice with the option in force. */
  choices: Record<string, string>;
  features: CompiledThemeFeatures;
  previewColors: { light: PreviewSwatch; dark: PreviewSwatch };
  /** The heading font stack, resolved. */
  headingFont: string;
}

const FONT_FORMATS: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** Concatenate a compiled theme's CSS in injector order. */
export function compiledThemeCss(compiled: CompiledThemeV2): string {
  return [compiled.css.fontFaces, compiled.css.tokens, compiled.css.icons, compiled.css.custom].filter((s) => s.trim()).join('\n\n');
}

function fontFaces(doc: ThemeDocument): string {
  const { id, version } = doc.manifest;
  return (doc.manifest.fonts ?? [])
    .map((font) => {
      const ext = font.src.split('.').pop()!.toLowerCase();
      return [
        '@font-face {',
        `  font-family: ${cssString(font.family)};`,
        `  src: url(${cssString(bundleFontUrl(id, version, font.src))}) format(${cssString(FONT_FORMATS[ext] ?? 'woff2')});`,
        `  font-weight: ${font.weight ?? '400'};`,
        `  font-style: ${font.style ?? 'normal'};`,
        `  font-display: ${font.display ?? 'swap'};`,
        '}',
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * One `[data-icon]` rule per override: `.svg` is masked (tinted), `.webp`
 * painted as an image. Scoped to the theme, so a preview of an inactive theme
 * does not repaint the app's icons.
 */
function iconOverrides(doc: ThemeDocument): string {
  const { id, version } = doc.manifest;
  return Object.entries(doc.manifest.icons ?? {})
    .map(([name, p]) => {
      const url = `url(${cssString(bundleAssetUrl(id, version, p))})`;
      return p.toLowerCase().endsWith('.svg')
        ? `[data-theme="${id}"] [data-icon="${name}"] { --_qt-icon-mask: ${url}; --_qt-icon-bg: none; background-color: currentColor; }`
        : `[data-theme="${id}"] [data-icon="${name}"] { --_qt-icon-mask: none; --_qt-icon-bg: ${url}; background-color: transparent; }`;
    })
    .join('\n');
}

/** Resolve a name to a literal through the theme's values, the registry and Tailwind's map. */
function literal(values: Record<string, ResolvedValue>, name: string): string {
  const lookup = (n: string): string | undefined => {
    if (values[n]) return values[n].value;
    const alias = tailwindAlias(n);
    return alias ? `var(${alias})` : undefined;
  };
  return substituteVars(`var(${name})`, lookup) ?? '';
}

export function compileThemeV2(doc: ThemeDocument, scopedCss: string, registry: RegistryView): CompiledThemeV2 {
  const resolved = resolveTheme(doc.tokens, registry);
  const swatch = (values: Record<string, ResolvedValue>): PreviewSwatch => ({
    background: literal(values, '--theme-background'),
    primary: literal(values, '--theme-primary'),
    secondary: literal(values, '--theme-secondary'),
    accent: literal(values, '--theme-accent'),
  });
  const imageSet = (values: Record<string, ResolvedValue>) => {
    const v = values['--qt-page-background-image']?.value.trim();
    return v !== undefined && v !== 'none';
  };
  return {
    css: {
      fontFaces: fontFaces(doc),
      tokens: emitThemeCss(doc.tokens, { id: doc.manifest.id, version: doc.manifest.version }),
      icons: iconOverrides(doc),
      custom: scopedCss,
    },
    choices: resolved.choices,
    features: {
      pageBackground: imageSet(resolved.light) || imageSet(resolved.dark),
      // The app's focus ring is part of the version 2 contract.
      focusRing: true,
      scrollbar: doc.tokens.tokens['--qt-scrollbar-thumb'] !== undefined,
    },
    previewColors: { light: swatch(resolved.light), dark: swatch(resolved.dark) },
    headingFont: literal(resolved.light, '--qt-heading-font'),
  };
}
