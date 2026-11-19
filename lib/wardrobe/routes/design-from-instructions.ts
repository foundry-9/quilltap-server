/**
 * Import from Instructions — the handlers behind
 *
 *   POST /api/v1/wardrobe?action=design-from-instructions — Aurora designs pieces and an outfit, SSE stream
 *   GET  /api/v1/wardrobe?action=design-defaults          — `{ defaultProfileId, webSearchConfigured, curlConfigured }`
 *
 * A design run is ephemeral: no chat row, no messages, nothing created. It
 * runs in the parent process inside the route and streams tool events,
 * reasoning and a terminal `done` (carrying the proposal) or `error`. Closing
 * the request aborts the loop. The operator creates the pieces through the
 * ordinary wardrobe creates, from the wizard's review pane.
 *
 * Server-only.
 *
 * @module lib/wardrobe/routes/design-from-instructions
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { RequestContext } from '@/lib/api/middleware'
import { badRequest, notFound, successResponse, validationError } from '@/lib/api/responses'
import { readJsonBody } from '@/lib/api/request-body'
import { logger as rootLogger } from '@/lib/logger'
import {
  describeProfileApiKeyFailure,
  resolveConnectionProfileApiKey,
} from '@/lib/services/api-key.service'
import type { StreamController } from '@/lib/services/chat-message/tool-execution.service'
import {
  resolveWardrobeDesignReach,
  runWardrobeInstructionDesign,
  wardrobeDesignUsesTools,
} from '@/lib/services/wardrobe-design/wardrobe-design.service'
import { resolveWebCapabilities } from '@/lib/tools/web-capabilities'
import { resolveWardrobeLocation } from '@/lib/wardrobe/location'
import {
  wardrobeDesignRequestSchema,
  type WardrobeDesignDefaults,
} from '@/lib/wardrobe/instruction-design/request-schema'

const logger = rootLogger.child({ context: 'WardrobeDesign' })

/** GET `?action=design-defaults` — the usual model, and what of the web is reachable. */
export async function handleWardrobeDesignDefaults(_req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const [defaultProfile, capabilities] = await Promise.all([
    repos.connections.findDefault(user.id),
    resolveWebCapabilities(repos, user.id),
  ])
  const body: WardrobeDesignDefaults = {
    defaultProfileId: defaultProfile?.id ?? null,
    webSearchConfigured: capabilities.webSearchConfigured,
    curlConfigured: capabilities.curlConfigured,
  }
  logger.debug('Wardrobe design defaults resolved', body)
  return successResponse(body)
}

/** POST `?action=design-from-instructions` — run the design and stream it. */
export async function handleWardrobeDesign(req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const raw = await readJsonBody(req, {})
  const parsed = wardrobeDesignRequestSchema.safeParse(raw)
  if (!parsed.success) {
    logger.debug('Wardrobe design request failed validation', { issues: parsed.error.issues.length })
    return validationError(parsed.error)
  }
  const body = parsed.data
  const target = { scope: body.target.scope, id: body.target.id ?? null }

  // An archived character is a tombstone: its wardrobe still reads, but
  // nothing may be designed for it (and nothing provisions its vault).
  if (target.scope === 'character' && target.id) {
    const row = await repos.characters.findByIdRaw(target.id)
    if (!row || row.userId !== user.id || row.archivedAt) {
      logger.debug('Wardrobe design refused: character missing or archived', { archived: !!row?.archivedAt })
      return notFound('Wardrobe')
    }
  }

  // A read probe: never provisions a store for a design that may be discarded.
  const location = await resolveWardrobeLocation(target.scope, target.id, repos, user.id)
  if (!location) {
    logger.debug('Wardrobe design target did not resolve', { scope: target.scope })
    return notFound('Wardrobe')
  }

  const connectionProfile = await repos.connections.findById(body.connectionProfileId)
  if (!connectionProfile || connectionProfile.userId !== user.id) {
    logger.debug('Wardrobe design profile not found for user', { profileId: body.connectionProfileId })
    return notFound('Connection profile')
  }

  if (connectionProfile.allowToolUse === false) {
    const reach = await resolveWardrobeDesignReach(repos, user.id, connectionProfile, body)
    if (wardrobeDesignUsesTools(reach)) {
      return badRequest(
        'This connection profile has tool use switched off, so Aurora can neither search nor look anything up with it. Choose another profile, or switch both kinds of looking off.',
      )
    }
  }

  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    return badRequest(describeProfileApiKeyFailure(keyResolution.reason))
  }

  logger.debug('Wardrobe design request accepted', {
    searchStores: body.searchStores,
    searchWeb: body.searchWeb,
    targetScope: target.scope,
    revising: body.revision != null,
    profileId: connectionProfile.id,
  })

  const signal = req.signal
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let closed = false
      // processToolCalls enqueues directly; a cancelled stream throws on
      // enqueue. Swallow those so a closed dialog ends the run quietly.
      const safeController: StreamController = {
        enqueue: (data: Uint8Array) => {
          if (closed || signal.aborted) return
          try {
            streamController.enqueue(data)
          } catch {
            closed = true
          }
        },
      }
      const onAbort = () => {
        logger.debug('Wardrobe design client disconnected; aborting the run')
        closed = true
      }
      signal.addEventListener('abort', onAbort)

      try {
        await runWardrobeInstructionDesign(
          {
            repos,
            userId: user.id,
            connectionProfile,
            apiKey: keyResolution.apiKey,
            location,
            input: {
              instructions: body.instructions,
              searchStores: body.searchStores,
              searchWeb: body.searchWeb,
              priorProposal: body.priorProposal ?? null,
              revision: body.revision ?? null,
            },
          },
          safeController,
          signal,
        )
      } catch (error) {
        // runWardrobeInstructionDesign never throws by contract; this is belt and braces.
        logger.error('Wardrobe design stream failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        safeController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Aurora could not finish the design.' })}\n\n`),
        )
      } finally {
        signal.removeEventListener('abort', onAbort)
        if (!closed) {
          closed = true
          try {
            streamController.close()
          } catch {
            /* already closed */
          }
        }
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
