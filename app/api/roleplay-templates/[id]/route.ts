/**
 * Roleplay Template Individual Routes
 *
 * GET    /api/roleplay-templates/[id]   - Get a specific roleplay template
 * PUT    /api/roleplay-templates/[id]   - Update a roleplay template (user templates only)
 * DELETE /api/roleplay-templates/[id]   - Delete a roleplay template (user templates only)
 *
 * Built-in templates cannot be modified or deleted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/roleplay-templates/[id]
 * Get a specific roleplay template by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    logger.debug('Fetching roleplay template by ID', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'GET',
      templateId: id,
    })

    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('Unauthorized request to get roleplay template', {
        templateId: id,
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()
    const template = await repos.roleplayTemplates.findById(id)

    if (!template) {
      logger.debug('Roleplay template not found', { templateId: id })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Check access: user can see built-in templates or their own templates
    if (!template.isBuiltIn && template.userId !== session.user.id) {
      logger.warn('Access denied to roleplay template', {
        templateId: id,
        userId: session.user.id,
        templateUserId: template.userId,
      })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    logger.debug('Roleplay template retrieved', {
      templateId: id,
      templateName: template.name,
    })

    return NextResponse.json(template)
  } catch (error) {
    const { id } = await params
    logger.error('Failed to fetch roleplay template', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'GET',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch roleplay template' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/roleplay-templates/[id]
 * Update a roleplay template
 *
 * Body: {
 *   name?: string,
 *   description?: string,
 *   systemPrompt?: string
 * }
 *
 * Note: Built-in templates cannot be updated
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    logger.debug('Updating roleplay template', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'PUT',
      templateId: id,
    })

    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('Unauthorized request to update roleplay template', {
        templateId: id,
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()
    const existing = await repos.roleplayTemplates.findById(id)

    if (!existing) {
      logger.debug('Roleplay template not found for update', { templateId: id })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Check ownership
    if (existing.userId !== session.user.id) {
      logger.warn('Access denied to update roleplay template', {
        templateId: id,
        userId: session.user.id,
        templateUserId: existing.userId,
      })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Prevent updating built-in templates
    if (existing.isBuiltIn) {
      logger.warn('Attempt to update built-in roleplay template', {
        templateId: id,
        templateName: existing.name,
      })
      return NextResponse.json(
        { error: 'Built-in templates cannot be modified' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { name, description, systemPrompt } = body

    // Validation
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        )
      }
      if (name.trim().length > 100) {
        return NextResponse.json(
          { error: 'Name must be 100 characters or less' },
          { status: 400 }
        )
      }

      // Check for duplicate name if name is changing
      if (name.trim() !== existing.name) {
        const duplicateName = await repos.roleplayTemplates.findByName(session.user.id, name.trim())
        if (duplicateName) {
          return NextResponse.json(
            { error: 'A roleplay template with this name already exists' },
            { status: 409 }
          )
        }
      }
    }

    if (systemPrompt !== undefined) {
      if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
        return NextResponse.json(
          { error: 'System prompt cannot be empty' },
          { status: 400 }
        )
      }
    }

    if (description !== undefined && description !== null) {
      if (typeof description === 'string' && description.length > 500) {
        return NextResponse.json(
          { error: 'Description must be 500 characters or less' },
          { status: 400 }
        )
      }
    }

    // Build update object
    const updateData: Record<string, string | null> = {}
    if (name !== undefined) {
      updateData.name = name.trim()
    }
    if (description !== undefined) {
      updateData.description = description?.trim() || null
    }
    if (systemPrompt !== undefined) {
      updateData.systemPrompt = systemPrompt.trim()
    }

    const updated = await repos.roleplayTemplates.update(id, updateData)

    if (!updated) {
      logger.error('Failed to update roleplay template', {
        templateId: id,
      })
      return NextResponse.json(
        { error: 'Failed to update template' },
        { status: 500 }
      )
    }

    logger.info('Roleplay template updated', {
      userId: session.user.id,
      templateId: id,
      templateName: updated.name,
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { id } = await params
    logger.error('Failed to update roleplay template', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'PUT',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update roleplay template' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/roleplay-templates/[id]
 * Delete a roleplay template
 *
 * Note: Built-in templates cannot be deleted
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    logger.debug('Deleting roleplay template', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'DELETE',
      templateId: id,
    })

    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('Unauthorized request to delete roleplay template', {
        templateId: id,
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()
    const existing = await repos.roleplayTemplates.findById(id)

    if (!existing) {
      logger.debug('Roleplay template not found for deletion', { templateId: id })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Check ownership
    if (existing.userId !== session.user.id) {
      logger.warn('Access denied to delete roleplay template', {
        templateId: id,
        userId: session.user.id,
        templateUserId: existing.userId,
      })
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Prevent deleting built-in templates
    if (existing.isBuiltIn) {
      logger.warn('Attempt to delete built-in roleplay template', {
        templateId: id,
        templateName: existing.name,
      })
      return NextResponse.json(
        { error: 'Built-in templates cannot be deleted' },
        { status: 403 }
      )
    }

    const deleted = await repos.roleplayTemplates.delete(id)

    if (!deleted) {
      logger.error('Failed to delete roleplay template', {
        templateId: id,
      })
      return NextResponse.json(
        { error: 'Failed to delete template' },
        { status: 500 }
      )
    }

    logger.info('Roleplay template deleted', {
      userId: session.user.id,
      templateId: id,
      templateName: existing.name,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const { id } = await params
    logger.error('Failed to delete roleplay template', {
      endpoint: `/api/roleplay-templates/${id}`,
      method: 'DELETE',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete roleplay template' },
      { status: 500 }
    )
  }
}
