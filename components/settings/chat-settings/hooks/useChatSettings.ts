'use client'

/**
 * useChatSettings — the chat-settings tab's row, its reference lists, and one
 * setter per control.
 *
 * Every setter is a row in a table over `useChatSettingsMutation`: `set(key)`
 * writes one top-level key, `merge(key, defaults)` folds a partial change
 * into a nested object (read from the cache at call time, so two quick
 * changes to one object never lose each other) and sends it whole. The
 * mutation does the optimistic write, the rollback and the error toast; the
 * few setters with a follow-up keep it beside their row.
 *
 * @module components/settings/chat-settings/hooks/useChatSettings
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { readChatSettings, useChatSettingsMutation, type ChatSettingsPatch } from '@/hooks/useChatSettingsMutation'
import { useConnectionProfilesQuery, useEmbeddingProfilesQuery, useImageProfilesQuery } from '@/lib/hooks/use-profiles'
import {
  ChatSettings,
  ConnectionProfile,
  EmbeddingProfile,
  ImageProfile,
  AvatarDisplayMode,
  AvatarDisplayStyle,
  ImpersonationVoiceMode,
  CheapLLMSettings,
  MemoryCascadePreferences,
  TokenDisplaySettings,
  ContextCompressionSettings,
  LLMLoggingSettings,
  StoryBackgroundsSettings,
  DEFAULT_MEMORY_CASCADE_PREFERENCES,
  DEFAULT_TOKEN_DISPLAY_SETTINGS,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  DEFAULT_LLM_LOGGING_SETTINGS,
  AgentModeSettings,
  DEFAULT_AGENT_MODE_SETTINGS,
  DEFAULT_STORY_BACKGROUNDS_SETTINGS,
  DEFAULT_WARDROBE_IMAGE_SETTINGS,
  ConciergeSettings,
  ConciergeSettingsUpdate,
  DEFAULT_CONCIERGE_SETTINGS,
  AutonomousRoomSettings,
  ThinkingDisplaySettings,
  DEFAULT_THINKING_DISPLAY_SETTINGS,
  AnswerConfirmationSettings,
  DEFAULT_ANSWER_CONFIRMATION_SETTINGS,
  SmartTypographySettings,
  DEFAULT_SMART_TYPOGRAPHY_SETTINGS,
} from '../types'

interface UseChatSettingsReturn {
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleMemoryCascadeUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
  handleTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
  handleContextCompressionUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
  handleLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
  handleAutoDetectRngChange: (value: boolean) => Promise<void>
  handleCustomToolsChange: (value: boolean) => Promise<void>
  handleCustomToolTriggersChange: (value: boolean) => Promise<void>
  handleCustomToolInterventionChange: (value: boolean) => Promise<void>
  handleCompositionModeDefaultChange: (value: boolean) => Promise<void>
  handleComposerSpellcheckChange: (value: boolean) => Promise<void>
  handleComposerEmojiChange: (value: boolean) => Promise<void>
  handleComposerUnicodeChange: (value: boolean) => Promise<void>
  handleComposerSlashCommandsChange: (value: boolean) => Promise<void>
  handleImpersonationVoiceModeChange: (value: ImpersonationVoiceMode) => Promise<void>
  handleAutoScrollOnResponseCompleteChange: (value: boolean) => Promise<void>
  handleTextReplacementsEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeDefaultEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeMaxTurnsChange: (value: number) => Promise<void>
  handleStoryBackgroundsEnabledChange: (value: boolean) => Promise<void>
  handleStoryBackgroundsProfileChange: (profileId: string | null) => Promise<void>
  handleWardrobeImageProfileChange: (profileId: string | null) => Promise<void>
  handleWardrobeImageGenerateFromToolsChange: (enabled: boolean) => Promise<void>
  handleConciergeUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
  handleTimezoneChange: (timezone: string | null) => Promise<void>
  handleAutonomousRoomSettingsUpdate: (updates: Partial<AutonomousRoomSettings>) => Promise<void>
  handleThinkingDisplayUpdate: (updates: Partial<ThinkingDisplaySettings>) => Promise<void>
  handleAnswerConfirmationUpdate: (updates: Partial<AnswerConfirmationSettings>) => Promise<void>
  handleSmartTypographyUpdate: (updates: Partial<SmartTypographySettings>) => Promise<void>
}

export function useChatSettings(): UseChatSettingsReturn {
  const queryClient = useQueryClient()
  const { data: settingsData, isLoading, error: loadError, refetch } = useChatSettingsQuery()
  const { data: connectionProfiles } = useConnectionProfilesQuery<ConnectionProfile>()
  const { data: embeddingProfiles } = useEmbeddingProfilesQuery<EmbeddingProfile>()
  const { data: imageProfiles } = useImageProfilesQuery<ImageProfile>()

  // The "Saved" flash beside the tab's heading.
  const [success, setSuccess] = useState(false)
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashSuccess = useCallback(() => {
    setSuccess(true)
    if (successTimer.current) clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccess(false), 2000)
  }, [])

  const { save, saving } = useChatSettingsMutation({ onSaved: flashSuccess })

  const fetchSettings = useCallback(async () => {
    await refetch()
  }, [refetch])

  const handlers = useMemo(() => {
    /** Write a patch once the row is loaded (a merge needs the current value). */
    const write = async (patch: ChatSettingsPatch, failure: string): Promise<boolean> => {
      if (!readChatSettings(queryClient)) return false
      return save(patch, { failure })
    }

    /** One top-level key. */
    const set = <K extends keyof ChatSettings>(key: K, failure: string) =>
      async (value: ChatSettings[K]): Promise<void> => {
        await write({ [key]: value } as ChatSettingsPatch, failure)
      }

    /** A partial change folded into a nested object, sent whole. */
    const mergeAndWrite = <K extends keyof ChatSettings>(
      key: K,
      failure: string,
      defaults: NonNullable<ChatSettings[K]> | undefined,
      updates: Partial<NonNullable<ChatSettings[K]>>,
    ): Promise<boolean> => {
      const current = readChatSettings(queryClient)?.[key] as object | undefined
      const next = { ...(defaults as object | undefined), ...current, ...updates } as ChatSettings[K]
      return write({ [key]: next } as ChatSettingsPatch, failure)
    }
    const merge = <K extends keyof ChatSettings>(key: K, failure: string, defaults?: NonNullable<ChatSettings[K]>) =>
      async (updates: Partial<NonNullable<ChatSettings[K]>>): Promise<void> => {
        await mergeAndWrite(key, failure, defaults, updates)
      }

    /** A single field of a nested object, `(field, value)`. */
    const field = <K extends keyof ChatSettings>(key: K, failure: string, defaults?: NonNullable<ChatSettings[K]>) => {
      const m = merge(key, failure, defaults)
      return <F extends keyof NonNullable<ChatSettings[K]>>(f: F, value: NonNullable<ChatSettings[K]>[F]) =>
        m({ [f]: value } as unknown as Partial<NonNullable<ChatSettings[K]>>)
    }

    const agentMode = merge('agentModeSettings', 'Failed to update agent mode settings', DEFAULT_AGENT_MODE_SETTINGS)
    const storyBackgrounds = merge('storyBackgroundsSettings', 'Failed to update story backgrounds settings', DEFAULT_STORY_BACKGROUNDS_SETTINGS)
    const wardrobeImages = merge('wardrobeImageSettings', 'Failed to update wardrobe image settings', DEFAULT_WARDROBE_IMAGE_SETTINGS)

    return {
      handleAvatarModeChange: set('avatarDisplayMode', 'Failed to update avatar display mode'),
      // The Avatar Display provider reads the same cached row, so every avatar
      // re-renders with the new style as soon as the optimistic write lands.
      handleAvatarStyleChange: set('avatarDisplayStyle', 'Failed to update avatar display style'),
      handleCheapLLMUpdate: merge('cheapLLMSettings', 'Failed to update cheap LLM settings'),
      handleImageDescriptionProfileChange: set('imageDescriptionProfileId', 'Failed to update image description profile'),
      handleMemoryCascadeUpdate: merge('memoryCascadePreferences', 'Failed to update memory cascade preferences', DEFAULT_MEMORY_CASCADE_PREFERENCES),
      handleTokenDisplayChange: field('tokenDisplaySettings', 'Failed to update token display settings', DEFAULT_TOKEN_DISPLAY_SETTINGS),
      handleContextCompressionUpdate: merge('contextCompressionSettings', 'Failed to update context compression settings', DEFAULT_CONTEXT_COMPRESSION_SETTINGS),
      handleLLMLoggingChange: field('llmLoggingSettings', 'Failed to update LLM logging settings', DEFAULT_LLM_LOGGING_SETTINGS),
      handleAutoDetectRngChange: set('autoDetectRng', 'Failed to update auto-detect RNG setting'),
      handleCustomToolsChange: set('customTools', 'Failed to update custom tools setting'),
      handleCustomToolTriggersChange: set('customToolTriggers', 'Failed to update trigger phrase setting'),
      handleCustomToolInterventionChange: set('customToolIntervention', 'Failed to update roll intervention setting'),
      handleCompositionModeDefaultChange: set('compositionModeDefault', 'Failed to update composition mode default'),
      handleComposerSpellcheckChange: set('composerSpellcheck', 'Failed to update composer spellcheck setting'),
      handleComposerEmojiChange: set('composerEmoji', 'Failed to update composer emoji setting'),
      handleComposerUnicodeChange: set('composerUnicode', 'Failed to update composer unicode setting'),
      handleComposerSlashCommandsChange: set('composerSlashCommands', 'Failed to update composer slash-commands setting'),
      handleImpersonationVoiceModeChange: set('impersonationVoiceMode', 'Failed to update impersonated-line voice setting'),
      handleAutoScrollOnResponseCompleteChange: set('autoScrollOnResponseComplete', 'Failed to update auto-scroll setting'),
      handleTextReplacementsEnabledChange: set('textReplacementsEnabled', 'Failed to update text-replacements setting'),
      handleAgentModeDefaultEnabledChange: (value: boolean) => agentMode({ defaultEnabled: value }),
      handleAgentModeMaxTurnsChange: (value: number) => agentMode({ maxTurns: value }),
      handleStoryBackgroundsEnabledChange: (value: boolean) => storyBackgrounds({ enabled: value }),
      handleStoryBackgroundsProfileChange: (profileId: string | null) => storyBackgrounds({ defaultImageProfileId: profileId }),
      handleWardrobeImageProfileChange: (profileId: string | null) => wardrobeImages({ imageProfileId: profileId }),
      handleWardrobeImageGenerateFromToolsChange: (enabled: boolean) => wardrobeImages({ generateFromTools: enabled }),
      // Two nested objects inside; each is merged with its defaults.
      handleConciergeUpdate: async (updates: ConciergeSettingsUpdate): Promise<void> => {
        const current = readChatSettings(queryClient)?.conciergeSettings ?? DEFAULT_CONCIERGE_SETTINGS
        const { display, preScreen, ...topLevel } = updates
        const next: ConciergeSettings = {
          ...DEFAULT_CONCIERGE_SETTINGS,
          ...current,
          ...topLevel,
          display: { ...DEFAULT_CONCIERGE_SETTINGS.display, ...current.display, ...(display ?? {}) },
          preScreen: { ...DEFAULT_CONCIERGE_SETTINGS.preScreen, ...current.preScreen, ...(preScreen ?? {}) },
        }
        await write({ conciergeSettings: next }, "Failed to update the Concierge's settings")
      },
      handleTimezoneChange: set('timezone', 'Failed to update timezone'),
      handleAutonomousRoomSettingsUpdate: merge('autonomousRoomSettings', 'Failed to update autonomous-room settings'),
      handleThinkingDisplayUpdate: merge('thinkingDisplay', 'Failed to update thinking-display settings', DEFAULT_THINKING_DISPLAY_SETTINGS),
      handleAnswerConfirmationUpdate: merge('answerConfirmationSettings', 'Failed to update answer-confirmation settings', DEFAULT_ANSWER_CONFIRMATION_SETTINGS),
      handleSmartTypographyUpdate: async (updates: Partial<SmartTypographySettings>): Promise<void> => {
        const ok = await mergeAndWrite(
          'smartTypographySettings', 'Failed to update smart typography settings', DEFAULT_SMART_TYPOGRAPHY_SETTINGS, updates)
        // Persisted messages arrive with server-PRE-RENDERED HTML baked into the
        // chat payload (see app/api/v1/chats/[id]/handlers/get.ts), so a cached
        // conversation would keep its old quotes until something else happened
        // to refetch it. Toggling `displayQuotes` must be visible at once, which
        // means dropping those cached renders. Messages the client renders
        // itself pick the change up through the settings query directly.
        if (ok) await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      },
    }
  }, [queryClient, save])

  return {
    settings: settingsData ?? null,
    loading: isLoading,
    error: loadError ? (loadError instanceof Error ? loadError.message : 'An error occurred') : null,
    saving,
    success,
    connectionProfiles: connectionProfiles ?? [],
    embeddingProfiles: embeddingProfiles ?? [],
    imageProfiles: imageProfiles ?? [],
    loadingProfiles: !connectionProfiles || !embeddingProfiles || !imageProfiles,
    fetchSettings,
    ...handlers,
  }
}
