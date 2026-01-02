// Sidebar Characters API
// GET /api/sidebar/characters - Get characters for sidebar (favorites + top participants)

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('Fetching sidebar characters', { userId: user.id })

    // Get all non-NPC, LLM-controlled characters (exclude user-controlled characters)
    let characters = await repos.characters.findByUserId(user.id)
    characters = characters.filter(c => !c.npc && c.controlledBy !== 'user')

    // Get chat counts for each character
    const chats = await repos.chats.findByUserId(user.id)

    // Count chats per character
    const chatCounts = new Map<string, number>()
    for (const chat of chats) {
      const participants = chat.participants || []
      for (const participant of participants) {
        if (participant.characterId) {
          const count = chatCounts.get(participant.characterId) || 0
          chatCounts.set(participant.characterId, count + 1)
        }
      }
    }

    // Enrich characters with chat count and images
    const enrichedCharacters = await Promise.all(
      characters.map(async (character) => {
        // Get default image for character
        let defaultImage: string | null = null
        if (character.avatarUrl) {
          defaultImage = character.avatarUrl
        } else {
          // First, try to get the character's default image directly by ID
          let imageToUse = null
          if (character.defaultImageId) {
            imageToUse = await repos.files.findById(character.defaultImageId)
          }
          // Fallback: search by linkedTo (for avatar tagged images)
          if (!imageToUse) {
            const images = await repos.files.findByLinkedTo(character.id)
            imageToUse = images.find((img: { tags?: string[] }) => img.tags?.includes('avatar'))
              || images[0]
              || null
          }
          if (imageToUse) {
            defaultImage = `/api/files/${imageToUse.id}`
          }
        }

        return {
          id: character.id,
          name: character.name,
          avatarUrl: character.avatarUrl,
          defaultImage,
          isFavorite: character.isFavorite || false,
          chatCount: chatCounts.get(character.id) || 0,
          tags: character.tags || [],
        }
      })
    )

    // Sort: favorites first, then by chat count, then alphabetically
    enrichedCharacters.sort((a, b) => {
      // Favorites first
      if (a.isFavorite && !b.isFavorite) return -1
      if (!a.isFavorite && b.isFavorite) return 1

      // Then by chat count
      if (a.chatCount !== b.chatCount) {
        return b.chatCount - a.chatCount
      }

      // Then alphabetically
      return a.name.localeCompare(b.name)
    })

    // Return top 10 characters
    const sidebarCharacters = enrichedCharacters.slice(0, 10)

    logger.debug('Fetched sidebar characters', {
      userId: user.id,
      totalCharacters: characters.length,
      sidebarCharacters: sidebarCharacters.length,
    })

    return NextResponse.json({
      characters: sidebarCharacters,
    })
  } catch (error) {
    logger.error('Error fetching sidebar characters', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to fetch characters' },
      { status: 500 }
    )
  }
})
