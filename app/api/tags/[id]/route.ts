// Tags API: Update and Delete
// PUT /api/tags/[id] - Update a tag name
// DELETE /api/tags/[id] - Delete a tag

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware'
import { badRequest, forbidden, notFound, serverError, validationError } from '@/lib/api/responses'
import { z } from 'zod'
import type { Tag } from '@/lib/schemas/types'
import { TagVisualStyleSchema } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

// Validation schema
const updateTagSchema = z
  .object({
    name: z.string().min(1, 'Tag name is required').max(50).optional(),
    quickHide: z.boolean().optional(),
    visualStyle: TagVisualStyleSchema.nullable().optional(),
  })
  .refine(
    (data) => typeof data.name !== 'undefined' || typeof data.quickHide !== 'undefined' || typeof data.visualStyle !== 'undefined',
    { message: 'At least one field must be provided' }
  )

// PUT /api/tags/[id] - Update tag name
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
  try {
    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await repos.tags.findById(tagId)

    if (!existingTag) {
      return notFound('Tag')
    }

    if (existingTag.userId !== user.id) {
      return forbidden()
    }

    const body = await req.json()
    const validatedData = updateTagSchema.parse(body)

    const updateData: Partial<Tag> = {}

    if (typeof validatedData.name !== 'undefined') {
      const nameLower = validatedData.name.toLowerCase()

      // Check if another tag with this name already exists
      const allTags = await repos.tags.findByUserId(user.id)
      const duplicateTag = allTags.find(
        tag => tag.nameLower === nameLower && tag.id !== tagId
      )

      if (duplicateTag) {
        return badRequest('A tag with this name already exists')
      }

      updateData.name = validatedData.name
      updateData.nameLower = nameLower
    }

    if (typeof validatedData.quickHide !== 'undefined') {
      updateData.quickHide = validatedData.quickHide
    }

    if (typeof validatedData.visualStyle !== 'undefined') {
      updateData.visualStyle = validatedData.visualStyle
    }

    const tag = await repos.tags.update(tagId, updateData)

    return NextResponse.json({ tag })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error)
    }

    logger.error('Error updating tag:', error as Error)
    return serverError('Failed to update tag')
  }
})

// DELETE /api/tags/[id] - Delete a tag
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
  try {
    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await repos.tags.findById(tagId)

    if (!existingTag) {
      return notFound('Tag')
    }

    if (existingTag.userId !== user.id) {
      return forbidden()
    }

    // Delete the tag (cascade will remove all junction table entries)
    await repos.tags.delete(tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting tag:', error as Error)
    return serverError('Failed to delete tag')
  }
})
