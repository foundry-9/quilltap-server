'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import MessageContent from '@/components/chat/MessageContent'
import { CharacterConversationsTab } from '@/components/character/character-conversations-tab'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { usePersonaDisplayName } from '@/hooks/usePersonaDisplayName'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TagBadge } from '@/components/tags/tag-badge'
import { TagEditor } from '@/components/tags/tag-editor'
import { EntityTabs, Tab } from '@/components/tabs'
import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { MemoryList } from '@/components/memory/memory-list'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { TemplateHighlighter, countTemplateReplacements, replaceWithTemplate } from '@/components/characters/TemplateHighlighter'

interface Tag {
  id: string
  name: string
}

interface ConnectionProfile {
  id: string
  name: string
}

interface Persona {
  id: string
  name: string
  title: string | null
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

interface Character {
  id: string
  name: string
  title?: string | null
  description?: string | null
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  tags?: string[]
}

const CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'memories',
    label: 'Memories',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
  {
    id: 'profiles',
    label: 'Associated Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'gallery',
    label: 'Photo Gallery',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'descriptions',
    label: 'Physical Descriptions',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [showChatDialog, setShowChatDialog] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [creatingChat, setCreatingChat] = useState(false)
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>('')
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPersona, setSavingPersona] = useState(false)
  const [savingImageProfile, setSavingImageProfile] = useState(false)
  const [defaultImageProfileId, setDefaultImageProfileId] = useState<string>('')
  const [replacingTemplate, setReplacingTemplate] = useState<'char' | 'user' | null>(null)
  const { style } = useAvatarDisplay()
  const { formatPersonaName } = usePersonaDisplayName()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0
  const characterTagIds = character?.tags || []

  // Get the default persona for template highlighting
  const defaultPersona = personas.find(p => p.id === defaultPersonaId)
  const defaultPersonaName = defaultPersona?.name || null

  // Count template replacement opportunities in fields that support templates
  const templateFields = {
    description: character?.description,
    personality: character?.personality,
    scenario: character?.scenario,
    firstMessage: character?.firstMessage,
    exampleDialogues: character?.exampleDialogues,
    systemPrompt: character?.systemPrompt,
  }

  const templateCounts = character
    ? countTemplateReplacements(templateFields, character.name, defaultPersonaName)
    : { charCount: 0, userCount: 0, fieldCounts: {} }

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
      if (character.systemPrompt) {
        const replaced = replaceWithTemplate(character.systemPrompt, nameToReplace, template)
        if (replaced !== character.systemPrompt) updates.systemPrompt = replaced
      }

      if (Object.keys(updates).length === 0) {
        showSuccessToast('No replacements needed')
        return
      }

      const res = await fetch(`/api/characters/${id}`, {
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

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}`, {
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
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/tags`)
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      setTags(data.tags || [])
    } catch (err) {
      clientLogger.error('Failed to fetch tags:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [id])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.map((p: any) => ({ id: p.id, name: p.name })))
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
      }
    } catch (err) {
      clientLogger.error('Failed to fetch personas:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchDefaultPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/personas`)
      if (res.ok) {
        const data = await res.json()
        const defaultPersona = data.find((cp: any) => cp.isDefault)
        if (defaultPersona) {
          setDefaultPersonaId(defaultPersona.personaId)
        }
      }
    } catch (err) {
      clientLogger.error('Failed to fetch default persona:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [id])

  const fetchImageProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/image-profiles')
      if (res.ok) {
        const data = await res.json()
        setImageProfiles(data)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch image profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    fetchCharacter()
    fetchTags()
    fetchProfiles()
    fetchPersonas()
    fetchDefaultPersona()
    fetchImageProfiles()
  }, [fetchCharacter, fetchTags, fetchProfiles, fetchPersonas, fetchDefaultPersona, fetchImageProfiles])

  useEffect(() => {
    if (searchParams.get('action') === 'chat') {
      setShowChatDialog(true)
      setOpenedFromQuery(true)

      // Set default profile when opening from query
      if (character?.defaultConnectionProfileId) {
        setSelectedProfileId(character.defaultConnectionProfileId)
      } else if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id)
      }

      // Set default persona if available
      if (defaultPersonaId) {
        setSelectedPersonaId(defaultPersonaId)
      }
    }
  }, [searchParams, character?.defaultConnectionProfileId, profiles, defaultPersonaId])

  const getAvatarSrc = () => {
    let src = null
    if (character?.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      src = character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    } else {
      src = character?.avatarUrl
    }
    // Add cache-busting parameter based on defaultImageId to force reload when avatar changes
    if (src && character?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${character.defaultImageId}`
    }
    return src
  }

  const handleStartChat = () => {
    // Use character's default connection profile if available
    if (character?.defaultConnectionProfileId) {
      setSelectedProfileId(character.defaultConnectionProfileId)
    } else if (profiles.length === 0) {
      showErrorToast('No connection profiles available. Please set up a profile first.')
      return
    } else {
      // Fall back to first profile if no default is set
      setSelectedProfileId(profiles[0].id)
    }

    // Use character's default persona if available
    if (defaultPersonaId) {
      setSelectedPersonaId(defaultPersonaId)
    } else {
      setSelectedPersonaId('')
    }

    setShowChatDialog(true)
  }

  const handleCreateChat = async () => {
    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      return
    }

    setCreatingChat(true)
    try {
      const participants: any[] = [
        {
          type: 'CHARACTER',
          characterId: id,
          connectionProfileId: selectedProfileId,
          imageProfileId: selectedImageProfileId || undefined,
        },
      ]

      if (selectedPersonaId) {
        participants.push({
          type: 'PERSONA',
          personaId: selectedPersonaId,
        })
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
          title: `Chat with ${character?.name}`,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }
      const data = await res.json()
      setShowChatDialog(false)
      router.push(`/chats/${data.chat.id}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to start chat')
    } finally {
      setCreatingChat(false)
    }
  }

  const handleSaveConnectionProfile = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultConnectionProfileId: profileId || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to update connection profile')
      await fetchCharacter()
      showSuccessToast('Connection profile updated')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update connection profile')
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handleSaveDefaultPersona = async (personaId: string) => {
    setSavingPersona(true)
    try {
      // First, remove the current default if there is one
      if (defaultPersonaId) {
        await fetch(`/api/characters/${id}/personas?personaId=${defaultPersonaId}`, {
          method: 'DELETE',
        })
      }

      // If a new persona is selected, link it as default
      if (personaId) {
        const res = await fetch(`/api/characters/${id}/personas`, {
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
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update persona')
      await fetchDefaultPersona() // Revert to server state
    } finally {
      setSavingPersona(false)
    }
  }

  const renderTabContent = (activeTab: string) => {
    switch (activeTab) {
      case 'details':
        return (
          <div className="space-y-6">
            {/* Edit Button Header with Template Replacement Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Character Name → {{char}} button */}
              {templateCounts.charCount > 0 && (
                <button
                  onClick={() => handleTemplateReplace('char')}
                  disabled={replacingTemplate !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary shadow-sm transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                  title={`Replace ${templateCounts.charCount} occurrences of "${character?.name}" with {{char}}`}
                >
                  {replacingTemplate === 'char' ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{character?.name}</span>
                  <span className="text-primary">→</span>
                  <code className="rounded bg-primary/20 px-1 text-xs text-primary">{`{{char}}`}</code>
                  <span className="text-xs text-primary/80">({templateCounts.charCount})</span>
                </button>
              )}

              {/* Persona Name → {{user}} button */}
              {defaultPersonaName && templateCounts.userCount > 0 && (
                <button
                  onClick={() => handleTemplateReplace('user')}
                  disabled={replacingTemplate !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success shadow-sm transition hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
                  title={`Replace ${templateCounts.userCount} occurrences of "${defaultPersonaName}" with {{user}}`}
                >
                  {replacingTemplate === 'user' ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-success border-r-transparent"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{defaultPersonaName}</span>
                  <span className="text-success">→</span>
                  <code className="rounded bg-success/20 px-1 text-xs text-success">{`{{user}}`}</code>
                  <span className="text-xs text-success/80">({templateCounts.userCount})</span>
                </button>
              )}

              <Link
                href={`/characters/${id}/edit`}
                className="character-edit-link flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Character
              </Link>
            </div>

            {/* Main Content with Template Highlighting */}
            <div className="space-y-6">
              {character?.description && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    Description
                    {(templateCounts.fieldCounts.description?.char > 0 || templateCounts.fieldCounts.description?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <div className="text-muted-foreground">
                    <TemplateHighlighter
                      content={character.description}
                      characterName={character.name}
                      personaName={defaultPersonaName}
                      showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                    />
                  </div>
                </div>
              )}

              {character?.personality && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    Personality
                    {(templateCounts.fieldCounts.personality?.char > 0 || templateCounts.fieldCounts.personality?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <div className="text-muted-foreground">
                    <TemplateHighlighter
                      content={character.personality}
                      characterName={character.name}
                      personaName={defaultPersonaName}
                      showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                    />
                  </div>
                </div>
              )}

              {character?.scenario && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    Scenario
                    {(templateCounts.fieldCounts.scenario?.char > 0 || templateCounts.fieldCounts.scenario?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <div className="text-muted-foreground">
                    <TemplateHighlighter
                      content={character.scenario}
                      characterName={character.name}
                      personaName={defaultPersonaName}
                      showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                    />
                  </div>
                </div>
              )}

              {character?.firstMessage && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    First Message
                    {(templateCounts.fieldCounts.firstMessage?.char > 0 || templateCounts.fieldCounts.firstMessage?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <div className="text-muted-foreground">
                    <TemplateHighlighter
                      content={character.firstMessage}
                      characterName={character.name}
                      personaName={defaultPersonaName}
                      showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                    />
                  </div>
                </div>
              )}

              {character?.exampleDialogues && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    Example Dialogues
                    {(templateCounts.fieldCounts.exampleDialogues?.char > 0 || templateCounts.fieldCounts.exampleDialogues?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <div className="text-muted-foreground">
                    <TemplateHighlighter
                      content={character.exampleDialogues}
                      characterName={character.name}
                      personaName={defaultPersonaName}
                      showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                    />
                  </div>
                </div>
              )}

              {character?.systemPrompt && (
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    System Prompt
                    {(templateCounts.fieldCounts.systemPrompt?.char > 0 || templateCounts.fieldCounts.systemPrompt?.user > 0) && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (template replacements available)
                      </span>
                    )}
                  </h2>
                  <pre className="my-2 overflow-hidden rounded-md bg-muted/80 p-4 text-sm text-foreground">
                    <code className="text-sm whitespace-pre-wrap break-words">
                      <TemplateHighlighter
                        content={character.systemPrompt}
                        characterName={character.name}
                        personaName={defaultPersonaName}
                        showHighlights={templateCounts.charCount > 0 || templateCounts.userCount > 0}
                      />
                    </code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        )

      case 'conversations':
        return (
          <CharacterConversationsTab characterId={id} characterName={character?.name || 'Character'} />
        )

      case 'memories':
        return (
          <MemoryList characterId={id} />
        )

      case 'tags':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Character Tags
                </h2>
                <p className="text-sm text-muted-foreground">
                  Tags help organize and categorize this character. They can also be used for filtering and searching.
                </p>
              </div>
            </div>
            <div className="character-section-card rounded-lg border border-border bg-card p-6">
              <TagEditor entityType="character" entityId={id} />
            </div>
          </div>
        )

      case 'profiles':
        return (
          <div className="space-y-8">
            {/* Connection Profile Section */}
            <div className="character-section-card rounded-lg border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Default Connection Profile
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                The default AI provider and model to use when chatting with this character. Can be overridden per chat.
              </p>
              <div className="flex items-center gap-3">
                <select
                  value={character?.defaultConnectionProfileId || ''}
                  onChange={(e) => handleSaveConnectionProfile(e.target.value)}
                  disabled={savingConnectionProfile}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">No default profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                {savingConnectionProfile && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
                    Saving...
                  </div>
                )}
              </div>
              {profiles.length === 0 && (
                <p className="mt-2 text-sm text-warning">
                  No connection profiles available. <Link href="/settings" className="underline hover:no-underline">Create one in Settings</Link>.
                </p>
              )}
            </div>

            {/* Persona Section */}
            <div className="character-section-card rounded-lg border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Default Persona
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                The default persona to use when chatting with this character. Represents &quot;you&quot; in the conversation.
              </p>
              <div className="flex items-center gap-3">
                <select
                  value={defaultPersonaId}
                  onChange={(e) => handleSaveDefaultPersona(e.target.value)}
                  disabled={savingPersona}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">No default persona</option>
                  {personas.map((persona) => (
                    <option key={persona.id} value={persona.id}>
                      {formatPersonaName(persona)}
                    </option>
                  ))}
                </select>
                {savingPersona && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
                    Saving...
                  </div>
                )}
              </div>
              {personas.length === 0 && (
                <p className="mt-2 text-sm text-warning">
                  No personas available. <Link href="/personas/new" className="underline hover:no-underline">Create one</Link>.
                </p>
              )}
            </div>

            {/* Image Profile Section */}
            <div className="character-section-card rounded-lg border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Image Generation Profile
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                The default image generation profile for creating images during chats. Optional.
              </p>
              <ImageProfilePicker
                value={defaultImageProfileId || null}
                onChange={(profileId) => setDefaultImageProfileId(profileId || '')}
                characterId={id}
              />
            </div>
          </div>
        )

      case 'gallery':
        return (
          <EmbeddedPhotoGallery
            entityType="character"
            entityId={id}
            entityName={character?.name || 'Character'}
            currentAvatarId={character?.defaultImageId}
            onAvatarChange={(imageId) => {
              setCharacter(prev => prev ? { ...prev, defaultImageId: imageId ?? undefined } : null)
              fetchCharacter()
            }}
            onRefresh={fetchCharacter}
          />
        )

      case 'descriptions':
        return (
          <PhysicalDescriptionList
            entityType="character"
            entityId={id}
          />
        )

      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-lg text-destructive">Error: {error}</p>
          <Link
            href="/characters"
            className="font-medium text-primary hover:text-primary/80"
          >
            ← Back to Characters
          </Link>
        </div>
      </div>
    )
  }

  if (quickHideActive && character && shouldHideByIds(characterTagIds)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return (
    <div className="character-view min-h-screen px-4 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/characters"
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back to Characters
        </Link>
        <div className="mb-8 flex flex-wrap items-start justify-between gap-6 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
          <div className="flex flex-grow items-center gap-4">
            <div className="relative">
              {getAvatarSrc() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                  src={getAvatarSrc()!}
                  alt={character?.name || ''}
                  className={getAvatarClasses(style, 'lg').imageClass}
                />
              ) : (
                <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                  <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                    {character?.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-semibold">
                {character?.name || 'Loading...'}
              </h1>
              {character?.title && (
                <p className="text-sm text-muted-foreground">{character.title}</p>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={handleStartChat}
              className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow hover:bg-success/90"
            >
              Start Chat
            </button>
          </div>
        </div>

        {/* Tabbed Content */}
        <EntityTabs tabs={CHARACTER_TABS} defaultTab="details">
          {renderTabContent}
        </EntityTabs>
      </div>

      {/* Chat Creation Dialog */}
      {showChatDialog && (
        <div className="character-chat-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold">
              Start Chat with {character?.name}
            </h3>

            <div className="space-y-4">
              {/* Connection Profile Selection */}
              <div>
                <label htmlFor="profile" className="mb-2 block text-sm font-medium text-foreground">
                  Connection Profile *
                </label>
                <select
                  id="profile"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Persona Selection */}
              {personas.length > 0 && (
                <div>
                  <label htmlFor="persona" className="mb-2 block text-sm font-medium text-foreground">
                    Persona (Optional)
                  </label>
                  <select
                    id="persona"
                    value={selectedPersonaId}
                    onChange={(e) => setSelectedPersonaId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Use character defaults</option>
                    {personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {formatPersonaName(persona)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Image Profile Selection */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Image Generation Profile (Optional)
                </label>
                <ImageProfilePicker
                  value={selectedImageProfileId}
                  onChange={setSelectedImageProfileId}
                  characterId={id}
                  personaId={selectedPersonaId}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (openedFromQuery) {
                    router.push('/characters')
                  } else {
                    setShowChatDialog(false)
                  }
                }}
                className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChat}
                disabled={!selectedProfileId || creatingChat}
                className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow transition hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingChat ? 'Creating...' : 'Start Chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
