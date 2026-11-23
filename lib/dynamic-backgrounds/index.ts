/**
 * Dynamic backgrounds — a collage of generated pictures behind the home,
 * project and character pages (design: docs/developer/features/complete/dynamic-backgrounds.md).
 *
 * A collage's pool, eligibility, plan and bytes come only from this module.
 * The uncensored decision is re-made here on every request from the stored
 * settings; it is never a client parameter. The route
 * (`app/api/v1/system/dynamic-backgrounds/route.ts`) is a thin caller of
 * `describeCollage` and `drawCollage`.
 *
 * @module dynamic-backgrounds
 */

import { randomBytes } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { processSingleton } from '@/lib/utils/process-singleton';
import { CANVAS, MIN_COLLAGE_POOL, planCollage, type CollageOrientation } from './layout';
import { seededRandom, shuffle } from './seed';
import { loadCollagePool, poolFingerprint, type CollageScope } from './pools';
import { composeCollage, type ComposeOptions } from './compose';
import { resolveDynamicBackgroundSettings } from './settings';

export { resolveDynamicBackgroundSettings } from './settings';
export { filterForCollage } from './eligibility';
export { loadCollagePool, CollageScopeNotFoundError, COLLAGE_SCOPES } from './pools';
export type { CollageScope, CollageSource } from './pools';
export { planCollage, CANVAS, MIN_COLLAGE_POOL } from './layout';
export type { CollageOrientation, CollageMode, PlannedTile } from './layout';
export { composeCollage } from './compose';

const log = logger.child({ module: 'dynamic-backgrounds' });

export const DYNAMIC_BACKGROUNDS_ROUTE = '/api/v1/system/dynamic-backgrounds';

type Repos = ReturnType<typeof getRepositories>;

export interface CollageRequest {
  userId: string;
  scope: CollageScope;
  /** Required for project / character; null for home. */
  id: string | null;
  orientation: CollageOrientation;
}

export interface CollageStatus {
  enabled: boolean;
  available: boolean;
  count: number;
  refreshMinutes: number;
  /** The image URL for a fresh collage; null when off or below the floor. */
  url: string | null;
}

/** The image URL for a request and seed. */
export function collageImageUrl(req: Omit<CollageRequest, 'userId'>, seed: string): string {
  const params = new URLSearchParams({ action: 'image', scope: req.scope });
  if (req.id) params.set('id', req.id);
  params.set('orientation', req.orientation);
  params.set('seed', seed);
  return `${DYNAMIC_BACKGROUNDS_ROUTE}?${params.toString()}`;
}

/**
 * Whether a page may have a collage, and the URL of a new one (a fresh random
 * seed on every call — that is what makes each refresh a new collage).
 */
export async function describeCollage(req: CollageRequest, repos: Repos = getRepositories()): Promise<CollageStatus> {
  const settings = await resolveDynamicBackgroundSettings(repos, req.userId);
  if (!settings.enabled) {
    log.debug('Dynamic backgrounds are off', { scope: req.scope });
    return { enabled: false, available: false, count: 0, refreshMinutes: settings.refreshMinutes, url: null };
  }
  const pool = await loadCollagePool({ scope: req.scope, id: req.id, userId: req.userId }, settings, repos);
  const available = pool.length >= MIN_COLLAGE_POOL;
  const url = available ? collageImageUrl(req, randomBytes(8).toString('hex')) : null;
  log.debug('Collage status', { scope: req.scope, id: req.id, count: pool.length, available });
  return { enabled: true, available, count: pool.length, refreshMinutes: settings.refreshMinutes, url };
}

/** Composed collages kept for a re-request of the same URL (a second pane, a reload). */
const CACHE_LIMIT = 8;
const collageCache = processSingleton('dynamic-backgrounds.collage-cache', () => new Map<string, Buffer>());

function remember(key: string, buffer: Buffer): void {
  collageCache.delete(key);
  collageCache.set(key, buffer);
  while (collageCache.size > CACHE_LIMIT) {
    const oldest = collageCache.keys().next().value;
    if (oldest === undefined) break;
    collageCache.delete(oldest);
  }
}

/** Test seam: forget every cached collage. */
export function clearCollageCache(): void {
  collageCache.clear();
}

/**
 * Compose the collage for a request and seed. Null when the setting is off,
 * the pool is below the floor, or too few pictures could be read — each is a
 * 404 at the route. Deterministic for (scope, id, orientation, seed, pool).
 */
export async function drawCollage(
  req: CollageRequest & { seed: string },
  repos: Repos = getRepositories(),
  options: ComposeOptions = {},
): Promise<Buffer | null> {
  const settings = await resolveDynamicBackgroundSettings(repos, req.userId);
  if (!settings.enabled) return null;
  const pool = await loadCollagePool({ scope: req.scope, id: req.id, userId: req.userId }, settings, repos);
  if (pool.length < MIN_COLLAGE_POOL) {
    log.debug('Collage pool below the floor', { scope: req.scope, id: req.id, count: pool.length });
    return null;
  }

  const cacheKey = `${req.scope}|${req.id ?? ''}|${req.orientation}|${req.seed}|${settings.allowUncensored ? 'u' : 'm'}|${poolFingerprint(pool)}`;
  const cached = collageCache.get(cacheKey);
  if (cached) {
    log.debug('Collage served from cache', { scope: req.scope, id: req.id });
    remember(cacheKey, cached);
    return cached;
  }

  const random = seededRandom(`${req.seed}|${req.scope}|${req.id ?? ''}|${req.orientation}`);
  const canvas = CANVAS[req.orientation];
  const plan = planCollage({
    mode: req.scope === 'character' ? 'columns' : 'rows',
    canvas,
    sources: pool.map((s) => ({ key: s.fileId, aspect: s.width / s.height })),
    random,
  });
  log.debug('Collage planned', { scope: req.scope, id: req.id, pool: pool.length, tiles: plan.length });

  const buffer = await composeCollage(plan, canvas, shuffle(pool, random), options);
  if (buffer) remember(cacheKey, buffer);
  return buffer;
}
