'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'
import { TagDisplay } from '@/components/tags/tag-display'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import { ImportWizard } from '@/components/import/import-wizard'
import AvatarStack from '@/components/ui/AvatarStack'

interface ChatParticipant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  characterId?: string | null
  personaId?: string | null
  connectionProfileId?: string | null
  imageProfileId?: string | null
  isActive: boolean
  displayOrder: number
  character?: {
    id: string
    name: string
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    }
    tags?: string[]
  }
  persona?: {
    id: string
    name: string
    title?: string | null
    tags?: string[]
  }
}

interface Chat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  participants: ChatParticipant[]
  tags: Array<{
    tag: {
      id: string
      name: string
    }
  }>
  project: {
    id: string
    name: string
    color: string | null
  } | null
  _count: {
    messages: number
  }
}

/**
 * Folder icon for project indicator
 */
function FolderIcon({ className, color }: { className?: string; color?: string | null }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={color || 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export default function ChatsPage() {
  const router = useRouter()
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [characters, setCharacters] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [personas, setPersonas] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { formatCharacterName } = useUserCharacterDisplayName()
  const { shouldHideByIds } = useQuickHide()
  const { refreshSidebar } = useSidebarData()

  const visibleChats = useMemo(
    () => chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant tags
      const allTagIds: string[] = chat.tags.map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          allTagIds.push(...participant.character.tags)
        }
        if (participant.persona?.tags) {
          allTagIds.push(...participant.persona.tags)
        }
      }

      return !shouldHideByIds(allTagIds)
    }),
    [chats, shouldHideByIds]
  )

  useEffect(() => {
    fetchChats()
    fetchCharacters()
    fetchPersonas()
    fetchProfiles()
  }, [])

  // Auto-scroll and highlight imported chat
  useEffect(() => {
    if (highlightedChatId && importedChatRef.current) {
      importedChatRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Clear the highlight after animation completes (2.5 seconds)
      const timer = setTimeout(() => {
        setHighlightedChatId(null)
      }, 2500)

      return () => clearTimeout(timer)
    }
  }, [highlightedChatId])

  // Helper to get all active character participants
  const getActiveCharacters = (chat: Chat) => {
    return chat.participants
      .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(p => p.character!)
  }

  // Helper to get first persona participant
  const getFirstPersona = (chat: Chat) => {
    const personaParticipant = chat.participants.find(
      p => p.type === 'PERSONA' && p.isActive && p.persona
    )
    return personaParticipant?.persona
  }

  // Helper to format character names for display
  const formatCharacterNames = (characters: NonNullable<ChatParticipant['character']>[]): string => {
    if (characters.length === 0) return 'Unknown'
    if (characters.length === 1) return characters[0].name
    if (characters.length === 2) return `${characters[0].name} + ${characters[1].name}`
    // For 3+ characters, list all with " + "
    return characters.map(c => c.name).join(' + ')
  }

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/v1/chats')
      if (!res.ok) throw new Error('Failed to fetch chats')
      const data = await res.json()
      setChats(data.chats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/v1/characters')
      if (res.ok) {
        const data = await res.json()
        setCharacters(data.characters.map((c: any) => ({ id: c.id, name: c.name, title: c.title })))
      }
    } catch (err) {
      console.error('Failed to fetch characters:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchPersonas = async () => {
    try {
      const res = await fetch('/api/v1/personas')
      if (res.ok) {
        const data = await res.json()
        setPersonas(data.map((p: any) => ({ id: p.id, name: p.name, title: p.title })))
      }
    } catch (err) {
      console.error('Failed to fetch personas:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/v1/connection-profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles((data.profiles || []).map((p: any) => ({ id: p.id, name: p.name })))
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const deleteChat = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/v1/chats/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter((c) => c.id !== id))

      // Refresh sidebar to reflect deletion
      refreshSidebar()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  /**
   * Handle import completion from the new wizard
   */
  const handleImportComplete = useCallback(async (chatId: string) => {
    // Refetch all chats to get the newly imported one
    await fetchChats()
    // Also refetch characters/personas in case new ones were created
    await fetchCharacters()
    await fetchPersonas()
    // Refresh sidebar to show new chat and any new characters
    refreshSidebar()
    // Highlight the imported chat
    setHighlightedChatId(chatId)
    setImportDialogOpen(false)
  }, [refreshSidebar])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="chat-page qt-page-container text-foreground">
      <style>{`
        @keyframes arrowFlash {
          0% {
            opacity: 1;
            transform: translateX(0);
          }
          50% {
            opacity: 1;
            transform: translateX(10px);
          }
          100% {
            opacity: 0;
            transform: translateX(10px);
          }
        }
        .arrow-highlight {
          animation: arrowFlash 2.5s ease-out forwards;
        }
      `}</style>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <h1 className="text-3xl font-semibold leading-tight">Chats</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button chat-toolbar__button inline-flex items-center rounded-lg border border-border bg-muted/70 px-4 py-2 text-sm qt-text-primary shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import
          </button>
          <Link
            href="/chats/new"
            className="qt-button chat-toolbar__button chat-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New Chat
          </Link>
        </div>
      </div>

      {visibleChats.length === 0 ? (
        <div className="chat-empty-state mt-12 rounded-2xl border border-dashed border-border/70 bg-card/80 px-8 py-12 text-center shadow-sm">
          <p className="mb-4 text-lg qt-text-small">No chats yet</p>
          <Link
            href="/chats/new"
            className="font-medium text-primary hover:text-primary/80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="chat-card-stack space-y-4">
          {visibleChats.map((chat) => {
            const characters = getActiveCharacters(chat)
            const persona = getFirstPersona(chat)
            const characterNames = formatCharacterNames(characters)

            const handleCardClick = (e: React.MouseEvent) => {
              // Don't navigate if clicking on delete button
              if ((e.target as HTMLElement).closest('button')) {
                return
              }
              router.push(`/chats/${chat.id}`)
            }

            return (
              <div
                key={chat.id}
                ref={highlightedChatId === chat.id ? importedChatRef : null}
                className="qt-entity-card chat-card relative cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={handleCardClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/chats/${chat.id}`) } }}
              >
                {highlightedChatId === chat.id && (
                  <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 arrow-highlight">
                    <span className="text-6xl text-yellow-200 font-black" style={{ textShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}>←</span>
                  </div>
                )}
                <div className="flex items-stretch justify-between gap-4">
                  <div className="flex items-stretch flex-1 gap-4">
                    <AvatarStack entities={characters} size="lg" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-semibold text-foreground">{chat.title}</h2>
                        <span className="chat-card__badge inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                          {chat._count.messages}
                        </span>
                      </div>
                      <p className="qt-text-small">
                        {characterNames}
                        {persona && ` with ${formatCharacterName(persona)}`}
                        {' \u2022 '}
                        {new Date(chat.updatedAt).toLocaleDateString()}
                      </p>
                      {(chat.project || chat.tags.length > 0) && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {chat.project && (
                            <Link
                              href={`/projects/${chat.project.id}`}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <FolderIcon className="w-3 h-3" color={chat.project.color} />
                              <span>{chat.project.name}</span>
                            </Link>
                          )}
                          {chat.tags.length > 0 && (
                            <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id) }}
                      className="chat-card__action inline-flex h-10 w-10 items-center justify-center rounded-lg bg-destructive text-destructive-foreground shadow transition hover:bg-destructive/90"
                      title="Delete chat"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Import Wizard */}
      {importDialogOpen && (
        <ImportWizard
          characters={characters}
          personas={personas}
          profiles={profiles}
          onClose={() => setImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
        />
      )}
    </div>
  )
}
