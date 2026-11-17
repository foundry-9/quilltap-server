/**
 * Atlas lore draft — the handlers behind
 *
 *   POST /api/v1/atlas?action=draft-from-lore  — Brahma drafts an entry, SSE stream
 *   GET  /api/v1/atlas?action=lore-defaults    — `{ brahmaProfileId }` for `?scope=&id=`
 *
 * A draft run is ephemeral: no chat row, no messages, nothing filed. It runs
 * in the parent process inside the route and streams tool events, reasoning
 * and a terminal `done` (carrying the draft) or `error`. Closing the request
 * aborts the loop. The operator files the draft through the ordinary create.
 *
 * Server-only.
 *
 * @module lib/atlas/routes/lore-draft
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { RequestContext } from '@/lib/api/middleware'
import { badRequest, notFound, successResponse, validationError } from '@/lib/api/responses'
import { readJsonBody } from '@/lib/api/request-body'
import { logger as rootLogger } from '@/lib/logger'
import { AtlasScopeSchema } from '@/lib/schemas/atlas.types'
import { UUIDSchema } from '@/lib/schemas/common.types'
import { atlasLoreDraftRequestSchema } from '@/lib/atlas/lore-draft/request-schema'
import {
  describeProfileApiKeyFailure,
  resolveConnectionProfileApiKey,
} from '@/lib/services/api-key.service'
import { resolveBrahmaConnectionProfileForProject } from '@/lib/services/brahma-console/inline-profile'
import { runAtlasLoreDraft } from '@/lib/services/atlas-lore/atlas-lore.service'
import type { StreamController } from '@/lib/services/chat-message/tool-execution.service'

const logger = rootLogger.child({ context: 'AtlasLoreDraft' })

/** The project whose Brahma override applies: a project target's own id, else none. */
const projectOf = (target: { scope: string; id?: string | null }): string | null =>
  target.scope === 'project' ? target.id ?? null : null

/** GET `?action=lore-defaults&scope=&id=` — the profile Brahma would use for a draft filed there. */
export async function handleAtlasLoreDefaults(req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const params = req.nextUrl.searchParams
  const scope = AtlasScopeSchema.safeParse(params.get('scope') ?? 'general')
  if (!scope.success) return badRequest('scope must be character, group, project or general')
  const rawId = params.get('id')
  const id = rawId ? UUIDSchema.safeParse(rawId) : null
  if (id && !id.success) return badRequest('id must be a UUID')

  const profile = await resolveBrahmaConnectionProfileForProject(
    repos,
    user.id,
    projectOf({ scope: scope.data, id: id?.success ? id.data : null }),
    { surface: 'atlas-lore' },
  )
  logger.debug('Atlas lore defaults resolved', { scope: scope.data, brahmaProfileId: profile?.id ?? null })
  return successResponse({ brahmaProfileId: profile?.id ?? null })
}

/** POST `?action=draft-from-lore` — run the draft and stream it. */
export async function handleAtlasLoreDraft(req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const raw = await readJsonBody(req, {})
  const parsed = atlasLoreDraftRequestSchema.safeParse(raw)
  if (!parsed.success) {
    logger.debug('Atlas lore draft request failed validation', { issues: parsed.error.issues.length })
    return validationError(parsed.error)
  }
  const body = parsed.data
  const target = { scope: body.target.scope, id: body.target.id ?? null }

  // The model: the one chosen, else Brahma's own (project → global → default).
  const connectionProfile = body.connectionProfileId
    ? await repos.connections.findById(body.connectionProfileId)
    : await resolveBrahmaConnectionProfileForProject(repos, user.id, projectOf(target), { surface: 'atlas-lore' })
  if (!connectionProfile || connectionProfile.userId !== user.id) {
    logger.debug('Atlas lore draft profile not found for user', { profileId: body.connectionProfileId ?? null })
    return notFound('Connection profile')
  }
  if (body.searchStores && connectionProfile.allowToolUse === false) {
    return badRequest(
      'This connection profile has tool use switched off, so Brahma cannot search the stores with it. Choose another profile, or leave the stores unsearched.',
    )
  }

  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    return badRequest(describeProfileApiKeyFailure(keyResolution.reason))
  }

  logger.debug('Atlas lore draft request accepted', {
    searchStores: body.searchStores,
    targetScope: target.scope,
    revising: body.revision != null,
    profileId: connectionProfile.id,
    chosenProfile: !!body.connectionProfileId,
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
        logger.debug('Atlas lore draft client disconnected; aborting the run')
        closed = true
      }
      signal.addEventListener('abort', onAbort)

      try {
        await runAtlasLoreDraft(
          {
            repos,
            userId: user.id,
            connectionProfile,
            apiKey: keyResolution.apiKey,
            input: {
              subject: body.subject,
              details: body.details,
              searchStores: body.searchStores,
              target,
              priorDraft: body.priorDraft ?? null,
              revision: body.revision ?? null,
            },
          },
          safeController,
          signal,
        )
      } catch (error) {
        // runAtlasLoreDraft never throws by contract; this is belt and braces.
        logger.error('Atlas lore draft stream failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        safeController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Brahma could not finish the draft.' })}\n\n`),
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
