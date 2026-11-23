/**
 * Theme engine — what uses what (Calliope Live, Spec F §0.1).
 *
 * Given a theme's manifest, its tokens document and its custom CSS, say for
 * every bundle path the things that refer to it: a font entry, a font's
 * licence file, an icon override, a subsystem picture, the preview image, a
 * token or primitive value, a `url()` in the custom CSS, or the manifest's
 * own pointers to the tokens and styles files. A `url()` is read with the
 * engine's own parser (`mapUrlTargets`), never a pattern of its own.
 *
 * This is the one source for a draft's served set, its "unused" files, the
 * refusal to remove a file still in use, and what an install leaves out.
 *
 * Pure and client-safe. The manifest is taken as loosely as it comes from
 * disk (a draft's may not pass the schema); a field of the wrong shape is
 * simply not a reference.
 *
 * @module themes/engine/usage
 */

import { normaliseBundlePath } from './css-text';
import { mapUrlTargets } from './urls';
import { tokenModes, type ThemeTokensDocument } from './document';

/** One thing that refers to a bundle file. */
export type BundleFileUse =
  | { kind: 'font'; index: number; family: string }
  | { kind: 'licence-file'; index: number; family: string }
  | { kind: 'icon'; name: string }
  | { kind: 'subsystem'; subsystem: string; field: 'thumbnail' | 'backgroundImage' }
  | { kind: 'preview-image' }
  | { kind: 'tokens-file' }
  | { kind: 'styles-file' }
  | { kind: 'token'; key: string; mode: 'light' | 'dark' }
  | { kind: 'primitive'; name: string; mode: 'light' | 'dark' }
  | { kind: 'custom-css' };

export interface BundleUsageInput {
  /** The parsed theme.json (any shape; null when it does not parse). */
  manifest: Record<string, unknown> | null;
  /** The tokens document, or null when it is missing or does not parse. */
  tokens: ThemeTokensDocument | null;
  /** The custom CSS as written, or null when there is none. */
  css: string | null;
}

/** Bundle path → everything that refers to it. Paths are normalised (`./a` → `a`). */
export type BundleUsage = Map<string, BundleFileUse[]>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every bundle path a CSS value's `url()`s name (data URIs and remote URLs are not bundle paths). */
export function urlTargetsIn(value: string): string[] {
  const out: string[] = [];
  mapUrlTargets(value, (target) => {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('/')) out.push(normaliseBundlePath(target));
    return null;
  });
  return out;
}

/** What refers to each file of a theme. */
export function bundleFileUsage({ manifest, tokens, css }: BundleUsageInput): BundleUsage {
  const usage: BundleUsage = new Map();
  const add = (p: unknown, use: BundleFileUse) => {
    if (typeof p !== 'string' || p === '' || p === 'none') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('/')) return;
    const key = normaliseBundlePath(p);
    const list = usage.get(key) ?? [];
    list.push(use);
    usage.set(key, list);
  };

  if (manifest) {
    add(manifest.tokensPath ?? 'tokens.json', { kind: 'tokens-file' });
    add(manifest.stylesPath, { kind: 'styles-file' });
    add(manifest.previewImage, { kind: 'preview-image' });
    if (Array.isArray(manifest.fonts)) {
      manifest.fonts.forEach((font, index) => {
        if (!isRecord(font)) return;
        const family = typeof font.family === 'string' ? font.family : '';
        add(font.src, { kind: 'font', index, family });
        add(font.licenseFile, { kind: 'licence-file', index, family });
      });
    }
    if (isRecord(manifest.icons)) {
      for (const [name, p] of Object.entries(manifest.icons)) add(p, { kind: 'icon', name });
    }
    if (isRecord(manifest.subsystems)) {
      for (const [subsystem, entry] of Object.entries(manifest.subsystems)) {
        if (!isRecord(entry)) continue;
        add(entry.thumbnail, { kind: 'subsystem', subsystem, field: 'thumbnail' });
        add(entry.backgroundImage, { kind: 'subsystem', subsystem, field: 'backgroundImage' });
      }
    }
  }

  if (tokens) {
    for (const [name, primitive] of Object.entries(tokens.primitives)) {
      for (const p of urlTargetsIn(primitive.value)) add(p, { kind: 'primitive', name, mode: 'light' });
      if (primitive.dark !== undefined) for (const p of urlTargetsIn(primitive.dark)) add(p, { kind: 'primitive', name, mode: 'dark' });
    }
    for (const [key, value] of Object.entries(tokens.tokens)) {
      const modes = tokenModes(value);
      for (const p of urlTargetsIn(modes.value)) add(p, { kind: 'token', key, mode: 'light' });
      if (modes.dark !== undefined) for (const p of urlTargetsIn(modes.dark)) add(p, { kind: 'token', key, mode: 'dark' });
    }
  }

  if (css) {
    const seen = new Set<string>();
    for (const p of urlTargetsIn(css)) {
      if (seen.has(p)) continue;
      seen.add(p);
      add(p, { kind: 'custom-css' });
    }
  }
  return usage;
}

/** One use in plain words (for refusals and the files panel). */
export function describeFileUse(use: BundleFileUse): string {
  switch (use.kind) {
    case 'font':
      return `the font ${use.family || `#${use.index + 1}`}`;
    case 'licence-file':
      return `the licence of the font ${use.family || `#${use.index + 1}`}`;
    case 'icon':
      return `the icon ${use.name}`;
    case 'subsystem':
      return `the ${use.field === 'thumbnail' ? 'thumbnail' : 'background picture'} of ${use.subsystem}`;
    case 'preview-image':
      return 'the preview image';
    case 'tokens-file':
      return 'the manifest (tokens file)';
    case 'styles-file':
      return 'the manifest (custom CSS file)';
    case 'token':
      return `the token ${use.key}${use.mode === 'dark' ? ' (dark)' : ''}`;
    case 'primitive':
      return `the primitive ${use.name}${use.mode === 'dark' ? ' (dark)' : ''}`;
    case 'custom-css':
      return 'the custom CSS';
  }
}
