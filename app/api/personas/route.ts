/**
 * DEPRECATED - DO NOT USE
 * 
 * This endpoint should be removed and replaced with /api/v1/personas
 * All client code should be migrated to the v1 API.
 * 
 * Legacy Personas API
 * GET /api/personas - List all personas for authenticated user
 * POST /api/personas - Create a new persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler, getFilePath } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'

// GET /api/personas - List all personas for user
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const { searchParams } = new URL(req.url)
    const sortByCharacter = searchParams.get('sortByCharacter')

    // Get all personas for user
    const personas = await repos.personas.findByUserId(user.id)

    // Enrich personas with related data
    const enrichedPersonas = await Promise.all(
      personas.map(async (persona) => {
        // Get default image from repository if present
        let defaultImage = null
        if (persona.defaultImageId) {
          const fileEntry = await repos.files.findById(persona.defaultImageId)
          if (fileEntry) {
            defaultImage = {
              id: fileEntry.id,
              filepath: getFilePath(fileEntry),
              url: null,
            }
          }
        }

        // Get character links
        const characters = await Promise.all(
          persona.characterLinks.map(async (characterId) => {
            const character = await repos.characters.findById(characterId)
            return character
              ? {
                  character: {
                    id: character.id,
                    name: character.name,
                  },
                }
              : null
          })
        )

        // Get tags
        const tags = await Promise.all(
          persona.tags.map(async (tagId) => {
            const tag = await repos.tags.findById(tagId)
            return tag ? { tag, tagId: tag.id } : null
          })
        )

        return {
          ...persona,
          defaultImage,
          characters: characters.filter(Boolean),
          tags: tags.filter(Boolean),
        }
      })
    )

    // Sort by createdAt descending by default
    enrichedPersonas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      // Get character tags
      const character = await repos.characters.findById(sortByCharacter)
      const characterTagIds = new Set(character?.tags || [])

      // Sort personas by number of matching tags (descending)
      enrichedPersonas.sort((a, b) => {
        const aMatchingTags = a.tags.filter((pt) => pt && characterTagIds.has(pt.tagId)).length
        const bMatchingTags = b.tags.filter((pt) => pt && characterTagIds.has(pt.tagId)).length
        return bMatchingTags - aMatchingTags
      })

      // Add matching tags info to each persona
      const personasWithMatches = enrichedPersonas.map((persona) => ({
        ...persona,
        matchingTags: persona.tags
          .filter((pt) => pt && characterTagIds.has(pt.tagId))
          .map((pt) => pt?.tag),
        matchingTagCount: persona.tags.filter((pt) => pt && characterTagIds.has(pt.tagId)).length,
      }))

      return NextResponse.json(personasWithMatches)
    }

    return NextResponse.json(enrichedPersonas)
  } catch (error) {
    logger.error('Error fetching personas:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    )
  }
})

// POST /api/personas - Create a new persona
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json()
    const { name, title, description, personalityTraits, avatarUrl, sillyTavernData } =
      body

    // Validate required fields
    if (!name || !description) {
      return NextResponse.json(
        { error: 'Name and description are required' },
        { status: 400 }
      )
    }

    const persona = await repos.personas.create({
      userId: user.id,
      name,
      title: title || null,
      description,
      personalityTraits: personalityTraits || null,
      avatarUrl: avatarUrl || null,
      sillyTavernData: sillyTavernData || null,
      tags: [] as string[],
      characterLinks: [] as string[],
      defaultImageId: null,
      physicalDescriptions: [],
    })

    return NextResponse.json(persona, { status: 201 })
  } catch (error) {
    logger.error('Error creating persona:', error as Error)
    return NextResponse.json(
      { error: 'Failed to create persona' },
      { status: 500 }
    )
  }
})
