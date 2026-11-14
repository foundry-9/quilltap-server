/**
 * Chat Settings Management Routes (v1)
 *
 * GET /api/v1/settings/chat - Get chat settings for current user
 * PUT /api/v1/settings/chat - Update chat settings for current user
 */

import { NextRequest } from 'next/server'
import { createContextHandler, type RequestContext } from '@/lib/api/middleware'
import { z } from 'zod'
import { successResponse, serverError, badRequest } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { ChatSettingsSchema } from '@/lib/schemas/settings.types'
import { patchSchemaOf } from '@/lib/schemas/patch-schema'
import { defaultChatSettings } from '@/lib/database/repositories/chat-settings.repository'

/**
 * The keys a PUT may no longer carry: `dangerousContentSettings`,
 * `uncensoredImageDescriptionProfileId` and `cheapLLMSettings.imagePromptProfileId`
 * all moved into `conciergeSettings`.
 */
function findRetiredConciergeKeys(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const retired: string[] = []
  if (typeof b.dangerousContentSettings !== 'undefined') retired.push('dangerousContentSettings')
  if (typeof b.uncensoredImageDescriptionProfileId !== 'undefined') retired.push('uncensoredImageDescriptionProfileId')
  const cheap = b.cheapLLMSettings
  if (cheap && typeof cheap === 'object' && typeof (cheap as Record<string, unknown>).imagePromptProfileId !== 'undefined') {
    retired.push('cheapLLMSettings.imagePromptProfileId')
  }
  return retired
}

/**
 * The write-side shape of a PUT: every operator-settable key of
 * `ChatSettingsSchema`, each optional and none defaulted (`patchSchemaOf`, bug
 * 244), and **strict** — an unknown key is a 400 rather than silently dropped:
 * a field the client thinks it saved but the route never wrote (Core whisper's
 * toggles, for one) reads back unchanged and looks like a UI that won't take
 * the click.
 *
 * The repository replaces each top-level key wholesale and the clients send
 * whole nested objects, so a nested object validates against its full
 * sub-schema (its own field defaults fill what a client left out — the same
 * values a read would have filled in). Server-owned and non-operator columns
 * (`id`, `userId`, timestamps, `defaultTimestampConfig`, `timezone`) are not
 * writable here.
 */
export const ChatSettingsPutSchema = patchSchemaOf(
  ChatSettingsSchema.omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    defaultTimestampConfig: true,
    timezone: true,
  }).extend({
    // The entity column is a free string for old rows; a write names one of
    // the two styles the Salon draws.
    avatarDisplayStyle: z.enum(['CIRCULAR', 'RECTANGULAR']),
  }),
).strict()

export type ChatSettingsPut = z.infer<typeof ChatSettingsPutSchema>

/**
 * Write a validated patch. The only check the schema cannot make is that a
 * named roleplay template exists.
 */
async function updateChatSettings(userId: string, repos: RequestContext['repos'], patch: ChatSettingsPut) {
  if (patch.defaultRoleplayTemplateId) {
    const template = await repos.roleplayTemplates.findById(patch.defaultRoleplayTemplateId)
    if (!template) {
      logger.warn('[Settings v1] Rejected an unknown default roleplay template', {
        userId,
        templateId: patch.defaultRoleplayTemplateId,
      })
      return badRequest('Invalid roleplay template ID')
    }
  }

  logger.debug('[Settings v1] Updating chat settings', { userId, keys: Object.keys(patch) })
  if (patch.conciergeSettings) {
    logger.debug('[Settings v1] Updating Concierge settings', {
      userId,
      enabled: patch.conciergeSettings.enabled,
      preScreen: patch.conciergeSettings.preScreen.enabled,
      summaryClassification: patch.conciergeSettings.preScreen.summaryClassification,
    })
  }

  return successResponse(await repos.chatSettings.updateForUser(userId, patch))
}

/**
 * GET /api/v1/settings/chat
 * Get chat settings for the authenticated user. A user who has never saved
 * any gets the defaults — answered, not written: the row is created by the
 * first PUT (`updateForUser`), so a read never writes.
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  try {
    const chatSettings = await repos.chatSettings.findByUserId(user.id)
    if (chatSettings) {
      return successResponse(chatSettings)
    }

    logger.debug('[Settings v1] No chat settings saved yet; answering defaults', { userId: user.id })
    return successResponse(defaultChatSettings(user.id))
  } catch (error) {
    logger.error('[Settings v1] Error fetching chat settings', { userId: user.id }, error instanceof Error ? error : undefined)
    return serverError('Failed to fetch chat settings')
  }
})

/**
 * PUT /api/v1/settings/chat
 * Update chat settings for the authenticated user
 */
export const PUT = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  const body = await req.json()

  // Settings the Concierge's own object replaced (phase 4). A stale client
  // must fail loudly rather than write a column nothing reads any more.
  const retired = findRetiredConciergeKeys(body)
  if (retired.length > 0) {
    logger.warn('[Settings v1] Rejected a PUT carrying retired Concierge settings', { userId: user.id, retired })
    return badRequest(
      `Invalid settings: ${retired.join(', ')} ${retired.length === 1 ? 'was' : 'were'} replaced by conciergeSettings`,
    )
  }

  // A malformed body throws a ZodError, which the middleware answers with a
  // 400 and the issues (#166). Anything else is a real 500.
  const patch = ChatSettingsPutSchema.parse(body)
  return updateChatSettings(user.id, repos, patch)
})
