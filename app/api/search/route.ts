/**
 * Global Search API
 * GET /api/search?q=query&types=chats,characters,personas,tags,memories&limit=40
 *
 * Search across chats, characters, personas, tags, and memories.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { getUserRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { executeGlobalSearch, VALID_SEARCH_TYPES, type SearchType } from '@/lib/services/search'

const searchLogger = logger.child({ module: 'search-api' })

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }: AuthenticatedContext) => {
  try {
    const repos = getUserRepositories(user.id)

    const searchParams = req.nextUrl.searchParams
    const query = searchParams.get('q')?.trim()
    const typesParam = searchParams.get('types')
    const limitParam = searchParams.get('limit')

    // Validate query
    if (!query || query.length < 2) {
      searchLogger.debug('Search query too short', { query })
      return NextResponse.json(
        { error: 'Search query must be at least 2 characters' },
        { status: 400 }
      )
    }

    // Parse types (default to all)
    let types: SearchType[] = [...VALID_SEARCH_TYPES]
    if (typesParam) {
      const requestedTypes = typesParam.split(',').map(t => t.trim()) as SearchType[]
      types = requestedTypes.filter(t => VALID_SEARCH_TYPES.includes(t))
      if (types.length === 0) {
        types = [...VALID_SEARCH_TYPES]
      }
    }

    // Parse limit (default 40, max 100)
    const limit = Math.min(Math.max(1, parseInt(limitParam || '40', 10) || 40), 100)

    searchLogger.debug('Executing global search', {
      userId: user.id,
      query,
      types,
      limit,
    })

    // Execute search using the service
    const response = await executeGlobalSearch(repos, { query, types, limit })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof Error && error.message.includes('at least 2 characters')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    searchLogger.error(
      'Global search failed',
      { error: error instanceof Error ? error.message : String(error) },
      error as Error
    )
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
})
