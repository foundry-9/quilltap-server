/**
 * Chat Settings Management Routes
 *
 * GET    /api/chat-settings   - Get chat settings for current user
 * POST   /api/chat-settings   - Update chat settings for current user (legacy)
 * PUT    /api/chat-settings   - Update chat settings for current user
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { TagStyleMapSchema, ThemePreferenceSchema, TokenDisplaySettingsSchema, type AvatarDisplayMode } from '@/lib/schemas/types'
import { getErrorMessage } from '@/lib/errors'

/**
 * Validate and update chat settings
 */
async function updateChatSettings(
  userId: string,
  avatarDisplayMode?: string,
  avatarDisplayStyle?: string,
  tagStyles?: unknown,
  cheapLLMSettings?: unknown,
  imageDescriptionProfileId?: string | null,
  themePreference?: unknown,
  defaultRoleplayTemplateId?: string | null,
  sidebarWidth?: number,
  tokenDisplaySettings?: unknown
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

  const repos = getRepositories()

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
    logger.debug('Updating sidebar width', { userId, sidebarWidth })
  }
  if (typeof tokenDisplaySettings !== 'undefined') {
    const validatedTokenDisplaySettings = TokenDisplaySettingsSchema.parse(tokenDisplaySettings)
    updateData.tokenDisplaySettings = validatedTokenDisplaySettings
  }

  return repos.chatSettings.updateForUser(userId, updateData)
}

/**
 * GET /api/chat-settings
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

    return NextResponse.json(chatSettings)
  } catch (error) {
    logger.error('Error fetching chat settings', { context: 'GET /api/chat-settings' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch chat settings' },
      { status: 500 }
    )
  }
})

/**
 * Handle settings update for both POST and PUT
 */
async function handleSettingsUpdate(req: NextRequest, { user }: AuthenticatedContext) {
  try {
    const body = await req.json()
    const { avatarDisplayMode, avatarDisplayStyle, tagStyles, cheapLLMSettings, imageDescriptionProfileId, themePreference, defaultRoleplayTemplateId, sidebarWidth, tokenDisplaySettings } = body

    const chatSettings = await updateChatSettings(
      user.id,
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId,
      themePreference,
      defaultRoleplayTemplateId,
      sidebarWidth,
      tokenDisplaySettings
    )

    return NextResponse.json(chatSettings)
  } catch (error) {
    logger.error('Error updating chat settings', { context: 'PUT/POST /api/chat-settings' }, error instanceof Error ? error : undefined)
    const errorMessage = getErrorMessage(error, 'Failed to update chat settings')
    const status = errorMessage.includes('Invalid') ? 400 : 500
    return NextResponse.json(
      { error: errorMessage },
      { status }
    )
  }
}

/**
 * POST /api/chat-settings
 * Update chat settings for the authenticated user (legacy, for backwards compatibility)
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, context: AuthenticatedContext) => {
  return handleSettingsUpdate(req, context)
})

/**
 * PUT /api/chat-settings
 * Update chat settings for the authenticated user
 */
export const PUT = createAuthenticatedHandler(async (req: NextRequest, context: AuthenticatedContext) => {
  return handleSettingsUpdate(req, context)
})
