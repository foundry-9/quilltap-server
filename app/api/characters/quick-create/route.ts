/**
 * Quick Character Creation API
 * POST /api/characters/quick-create
 *
 * Creates a minimal character record for use during chat import.
 * Only requires a name - other details can be added later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const quickCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  defaultConnectionProfileId: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = quickCreateSchema.parse(body)

    logger.info('[QuickCreate] Creating character', {
      userId: user.id,
      name: validatedData.name,
    })

    const character = await repos.characters.create({
      userId: user.id,
      name: validatedData.name,
      title: null,
      description: `Character created during chat import`,
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      avatarUrl: null,
      defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
      isFavorite: false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescriptions: [],
    })

    logger.info('[QuickCreate] Character created', {
      characterId: character.id,
      name: character.name,
    })

    return NextResponse.json({ character }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('[QuickCreate] Error creating character', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}
