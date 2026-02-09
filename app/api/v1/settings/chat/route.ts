/**
 * Chat Settings Management Routes (v1)
 *
 * GET /api/v1/settings/chat - Get chat settings for current user
 * PUT /api/v1/settings/chat - Update chat settings for current user
 */

import { NextRequest } from 'next/server'
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { successResponse, serverError, badRequest } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { TagStyleMapSchema, ThemePreferenceSchema } from '@/lib/schemas/common.types'
import { TokenDisplaySettingsSchema, LLMLoggingSettingsSchema, AgentModeSettingsSchema, StoryBackgroundsSettingsSchema, DangerousContentSettingsSchema } from '@/lib/schemas/settings.types'
import { type AvatarDisplayMode } from '@/lib/schemas/types'
import { getErrorMessage } from '@/lib/errors'

/**
 * Validate and update chat settings
 */
async function updateChatSettings(
  userId: string,
  repos: any,
  avatarDisplayMode?: string,
  avatarDisplayStyle?: string,
  tagStyles?: unknown,
  cheapLLMSettings?: unknown,
  imageDescriptionProfileId?: string | null,
  themePreference?: unknown,
  defaultRoleplayTemplateId?: string | null,
  sidebarWidth?: number,
  tokenDisplaySettings?: unknown,
  memoryCascadePreferences?: unknown,
  llmLoggingSettings?: unknown,
  autoDetectRng?: boolean,
  agentModeSettings?: unknown,
  storyBackgroundsSettings?: unknown,
  contextCompressionSettings?: unknown,
  dangerousContentSettings?: unknown
) {
  // Validate avatarDisplayMode if provided
  if (avatarDisplayMode) {
    const validModes: AvatarDisplayMode[] = ['ALWAYS', 'GROUP_ONLY', 'NEVER']
    if (!validModes.includes(avatarDisplayMode as AvatarDisplayMode)) {
      throw new Error('Invalid avatar display mode')
    }
  }

  // Validate avatarDisplayStyle if provided
  if (avatarDisplayStyle) {
    const validStyles = ['CIRCULAR', 'RECTANGULAR']
    if (!validStyles.includes(avatarDisplayStyle)) {
      throw new Error('Invalid avatar display style')
    }
  }

  const updateData: Record<string, any> = {}
  if (avatarDisplayMode) updateData.avatarDisplayMode = avatarDisplayMode
  if (avatarDisplayStyle) updateData.avatarDisplayStyle = avatarDisplayStyle
  if (typeof tagStyles !== 'undefined') {
    const validatedTagStyles = TagStyleMapSchema.parse(tagStyles)
    updateData.tagStyles = validatedTagStyles
  }
  if (typeof cheapLLMSettings !== 'undefined') {
    // Validate cheapLLMSettings structure
    const validStrategies = ['USER_DEFINED', 'PROVIDER_CHEAPEST', 'LOCAL_FIRST']
    const validEmbeddingProviders = ['SAME_PROVIDER', 'OPENAI', 'LOCAL']

    if (cheapLLMSettings && typeof cheapLLMSettings === 'object') {
      const settings = cheapLLMSettings as any
      if (settings.strategy && !validStrategies.includes(settings.strategy)) {
        throw new Error('Invalid cheap LLM strategy')
      }
      if (settings.embeddingProvider && !validEmbeddingProviders.includes(settings.embeddingProvider)) {
        throw new Error('Invalid embedding provider')
      }
    }
    updateData.cheapLLMSettings = cheapLLMSettings
  }
  if (typeof imageDescriptionProfileId !== 'undefined') {
    updateData.imageDescriptionProfileId = imageDescriptionProfileId
  }
  if (typeof themePreference !== 'undefined') {
    const validatedThemePreference = ThemePreferenceSchema.parse(themePreference)
    updateData.themePreference = validatedThemePreference
  }
  if (typeof defaultRoleplayTemplateId !== 'undefined') {
    // Validate template exists if setting a non-null value
    if (defaultRoleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(defaultRoleplayTemplateId)
      if (!template) {
        throw new Error('Invalid roleplay template ID')
      }
    }
    updateData.defaultRoleplayTemplateId = defaultRoleplayTemplateId
  }
  if (typeof sidebarWidth !== 'undefined') {
    // Validate sidebar width range (256-512)
    if (typeof sidebarWidth !== 'number' || sidebarWidth < 256 || sidebarWidth > 512) {
      throw new Error('Invalid sidebar width (must be 256-512)')
    }
    updateData.sidebarWidth = sidebarWidth
  }
  if (typeof tokenDisplaySettings !== 'undefined') {
    const validatedTokenDisplaySettings = TokenDisplaySettingsSchema.parse(tokenDisplaySettings)
    updateData.tokenDisplaySettings = validatedTokenDisplaySettings
  }
  if (typeof memoryCascadePreferences !== 'undefined') {
    // Validate memoryCascadePreferences structure
    const validActions = ['DELETE_MEMORIES', 'KEEP_MEMORIES', 'ASK_EVERY_TIME', 'REGENERATE_MEMORIES']
    if (memoryCascadePreferences && typeof memoryCascadePreferences === 'object') {
      const prefs = memoryCascadePreferences as any
      if (prefs.onMessageDelete && !validActions.includes(prefs.onMessageDelete)) {
        throw new Error('Invalid memory cascade action for onMessageDelete')
      }
      if (prefs.onSwipeRegenerate && !validActions.includes(prefs.onSwipeRegenerate)) {
        throw new Error('Invalid memory cascade action for onSwipeRegenerate')
      }
    }
    updateData.memoryCascadePreferences = memoryCascadePreferences
  }
  if (typeof llmLoggingSettings !== 'undefined') {
    const validatedLLMLoggingSettings = LLMLoggingSettingsSchema.parse(llmLoggingSettings)
    updateData.llmLoggingSettings = validatedLLMLoggingSettings
  }
  if (typeof autoDetectRng !== 'undefined') {
    if (typeof autoDetectRng !== 'boolean') {
      throw new Error('Invalid autoDetectRng value (must be boolean)')
    }
    updateData.autoDetectRng = autoDetectRng
  }
  if (typeof agentModeSettings !== 'undefined') {
    const validatedAgentModeSettings = AgentModeSettingsSchema.parse(agentModeSettings)
    updateData.agentModeSettings = validatedAgentModeSettings
  }
  if (typeof storyBackgroundsSettings !== 'undefined') {
    const validatedStoryBackgroundsSettings = StoryBackgroundsSettingsSchema.parse(storyBackgroundsSettings)
    updateData.storyBackgroundsSettings = validatedStoryBackgroundsSettings
  }
  if (typeof contextCompressionSettings !== 'undefined') {
    // Basic validation - ensure it's an object with expected structure
    if (contextCompressionSettings && typeof contextCompressionSettings === 'object') {
      const settings = contextCompressionSettings as any
      if (typeof settings.enabled !== 'boolean') {
        throw new Error('Invalid contextCompressionSettings.enabled (must be boolean)')
      }
      if (typeof settings.windowSize !== 'number' || settings.windowSize < 1) {
        throw new Error('Invalid contextCompressionSettings.windowSize (must be positive number)')
      }
    }
    updateData.contextCompressionSettings = contextCompressionSettings
  }
  if (typeof dangerousContentSettings !== 'undefined') {
    const validatedDangerousContentSettings = DangerousContentSettingsSchema.parse(dangerousContentSettings)
    updateData.dangerousContentSettings = validatedDangerousContentSettings
  }

  return repos.chatSettings.updateForUser(userId, updateData)
}

/**
 * GET /api/v1/settings/chat
 * Get chat settings for the authenticated user
 * Returns default settings if none exist
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }: AuthenticatedContext) => {
  try {

    let chatSettings = await repos.chatSettings.findByUserId(user.id)

    // If no settings exist, create default settings via update
    if (!chatSettings) {
      chatSettings = await repos.chatSettings.updateForUser(user.id, {
        avatarDisplayMode: 'ALWAYS',
        avatarDisplayStyle: 'CIRCULAR',
        tagStyles: {},
        themePreference: {
          activeThemeId: null,
          colorMode: 'system',
          showNavThemeSelector: false,
        },
      })
    }

    return successResponse(chatSettings)
  } catch (error) {
    logger.error('[Settings v1] Error fetching chat settings', { userId: user.id }, error instanceof Error ? error : undefined)
    return serverError('Failed to fetch chat settings')
  }
})

/**
 * PUT /api/v1/settings/chat
 * Update chat settings for the authenticated user
 */
export const PUT = createAuthenticatedHandler(async (req: NextRequest, { user, repos }: AuthenticatedContext) => {
  try {
    const body = await req.json()
    const {
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId,
      themePreference,
      defaultRoleplayTemplateId,
      sidebarWidth,
      tokenDisplaySettings,
      memoryCascadePreferences,
      llmLoggingSettings,
      autoDetectRng,
      agentModeSettings,
      storyBackgroundsSettings,
      contextCompressionSettings,
      dangerousContentSettings,
    } = body

    const chatSettings = await updateChatSettings(
      user.id,
      repos,
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId,
      themePreference,
      defaultRoleplayTemplateId,
      sidebarWidth,
      tokenDisplaySettings,
      memoryCascadePreferences,
      llmLoggingSettings,
      autoDetectRng,
      agentModeSettings,
      storyBackgroundsSettings,
      contextCompressionSettings,
      dangerousContentSettings
    )

    return successResponse(chatSettings)
  } catch (error) {
    logger.error('[Settings v1] Error updating chat settings', { userId: user.id }, error instanceof Error ? error : undefined)
    const errorMessage = getErrorMessage(error, 'Failed to update chat settings')
    const status = errorMessage.includes('Invalid') ? 400 : 500
    if (status === 400) {
      return badRequest(errorMessage)
    }
    return serverError(errorMessage)
  }
})
