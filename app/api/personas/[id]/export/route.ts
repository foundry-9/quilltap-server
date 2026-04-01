/**
 * Persona Export API
 * GET /api/personas/:id/export - Export a persona in SillyTavern format
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware'
import { exportSTPersona } from '@/lib/sillytavern/persona'
import { logger } from '@/lib/logger'

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Get persona
      const persona = await repos.personas.findById(id)

      if (!checkOwnership(persona, user.id)) {
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
      }

      // Export to SillyTavern format
      const stPersona = exportSTPersona(persona)

      // Return as JSON with download headers
      return new NextResponse(JSON.stringify(stPersona, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${persona.name}_persona.json"`,
        },
      })
    } catch (error) {
      logger.error('Error exporting persona', { context: 'personas-export-GET' }, error instanceof Error ? error : undefined)
      return NextResponse.json(
        { error: 'Failed to export persona' },
        { status: 500 }
      )
    }
  }
)
