// Memories API: List and Create for a Character
// GET /api/characters/[id]/memories - List all memories for a character
// POST /api/characters/[id]/memories - Create a new memory for a character
//
// DEPRECATED: This route is deprecated in favor of /api/v1/memories
// - GET /api/v1/memories?characterId=[id]
// - POST /api/v1/memories (with characterId in body)
// This route will be removed after 2026-04-15

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { createMemoryWithEmbedding } from '@/lib/memory/memory-service'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { notFound, forbidden, serverError, validationError, withDeprecationHeaders, V1_MIGRATION_DEPRECATION } from '@/lib/api/responses'

// Validation schema for creating a memory
const createMemorySchema = z.object({
  content: z.string().min(1, 'Memory content is required'),
  summary: z.string().min(1, 'Memory summary is required'),
  keywords: z.array(z.string()).default([]),
  tags: z.array(z.string().uuid()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  personaId: z.string().uuid().nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
  source: z.enum(['AUTO', 'MANUAL']).default('MANUAL'),
  sourceMessageId: z.string().uuid().nullable().optional(),
})

// GET /api/characters/[id]/memories - List all memories for a character
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: characterId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }
      if (character.userId !== user.id) {
        return forbidden()
      }

      // Get query params for filtering
      const searchParams = req.nextUrl.searchParams
      const search = searchParams.get('search')
      const minImportance = searchParams.get('minImportance')
      const source = searchParams.get('source')
      const sortBy = searchParams.get('sortBy') || 'createdAt'
      const sortOrder = searchParams.get('sortOrder') || 'desc'

      // Get memories
      let memories = await repos.memories.findByCharacterId(characterId)

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase()
        memories = memories.filter(memory =>
          memory.content.toLowerCase().includes(searchLower) ||
          memory.summary.toLowerCase().includes(searchLower) ||
          memory.keywords.some(k => k.toLowerCase().includes(searchLower))
        )
      }

      // Apply importance filter
      if (minImportance) {
        const minImp = parseFloat(minImportance)
        if (!isNaN(minImp)) {
          memories = memories.filter(m => m.importance >= minImp)
        }
      }

      // Apply source filter
      if (source && (source === 'AUTO' || source === 'MANUAL')) {
        memories = memories.filter(m => m.source === source)
      }

      // Sort memories
      memories.sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
          case 'importance':
            comparison = a.importance - b.importance
            break
          case 'updatedAt':
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
            break
          case 'createdAt':
          default:
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            break
        }
        return sortOrder === 'desc' ? -comparison : comparison
      })

      // Enrich with tag names
      const allTags = await repos.tags.findAll()
      const tagMap = new Map(allTags.map(t => [t.id, t]))

      const memoriesWithTags = memories.map(memory => ({
        ...memory,
        tagDetails: memory.tags
          .map(tagId => tagMap.get(tagId))
          .filter(Boolean),
      }))

      const response = NextResponse.json({
        memories: memoriesWithTags,
        count: memoriesWithTags.length,
      })
      return withDeprecationHeaders(response, {
        ...V1_MIGRATION_DEPRECATION,
        replacement: '/api/v1/memories',
      })
    } catch (error) {
      logger.error('Error fetching memories', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to fetch memories')
    }
  }
)

// POST /api/characters/[id]/memories - Create a new memory
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: characterId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId)
      if (!character) {
        return notFound('Character')
      }
      if (character.userId !== user.id) {
        return forbidden()
      }

      const body = await req.json()
      const validatedData = createMemorySchema.parse(body)

      // Create memory with embedding generation
      const memory = await createMemoryWithEmbedding(
        {
          characterId,
          content: validatedData.content,
          summary: validatedData.summary,
          keywords: validatedData.keywords,
          tags: validatedData.tags,
          importance: validatedData.importance,
          personaId: validatedData.personaId,
          chatId: validatedData.chatId,
          source: validatedData.source,
          sourceMessageId: validatedData.sourceMessageId,
        },
        {
          userId: user.id,
          // Embedding generation is automatic if profile is configured
        }
      )

      const response = NextResponse.json({ memory }, { status: 201 })
      return withDeprecationHeaders(response, {
        ...V1_MIGRATION_DEPRECATION,
        replacement: '/api/v1/memories',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error)
      }

      logger.error('Error creating memory', {}, error instanceof Error ? error : undefined)
      return serverError('Failed to create memory')
    }
  }
)
