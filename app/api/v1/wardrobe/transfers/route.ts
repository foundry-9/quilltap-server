/**
 * Wardrobe transfer API.
 *
 * POST /api/v1/wardrobe/transfers
 *   Moves or copies one wardrobe item between wardrobe tiers — a thin
 *   wrapper over `transferWardrobeItem` (`lib/wardrobe/transfers.ts`), which
 *   holds the rules. The destinations the dialog offers come from the shared
 *   container catalogue, not from here.
 */

import { z } from 'zod'
import { createContextHandler } from '@/lib/api/middleware'
import { successResponse, badRequest, conflict, notFound, serverError } from '@/lib/api/responses'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { logger } from '@/lib/logger'
import {
  WardrobeTransferRefusedError,
  WardrobeTransferSourceNotFoundError,
  transferWardrobeItem,
  wardrobeTransferRequestSchema,
} from '@/lib/wardrobe/transfers'

export const POST = createContextHandler(async (req, { user, repos }) => {
  try {
    const body = wardrobeTransferRequestSchema.parse(await req.json())
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
})
