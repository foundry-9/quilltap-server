'use client'

import { useCallback, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { countTemplateReplacements, replaceWithTemplate } from '@/components/characters/TemplateHighlighter'
import {
  Character,
  Tag,
  ConnectionProfile,
  Persona,
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
  personas: Persona[]
  defaultPersonaId: string
  imageProfiles: ImageProfile[]
  avatarRefreshKey: number
  templateCounts: TemplateCounts
  replacingTemplate: 'char' | 'user' | null
  fetchCharacter: () => Promise<void>
  fetchTags: () => Promise<void>
  fetchProfiles: () => Promise<void>
  fetchPersonas: () => Promise<void>
  fetchDefaultPersona: () => Promise<void>
  fetchImageProfiles: () => Promise<void>
  setCharacter: (char: Character | null) => void
  setDefaultPersonaId: (id: string) => void
  setAvatarRefreshKey: (key: number) => void
  setImageProfiles: (profiles: ImageProfile[]) => void
  handleTemplateReplace: (type: 'char' | 'user') => Promise<void>
  handleSaveConnectionProfile: (profileId: string) => Promise<void>
  handleSaveDefaultPersona: (personaId: string) => Promise<void>
}

export function useCharacterView(characterId: string): UseCharacterViewReturn {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>('')
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [replacingTemplate, setReplacingTemplate] = useState<'char' | 'user' | null>(null)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPersona, setSavingPersona] = useState(false)

  // Get the default persona for template highlighting
  const defaultPersona = personas.find(p => p.id === defaultPersonaId)
  const defaultPersonaName = defaultPersona?.name || null

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
    ? countTemplateReplacements(templateFields, character.name, defaultPersonaName)
    : { charCount: 0, userCount: 0, fieldCounts: {} }

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${characterId}`, {
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
      clientLogger.debug('Character loaded', { characterId: data.character.id, name: data.character.name })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMsg)
      clientLogger.error('Failed to fetch character', { error: errorMsg, characterId })
    } finally {
      setLoading(false)
    }
  }, [characterId])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${characterId}/tags`)
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      setTags(data.tags || [])
      clientLogger.debug('Character tags loaded', { count: data.tags?.length || 0 })
    } catch (err) {
      clientLogger.error('Failed to fetch tags:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.map((p: any) => ({ id: p.id, name: p.name })))
        clientLogger.debug('Connection profiles loaded', { count: data.length })
      }
    } catch (err) {
      clientLogger.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/personas')
      if (res.ok) {
        const data = await res.json()
        setPersonas(data.map((p: any) => ({ id: p.id, name: p.name, title: p.title })))
        clientLogger.debug('Personas loaded', { count: data.length })
      }
    } catch (err) {
      clientLogger.error('Failed to fetch personas:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchDefaultPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${characterId}/personas`)
      if (res.ok) {
        const data = await res.json()
        const defaultPersona = data.find((cp: any) => cp.isDefault)
        if (defaultPersona) {
          setDefaultPersonaId(defaultPersona.personaId)
          clientLogger.debug('Default persona loaded', { personaId: defaultPersona.personaId })
        }
      }
    } catch (err) {
      clientLogger.error('Failed to fetch default persona:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  const fetchImageProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/image-profiles')
      if (res.ok) {
        const data = await res.json()
        setImageProfiles(data)
        clientLogger.debug('Image profiles loaded', { count: data.length })
      }
    } catch (err) {
      clientLogger.error('Failed to fetch image profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  // Handler for template replacement
  const handleTemplateReplace = async (type: 'char' | 'user') => {
    if (!character) return

    const nameToReplace = type === 'char' ? character.name : defaultPersonaName
    const template = type === 'char' ? '{{char}}' : '{{user}}'

    if (!nameToReplace) return

    setReplacingTemplate(type)
    clientLogger.debug('Starting template replacement', { type, nameToReplace, template })

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

      const res = await fetch(`/api/characters/${characterId}`, {
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
      clientLogger.info('Template replacement completed', { type, fieldsUpdated: Object.keys(updates) })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to replace template')
      clientLogger.error('Template replacement failed', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setReplacingTemplate(null)
    }
  }

  const handleSaveConnectionProfile = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      const res = await fetch(`/api/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultConnectionProfileId: profileId || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to update connection profile')
      await fetchCharacter()
      showSuccessToast('Connection profile updated')
      clientLogger.info('Connection profile saved', { profileId })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update connection profile')
      clientLogger.error('Failed to save connection profile', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handleSaveDefaultPersona = async (personaId: string) => {
    setSavingPersona(true)
    try {
      // First, remove the current default if there is one
      if (defaultPersonaId) {
        await fetch(`/api/characters/${characterId}/personas?personaId=${defaultPersonaId}`, {
          method: 'DELETE',
        })
      }

      // If a new persona is selected, link it as default
      if (personaId) {
        const res = await fetch(`/api/characters/${characterId}/personas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId,
            isDefault: true,
          }),
        })
        if (!res.ok) throw new Error('Failed to link persona')
      }

      setDefaultPersonaId(personaId)
      showSuccessToast(personaId ? 'Default persona updated' : 'Default persona removed')
      clientLogger.info('Default persona saved', { personaId })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update persona')
      clientLogger.error('Failed to save default persona', { error: err instanceof Error ? err.message : String(err) })
      await fetchDefaultPersona() // Revert to server state
    } finally {
      setSavingPersona(false)
    }
  }

  return {
    loading,
    error,
    character,
    tags,
    profiles,
    personas,
    defaultPersonaId,
    imageProfiles,
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    fetchCharacter,
    fetchTags,
    fetchProfiles,
    fetchPersonas,
    fetchDefaultPersona,
    fetchImageProfiles,
    setCharacter,
    setDefaultPersonaId,
    setAvatarRefreshKey,
    setImageProfiles,
    handleTemplateReplace,
    handleSaveConnectionProfile,
    handleSaveDefaultPersona,
  }
}
