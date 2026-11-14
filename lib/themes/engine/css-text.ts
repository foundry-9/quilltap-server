/**
 * Theme engine — writing manifest strings and bundle paths into CSS safely.
 *
 * Anything from a theme's manifest that ends up in generated CSS goes through
 * here at the point it is written: strings are quoted and escaped, bundle
 * paths are held to a plain character set, and asset URLs are built in one
 * place.
 *
 * @module themes/engine/css-text
 */

import { isBundleRelativePath } from '../bundle-paths';

/**
 * A CSS string literal for `value`: double-quoted, with `"`, `\`, control
 * characters and `<` written as escapes, so it can neither end the string nor
 * close a `<style>` element.
 */
export function cssString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\' || ch === '<' || code < 0x20 || code === 0x7f) {
      out += `\\${code.toString(16)} `;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

/**
 * Characters a version 2 bundle path may use. Anything else (spaces, quotes,
 * parentheses, `%`, `?`, `#`) is refused at validation, which keeps every
 * path usable as written in a URL and in CSS.
 */
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

/** A version 2 bundle path: relative, inside the bundle, plain characters. */
export function isSafeBundlePath(p: string): boolean {
  return SAFE_PATH.test(p) && isBundleRelativePath(p) && !p.split('/').some((seg) => seg === '' || seg === '.');
}

/** `./a/b.webp` → `a/b.webp`; leaves anything else as it is. */
export function normaliseBundlePath(p: string): string {
  return p.replace(/^(\.\/)+/, '');
}

/** The URL a bundle asset is served from. */
export function bundleAssetUrl(themeId: string, version: string, bundlePath: string): string {
  return `/api/themes/assets/bundle:${themeId}/${normaliseBundlePath(bundlePath)}?v=${encodeURIComponent(version)}`;
}

/** The URL a bundle font is served from. */
export function bundleFontUrl(themeId: string, version: string, bundlePath: string): string {
  return `/api/themes/fonts/bundle:${themeId}/${normaliseBundlePath(bundlePath)}?v=${encodeURIComponent(version)}`;
}

/** File extensions a `url()` in a theme may name. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif'] as const;

export function hasImageExtension(p: string): boolean {
  const lower = p.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
