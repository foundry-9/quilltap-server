// Character Controlled-By API: Toggle controlled-by status
// PATCH /api/characters/:id/controlled-by - Toggle character controlled-by status

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

// PATCH /api/characters/:id/controlled-by - Toggle controlled-by status
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const existingCharacter = await repos.characters.findById(id)

      if (!checkOwnership(existingCharacter, user.id)) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }

      // Toggle the controlledBy property
      const newControlledBy = existingCharacter.controlledBy === 'user' ? 'llm' : 'user'
      const character = await repos.characters.setControlledBy(id, newControlledBy)

      logger.info('Character controlledBy toggled', { characterId: id, controlledBy: newControlledBy })

      return NextResponse.json({ character })
    } catch (error) {
      logger.error('Error toggling character controlledBy', { context: 'PATCH /api/characters/[id]/controlled-by' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to toggle controlled-by' },
        { status: 500 }
      )
    }
  }
)
