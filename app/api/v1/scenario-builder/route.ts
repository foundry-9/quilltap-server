/**
 * Scenario Builder API v1 — The Host researches and drafts a starting scene.
 *
 * POST /api/v1/scenario-builder?action=build        — run the builder, SSE stream
 * GET  /api/v1/scenario-builder?action=capabilities — { webSearchConfigured, curlConfigured }
 *
 * A builder run is ephemeral: no chat row, no messages. It runs in the parent
 * process inside this route and streams tool events, reasoning, and a terminal
 * `done` (carrying the scene) or `error`. Closing the request aborts the loop.
 *
 * Design of record: docs/developer/features/scenario-builder.md
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createContextHandler,
  withCollectionActionDispatch,
  type RequestContext,
} from '@/lib/api/middleware'
import { badRequest, errorResponse, notFound, successResponse, validationError } from '@/lib/api/responses'
import { scenarioBuildRequestSchema } from '@/lib/scenario-builder/request-schema'
import { logger as rootLogger } from '@/lib/logger'
import {
  describeProfileApiKeyFailure,
  resolveConnectionProfileApiKey,
} from '@/lib/services/api-key.service'
import {
  resolveScenarioBuilderCapabilities,
  runScenarioBuilder,
} from '@/lib/services/scenario-builder/scenario-builder.service'
import type { StreamController } from '@/lib/services/chat-message/tool-execution.service'

const logger = rootLogger.child({ context: 'ScenarioBuilder' })

async function handleBuild(req: NextRequest, context: RequestContext): Promise<NextResponse> {
  const { user, repos } = context

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Request body must be JSON')
  }
  const parsed = scenarioBuildRequestSchema.safeParse(raw)
  if (!parsed.success) {
    logger.debug('Scenario Builder request failed validation', { issues: parsed.error.issues.length })
    return validationError(parsed.error)
  }
  const body = parsed.data

  // Profile: must be the user's, and must allow tools — the builder is a tool loop.
  const connectionProfile = await repos.connections.findById(body.connectionProfileId)
  if (!connectionProfile || connectionProfile.userId !== user.id) {
    logger.debug('Scenario Builder profile not found for user', { profileId: body.connectionProfileId })
    return notFound('Connection profile')
  }
  if (connectionProfile.allowToolUse === false) {
    return badRequest(
      'This connection profile has tool use switched off, and the Host cannot make enquiries without tools. Choose another profile.',
    )
  }

  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    return badRequest(describeProfileApiKeyFailure(keyResolution.reason))
  }

  // Cast: keep only ids this user can read. `repos.characters` is user-scoped.
  const characterIds: string[] = []
  for (const id of [...new Set(body.characterIds)]) {
    try {
      const character = await repos.characters.findById(id)
      if (character) characterIds.push(id)
    } catch (error) {
      logger.warn('Scenario Builder dropped an unreadable cast id', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (characterIds.length !== body.characterIds.length) {
    logger.debug('Scenario Builder dropped cast ids the user cannot read', {
      requested: body.characterIds.length,
      kept: characterIds.length,
    })
  }

  // Named groups (the builder launched from a group's page): keep only ones that exist.
  const groupIds: string[] = []
  for (const id of [...new Set(body.groupIds)]) {
    try {
      const group = await repos.groups.findByIdRaw(id)
      if (group) groupIds.push(id)
    } catch (error) {
      logger.warn('Scenario Builder dropped an unreadable group id', {
        groupId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // In-chat: the chat must be the user's, and a Salon or autonomous room.
  let chat: { id: string; scenarioText?: string | null; contextSummary?: string | null } | null = null
  if (body.chatId) {
    const found = await repos.chats.findById(body.chatId)
    if (!found || found.userId !== user.id) {
      return notFound('Chat')
    }
    if (found.chatType !== 'salon' && found.chatType !== 'autonomous') {
      return badRequest('The Scenario Builder sets scenes only for Salon chats and autonomous rooms.')
    }
    chat = { id: found.id, scenarioText: found.scenarioText, contextSummary: found.contextSummary }
  }

  logger.debug('Scenario Builder request accepted', {
    mode: body.mode,
    castCount: characterIds.length,
    groupCount: groupIds.length,
    hasProject: !!body.projectId,
    inChat: !!chat,
    revising: body.revision != null,
    profileId: connectionProfile.id,
  })

  const signal = req.signal
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let closed = false
      // processToolCalls enqueues directly; a cancelled stream throws on
      // enqueue. Swallow those so a closed tab ends the run quietly.
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
        logger.debug('Scenario Builder client disconnected; aborting the run')
        closed = true
      }
      signal.addEventListener('abort', onAbort)

      try {
        await runScenarioBuilder(
          {
            repos,
            userId: user.id,
            connectionProfile,
            apiKey: keyResolution.apiKey,
            input: {
              mode: body.mode,
              location: body.location,
              time: body.time,
              details: body.details,
              projectId: body.projectId ?? null,
              characterIds,
              groupIds,
              chat,
              priorDraft: body.priorDraft ?? null,
              revision: body.revision ?? null,
            },
          },
          safeController,
          signal,
        )
      } catch (error) {
        // runScenarioBuilder never throws by contract; this is belt and braces.
        logger.error('Scenario Builder stream failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        safeController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'The Host could not complete the enquiry.' })}\n\n`),
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

async function handleCapabilities(_req: NextRequest, context: RequestContext): Promise<NextResponse> {
  try {
    const capabilities = await resolveScenarioBuilderCapabilities(context.repos, context.user.id)
    return successResponse(capabilities)
  } catch (error) {
    logger.error('Scenario Builder capabilities lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return errorResponse('Failed to read Scenario Builder capabilities', 500)
  }
}

export const GET = createContextHandler(
  withCollectionActionDispatch({ capabilities: handleCapabilities }),
)

export const POST = createContextHandler(
  withCollectionActionDispatch({ build: handleBuild }),
)
