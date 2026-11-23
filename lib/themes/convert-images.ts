/**
 * Convert a theme bundle directory's raster images to WebP (Spec D,
 * decision 11): a draft keeps its original images, an installed theme carries
 * WebP.
 *
 * Pure over a directory: it reads and rewrites files inside `dir` and nothing
 * else. Each `.png`, `.jpg`, `.jpeg` and `.gif` becomes a `.webp` beside it
 * (the original is removed from the directory) and every reference is
 * rewritten — in `theme.json` (`previewImage`, `icons`, `subsystems`), in token
 * and primitive values, and in the custom CSS — through the engine's own
 * `url()` parser (`mapUrlTargets`), never a string replace. A lossless
 * `.webp` is re-encoded in place, keeping its name. SVG is left alone, and so
 * is an animated image, which is reported. A converted name that would land
 * on a file already in the bundle is an error, and nothing is converted.
 *
 * Encoder settings are the store's (`transcodeToWebP`): quality 85, effort 4.
 *
 * @module themes/convert-images
 */

import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { resolveInside } from '@/lib/paths/resolve-inside';
import { isLosslessWebP } from '@/lib/mount-index/blob-transcode';
import { listBundleFiles } from './theme-bundle';
import { mapUrlTargets, ThemeTokensDocumentSchema } from './engine';
import { normaliseBundlePath } from './engine/css-text';

const logger = createServiceLogger('ThemeImageConversion');

/** The store's WebP settings (`lib/mount-index/blob-transcode.ts`). */
const WEBP_OPTIONS = { quality: 85, effort: 4 } as const;

const CONVERTIBLE = /\.(png|jpe?g|gif)$/i;

export interface ThemeImageConversion {
  /** Original path → new path, for each file renamed. */
  converted: Record<string, string>;
  /** Lossless WebP files re-encoded under their own name. */
  reencoded: string[];
  /** Animated images left as they are. */
  skippedAnimated: string[];
  /** Problems that stopped the conversion; when non-empty nothing was changed. */
  errors: string[];
}

async function isAnimated(data: Buffer): Promise<boolean> {
  const meta = await sharp(data, { animated: true }).metadata();
  return (meta.pages ?? 1) > 1;
}

const encode = (data: Buffer) => sharp(data).webp(WEBP_OPTIONS).toBuffer();

/**
 * Convert the raster images in the bundle directory `dir` and rewrite their
 * references. The manifest is read from `dir/theme.json`.
 */
export async function convertThemeImages(dir: string): Promise<ThemeImageConversion> {
  const result: ThemeImageConversion = { converted: {}, reencoded: [], skippedAnimated: [], errors: [] };
  const files = await listBundleFiles(dir);
  const read = async (rel: string) => fs.readFile(await resolveInside(dir, rel, { realpath: true }));

  // Plan first, so a collision changes nothing.
  const renames = new Map<string, string>();
  const reencode: string[] = [];
  const claimed = new Map<string, string>();
  for (const rel of [...files].sort()) {
    const lower = rel.toLowerCase();
    if (!CONVERTIBLE.test(lower) && !lower.endsWith('.webp')) continue;
    const data = await read(rel);
    let animated = false;
    try {
      animated = await isAnimated(data);
    } catch (error) {
      result.errors.push(`${rel}: cannot be read as an image (${(error as Error).message})`);
      continue;
    }
    if (animated) {
      result.skippedAnimated.push(rel);
      continue;
    }
    if (lower.endsWith('.webp')) {
      if (isLosslessWebP(data)) reencode.push(rel);
      continue;
    }
    const target = rel.replace(CONVERTIBLE, '.webp');
    if (files.has(target)) {
      result.errors.push(`${rel}: would become ${target}, which is already in the theme`);
      continue;
    }
    const other = claimed.get(target);
    if (other) {
      result.errors.push(`${rel} and ${other} would both become ${target}`);
      continue;
    }
    claimed.set(target, rel);
    renames.set(rel, target);
  }
  if (result.errors.length > 0) {
    logger.debug('Theme image conversion refused', { dir, errors: result.errors });
    return result;
  }

  for (const [from, to] of renames) {
    const webp = await encode(await read(from));
    await fs.writeFile(await resolveInside(dir, to), webp);
    await fs.rm(await resolveInside(dir, from, { realpath: true }));
    result.converted[from] = to;
  }
  for (const rel of reencode) {
    await fs.writeFile(await resolveInside(dir, rel, { realpath: true }), await encode(await read(rel)));
    result.reencoded.push(rel);
  }

  if (renames.size > 0) await rewriteReferences(dir, renames);
  logger.debug('Converted theme images to WebP', {
    dir,
    converted: Object.keys(result.converted).length,
    reencoded: result.reencoded.length,
    skippedAnimated: result.skippedAnimated,
  });
  return result;
}

/** Rewrite every reference to a renamed file in the manifest, the tokens and the CSS. */
async function rewriteReferences(dir: string, renames: ReadonlyMap<string, string>): Promise<void> {
  const renamePath = (p: string) => renames.get(normaliseBundlePath(p)) ?? null;
  const inValue = (value: string) => mapUrlTargets(value, renamePath);

  const manifestFile = await resolveInside(dir, 'theme.json', { realpath: true });
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8')) as Record<string, unknown>;
  if (typeof manifest.previewImage === 'string') manifest.previewImage = renamePath(manifest.previewImage) ?? manifest.previewImage;
  if (manifest.icons && typeof manifest.icons === 'object') {
    const icons = manifest.icons as Record<string, unknown>;
    for (const [name, p] of Object.entries(icons)) if (typeof p === 'string') icons[name] = renamePath(p) ?? p;
  }
  if (manifest.subsystems && typeof manifest.subsystems === 'object') {
    for (const sub of Object.values(manifest.subsystems as Record<string, Record<string, unknown>>)) {
      for (const key of ['thumbnail', 'backgroundImage'] as const) {
        const p = sub?.[key];
        if (typeof p === 'string' && p !== 'none') sub[key] = renamePath(p) ?? p;
      }
    }
  }
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const tokensPath = typeof manifest.tokensPath === 'string' ? manifest.tokensPath : 'tokens.json';
  const tokensFile = await resolveInside(dir, tokensPath, { realpath: true });
  const tokens = ThemeTokensDocumentSchema.parse(JSON.parse(await fs.readFile(tokensFile, 'utf-8')));
  for (const primitive of Object.values(tokens.primitives)) {
    primitive.value = inValue(primitive.value);
    if (primitive.dark !== undefined) primitive.dark = inValue(primitive.dark);
  }
  for (const [name, value] of Object.entries(tokens.tokens)) {
    tokens.tokens[name] =
      typeof value === 'string'
        ? inValue(value)
        : { value: inValue(value.value), ...(value.dark !== undefined ? { dark: inValue(value.dark) } : {}) };
  }
  await fs.writeFile(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`);

  if (typeof manifest.stylesPath === 'string') {
    const cssFile = await resolveInside(dir, manifest.stylesPath, { realpath: true });
    await fs.writeFile(cssFile, inValue(await fs.readFile(cssFile, 'utf-8')));
  }
}
