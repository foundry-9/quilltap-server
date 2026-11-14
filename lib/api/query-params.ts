/**
 * Query-parameter readers shared by v1 routes.
 *
 * @module api/query-params
 */

import type { NextRequest } from 'next/server';

/**
 * Read the `?includeArchived=true` opt-in.
 *
 * Archived scenarios and wardrobe items are hidden by default at every listing
 * endpoint; a caller that wants to see them says so explicitly. Reading the
 * param in one place keeps the accepted spelling from drifting between the
 * eleven routes that honour it — anything other than a literal `true` (or the
 * bare valueless `?includeArchived`) means "no".
 */
export function readIncludeArchived(req: NextRequest | Request): boolean {
  let raw: string | null;
  try {
    raw = new URL(req.url).searchParams.get('includeArchived');
  } catch {
    // No parseable URL (an odd runtime, a bare stub in a test): fall closed.
    // Hiding archived entries is always the safe answer to "were we asked?".
    return false;
  }
  return raw === 'true' || raw === '';
}

/** A parsed `?limit=` / `?offset=` pair, already clamped. */
export interface Pagination {
  limit: number;
  offset: number;
}

/**
 * Read `?limit=` and `?offset=` the one way.
 *
 * `limit` is clamped to `[1, maxLimit]`; a missing, non-numeric or non-positive
 * value falls back to `defaultLimit` (a `limit=-1` must never reach SQLite,
 * where `LIMIT -1` means "no limit"). `offset` is a non-negative integer,
 * defaulting to 0. `defaultLimit` is itself clamped to `maxLimit`.
 */
export function readPagination(
  req: NextRequest | Request | { nextUrl: URL },
  options: { defaultLimit: number; maxLimit: number }
): Pagination {
  const { defaultLimit, maxLimit } = options;
  let params: URLSearchParams;
  try {
    params = 'nextUrl' in req ? req.nextUrl.searchParams : new URL(req.url).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const fallback = Math.min(Math.max(1, Math.floor(defaultLimit)), maxLimit);
  const rawLimit = parseInt(params.get('limit') ?? '', 10);
  const rawOffset = parseInt(params.get('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, maxLimit) : fallback;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}
