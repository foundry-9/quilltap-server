/**
 * Turn a collage plan into one WebP (spec §4.3).
 *
 * Each distinct picture is read once per collage and cover-cropped into every
 * tile it fills; tiles are composited onto a blank canvas in one pass. A tile
 * whose picture cannot be read or decoded takes the next readable picture in
 * the substitution order instead. Fewer than `MIN_COLLAGE_POOL` readable
 * pictures on the canvas → `null` (the route answers 404).
 *
 * Nothing is written anywhere: the collage is not a `files` row, never in a
 * gallery, export or backup. Raw sharp errors never leave this module.
 *
 * @module dynamic-backgrounds/compose
 */

import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import type { FileEntry } from '@/lib/schemas/types';
import { MIN_COLLAGE_POOL, type PlannedTile } from './layout';
import type { CollageSource } from './pools';

const log = logger.child({ module: 'dynamic-backgrounds.compose' });

/** Tiles decoded at once. */
const TILE_CONCURRENCY = 4;
const WEBP_QUALITY = 72;
const BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 };

export interface ComposeOptions {
  /** Reads a source's bytes; defaults to `fileStorageManager.downloadFile`. */
  readBytes?: (file: FileEntry) => Promise<Buffer>;
}

interface RenderedTile {
  input: Buffer;
  raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
  left: number;
  top: number;
  key: string;
}

/** Run `work` over `items`, at most `limit` at a time, keeping order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Compose the plan. `sources` is the whole pool in substitution order (the
 * seeded order the plan was dealt from); tiles name sources by `fileId`.
 */
export async function composeCollage(
  plan: readonly PlannedTile[],
  canvas: { width: number; height: number },
  sources: readonly CollageSource[],
  options: ComposeOptions = {},
): Promise<Buffer | null> {
  const started = Date.now();
  const readBytes = options.readBytes ?? ((file: FileEntry) => fileStorageManager.downloadFile(file));
  const byId = new Map(sources.map((s) => [s.fileId, s]));

  // Bytes are read once per picture per collage; a failed read is remembered.
  const bytes = new Map<string, Promise<Buffer | null>>();
  const unreadable = new Set<string>();
  const loadBytes = (source: CollageSource): Promise<Buffer | null> => {
    let pending = bytes.get(source.fileId);
    if (!pending) {
      pending = readBytes(source.file).catch((error: unknown) => {
        log.warn('Could not read a collage picture; substituting', {
          fileId: source.fileId,
          error: error instanceof Error ? error.message : String(error),
        });
        unreadable.add(source.fileId);
        return null;
      });
      bytes.set(source.fileId, pending);
    }
    return pending;
  };

  const renderInto = async (source: CollageSource, tile: PlannedTile): Promise<RenderedTile | null> => {
    if (unreadable.has(source.fileId)) return null;
    const input = await loadBytes(source);
    if (!input) return null;
    try {
      const { data, info } = await sharp(input)
        .rotate()
        .resize(tile.width, tile.height, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        input: data,
        raw: { width: info.width, height: info.height, channels: info.channels },
        left: tile.x,
        top: tile.y,
        key: source.fileId,
      };
    } catch (error) {
      log.warn('Could not decode a collage picture; substituting', {
        fileId: source.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      unreadable.add(source.fileId);
      return null;
    }
  };

  // Substitution walks the pool in order, skipping pictures known unreadable.
  let cursor = 0;
  const substitute = async (tile: PlannedTile, avoid: string): Promise<RenderedTile | null> => {
    for (let tries = 0; tries < sources.length; tries++) {
      const candidate = sources[cursor % sources.length];
      cursor += 1;
      if (candidate.fileId === avoid || unreadable.has(candidate.fileId)) continue;
      const rendered = await renderInto(candidate, tile);
      if (rendered) return rendered;
    }
    return null;
  };

  const rendered = await mapLimited(plan, TILE_CONCURRENCY, async (tile) => {
    const source = byId.get(tile.key);
    const direct = source ? await renderInto(source, tile) : null;
    return direct ?? substitute(tile, tile.key);
  });

  const placed = rendered.filter((t): t is RenderedTile => !!t);
  const distinct = new Set(placed.map((t) => t.key));
  if (placed.length < plan.length || distinct.size < MIN_COLLAGE_POOL) {
    log.warn('Too few readable pictures for a collage', {
      tiles: plan.length,
      placed: placed.length,
      distinctReadable: distinct.size,
      unreadable: unreadable.size,
    });
    return null;
  }

  try {
    const output = await sharp({
      create: { width: canvas.width, height: canvas.height, channels: 3, background: BACKGROUND },
    })
      .composite(placed.map((t) => ({ input: t.input, raw: t.raw, left: t.left, top: t.top })))
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    log.debug('Collage composed', {
      tiles: plan.length,
      distinct: distinct.size,
      substituted: unreadable.size,
      bytes: output.byteLength,
      ms: Date.now() - started,
    });
    return output;
  } catch (error) {
    log.warn('Could not compose a collage', {
      tiles: plan.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
