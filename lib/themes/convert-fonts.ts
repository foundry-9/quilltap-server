/**
 * Convert a theme bundle directory's TrueType and OpenType fonts to WOFF2
 * (Calliope Live, Spec F decision 2): a draft keeps its fonts as uploaded, an
 * installed theme carries WOFF2. The same shape as `./convert-images.ts`.
 *
 * The only importer of `wawoff2` (WebAssembly, inlined in the package; no
 * native build). Pure over a directory: it reads and rewrites files inside
 * `dir` and nothing else. Each `.ttf` and `.otf` that a manifest font entry
 * names becomes a `.woff2` beside it, the original is removed, and every
 * entry naming it gets the new `src`. A `.woff` is left as it is — it is
 * already compressed, and the encoder takes only uncompressed fonts. Before
 * anything is written the plan is checked: a target name already in the
 * bundle (or claimed twice) is an error and nothing is converted. A file the
 * encoder rejects, or whose WOFF2 does not read back as the same family,
 * weight and axes, is an error naming the file.
 *
 * @module themes/convert-fonts
 */

import fs from 'node:fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { resolveInside } from '@/lib/paths/resolve-inside';
import { listBundleFiles } from './theme-bundle';
import { normaliseBundlePath } from './engine/css-text';
import { readFontInfo } from './font-info';

const logger = createServiceLogger('ThemeFontConversion');

const CONVERTIBLE = /\.(ttf|otf)$/i;

export interface ThemeFontConversion {
  /** Original path → new path, for each file converted. */
  converted: Record<string, string>;
  /** Problems that stopped the conversion; when non-empty nothing was changed. */
  errors: string[];
}

type Encoder = (data: Uint8Array) => Promise<Uint8Array>;

let encoder: Promise<Encoder> | null = null;

/** wawoff2's `compress`, loaded once (its WebAssembly runtime starts on first use). */
function woff2Encoder(): Promise<Encoder> {
  encoder ??= import('wawoff2').then((m) => {
    const mod = m as unknown as { compress?: Encoder; default?: { compress: Encoder } };
    const compress = mod.compress ?? mod.default?.compress;
    if (!compress) throw new Error('the WOFF2 encoder did not load');
    return compress;
  });
  return encoder;
}

/** Encode one TrueType / OpenType font as WOFF2. Throws when the encoder refuses it. */
export async function encodeWoff2(data: Buffer): Promise<Buffer> {
  const compress = await woff2Encoder();
  return Buffer.from(await compress(data));
}

/**
 * Convert the fonts the manifest in `dir/theme.json` names, and rewrite the
 * manifest's `src` fields to match.
 */
export async function convertThemeFonts(dir: string): Promise<ThemeFontConversion> {
  const result: ThemeFontConversion = { converted: {}, errors: [] };
  const manifestFile = await resolveInside(dir, 'theme.json', { realpath: true });
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8')) as Record<string, unknown>;
  const fonts = Array.isArray(manifest.fonts) ? (manifest.fonts as Array<Record<string, unknown>>) : [];
  const files = await listBundleFiles(dir);

  // Plan first, so a collision changes nothing.
  const plan = new Map<string, string>();
  const claimed = new Map<string, string>();
  for (const font of fonts) {
    if (typeof font?.src !== 'string') continue;
    const src = normaliseBundlePath(font.src);
    if (!CONVERTIBLE.test(src) || plan.has(src)) continue;
    if (!files.has(src)) continue; // validation reports a missing file; nothing to convert
    const target = src.replace(CONVERTIBLE, '.woff2');
    if (files.has(target)) {
      result.errors.push(`${src}: would become ${target}, which is already in the theme`);
      continue;
    }
    const other = claimed.get(target);
    if (other) {
      result.errors.push(`${src} and ${other} would both become ${target}`);
      continue;
    }
    claimed.set(target, src);
    plan.set(src, target);
  }
  if (result.errors.length > 0) {
    logger.debug('Theme font conversion refused', { dir, errors: result.errors });
    return result;
  }

  // Encode everything before writing anything, so a rejected file changes nothing.
  const encoded = new Map<string, Buffer>();
  for (const [from, to] of plan) {
    const original = await fs.readFile(await resolveInside(dir, from, { realpath: true }));
    let woff2: Buffer;
    try {
      woff2 = await encodeWoff2(original);
    } catch (error) {
      result.errors.push(`${from}: the WOFF2 encoder could not convert it (${(error as Error).message})`);
      continue;
    }
    const before = readFontInfo(original);
    const after = readFontInfo(woff2);
    if (before.ok && (!after.ok || after.info.family !== before.info.family || after.info.weight !== before.info.weight || after.info.axes.join() !== before.info.axes.join())) {
      result.errors.push(`${from}: its WOFF2 copy does not read back as the same font`);
      continue;
    }
    encoded.set(to, woff2);
    logger.debug('Encoded a theme font as WOFF2', { from, to, bytes: original.length, woff2Bytes: woff2.length });
  }
  if (result.errors.length > 0) {
    logger.debug('Theme font conversion failed', { dir, errors: result.errors });
    return result;
  }

  for (const [from, to] of plan) {
    await fs.writeFile(await resolveInside(dir, to), encoded.get(to) as Buffer);
    await fs.rm(await resolveInside(dir, from, { realpath: true }));
    result.converted[from] = to;
  }
  if (plan.size > 0) {
    for (const font of fonts) {
      if (typeof font?.src !== 'string') continue;
      const to = plan.get(normaliseBundlePath(font.src));
      if (to) font.src = to;
    }
    await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  logger.debug('Converted theme fonts to WOFF2', { dir, converted: plan.size });
  return result;
}
