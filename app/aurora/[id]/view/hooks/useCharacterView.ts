'use client'

import { useCallback, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { countTemplateReplacements, replaceWithTemplate } from '@/components/characters/TemplateHighlighter'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'
import type { TimestampConfig } from '@/lib/schemas/types'
import {
  Character,
  Tag,
  ConnectionProfile,
  UserControlledCharacter,
  ImageProfile,
  TemplateCounts,
  TemplateFields,
} from '../types'

interface UseCharacterViewReturn {
  loading: boolean
  error: string | null
  character: Character | null
  tags: Tag[]
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  defaultPartnerId: string
  defaultPartnerName: string | null
  imageProfiles: ImageProfile[]
  defaultImageProfileId: string
  avatarRefreshKey: number
  templateCounts: TemplateCounts
  replacingTemplate: 'char' | 'user' | null
  togglingNpc: boolean
  togglingFavorite: boolean
  togglingControlledBy: boolean
  savingAgentMode: boolean
  savingHelpTools: boolean
  savingCanDressThemselves: boolean
  savingCanCreateOutfits: boolean
  savingTimestampConfig: boolean
  savingDefaultScenario: boolean
  savingDefaultSystemPrompt: boolean
  fetchCharacter: () => Promise<void>
  fetchTags: () => Promise<void>
  fetchProfiles: () => Promise<void>
  fetchUserControlledCharacters: () => Promise<void>
  fetchDefaultPartner: () => Promise<void>
  fetchImageProfiles: () => Promise<void>
  setCharacter: (char: Character | null) => void
  setDefaultPartnerId: (id: string) => void
  setAvatarRefreshKey: (key: number) => void
  setImageProfiles: (profiles: ImageProfile[]) => void
  handleTemplateReplace: (type: 'char' | 'user') => Promise<void>
  handleSaveConnectionProfile: (profileId: string) => Promise<void>
  handleSaveDefaultPartner: (partnerId: string) => Promise<void>
  handleSaveImageProfile: (profileId: string | null) => Promise<void>
  handleSaveAgentMode: (enabled: boolean | null) => Promise<void>
  handleSaveHelpTools: (enabled: boolean | null) => Promise<void>
  handleSaveCanDressThemselves: (enabled: boolean | null) => Promise<void>
  handleSaveCanCreateOutfits: (enabled: boolean | null) => Promise<void>
  handleSaveTimestampConfig: (config: TimestampConfig | null) => Promise<void>
  handleSaveDefaultScenario: (scenarioId: string | null) => Promise<void>
  handleSaveDefaultSystemPrompt: (promptId: string | null) => Promise<void>
  handleToggleNpc: () => Promise<void>
  handleToggleFavorite: () => Promise<void>
  handleToggleControlledBy: () => Promise<void>
}

export function useCharacterView(characterId: string): UseCharacterViewReturn {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<UserControlledCharacter[]>([])
  const [defaultPartnerId, setDefaultPartnerId] = useState<string>('')
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [defaultImageProfileId, setDefaultImageProfileId] = useState<string>('')
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [replacingTemplate, setReplacingTemplate] = useState<'char' | 'user' | null>(null)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)
  const [savingImageProfile, setSavingImageProfile] = useState(false)
  const [togglingNpc, setTogglingNpc] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState(false)
  const [togglingControlledBy, setTogglingControlledBy] = useState(false)
  const [savingAgentMode, setSavingAgentMode] = useState(false)
  const [savingHelpTools, setSavingHelpTools] = useState(false)
  const [savingCanDressThemselves, setSavingCanDressThemselves] = useState(false)
  const [savingCanCreateOutfits, setSavingCanCreateOutfits] = useState(false)
  const [savingTimestampConfig, setSavingTimestampConfig] = useState(false)
  const [savingDefaultScenario, setSavingDefaultScenario] = useState(false)
  const [savingDefaultSystemPrompt, setSavingDefaultSystemPrompt] = useState(false)

  // Get the default partner for template highlighting ({{user}} replacement)
  // This uses the new default conversation partner system instead of old personas
  const defaultPartner = userControlledCharacters.find(c => c.id === defaultPartnerId)
  const defaultPartnerName = defaultPartner?.name || null

  // Get the default system prompt content for template highlighting
  const defaultSystemPrompt = character?.systemPrompts?.find(p => p.isDefault) || character?.systemPrompts?.[0]
  const defaultSystemPromptContent = defaultSystemPrompt?.content || null

  // Count template replacement opportunities in fields that support templates
  const templateFields: TemplateFields = {
    description: character?.description,
    personality: character?.personality,
    firstMessage: character?.firstMessage,
    exampleDialogues: character?.exampleDialogues,
    systemPrompt: defaultSystemPromptContent,
  }

  const templateCounts = character
    ? countTemplateReplacements(templateFields, character.name, defaultPartnerName)
    : { charCount: 0, userCount: 0, fieldCounts: {} }

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      setCharacter((prev) => {
        if (prev?.defaultImageId !== data.character.defaultImageId) {
          setAvatarRefreshKey(k => k + 1)
        }
        return data.character
      })
      // Set the default image profile ID from the character data
      if (data.character.defaultImageProfileId) {
        setDefaultImageProfileId(data.character.defaultImageProfileId)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMsg)
      console.error('Failed to fetch character', { error: errorMsg, characterId })
    } finally {
      setLoading(false)
    }
  }, [characterId])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=get-tags`)
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      setTags(data.tags || [])
    } catch (err) {
      console.error('Failed to fetch tags:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/connection-profiles')
      if (res.ok) {
        const data = await res.json()
        const profiles = data.profiles || []
        setProfiles(profiles.map((p: any) => ({ id: p.id, name: p.name })))
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchImageProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/image-profiles')
      if (res.ok) {
        const data = await res.json()
        setImageProfiles(data)
      }
    } catch (err) {
      console.error('Failed to fetch image profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchUserControlledCharacters = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/characters?controlledBy=user')
      if (res.ok) {
        const data = await res.json()
        const characters = data.characters || []
        setUserControlledCharacters(characters.map((c: any) => ({
          id: c.id,
          name: c.name,
          title: c.title || null,
        })))
      }
    } catch (err) {
      console.error('Failed to fetch user-controlled characters:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchDefaultPartner = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=default-partner`)
      if (res.ok) {
        const data = await res.json()
        if (data.partnerId) {
          setDefaultPartnerId(data.partnerId)
        }
      }
    } catch (err) {
      console.error('Failed to fetch default partner:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  // Handler for template replacement
  const handleTemplateReplace = async (type: 'char' | 'user') => {
    if (!character) return

    const nameToReplace = type === 'char' ? character.name : defaultPartnerName
    const template = type === 'char' ? '{{char}}' : '{{user}}'

    if (!nameToReplace) return

    setReplacingTemplate(type)

    try {
      // Build update payload with replaced fields
      const updates: Record<string, string> = {}

      if (character.description) {
        const replaced = replaceWithTemplate(character.description, nameToReplace, template)
        if (replaced !== character.description) updates.description = replaced
      }
      if (character.personality) {
        const replaced = replaceWithTemplate(character.personality, nameToReplace, template)
        if (replaced !== character.personality) updates.personality = replaced
      }
      // Apply template replacement to all scenarios
      if (character.scenarios && character.scenarios.length > 0) {
        const updatedScenarios = character.scenarios.map(s => {
          const replaced = replaceWithTemplate(s.content, nameToReplace, template)
          return replaced !== s.content ? { ...s, content: replaced } : s
        })
        const hasChanges = updatedScenarios.some((s, i) => s !== character.scenarios![i])
        if (hasChanges) {
          (updates as Record<string, unknown>).scenarios = updatedScenarios
        }
      }
      if (character.firstMessage) {
        const replaced = replaceWithTemplate(character.firstMessage, nameToReplace, template)
        if (replaced !== character.firstMessage) updates.firstMessage = replaced
      }
      if (character.exampleDialogues) {
        const replaced = replaceWithTemplate(character.exampleDialogues, nameToReplace, template)
        if (replaced !== character.exampleDialogues) updates.exampleDialogues = replaced
      }

      if (Object.keys(updates).length === 0) {
        showSuccessToast('No replacements needed')
        return
      }

      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }

      await fetchCharacter()
      showSuccessToast(`Replaced ${type === 'char' ? 'character name' : 'user character name'} with ${template}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to replace template')
      console.error('Template replacement failed', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setReplacingTemplate(null)
    }
  }

  const handleSaveConnectionProfile = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      // Handle the special "User Acts As Character" virtual profile
      const isUserControlled = profileId === USER_CONTROLLED_PROFILE_ID
      const updatePayload = isUserControlled
        ? {
            controlledBy: 'user' as const,
            defaultConnectionProfileId: undefined,
          }
        : {
            controlledBy: 'llm' as const,
            defaultConnectionProfileId: profileId || undefined,
          }

      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      })
      if (!res.ok) throw new Error('Failed to update connection profile')
      await fetchCharacter()
      showSuccessToast(isUserControlled ? 'Character set to user-controlled' : 'Connection profile updated')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update connection profile')
      console.error('Failed to save connection profile', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handleSaveDefaultPartner = async (partnerId: string) => {
    setSavingPartner(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=set-default-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: partnerId || null }),
      })
      if (!res.ok) throw new Error('Failed to update default partner')

      setDefaultPartnerId(partnerId)
      showSuccessToast(partnerId ? 'Default partner updated' : 'Default partner removed')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update partner')
      console.error('Failed to save default partner', { error: err instanceof Error ? err.message : String(err) })
      await fetchDefaultPartner() // Revert to server state
    } finally {
      setSavingPartner(false)
    }
  }

  const handleSaveImageProfile = async (profileId: string | null) => {
    setSavingImageProfile(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultImageProfileId: profileId }),
      })
      if (!res.ok) throw new Error('Failed to update image profile')

      setDefaultImageProfileId(profileId || '')
      showSuccessToast(profileId ? 'Image profile updated' : 'Image profile removed')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update image profile')
      console.error('Failed to save image profile', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingImageProfile(false)
    }
  }

  const handleSaveAgentMode = async (enabled: boolean | null) => {
    setSavingAgentMode(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAgentModeEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update agent mode setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultAgentModeEnabled: enabled })
      }
      const message = enabled === null
        ? 'Agent mode set to inherit from global'
        : enabled
          ? 'Agent mode enabled by default'
          : 'Agent mode disabled by default'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update agent mode')
      console.error('Failed to save agent mode', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingAgentMode(false)
    }
  }

  const handleSaveHelpTools = async (enabled: boolean | null) => {
    setSavingHelpTools(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultHelpToolsEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update help tools setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultHelpToolsEnabled: enabled })
      }
      const message = enabled === null
        ? 'Help tools set to inherit from global (disabled)'
        : enabled
          ? 'Help tools enabled'
          : 'Help tools disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update help tools')
      console.error('Failed to save help tools', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingHelpTools(false)
    }
  }

  const handleSaveCanDressThemselves = async (enabled: boolean | null) => {
    setSavingCanDressThemselves(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canDressThemselves: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update self-dressing setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, canDressThemselves: enabled })
      }
      const message = enabled === null
        ? 'Wardrobe self-dressing set to inherit from global (enabled)'
        : enabled
          ? 'Wardrobe self-dressing enabled'
          : 'Wardrobe self-dressing disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update self-dressing setting')
      console.error('Failed to save self-dressing setting', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingCanDressThemselves(false)
    }
  }

  const handleSaveCanCreateOutfits = async (enabled: boolean | null) => {
    setSavingCanCreateOutfits(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canCreateOutfits: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update outfit creation setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, canCreateOutfits: enabled })
      }
      const message = enabled === null
        ? 'Outfit creation set to inherit from global (enabled)'
        : enabled
          ? 'Outfit creation enabled'
          : 'Outfit creation disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update outfit creation setting')
      console.error('Failed to save outfit creation setting', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingCanCreateOutfits(false)
    }
  }

  const handleSaveTimestampConfig = async (config: TimestampConfig | null) => {
    setSavingTimestampConfig(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTimestampConfig: config }),
      })
      if (!res.ok) throw new Error('Failed to update timestamp config')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultTimestampConfig: config })
      }
      const message = config && config.mode !== 'NONE'
        ? 'Default timestamp settings updated'
        : 'Default timestamp settings cleared'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update timestamp config')
      console.error('Failed to save timestamp config', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingTimestampConfig(false)
    }
  }

  const handleSaveDefaultScenario = async (scenarioId: string | null) => {
    setSavingDefaultScenario(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultScenarioId: scenarioId }),
      })
      if (!res.ok) throw new Error('Failed to update default scenario')

      if (character) {
        setCharacter({ ...character, defaultScenarioId: scenarioId })
      }
      showSuccessToast(scenarioId ? 'Default scenario updated' : 'Default scenario cleared')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update default scenario')
      console.error('Failed to save default scenario', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter()
    } finally {
      setSavingDefaultScenario(false)
    }
  }

  const handleSaveDefaultSystemPrompt = async (promptId: string | null) => {
    setSavingDefaultSystemPrompt(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSystemPromptId: promptId }),
      })
      if (!res.ok) throw new Error('Failed to update default system prompt')

      if (character) {
        // Also update the isDefault flags on the prompts array to stay in sync
        const updatedPrompts = character.systemPrompts?.map(p => ({
          ...p,
          isDefault: promptId ? p.id === promptId : p.isDefault,
        })) || []
        setCharacter({ ...character, defaultSystemPromptId: promptId, systemPrompts: updatedPrompts })
      }
      showSuccessToast(promptId ? 'Default system prompt updated' : 'Default system prompt cleared')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update default system prompt')
      console.error('Failed to save default system prompt', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter()
    } finally {
      setSavingDefaultSystemPrompt(false)
    }
  }

  const handleToggleNpc = async () => {
    if (!character) return
    setTogglingNpc(true)
    try {
      const newNpcValue = !character.npc
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc: newNpcValue }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }
      // Update local state
      setCharacter({ ...character, npc: newNpcValue })
      showSuccessToast(newNpcValue ? 'Converted to NPC' : 'Converted to Character')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle NPC status')
      console.error('Failed to toggle NPC status', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingNpc(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (!character) return
    setTogglingFavorite(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=favorite`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to toggle favorite')
      }
      const data = await res.json()
      setCharacter({ ...character, isFavorite: data.character.isFavorite })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle favorite')
      console.error('Failed to toggle favorite', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingFavorite(false)
    }
  }

  const handleToggleControlledBy = async () => {
    if (!character) return
    setTogglingControlledBy(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=toggle-controlled-by`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to toggle controlled-by')
      }
      const data = await res.json()
      setCharacter({ ...character, controlledBy: data.character.controlledBy })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle controlled-by')
      console.error('Failed to toggle controlled-by', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingControlledBy(false)
    }
  }

  return {
    loading,
    error,
    character,
    tags,
    profiles,
    userControlledCharacters,
    defaultPartnerId,
    defaultPartnerName,
    imageProfiles,
    defaultImageProfileId,
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    togglingNpc,
    togglingFavorite,
    togglingControlledBy,
    savingAgentMode,
    savingHelpTools,
    savingCanDressThemselves,
    savingCanCreateOutfits,
    savingTimestampConfig,
    savingDefaultScenario,
    savingDefaultSystemPrompt,
    fetchCharacter,
    fetchTags,
    fetchProfiles,
    fetchUserControlledCharacters,
    fetchDefaultPartner,
    fetchImageProfiles,
    setCharacter,
    setDefaultPartnerId,
    setAvatarRefreshKey,
    setImageProfiles,
    handleTemplateReplace,
    handleSaveConnectionProfile,
    handleSaveDefaultPartner,
    handleSaveImageProfile,
    handleSaveAgentMode,
    handleSaveHelpTools,
    handleSaveCanDressThemselves,
    handleSaveCanCreateOutfits,
    handleSaveTimestampConfig,
    handleSaveDefaultScenario,
    handleSaveDefaultSystemPrompt,
    handleToggleNpc,
    handleToggleFavorite,
    handleToggleControlledBy,
  }
}
