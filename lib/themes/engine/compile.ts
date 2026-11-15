/**
 * Theme engine — compile a validated theme into what the app serves.
 *
 * The CSS the injector writes for a theme, in order: `@font-face`
 * rules, the emitted token CSS, icon overrides, the scoped custom CSS. All
 * of it is built here, server-side, from validated input, with manifest
 * strings escaped where they are written. Also derives the `data-qt-*`
 * switches (choices and app-owned features) and the swatches the theme
 * picker shows.
 *
 * @module themes/engine/compile
 */

import { wrapInThemeScope } from './boundary';
import { bundleAssetUrl, bundleFontUrl, cssString, normaliseBundlePath } from './css-text';
import type { ThemeDocument, ThemeTokensDocument } from './document';
import { resolveLiteral } from './literal';
import { emitThemeCss, resolveTheme, type RegistryView, type ResolvedTheme, type ResolvedValue } from './resolve';

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

/** What the theme picker shows for a theme: swatches and the heading font. */
export interface ThemePreview {
  previewColors: { light: PreviewSwatch; dark: PreviewSwatch };
  /** The heading font stack, resolved. */
  headingFont: string;
}

export interface CompiledTheme {
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
  /**
   * Every bundle file the asset route may serve for this theme: the preview
   * image, icon overrides, subsystem images, font licence files and each
   * `url()` the compiled CSS points at. Anything else is not served.
   */
  assets: string[];
}

const FONT_FORMATS: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** Concatenate a compiled theme's CSS in injector order. */
export function compiledThemeCss(compiled: CompiledTheme): string {
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
 * does not repaint the app's icons, and stopped at any nested element wearing
 * another theme (./boundary.ts).
 */
function iconOverrides(doc: ThemeDocument): string {
  const { id, version } = doc.manifest;
  const rules = Object.entries(doc.manifest.icons ?? {}).map(([name, p]) => {
    const url = `url(${cssString(bundleAssetUrl(id, version, p))})`;
    return p.toLowerCase().endsWith('.svg')
      ? `:scope [data-icon="${name}"] { --_qt-icon-mask: ${url}; --_qt-icon-bg: none; background-color: currentColor; }`
      : `:scope [data-icon="${name}"] { --_qt-icon-mask: none; --_qt-icon-bg: ${url}; background-color: transparent; }`;
  });
  return rules.length > 0 ? wrapInThemeScope(id, rules.join('\n')) : '';
}

/** A name as a literal, or "" when it does not resolve (the picker shows nothing). */
function literal(values: Record<string, ResolvedValue>, name: string): string {
  return resolveLiteral(values, name) ?? '';
}

function previewFrom(resolved: ReturnType<typeof resolveTheme>): ThemePreview {
  const swatch = (values: Record<string, ResolvedValue>): PreviewSwatch => ({
    background: literal(values, '--theme-background'),
    primary: literal(values, '--theme-primary'),
    secondary: literal(values, '--theme-secondary'),
    accent: literal(values, '--theme-accent'),
  });
  return {
    previewColors: { light: swatch(resolved.light), dark: swatch(resolved.dark) },
    headingFont: literal(resolved.light, '--qt-heading-font'),
  };
}

const EMPTY_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} };

/** The default theme's preview: the registry defaults, resolved. */
export function defaultThemePreview(registry: RegistryView): ThemePreview {
  return previewFrom(resolveTheme(EMPTY_TOKENS, registry));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The bundle files the theme's manifest names or its compiled CSS points at. */
function servedAssets(doc: ThemeDocument, cssParts: string[]): string[] {
  const { manifest } = doc;
  const assets = new Set<string>();
  const add = (p: string | undefined) => {
    if (p && p !== 'none') assets.add(normaliseBundlePath(p));
  };
  add(manifest.previewImage);
  for (const p of Object.values(manifest.icons ?? {})) add(p);
  for (const sub of Object.values(manifest.subsystems ?? {})) {
    add(sub.thumbnail);
    add(sub.backgroundImage);
  }
  for (const font of manifest.fonts ?? []) add(font.licenseFile);
  const prefix = new RegExp(`/api/themes/assets/bundle:${escapeRegExp(manifest.id)}/([A-Za-z0-9._\\-/]+)\\?v=`, 'g');
  for (const css of cssParts) for (const m of css.matchAll(prefix)) add(m[1]);
  return [...assets].sort();
}

/**
 * The app-owned switches a theme turns on, from its resolved values and its
 * own tokens. Shared by the server compile and the browser-side preview, so
 * both derive them with the same code.
 */
export function deriveThemeFeatures(resolved: ResolvedTheme, tokens: ThemeTokensDocument): CompiledThemeFeatures {
  const imageSet = (values: Record<string, ResolvedValue>) => {
    const v = values['--qt-page-background-image']?.value.trim();
    return v !== undefined && v !== 'none';
  };
  return {
    pageBackground: imageSet(resolved.light) || imageSet(resolved.dark),
    // The app's focus ring is part of the theme contract.
    focusRing: true,
    scrollbar: tokens.tokens['--qt-scrollbar-thumb'] !== undefined,
  };
}

export function compileTheme(doc: ThemeDocument, scopedCss: string, registry: RegistryView): CompiledTheme {
  const resolved = resolveTheme(doc.tokens, registry);
  const css = {
    fontFaces: fontFaces(doc),
    tokens: emitThemeCss(doc.tokens, { id: doc.manifest.id, version: doc.manifest.version }),
    icons: iconOverrides(doc),
    custom: scopedCss,
  };
  return {
    css,
    choices: resolved.choices,
    features: deriveThemeFeatures(resolved, doc.tokens),
    ...previewFrom(resolved),
    assets: servedAssets(doc, [css.tokens, css.icons, css.custom]),
  };
}
