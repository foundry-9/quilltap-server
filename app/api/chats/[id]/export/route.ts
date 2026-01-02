/**
 * Chat Export API
 * GET /api/chats/:id/export - Export a chat in SillyTavern format
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat'
import { logger } from '@/lib/logger'
import { notFound, serverError } from '@/lib/api/responses'

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (_req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Get chat
      const chat = await repos.chats.findById(id)

      if (!chat || chat.userId !== user.id) {
        return notFound('Chat')
      }

      // Get messages (filter for message events only, not context-summary events)
      const allEvents = await repos.chats.getMessages(id)
      const messages = allEvents.filter(event => event.type === 'message')

      // Get character from participants
      const characterParticipant = chat.participants.find(p => p.type === 'CHARACTER' && p.characterId)
      if (!characterParticipant?.characterId) {
        return notFound('No character in chat')
      }

      const character = await repos.characters.findById(characterParticipant.characterId)
      if (!character) {
        return notFound('Character')
      }

      // Get persona from participants if present
      const personaParticipant = chat.participants.find(p => p.type === 'PERSONA' && p.personaId)
      let persona = null
      if (personaParticipant?.personaId) {
        persona = await repos.personas.findById(personaParticipant.personaId)
      }

      // Export to SillyTavern format
      const userName = persona?.name || user.name || 'User'

      // Transform messages to the format expected by exportSTChat
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        chatId: id,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.createdAt),
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        tokenCount: msg.tokenCount || null,
        rawResponse: msg.rawResponse || null,
      }))

      // Create a chat object compatible with exportSTChatAsJSONL
      const chatForExport = {
        ...chat,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      }

      // Export as proper JSONL format (one JSON object per line)
      const jsonlContent = exportSTChatAsJSONL(chatForExport, formattedMessages, character.name, userName)

      // Return as JSONL with download headers
      const chatCreatedTime = new Date(chat.createdAt).getTime()
      const filename = `${character.name}_chat_${chatCreatedTime}.jsonl`

      return new NextResponse(jsonlContent, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    } catch (error) {
      logger.error('Error exporting chat', { operation: 'chatExport' }, error instanceof Error ? error : undefined)
      return serverError('Failed to export chat')
    }
  }
)
