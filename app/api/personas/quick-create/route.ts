/**
 * Quick Persona Creation API
 * POST /api/personas/quick-create
 *
 * Creates a minimal persona record for use during chat import.
 * Only requires a name - other details can be added later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const quickCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
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

    logger.info('[QuickCreate] Creating persona', {
      userId: user.id,
      name: validatedData.name,
    })

    const persona = await repos.personas.create({
      userId: user.id,
      name: validatedData.name,
      title: null,
      description: `Persona created during chat import`,
      personalityTraits: null,
      avatarUrl: null,
      sillyTavernData: null,
      tags: [] as string[],
      characterLinks: [] as string[],
      defaultImageId: null,
      physicalDescriptions: [],
    })

    logger.info('[QuickCreate] Persona created', {
      personaId: persona.id,
      name: persona.name,
    })

    return NextResponse.json({ persona }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('[QuickCreate] Error creating persona', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to create persona' },
      { status: 500 }
    )
  }
}
