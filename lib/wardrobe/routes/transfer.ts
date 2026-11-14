/**
 * Wardrobe transfer — the handler behind
 * `POST /api/v1/wardrobe?action=move-to-tier` / `?action=copy-to-tier`
 * (and, for one release, the old `POST /api/v1/wardrobe/transfers`, which took
 * `action` in the body).
 *
 *   Moves or copies one wardrobe item between wardrobe tiers — a thin
 *   wrapper over `transferWardrobeItem` (`lib/wardrobe/transfers.ts`), which
 *   holds the rules. The destinations the dialog offers come from the shared
 *   container catalogue, not from here.
 */

import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { RequestContext } from '@/lib/api/middleware'
import { successResponse, badRequest, conflict, notFound, serverError } from '@/lib/api/responses'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { logger } from '@/lib/logger'
import {
  WardrobeTransferRefusedError,
  WardrobeTransferSourceNotFoundError,
  transferWardrobeItem,
  wardrobeTransferRequestSchema,
} from '@/lib/wardrobe/transfers'

/**
 * Transfer one item. `mode` comes from the action (`move-to-tier` /
 * `copy-to-tier`); `'from-body'` is the deprecated path, where the body named
 * it.
 */
export function handleWardrobeTransfer(mode: 'move' | 'copy' | 'from-body') {
  return async (req: NextRequest, { user, repos }: RequestContext) => {
    try {
      const raw = (await req.json()) as Record<string, unknown>
      const body = wardrobeTransferRequestSchema.parse(mode === 'from-body' ? raw : { ...raw, action: mode })
      const { unresolvedComponentIds, ...result } = await transferWardrobeItem(repos, user.id, body)
      return successResponse({
        ...result,
        ...(unresolvedComponentIds.length > 0 ? { unresolvedComponentIds } : {}),
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(error.issues.map((issue) => issue.message).join('; '))
      }
      if (error instanceof WardrobeTransferSourceNotFoundError) return notFound('Wardrobe item')
      if (error instanceof WardrobeTransferRefusedError) return badRequest(error.message)
      if (error instanceof CharacterArchivedError) {
        return conflict('An archived character\'s wardrobe cannot be changed')
      }
      logger.error('[WardrobeTransfers v1] Failed to transfer item', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to transfer wardrobe item')
    }
  }
}
