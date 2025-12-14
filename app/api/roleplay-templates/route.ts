/**
 * Roleplay Template Management Routes
 *
 * GET    /api/roleplay-templates   - List all roleplay templates for current user (built-in + user's)
 * POST   /api/roleplay-templates   - Create a new roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

/**
 * GET /api/roleplay-templates
 * List all roleplay templates available to the authenticated user
 * Returns both built-in templates and user-created templates
 */
export async function GET(req: NextRequest) {
  try {
    logger.debug('Fetching roleplay templates', {
      endpoint: '/api/roleplay-templates',
      method: 'GET',
    })

    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('Unauthorized request to roleplay templates', {
        endpoint: '/api/roleplay-templates',
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Get all templates available to user (built-in + user's own)
    const templates = await repos.roleplayTemplates.findAllForUser(session.user.id)

    logger.debug('Retrieved roleplay templates for user', {
      userId: session.user.id,
      count: templates.length,
    })

    // Sort: built-in first, then by name
    templates.sort((a, b) => {
      // Built-in templates first
      if (a.isBuiltIn !== b.isBuiltIn) {
        return a.isBuiltIn ? -1 : 1
      }
      // Then alphabetically by name
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json(templates)
  } catch (error) {
    logger.error('Failed to fetch roleplay templates', {
      endpoint: '/api/roleplay-templates',
      method: 'GET',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch roleplay templates' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/roleplay-templates
 * Create a new roleplay template
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   systemPrompt: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    logger.debug('Creating roleplay template', {
      endpoint: '/api/roleplay-templates',
      method: 'POST',
    })

    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('Unauthorized request to create roleplay template', {
        endpoint: '/api/roleplay-templates',
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { name, description, systemPrompt } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (name.trim().length > 100) {
      return NextResponse.json(
        { error: 'Name must be 100 characters or less' },
        { status: 400 }
      )
    }

    if (!systemPrompt || typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'System prompt is required' },
        { status: 400 }
      )
    }

    if (description && typeof description === 'string' && description.length > 500) {
      return NextResponse.json(
        { error: 'Description must be 500 characters or less' },
        { status: 400 }
      )
    }

    const repos = getRepositories()

    // Check for duplicate name among user's own templates
    const existingTemplate = await repos.roleplayTemplates.findByName(session.user.id, name.trim())
    if (existingTemplate) {
      return NextResponse.json(
        { error: 'A roleplay template with this name already exists' },
        { status: 409 }
      )
    }

    // Create template
    const template = await repos.roleplayTemplates.create({
      userId: session.user.id,
      name: name.trim(),
      description: description?.trim() || null,
      systemPrompt: systemPrompt.trim(),
      isBuiltIn: false,
      tags: [],
    })

    logger.info('Roleplay template created', {
      userId: session.user.id,
      templateId: template.id,
      templateName: template.name,
    })

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    logger.error('Failed to create roleplay template', {
      endpoint: '/api/roleplay-templates',
      method: 'POST',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create roleplay template' },
      { status: 500 }
    )
  }
}
