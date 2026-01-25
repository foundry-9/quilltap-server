'use client'

import { useCallback, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { countTemplateReplacements, replaceWithTemplate } from '@/components/characters/TemplateHighlighter'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'
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
  avatarRefreshKey: number
  templateCounts: TemplateCounts
  replacingTemplate: 'char' | 'user' | null
  togglingNpc: boolean
  togglingFavorite: boolean
  togglingControlledBy: boolean
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
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [replacingTemplate, setReplacingTemplate] = useState<'char' | 'user' | null>(null)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)
  const [togglingNpc, setTogglingNpc] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState(false)
  const [togglingControlledBy, setTogglingControlledBy] = useState(false)

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
    scenario: character?.scenario,
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
      if (character.scenario) {
        const replaced = replaceWithTemplate(character.scenario, nameToReplace, template)
        if (replaced !== character.scenario) updates.scenario = replaced
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
      showSuccessToast(`Replaced ${type === 'char' ? 'character name' : 'persona name'} with ${template}`)
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
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    togglingNpc,
    togglingFavorite,
    togglingControlledBy,
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
    handleToggleNpc,
    handleToggleFavorite,
    handleToggleControlledBy,
  }
}
