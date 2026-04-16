'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { OutfitSelector } from '@/components/wardrobe'
import type { OutfitSelection } from '@/components/wardrobe'
import type { TimestampConfig } from '@/lib/schemas/types'

interface Character {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  defaultConnectionProfileId?: string | null
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  _count?: {
    chats: number
  }
  systemPrompts?: Array<{
    id: string
    name: string
    isDefault: boolean
  }>
  scenarios?: Array<{
    id: string
    title: string
    content: string
  }>
  defaultPartnerId?: string | null
  defaultTimestampConfig?: TimestampConfig | null
  defaultScenarioId?: string | null
  defaultSystemPromptId?: string | null
  defaultImageProfileId?: string | null
}

interface ConnectionProfile {
  id: string
  name: string
  provider?: string
  modelName?: string
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface SelectedCharacter {
  character: Character
  connectionProfileId: string
  selectedSystemPromptId?: string | null
  controlledBy: 'llm' | 'user'
}

// Special value for "Play As (User)" option in connection profile dropdown
const USER_CONTROLLED_PROFILE = '__USER_CONTROLLED__'
// Special value for custom scenario text in the scenario dropdown
const CUSTOM_SCENARIO_VALUE = '__custom__'

interface Project {
  id: string
  name: string
  color?: string | null
  defaultAvatarGenerationEnabled?: boolean | null
  defaultImageProfileId?: string | null
}

export default function NewChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectIdParam = searchParams.get('projectId')
  const { style } = useAvatarDisplay()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const prevCharacterIdsRef = useRef<string>('')

  const [characters, setCharacters] = useState<Character[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<Character[]>([])
  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [selectedUserCharacterId, setSelectedUserCharacterId] = useState<string>('')
  const [chatImageProfileId, setChatImageProfileId] = useState<string>('')
  const [scenario, setScenario] = useState('')
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [timestampConfig, setTimestampConfig] = useState<TimestampConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [project, setProject] = useState<Project | null>(null)
  const [avatarGenerationEnabled, setAvatarGenerationEnabled] = useState(false)
  const [outfitSelections, setOutfitSelections] = useState<OutfitSelection[]>([])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const fetchPromises: Promise<Response>[] = [
          fetch('/api/v1/characters'),
          fetch('/api/v1/connection-profiles'),
          fetch('/api/v1/image-profiles'),
        ]

        // Fetch project info if projectId is provided
        if (projectIdParam) {
          fetchPromises.push(fetch(`/api/v1/projects/${projectIdParam}`))
        }

        const responses = await Promise.all(fetchPromises)
        const [charsRes, profilesRes, imageProfilesRes, projectRes] = responses

        if (charsRes.ok) {
          const data = await charsRes.json()
          const allCharacters: Character[] = data.characters || []
          // Separate LLM-controlled and user-controlled characters
          const llmControlled = allCharacters.filter(c => c.controlledBy !== 'user')
          const userControlled = allCharacters.filter(c => c.controlledBy === 'user')
          setCharacters(llmControlled)
          setUserControlledCharacters(userControlled)
        }

        if (profilesRes.ok) {
          const data = await profilesRes.json()
          setProfiles(data.profiles || [])
        }

        if (imageProfilesRes.ok) {
          const data = await imageProfilesRes.json()
          setImageProfiles(data || [])
        }

        // Handle project response
        if (projectRes && projectRes.ok) {
          const data = await projectRes.json()
          const projectData = data.project || data
          setProject(projectData)
          if (projectData.defaultAvatarGenerationEnabled) {
            setAvatarGenerationEnabled(true)
          }
          // Pre-select project's default image profile if set
          if (projectData.defaultImageProfileId) {
            setChatImageProfileId(projectData.defaultImageProfileId)
          }
        } else if (projectRes && !projectRes.ok) {
          console.warn('[NewChat] Failed to load project', { projectId: projectIdParam, status: projectRes.status })
        }
      } catch (err) {
        console.error('[NewChat] Error fetching data', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [projectIdParam])

  useEffect(() => {
    if (!loading && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [loading])

  const filteredCharacters = useMemo(() => {
    let result = characters

    // Apply search filter if present
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.title?.toLowerCase().includes(query) ?? false)
      )
    }

    // Sort: favorites first, then user-controlled, then by chat count (desc), then by name, then by title
    return [...result].sort((a, b) => {
      // 1. Favorites first
      const aFav = a.isFavorite ? 1 : 0
      const bFav = b.isFavorite ? 1 : 0
      if (bFav !== aFav) return bFav - aFav

      // 2. User-controlled (Play As) characters next
      const aUser = a.controlledBy === 'user' ? 1 : 0
      const bUser = b.controlledBy === 'user' ? 1 : 0
      if (bUser !== aUser) return bUser - aUser

      // 3. By chat participation count (descending)
      const aChatCount = a._count?.chats ?? 0
      const bChatCount = b._count?.chats ?? 0
      if (bChatCount !== aChatCount) return bChatCount - aChatCount

      // 4. By name (ascending, case-insensitive)
      const nameCompare = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      if (nameCompare !== 0) return nameCompare

      // 5. By title (ascending, case-insensitive, nulls last)
      const aTitle = a.title?.toLowerCase() ?? ''
      const bTitle = b.title?.toLowerCase() ?? ''
      return aTitle.localeCompare(bTitle)
    })
  }, [characters, searchQuery])

  const selectedCharacterIds = useMemo(
    () => new Set(selectedCharacters.map((sc) => sc.character.id)),
    [selectedCharacters]
  )

  // Scenario selection for single-character mode
  const singleCharacterScenarios = useMemo(() => {
    if (selectedCharacters.length !== 1) return null
    const scenarios = selectedCharacters[0].character.scenarios
    return scenarios && scenarios.length > 0 ? scenarios : null
  }, [selectedCharacters])

  const selectedPreset = scenarioId
    ? singleCharacterScenarios?.find((s) => s.id === scenarioId)
    : null

  const showCustomTextarea = !singleCharacterScenarios || scenarioId === null

  // When exactly one LLM character is selected, propagate their defaults
  // Only run when the actual character IDs change, not on profile/prompt changes
  useEffect(() => {
    const llmCharacters = selectedCharacters.filter(sc => sc.controlledBy === 'llm')
    const currentIds = llmCharacters.map(sc => sc.character.id).sort().join(',')
    if (currentIds === prevCharacterIdsRef.current) return
    prevCharacterIdsRef.current = currentIds

    if (llmCharacters.length === 1) {
      const char = llmCharacters[0].character
      // Pre-select default "Play As" character if set
      if (char.defaultPartnerId) {
        setSelectedUserCharacterId(char.defaultPartnerId)
      }
      if (char.defaultTimestampConfig) {
        setTimestampConfig(char.defaultTimestampConfig)
      }
      // Pre-select default scenario if set
      if (char.defaultScenarioId) {
        setScenarioId(char.defaultScenarioId)
      }
      // Pre-select default image profile if set (project default takes priority)
      if (char.defaultImageProfileId && !project?.defaultImageProfileId) {
        setChatImageProfileId(char.defaultImageProfileId)
      }
    }
  }, [selectedCharacters, project?.defaultImageProfileId])

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      setScenarioId(null)
    } else {
      setScenarioId(value)
      // Clear custom text when switching to a preset
      setScenario('')
    }
  }

  const handleSelectCharacter = (character: Character) => {
    // Reset scenario selection when characters change
    setScenarioId(null)
    if (selectedCharacterIds.has(character.id)) {
      setSelectedCharacters((prev) =>
        prev.filter((sc) => sc.character.id !== character.id)
      )
    } else {
      const connectionProfileId =
        character.defaultConnectionProfileId || profiles[0]?.id || ''
      // Use defaultSystemPromptId if set, otherwise find default or first system prompt
      const defaultPrompt = character.defaultSystemPromptId
        ? character.systemPrompts?.find(p => p.id === character.defaultSystemPromptId)
        : (character.systemPrompts?.find(p => p.isDefault) || character.systemPrompts?.[0])
      const selectedSystemPromptId = defaultPrompt?.id || null
      setSelectedCharacters((prev) => [
        ...prev,
        { character, connectionProfileId, selectedSystemPromptId, controlledBy: 'llm' },
      ])
    }
  }

  const handleProfileChange = (characterId: string, profileId: string) => {
    const isUserControlled = profileId === USER_CONTROLLED_PROFILE
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId
          ? {
              ...sc,
              connectionProfileId: isUserControlled ? '' : profileId,
              controlledBy: isUserControlled ? 'user' : 'llm',
            }
          : sc
      )
    )
  }

  const handleSystemPromptChange = (characterId: string, promptId: string | null) => {
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  const handleRemoveCharacter = (characterId: string) => {
    setScenarioId(null)
    setSelectedCharacters((prev) =>
      prev.filter((sc) => sc.character.id !== characterId)
    )
  }

  const generateTitle = (): string => {
    if (selectedCharacters.length === 0) return 'New Chat'
    if (selectedCharacters.length === 1) {
      return 'Chat with ' + selectedCharacters[0].character.name
    }
    if (selectedCharacters.length === 2) {
      return 'Chat with ' + selectedCharacters[0].character.name + ' and ' + selectedCharacters[1].character.name
    }
    if (selectedCharacters.length === 3) {
      return 'Chat with ' + selectedCharacters[0].character.name + ', ' + selectedCharacters[1].character.name + ', and ' + selectedCharacters[2].character.name
    }
    return 'Group Chat (' + selectedCharacters.length + ' characters)'
  }

  const handleCreateChat = async () => {
    if (selectedCharacters.length === 0) {
      showErrorToast('Please select at least one character')
      return
    }

    // Only LLM-controlled characters need a connection profile
    const llmCharsWithoutProfile = selectedCharacters.filter((sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId)
    if (llmCharsWithoutProfile.length > 0) {
      showErrorToast('Please select a connection profile for: ' + llmCharsWithoutProfile.map((sc) => sc.character.name).join(', '))
      return
    }

    // Ensure at least one LLM-controlled character exists
    const hasLlmControlled = selectedCharacters.some((sc) => sc.controlledBy === 'llm')
    if (!hasLlmControlled) {
      showErrorToast('At least one character must be LLM-controlled')
      return
    }

    setCreating(true)

    try {
      const participants: Array<{
        type: 'CHARACTER'
        characterId: string
        connectionProfileId?: string
        selectedSystemPromptId?: string
        controlledBy?: 'llm' | 'user'
      }> = selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.controlledBy === 'llm' ? sc.connectionProfileId : undefined,
        selectedSystemPromptId: sc.selectedSystemPromptId || undefined,
        controlledBy: sc.controlledBy,
      }))

      // Add user-controlled character as a participant
      if (selectedUserCharacterId) {
        participants.push({
          type: 'CHARACTER' as const,
          characterId: selectedUserCharacterId,
          controlledBy: 'user' as const,
        })
      }

      const requestBody: Record<string, unknown> = {
        title: generateTitle(),
        participants,
      }

      // Chat-level image profile (shared by all participants)
      if (chatImageProfileId) {
        requestBody.imageProfileId = chatImageProfileId
      }

      if (scenario) {
        requestBody.scenario = scenario
      } else if (scenarioId) {
        requestBody.scenarioId = scenarioId
      }

      if (timestampConfig) {
        requestBody.timestampConfig = timestampConfig
      }

      if (project?.id) {
        requestBody.projectId = project.id
      }

      if (avatarGenerationEnabled) {
        requestBody.avatarGenerationEnabled = true
      }

      if (outfitSelections.length > 0) {
        requestBody.outfitSelections = outfitSelections
      }

      const res = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      showSuccessToast('Chat created!')

      router.push('/salon/' + data.chat.id)
    } catch (err) {
      console.error('[NewChat] Failed to create chat', {
        error: err instanceof Error ? err.message : String(err),
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to create chat')
    } finally {
      setCreating(false)
    }
  }

  const getAvatarSrc = (character: Character): string | null => {
    if (character.defaultImage) {
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : '/' + filepath)
    }
    return character.avatarUrl || null
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="qt-page-container min-h-screen text-foreground">
      <div>
        <Link href={project ? `/projects/${project.id}` : '/salon'} className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80">
          ← Back to {project ? project.name : 'Chats'}
        </Link>

        <h1 className="mb-6 text-3xl font-semibold">New Chat</h1>

        {project && (
          <div className="mb-6 rounded-lg border qt-border-default qt-bg-card/50 p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: project.color || 'var(--muted)' }}
              >
                <svg className="w-4 h-4 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm qt-text-primary">Creating chat in project</p>
                <p className="font-medium text-foreground">{project.name}</p>
              </div>
            </div>
          </div>
        )}

        {profiles.length === 0 && (
          <div className="mb-6 rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-4 qt-text-warning">
            <p className="font-medium">No connection profiles available</p>
            <p className="mt-1 text-sm">
              You need to create a connection profile before starting a chat.{' '}
              <Link href="/settings?tab=providers" className="underline hover:no-underline">Go to AI Providers</Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col rounded-xl border qt-border-default qt-bg-card p-6 lg:max-h-[calc(100vh-12rem)]">
            <h2 className="mb-4 text-lg font-semibold">Select Characters</h2>
            <div className="mb-4 flex-shrink-0">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search characters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border qt-border-default bg-background px-4 py-2 text-foreground placeholder:qt-text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {filteredCharacters.length === 0 ? (
                <div className="py-8 text-center qt-text-small">
                  {searchQuery ? 'No characters match your search' : 'No characters available'}
                </div>
              ) : (
                filteredCharacters.map((character) => {
                  const isSelected = selectedCharacterIds.has(character.id)
                  const avatarSrc = getAvatarSrc(character)
                  return (
                    <button
                      key={character.id}
                      onClick={() => handleSelectCharacter(character)}
                      className={'w-full flex items-center gap-3 rounded-lg border p-3 transition ' + (isSelected ? 'qt-border-primary qt-bg-primary/10' : 'qt-border-default qt-bg-card hover:qt-border-primary/50 hover:qt-bg-muted/50')}
                    >
                      {avatarSrc ? (
                         
                        <img src={avatarSrc} alt={character.name} className={getAvatarClasses(style, 'sm').imageClass} />
                      ) : (
                        <div className={getAvatarClasses(style, 'sm').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                          <span className={getAvatarClasses(style, 'sm').fallbackClass}>{character.name.charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 text-left">
                        <div className="qt-text-primary">{character.name}</div>
                        {character.title && <div className="qt-text-small">{character.title}</div>}
                      </div>
                      <div className={'flex h-6 w-6 items-center justify-center rounded-full border-2 ' + (isSelected ? 'qt-border-primary bg-primary text-primary-foreground' : 'border-muted-foreground')}>
                        {isSelected && (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border qt-border-default qt-bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">Selected Characters ({selectedCharacters.length})</h2>
              {selectedCharacters.length === 0 ? (
                <div className="py-8 text-center qt-text-small">Click on characters to add them to the chat</div>
              ) : (
                <div className="space-y-4">
                  {selectedCharacters.map((sc, index) => {
                    const avatarSrc = getAvatarSrc(sc.character)
                    return (
                      <div key={sc.character.id} className="rounded-lg border qt-border-default qt-bg-muted/30 p-4">
                        <div className="flex items-start gap-3">
                          {avatarSrc ? (
                             
                            <img src={avatarSrc} alt={sc.character.name} className={getAvatarClasses(style, 'sm').imageClass} />
                          ) : (
                            <div className={getAvatarClasses(style, 'sm').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                              <span className={getAvatarClasses(style, 'sm').fallbackClass}>{sc.character.name.charAt(0).toUpperCase()}</span>
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="qt-text-primary">{sc.character.name}</span>
                              {index === 0 && <span className="rounded qt-bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">Speaks First</span>}
                            </div>
                            {sc.character.title && <div className="qt-text-small">{sc.character.title}</div>}
                            <div className="mt-3">
                              <label className="mb-1 block text-xs font-medium qt-text-xs">Connection Profile</label>
                              <select
                                value={sc.controlledBy === 'user' ? USER_CONTROLLED_PROFILE : sc.connectionProfileId}
                                onChange={(e) => handleProfileChange(sc.character.id, e.target.value)}
                                className="w-full rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">Select profile...</option>
                                <option value={USER_CONTROLLED_PROFILE}>Play As (User)</option>
                                {profiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.name}{profile.modelName ? ' (' + profile.modelName + ')' : ''}
                                  </option>
                                ))}
                              </select>
                              {sc.connectionProfileId && sc.controlledBy !== 'user' && (() => {
                                const selectedProfile = profiles.find(p => p.id === sc.connectionProfileId)
                                return selectedProfile?.provider ? (
                                  <div className="mt-1">
                                    <ProviderModelBadge provider={selectedProfile.provider} modelName={selectedProfile.modelName} size="sm" />
                                  </div>
                                ) : null
                              })()}
                            </div>
                            {sc.character.systemPrompts && sc.character.systemPrompts.length > 0 && (
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium qt-text-xs">System Prompt</label>
                                <select
                                  value={sc.selectedSystemPromptId || ''}
                                  onChange={(e) => handleSystemPromptChange(sc.character.id, e.target.value || null)}
                                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                >
                                  <option value="">Use Default</option>
                                  {sc.character.systemPrompts.map((prompt) => (
                                    <option key={prompt.id} value={prompt.id}>
                                      {prompt.name}{prompt.isDefault ? ' (Default)' : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          <button onClick={() => handleRemoveCharacter(sc.character.id)} className="rounded p-1 qt-text-secondary hover:qt-bg-destructive/10 hover:qt-text-destructive" title="Remove character">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {userControlledCharacters.length > 0 && (
              <div className="rounded-xl border qt-border-default qt-bg-card p-6">
                <h2 className="mb-4 text-lg font-semibold">Play As (Optional)</h2>
                <p className="mb-3 qt-text-small">Select a character to represent you in the conversation.</p>
                <select
                  value={selectedUserCharacterId}
                  onChange={(e) => setSelectedUserCharacterId(e.target.value)}
                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No character selected</option>
                  {userControlledCharacters.map((char) => (
                    <option key={char.id} value={char.id}>
                      {char.name}{char.title ? ` (${char.title})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-xl border qt-border-default qt-bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">Scenario (Optional)</h2>
              <p className="mb-3 qt-text-small">Describe the starting scenario for this chat.</p>

              {singleCharacterScenarios && (
                <select
                  value={scenarioId ?? CUSTOM_SCENARIO_VALUE}
                  onChange={(e) => handleScenarioSelectChange(e.target.value)}
                  className="mb-3 w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
                  {singleCharacterScenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              )}

              {selectedPreset && (
                <div className="rounded-lg border qt-border-default qt-bg-muted/40 px-3 py-2 text-sm qt-text-secondary">
                  {selectedPreset.content}
                </div>
              )}

              {showCustomTextarea && (
                <textarea
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder="e.g., You are in a cozy coffee shop on a rainy afternoon..."
                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-foreground placeholder:qt-text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={4}
                />
              )}
            </div>

            {imageProfiles.length > 0 && (
              <div className="rounded-xl border qt-border-default qt-bg-card p-6">
                <h2 className="mb-4 text-lg font-semibold">Image Generation (Optional)</h2>
                <p className="mb-3 qt-text-small">Select an image profile to enable image generation in this chat.</p>
                <select
                  value={chatImageProfileId}
                  onChange={(e) => setChatImageProfileId(e.target.value)}
                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No image generation</option>
                  {imageProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.provider})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedCharacters.filter(sc => sc.controlledBy === 'llm').length > 0 && (
              <div className="rounded-xl border qt-border-default qt-bg-card p-6">
                <OutfitSelector
                  characters={(() => {
                    const list = selectedCharacters
                      .filter(sc => sc.controlledBy === 'llm')
                      .map(sc => ({ id: sc.character.id, name: sc.character.name }))
                    const userChar = userControlledCharacters.find(c => c.id === selectedUserCharacterId)
                    if (userChar) list.push({ id: userChar.id, name: userChar.name })
                    return list
                  })()}
                  onSelectionsChange={setOutfitSelections}
                  disabled={creating}
                />
                <div className="mt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={avatarGenerationEnabled}
                      onChange={(e) => setAvatarGenerationEnabled(e.target.checked)}
                      className="qt-checkbox"
                      disabled={creating}
                    />
                    <span className="qt-text-small">Auto-generate character avatars</span>
                  </label>
                  <p className="qt-text-xs qt-text-muted mt-1">
                    Generate new portraits when outfits change (uses image API)
                  </p>
                </div>
              </div>
            )}

            <TimestampConfigCard
              value={timestampConfig}
              onChange={setTimestampConfig}
            />

            <div className="flex justify-end gap-3">
              <Link href="/salon" className="rounded-lg border qt-border-default qt-bg-card px-6 py-2 font-medium qt-text-small transition hover:qt-bg-muted">Cancel</Link>
              <button
                onClick={handleCreateChat}
                disabled={
                  creating ||
                  selectedCharacters.length === 0 ||
                  (profiles.length === 0 && selectedCharacters.some((sc) => sc.controlledBy === 'llm')) ||
                  selectedCharacters.some((sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId) ||
                  !selectedCharacters.some((sc) => sc.controlledBy === 'llm')
                }
                className="rounded-lg bg-success px-6 py-2 font-semibold qt-text-success-foreground transition hover:qt-bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Chat'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
