'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'

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

interface Persona {
  id: string
  name: string
  title?: string | null
}

interface SelectedCharacter {
  character: Character
  connectionProfileId: string
  imageProfileId?: string | null
}

export default function NewChatPage() {
  const router = useRouter()
  const { style } = useAvatarDisplay()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [characters, setCharacters] = useState<Character[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    clientLogger.debug('[NewChat] Component mounted')

    const fetchData = async () => {
      clientLogger.debug('[NewChat] Fetching data')
      try {
        const [charsRes, profilesRes, imageProfilesRes, personasRes] = await Promise.all([
          fetch('/api/characters'),
          fetch('/api/profiles'),
          fetch('/api/image-profiles'),
          fetch('/api/personas'),
        ])

        if (charsRes.ok) {
          const data = await charsRes.json()
          setCharacters(data.characters || [])
          clientLogger.debug('[NewChat] Loaded characters', { count: data.characters?.length || 0 })
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

        if (personasRes.ok) {
          const data = await personasRes.json()
          setPersonas(data || [])
          clientLogger.debug('[NewChat] Loaded personas', { count: data?.length || 0 })
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
  }, [])

  useEffect(() => {
    if (!loading && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [loading])

  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters
    const query = searchQuery.toLowerCase()
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.title?.toLowerCase().includes(query) ?? false)
    )
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
      clientLogger.debug('[NewChat] Selecting character', {
        characterId: character.id,
        connectionProfileId,
      })
      setSelectedCharacters((prev) => [
        ...prev,
        { character, connectionProfileId, imageProfileId: null },
      ])
    }
  }

  const handleProfileChange = (characterId: string, profileId: string) => {
    clientLogger.debug('[NewChat] Changing connection profile', { characterId, profileId })
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId ? { ...sc, connectionProfileId: profileId } : sc
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

    const charsWithoutProfile = selectedCharacters.filter((sc) => !sc.connectionProfileId)
    if (charsWithoutProfile.length > 0) {
      showErrorToast('Please select a connection profile for: ' + charsWithoutProfile.map((sc) => sc.character.name).join(', '))
      return
    }

    setCreating(true)
    clientLogger.debug('[NewChat] Creating chat', {
      characterCount: selectedCharacters.length,
      hasPersona: !!selectedPersonaId,
    })

    try {
      const participants: Array<{
        type: 'CHARACTER' | 'PERSONA'
        characterId?: string
        personaId?: string
        connectionProfileId?: string
        imageProfileId?: string
      }> = selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.connectionProfileId,
        imageProfileId: sc.imageProfileId || undefined,
      }))

      if (selectedPersonaId) {
        participants.push({ type: 'PERSONA' as const, personaId: selectedPersonaId })
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: generateTitle(), participants }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      clientLogger.info('[NewChat] Chat created successfully', { chatId: data.chat.id })
      showSuccessToast('Chat created!')
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
    <div className="min-h-screen px-4 py-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <Link href="/chats" className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80">
          ← Back to Chats
        </Link>

        <h1 className="mb-6 text-3xl font-semibold">New Chat</h1>

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
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Select Characters</h2>
            <div className="mb-4">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search characters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="max-h-[500px] space-y-2 overflow-y-auto">
              {filteredCharacters.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
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
                        <div className="font-medium text-foreground">{character.name}</div>
                        {character.title && <div className="text-sm text-muted-foreground">{character.title}</div>}
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
                <div className="py-8 text-center text-muted-foreground">Click on characters to add them to the chat</div>
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
                              <span className="font-medium text-foreground">{sc.character.name}</span>
                              {index === 0 && <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">Speaks First</span>}
                            </div>
                            {sc.character.title && <div className="text-sm text-muted-foreground">{sc.character.title}</div>}
                            <div className="mt-3">
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">Connection Profile</label>
                              <select
                                value={sc.connectionProfileId}
                                onChange={(e) => handleProfileChange(sc.character.id, e.target.value)}
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                <option value="">Select profile...</option>
                                {profiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.name}{profile.modelName ? ' (' + profile.modelName + ')' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {imageProfiles.length > 0 && (
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Image Profile (Optional)</label>
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

            {personas.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="mb-4 text-lg font-semibold">Persona (Optional)</h2>
                <p className="mb-3 text-sm text-muted-foreground">Select a persona to represent you in the conversation.</p>
                <select
                  value={selectedPersonaId}
                  onChange={(e) => setSelectedPersonaId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No persona</option>
                  {personas.map((persona) => (
                    <option key={persona.id} value={persona.id}>{persona.name}{persona.title ? ' (' + persona.title + ')' : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Link href="/chats" className="rounded-lg border border-border bg-card px-6 py-2 font-medium text-muted-foreground transition hover:bg-muted">Cancel</Link>
              <button
                onClick={handleCreateChat}
                disabled={creating || selectedCharacters.length === 0 || profiles.length === 0 || selectedCharacters.some((sc) => !sc.connectionProfileId)}
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
