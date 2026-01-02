/**
 * Chat Import API
 * POST /api/chats/import - Import a SillyTavern chat
 *
 * Supports two modes:
 * 1. Legacy mode: Single character + optional persona (backwards compatible)
 * 2. Multi-character mode: Speaker mappings with multiple characters and personas
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'
import {
  importMultiCharacterChat,
  importLegacyChat,
  type MultiCharacterImportOptions,
  type LegacyImportOptions,
} from '@/lib/import/sillytavern-import-service'

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json()

    // Detect which mode we're in based on request body
    if (body.mappings) {
      // Multi-character mode
      if (!body.chatData || !body.mappings || body.mappings.length === 0) {
        return NextResponse.json(
          { error: 'Chat data and mappings are required' },
          { status: 400 }
        )
      }

      const options: MultiCharacterImportOptions = {
        chatData: body.chatData,
        mappings: body.mappings,
        defaultConnectionProfileId: body.defaultConnectionProfileId,
        triggerTitleGeneration: body.triggerTitleGeneration,
        createMemories: body.createMemories,
        title: body.title,
      }

      try {
        const result = await importMultiCharacterChat(user.id, options, repos)

        return NextResponse.json(
          {
            ...result.chat,
            createdEntities: result.createdEntities,
            triggerTitleGeneration: options.triggerTitleGeneration || false,
            memoryJobCount: result.memoryJobCount,
          },
          { status: 201 }
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Handle specific error cases
        if (
          errorMessage.includes('not found') ||
          errorMessage.includes('At least one character')
        ) {
          return NextResponse.json({ error: errorMessage }, { status: 400 })
        }

        throw error
      }
    } else {
      // Legacy single-character mode
      if (!body.chatData || !body.characterId || !body.connectionProfileId) {
        return NextResponse.json(
          {
            error: 'Chat data, character ID, and connection profile ID are required',
          },
          { status: 400 }
        )
      }

      const options: LegacyImportOptions = {
        chatData: body.chatData,
        characterId: body.characterId,
        connectionProfileId: body.connectionProfileId,
        personaId: body.personaId,
        title: body.title,
      }

      try {
        const result = await importLegacyChat(user.id, options, repos)

        // For legacy mode, include character, persona, and connection profile
        // at the root level for backwards compatibility
        const character = result.chat.participants.find(
          p => p.type === 'CHARACTER'
        )?.character
        const persona = result.chat.participants.find(
          p => p.type === 'PERSONA'
        )?.persona

        return NextResponse.json(
          {
            ...result.chat,
            character,
            persona,
            connectionProfile: {
              id: body.connectionProfileId,
            },
          },
          { status: 201 }
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Handle specific error cases
        if (errorMessage.includes('not found')) {
          return NextResponse.json({ error: errorMessage }, { status: 404 })
        }

        throw error
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to import chat')
    logger.error(
      'Error importing chat',
      { context: 'POST /api/chats/import', errorMessage },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
