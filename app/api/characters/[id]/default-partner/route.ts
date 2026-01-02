/**
 * Default Partner API
 * GET /api/characters/:id/default-partner - Get default partner for a character
 * PUT /api/characters/:id/default-partner - Set default partner for a character
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema for updates
const updateDefaultPartnerSchema = z.object({
  partnerId: z.string().uuid().nullable(),
})

// GET /api/characters/:id/default-partner
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id)

      if (!checkOwnership(character, user.id)) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }

      return NextResponse.json({
        partnerId: character.defaultPartnerId || null,
      })
    } catch (error) {
      logger.error('Error fetching default partner', { context: 'GET /api/characters/:id/default-partner' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to fetch default partner' },
        { status: 500 }
      )
    }
  }
)

// PUT /api/characters/:id/default-partner
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const existingCharacter = await repos.characters.findById(id)

      if (!checkOwnership(existingCharacter, user.id)) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }

      const body = await req.json()
      const { partnerId } = updateDefaultPartnerSchema.parse(body)

      // If partnerId is provided, verify it exists and is user-controlled
      if (partnerId) {
        const partner = await repos.characters.findById(partnerId)
        if (!partner || partner.userId !== user.id) {
          return NextResponse.json({ error: 'Partner character not found' }, { status: 404 })
        }
        if (partner.controlledBy !== 'user') {
          return NextResponse.json({ error: 'Partner must be a user-controlled character' }, { status: 400 })
        }
        if (partnerId === id) {
          return NextResponse.json({ error: 'Character cannot be its own partner' }, { status: 400 })
        }
      }

      await repos.characters.update(id, {
        defaultPartnerId: partnerId,
      })

      logger.info('Default partner updated', {
        context: 'PUT /api/characters/:id/default-partner',
        characterId: id,
        partnerId,
      })

      return NextResponse.json({
        partnerId,
        success: true,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      logger.error('Error updating default partner', { context: 'PUT /api/characters/:id/default-partner' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to update default partner' },
        { status: 500 }
      )
    }
  }
)
