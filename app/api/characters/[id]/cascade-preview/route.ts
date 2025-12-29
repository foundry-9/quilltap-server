// Cascade Delete Preview API
// GET /api/characters/:id/cascade-preview - Get preview of what will be deleted

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { getCascadeDeletePreview } from '@/lib/cascade-delete'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character ownership
      const character = await repos.characters.findById(id)

      if (!checkOwnership(character, user.id)) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }

      const preview = await getCascadeDeletePreview(id)

      if (!preview) {
        return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 })
      }

      // Transform to a simpler response format for the frontend
      return NextResponse.json({
        characterId: preview.characterId,
        characterName: preview.characterName,
        exclusiveChats: preview.exclusiveChats.map(c => ({
          id: c.chat.id,
          title: c.chat.title,
          messageCount: c.messageCount,
          lastMessageAt: c.chat.lastMessageAt,
        })),
        exclusiveCharacterImageCount: preview.exclusiveCharacterImages.length,
        exclusiveChatImageCount: preview.exclusiveChatImages.length,
        totalExclusiveImageCount:
          preview.exclusiveCharacterImages.length + preview.exclusiveChatImages.length,
        memoryCount: preview.memoryCount,
      })
    } catch (error) {
      logger.error('Error generating cascade delete preview', { context: 'GET /api/characters/:id/cascade-preview' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to generate preview' },
        { status: 500 }
      )
    }
  }
)
