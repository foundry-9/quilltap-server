/**
 * Theme engine — the `url()` rule for version 2 themes.
 *
 * In custom CSS and in token values a `url()` may name either
 * - a relative path to a file present in the bundle with an image extension,
 *   rewritten to `/api/themes/assets/bundle:<id>/<path>?v=<version>`, or
 * - a `data:image/…` URI, kept as written.
 * Absolute, rooted, remote and protocol-relative URLs are refused, as is a
 * string inside `image-set()` (which browsers treat as a URL) not wrapped in
 * `url()`.
 *
 * @module themes/engine/urls
 */

import { bundleAssetUrl, cssString, hasImageExtension, isSafeBundlePath, normaliseBundlePath } from './css-text';

export interface UrlContext {
  themeId: string;
  version: string;
  /**
   * Bundle-relative paths of every file in the bundle. Validation passes it
   * and a missing file is an error; emission after validation may omit it.
   */
  files?: ReadonlySet<string>;
}

export interface UrlRewrite {
  value: string;
  errors: string[];
}

/** Why `target` is not allowed, or null when it is. */
function refusal(target: string, ctx: UrlContext): string | null {
  if (/^data:/i.test(target)) {
    return /^data:image\/[a-z0-9.+-]+[;,]/i.test(target) ? null : `only data:image/… URIs are allowed, not ${target.slice(0, 40)}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return `remote or absolute URL ${target} is not allowed; ship the file in the bundle`;
  if (target.startsWith('//')) return `protocol-relative URL ${target} is not allowed`;
  if (target.startsWith('/')) return `rooted URL ${target} is not allowed; use a path relative to the bundle`;
  const p = normaliseBundlePath(target);
  if (!isSafeBundlePath(p)) return `url(${target}) is not a plain path inside the bundle (letters, digits, . _ - / only)`;
  if (!hasImageExtension(p)) return `url(${target}) does not name an image (png, jpg, gif, svg, webp, avif)`;
  if (ctx.files && !ctx.files.has(p)) return `url(${target}) names a file that is not in the bundle`;
  return null;
}

/** Index of the `)` that closes the `(` at `open`, honouring quotes. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function unquote(raw: string): string | null {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    const inner = t.slice(1, -1);
    // An escape inside a URL string is never needed for a bundle path or data URI.
    return inner.includes('\\') ? null : inner;
  }
  return /["'\\\s]/.test(t) ? null : t;
}

/** Check and rewrite every `url()` in a CSS value. */
export function rewriteUrls(value: string, ctx: UrlContext): UrlRewrite {
  const errors: string[] = [];
  let out = '';
  let i = 0;
  const lower = value.toLowerCase();
  while (i < value.length) {
    const at = lower.indexOf('url(', i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    const prev = value[at - 1] ?? '';
    if (/[\w-]/.test(prev)) {
      out += value.slice(i, at + 4);
      i = at + 4;
      continue;
    }
    const close = closeParen(value, at + 3);
    if (close < 0) {
      errors.push('unbalanced url(');
      return { value, errors };
    }
    const target = unquote(value.slice(at + 4, close));
    if (target === null) {
      errors.push(`url(${value.slice(at + 4, close).trim()}) is not a plain quoted or unquoted URL`);
      out += value.slice(i, close + 1);
    } else {
      const why = refusal(target, ctx);
      if (why) errors.push(why);
      const rewritten = /^data:/i.test(target) ? cssString(target) : cssString(bundleAssetUrl(ctx.themeId, ctx.version, target));
      out += `${value.slice(i, at)}url(${rewritten})`;
    }
    i = close + 1;
  }
  // image-set() accepts bare strings as URLs; require url() inside it.
  for (const m of value.matchAll(/(?:-webkit-)?image-set\(/gi)) {
    const open = (m.index as number) + m[0].length - 1;
    const close = closeParen(value, open);
    const inner = close < 0 ? value.slice(open) : value.slice(open + 1, close);
    const withoutUrls = inner.replace(/url\([^)]*\)/gi, '');
    if (/["']/.test(withoutUrls)) errors.push('image-set() takes url() entries here, not bare strings');
  }
  return { value: out, errors };
}
