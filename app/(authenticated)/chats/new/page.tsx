'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
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
  imageProfileId?: string | null
  selectedSystemPromptId?: string | null
  controlledBy: 'llm' | 'user'
}

// Special value for "Play As (User)" option in connection profile dropdown
const USER_CONTROLLED_PROFILE = '__USER_CONTROLLED__'

interface Project {
  id: string
  name: string
  color?: string | null
}

export default function NewChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectIdParam = searchParams.get('projectId')
  const { style } = useAvatarDisplay()
  const { refreshChats, refreshProjects } = useSidebarData()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [characters, setCharacters] = useState<Character[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<Character[]>([])
  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [selectedUserCharacterId, setSelectedUserCharacterId] = useState<string>('')
  const [scenario, setScenario] = useState('')
  const [timestampConfig, setTimestampConfig] = useState<TimestampConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    clientLogger.debug('[NewChat] Component mounted', { projectIdParam })

    const fetchData = async () => {
      clientLogger.debug('[NewChat] Fetching data')
      try {
        const fetchPromises: Promise<Response>[] = [
          fetch('/api/characters'),
          fetch('/api/profiles'),
          fetch('/api/image-profiles'),
        ]

        // Fetch project info if projectId is provided
        if (projectIdParam) {
          fetchPromises.push(fetch(`/api/projects/${projectIdParam}`))
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
          clientLogger.debug('[NewChat] Loaded characters', {
            total: allCharacters.length,
            llmControlled: llmControlled.length,
            userControlled: userControlled.length,
          })
        }

        if (profilesRes.ok) {
          const data = await profilesRes.json()
          setProfiles(data || [])
          clientLogger.debug('[NewChat] Loaded profiles', { count: data?.length || 0 })
        }

        if (imageProfilesRes.ok) {
          const data = await imageProfilesRes.json()
          setImageProfiles(data || [])
          clientLogger.debug('[NewChat] Loaded image profiles', { count: data?.length || 0 })
        }

        // Handle project response
        if (projectRes && projectRes.ok) {
          const data = await projectRes.json()
          setProject(data.project)
          clientLogger.debug('[NewChat] Loaded project', { projectId: data.project?.id, name: data.project?.name })
        } else if (projectRes && !projectRes.ok) {
          clientLogger.warn('[NewChat] Failed to load project', { projectId: projectIdParam, status: projectRes.status })
        }
      } catch (err) {
        clientLogger.error('[NewChat] Error fetching data', {
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

  const handleSelectCharacter = (character: Character) => {
    if (selectedCharacterIds.has(character.id)) {
      clientLogger.debug('[NewChat] Deselecting character', { characterId: character.id })
      setSelectedCharacters((prev) =>
        prev.filter((sc) => sc.character.id !== character.id)
      )
    } else {
      const connectionProfileId =
        character.defaultConnectionProfileId || profiles[0]?.id || ''
      // Find default or first system prompt
      const defaultPrompt = character.systemPrompts?.find(p => p.isDefault) || character.systemPrompts?.[0]
      const selectedSystemPromptId = defaultPrompt?.id || null
      clientLogger.debug('[NewChat] Selecting character', {
        characterId: character.id,
        connectionProfileId,
        selectedSystemPromptId,
      })
      setSelectedCharacters((prev) => [
        ...prev,
        { character, connectionProfileId, imageProfileId: null, selectedSystemPromptId, controlledBy: 'llm' },
      ])
    }
  }

  const handleProfileChange = (characterId: string, profileId: string) => {
    const isUserControlled = profileId === USER_CONTROLLED_PROFILE
    clientLogger.debug('[NewChat] Changing connection profile', { characterId, profileId, isUserControlled })
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

  const handleImageProfileChange = (characterId: string, profileId: string | null) => {
    clientLogger.debug('[NewChat] Changing image profile', { characterId, profileId })
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId ? { ...sc, imageProfileId: profileId } : sc
      )
    )
  }

  const handleSystemPromptChange = (characterId: string, promptId: string | null) => {
    clientLogger.debug('[NewChat] Changing system prompt', { characterId, promptId })
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  const handleRemoveCharacter = (characterId: string) => {
    clientLogger.debug('[NewChat] Removing character', { characterId })
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
    clientLogger.debug('[NewChat] Creating chat', {
      characterCount: selectedCharacters.length,
      hasUserCharacter: !!selectedUserCharacterId,
      hasScenario: !!scenario,
      hasTimestampConfig: !!timestampConfig,
      projectId: project?.id || null,
    })

    try {
      const participants: Array<{
        type: 'CHARACTER'
        characterId: string
        connectionProfileId?: string
        imageProfileId?: string
        selectedSystemPromptId?: string
        controlledBy?: 'llm' | 'user'
      }> = selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.controlledBy === 'llm' ? sc.connectionProfileId : undefined,
        imageProfileId: sc.imageProfileId || undefined,
        selectedSystemPromptId: sc.selectedSystemPromptId || undefined,
        controlledBy: sc.controlledBy,
      }))

      // Add user-controlled character as a participant (replaces persona)
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

      if (scenario) {
        requestBody.scenario = scenario
      }

      if (timestampConfig) {
        requestBody.timestampConfig = timestampConfig
      }

      if (project?.id) {
        requestBody.projectId = project.id
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      clientLogger.info('[NewChat] Chat created successfully', { chatId: data.chat.id, projectId: project?.id })
      showSuccessToast('Chat created!')

      // Refresh sidebar to show new chat
      refreshChats()
      if (project) {
        refreshProjects()
      }

      router.push('/chats/' + data.chat.id)
    } catch (err) {
      clientLogger.error('[NewChat] Failed to create chat', {
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
        <Link href={project ? `/projects/${project.id}` : '/chats'} className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80">
          ← Back to {project ? project.name : 'Chats'}
        </Link>

        <h1 className="mb-6 text-3xl font-semibold">New Chat</h1>

        {project && (
          <div className="mb-6 rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: project.color || 'var(--muted)' }}
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div className="mb-6 rounded-lg border border-warning/50 bg-warning/10 p-4 text-warning">
            <p className="font-medium">No connection profiles available</p>
            <p className="mt-1 text-sm">
              You need to create a connection profile before starting a chat.{' '}
              <Link href="/settings" className="underline hover:no-underline">Go to Settings</Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-border bg-card p-6 lg:max-h-[calc(100vh-12rem)]">
            <h2 className="mb-4 text-lg font-semibold">Select Characters</h2>
            <div className="mb-4 flex-shrink-0">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search characters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                      className={'w-full flex items-center gap-3 rounded-lg border p-3 transition ' + (isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50')}
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
                      <div className={'flex h-6 w-6 items-center justify-center rounded-full border-2 ' + (isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground')}>
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
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">Selected Characters ({selectedCharacters.length})</h2>
              {selectedCharacters.length === 0 ? (
                <div className="py-8 text-center qt-text-small">Click on characters to add them to the chat</div>
              ) : (
                <div className="space-y-4">
                  {selectedCharacters.map((sc, index) => {
                    const avatarSrc = getAvatarSrc(sc.character)
                    return (
                      <div key={sc.character.id} className="rounded-lg border border-border bg-muted/30 p-4">
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
                              {index === 0 && <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">Speaks First</span>}
                            </div>
                            {sc.character.title && <div className="qt-text-small">{sc.character.title}</div>}
                            <div className="mt-3">
                              <label className="mb-1 block text-xs font-medium qt-text-xs">Connection Profile</label>
                              <select
                                value={sc.controlledBy === 'user' ? USER_CONTROLLED_PROFILE : sc.connectionProfileId}
                                onChange={(e) => handleProfileChange(sc.character.id, e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">Select profile...</option>
                                <option value={USER_CONTROLLED_PROFILE}>Play As (User)</option>
                                {profiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.name}{profile.modelName ? ' (' + profile.modelName + ')' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {imageProfiles.length > 0 && (
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium qt-text-xs">Image Profile (Optional)</label>
                                <select
                                  value={sc.imageProfileId || ''}
                                  onChange={(e) => handleImageProfileChange(sc.character.id, e.target.value || null)}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                >
                                  <option value="">No image profile</option>
                                  {imageProfiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.name} ({profile.provider})</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {sc.character.systemPrompts && sc.character.systemPrompts.length > 0 && (
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium qt-text-xs">System Prompt</label>
                                <select
                                  value={sc.selectedSystemPromptId || ''}
                                  onChange={(e) => handleSystemPromptChange(sc.character.id, e.target.value || null)}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                          <button onClick={() => handleRemoveCharacter(sc.character.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove character">
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
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="mb-4 text-lg font-semibold">Play As (Optional)</h2>
                <p className="mb-3 qt-text-small">Select a character to represent you in the conversation.</p>
                <select
                  value={selectedUserCharacterId}
                  onChange={(e) => setSelectedUserCharacterId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">Scenario (Optional)</h2>
              <p className="mb-3 qt-text-small">Describe the starting scenario for this chat.</p>
              <textarea
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                placeholder="e.g., You are in a cozy coffee shop on a rainy afternoon..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                rows={4}
              />
            </div>

            <TimestampConfigCard
              value={timestampConfig}
              onChange={setTimestampConfig}
            />

            <div className="flex justify-end gap-3">
              <Link href="/chats" className="rounded-lg border border-border bg-card px-6 py-2 font-medium qt-text-small transition hover:bg-muted">Cancel</Link>
              <button
                onClick={handleCreateChat}
                disabled={
                  creating ||
                  selectedCharacters.length === 0 ||
                  (profiles.length === 0 && selectedCharacters.some((sc) => sc.controlledBy === 'llm')) ||
                  selectedCharacters.some((sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId) ||
                  !selectedCharacters.some((sc) => sc.controlledBy === 'llm')
                }
                className="rounded-lg bg-success px-6 py-2 font-semibold text-success-foreground transition hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
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
