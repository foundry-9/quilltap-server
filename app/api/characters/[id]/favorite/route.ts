// Character Favorite API: Toggle favorite status
// PATCH /api/characters/:id/favorite - Toggle character favorite status

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

// PATCH /api/characters/:id/favorite - Toggle favorite status
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const existingCharacter = await repos.characters.findById(id)

      if (!checkOwnership(existingCharacter, user.id)) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }

      // Toggle the isFavorite property
      const character = await repos.characters.setFavorite(id, !existingCharacter.isFavorite)

      return NextResponse.json({ character })
    } catch (error) {
      logger.error('Error toggling character favorite', { context: 'PATCH /api/characters/[id]/favorite' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to toggle favorite' },
        { status: 500 }
      )
    }
  }
)
