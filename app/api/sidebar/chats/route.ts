// Sidebar Chats API
// GET /api/sidebar/chats - Get recent chats for sidebar

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('Fetching sidebar chats', { userId: user.id })

    // Get all chats
    const chats = await repos.chats.findByUserId(user.id)

    // Sort by updatedAt descending (most recent first)
    chats.sort((a, b) => {
      const aDate = new Date(a.updatedAt || a.createdAt).getTime()
      const bDate = new Date(b.updatedAt || b.createdAt).getTime()
      return bDate - aDate
    })

    // Get character info for participants
    const characterIds = new Set<string>()
    for (const chat of chats) {
      for (const participant of (chat.participants || [])) {
        if (participant.characterId) {
          characterIds.add(participant.characterId)
        }
      }
    }

    // Fetch all needed characters in one go
    const characterMap = new Map<string, { name: string; avatarUrl?: string | null; tags: string[] }>()
    for (const characterId of characterIds) {
      try {
        const character = await repos.characters.findById(characterId)
        if (character) {
          // Get avatar
          let avatarUrl = character.avatarUrl
          if (!avatarUrl) {
            const images = await repos.files.findByLinkedTo(characterId)
            const avatarImage = images.find((img: { tags?: string[] }) => img.tags?.includes('avatar'))
            const anyImage = images[0]
            const imageToUse = avatarImage || anyImage
            if (imageToUse) {
              avatarUrl = `/api/files/${imageToUse.id}`
            }
          }

          characterMap.set(characterId, {
            name: character.name,
            avatarUrl,
            tags: character.tags || [],
          })
        }
      } catch {
        // Character might have been deleted
      }
    }

    // Enrich chats with participant info
    const enrichedChats = chats.slice(0, 15).map(chat => {
      const participants = (chat.participants || [])
        .filter(p => p.characterId && characterMap.has(p.characterId))
        .map(p => {
          const character = characterMap.get(p.characterId!)!
          return {
            id: p.characterId!,
            name: character.name,
            avatarUrl: character.avatarUrl,
          }
        })

      // Collect all tags from all character participants for quick-hide filtering
      const characterTags: string[] = []
      for (const participant of (chat.participants || [])) {
        if (participant.characterId && characterMap.has(participant.characterId)) {
          const character = characterMap.get(participant.characterId)!
          characterTags.push(...character.tags)
        }
      }

      return {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt || chat.createdAt,
        participants,
        characterTags: [...new Set(characterTags)], // Deduplicate
        messageCount: chat.messageCount || 0,
      }
    })

    logger.debug('Fetched sidebar chats', {
      userId: user.id,
      totalChats: chats.length,
      sidebarChats: enrichedChats.length,
    })

    return NextResponse.json({
      chats: enrichedChats,
    })
  } catch (error) {
    logger.error('Error fetching sidebar chats', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
})
