'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import { TagDisplay } from '@/components/tags/tag-display'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ImportWizard } from '@/components/import/import-wizard'

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
  }
  persona?: {
    id: string
    name: string
    title?: string | null
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
  _count: {
    messages: number
  }
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [characters, setCharacters] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [personas, setPersonas] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()

  const visibleChats = useMemo(
    () => chats.filter(chat => !shouldHideByIds(chat.tags.map(ct => ct.tag.id))),
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

  // Helper to get first character participant
  const getFirstCharacter = (chat: Chat) => {
    const charParticipant = chat.participants.find(
      p => p.type === 'CHARACTER' && p.isActive && p.character
    )
    return charParticipant?.character
  }

  // Helper to get first persona participant
  const getFirstPersona = (chat: Chat) => {
    const personaParticipant = chat.participants.find(
      p => p.type === 'PERSONA' && p.isActive && p.persona
    )
    return personaParticipant?.persona
  }

  const getAvatarSrc = (chat: Chat): string | null => {
    const character = getFirstCharacter(chat)
    if (!character) return null
    if (character.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return character.avatarUrl || null
  }

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats')
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
      const res = await fetch('/api/characters')
      if (res.ok) {
        const data = await res.json()
        setCharacters(data.characters.map((c: any) => ({ id: c.id, name: c.name, title: c.title })))
      }
    } catch (err) {
      clientLogger.error('Failed to fetch characters:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchPersonas = async () => {
    try {
      const res = await fetch('/api/personas')
      if (res.ok) {
        const data = await res.json()
        setPersonas(data.map((p: any) => ({ id: p.id, name: p.name, title: p.title })))
      }
    } catch (err) {
      clientLogger.error('Failed to fetch personas:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.map((p: any) => ({ id: p.id, name: p.name })))
      }
    } catch (err) {
      clientLogger.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const deleteChat = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter((c) => c.id !== id))
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
    // Highlight the imported chat
    setHighlightedChatId(chatId)
    setImportDialogOpen(false)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 dark:text-white">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600 dark:text-red-400">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-[800px]">
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

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Chats</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="px-4 py-2 bg-gray-600 dark:bg-slate-600 text-white rounded hover:bg-gray-700 dark:hover:bg-slate-500"
          >
            Import
          </button>
          <Link
            href="/characters"
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800"
          >
            New Chat
          </Link>
        </div>
      </div>

      {visibleChats.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">No chats yet</p>
          <Link
            href="/characters"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Start a chat with a character
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleChats.map((chat) => (
            <div
              key={chat.id}
              ref={highlightedChatId === chat.id ? importedChatRef : null}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 bg-white dark:bg-slate-800 hover:shadow-lg dark:hover:shadow-xl transition-shadow relative"
            >
              {highlightedChatId === chat.id && (
                <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 arrow-highlight">
                  <span className="text-6xl text-yellow-200 font-black" style={{ textShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}>←</span>
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start flex-1 gap-4">
                  {(() => {
                    const character = getFirstCharacter(chat)
                    const persona = getFirstPersona(chat)
                    const avatarSrc = getAvatarSrc(chat)
                    const characterName = character?.name || 'Unknown'

                    return (
                      <>
                        {avatarSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarSrc}
                            alt={characterName}
                            width={64}
                            height={64}
                            className={getAvatarClasses(style, 'lg').imageClass}
                          />
                        ) : (
                          <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                            <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                              {characterName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{chat.title}</h2>
                            <span className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm font-semibold px-3 py-1 rounded-full">
                              {chat._count.messages}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {characterName}
                            {persona && ` (${persona.name}${persona.title ? ` - ${persona.title}` : ''})`}
                            {' \u2022 '}
                            {new Date(chat.updatedAt).toLocaleDateString()}
                          </p>
                          {chat.tags.length > 0 && (
                            <div className="mt-2">
                              <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                            </div>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>

                <div className="flex flex-col gap-2">
                  <Link
                    href={`/chats/${chat.id}`}
                    className="w-10 h-10 flex items-center justify-center bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
                    title="Open chat"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
                      <path d="M6 11l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <button
                    onClick={() => deleteChat(chat.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-600 dark:bg-red-700 rounded hover:bg-red-700 dark:hover:bg-red-800 transition-colors"
                    title="Delete chat"
                  >
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
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
