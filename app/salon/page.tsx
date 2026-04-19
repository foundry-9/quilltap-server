'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ImportWizard } from '@/components/import/import-wizard'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'

interface ChatParticipant {
  id: string
  type: 'CHARACTER'
  characterId?: string | null
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
  storyBackground: {
    id: string
    filepath: string
  } | null
  isDangerousChat?: boolean
  _count: {
    messages: number
  }
}

/**
 * Transform API chat data to ChatCardData format
 */
function transformChatToCardData(chat: Chat): ChatCardData {
  // Extract active character participants
  const characters = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(p => ({
      id: p.character!.id,
      name: p.character!.name,
      avatarUrl: p.character!.avatarUrl,
      defaultImageId: p.character!.defaultImageId,
      defaultImage: p.character!.defaultImage,
      tags: p.character!.tags,
    }))

  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count.messages,
    participants: characters,
    tags: chat.tags,
    updatedAt: chat.updatedAt,
    project: chat.project,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    isDangerousChat: chat.isDangerousChat === true,
  }
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [characters, setCharacters] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { shouldHideByIds, hideDangerousChats } = useQuickHide()

  const visibleChats = useMemo(
    () => chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant tags
      const allTagIds: string[] = chat.tags.map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          allTagIds.push(...participant.character.tags)
        }
      }

      if (shouldHideByIds(allTagIds)) {
        return false
      }

      // Check danger filter using full chat metadata
      if (hideDangerousChats && chat.isDangerousChat === true) {
        return false
      }

      return true
    }),
    [chats, shouldHideByIds, hideDangerousChats]
  )

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

  useEffect(() => {
    fetchChats()
    fetchCharacters()
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

  const deleteChat = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/v1/chats/${id}`, { method: 'DELETE' })
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
    // Also refetch characters in case new ones were created
    await fetchCharacters()
    // Highlight the imported chat
    setHighlightedChatId(chatId)
    setImportDialogOpen(false)
  }, [])

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
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="chat-page qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/salon.webp)' } as React.CSSProperties}>
      {/* Highlight animation styles */}
      <style>{`
        @keyframes chatCardHighlight {
          0% { opacity: 1; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(10px); }
          100% { opacity: 0; transform: translateX(10px); }
        }
        .chat-card-highlight-arrow {
          animation: chatCardHighlight 2.5s ease-out forwards;
        }
      `}</style>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="text-3xl font-semibold leading-tight">Chats</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button chat-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import SillyTavern Chat
          </button>
          <Link
            href="/salon/new"
            className="qt-button chat-toolbar__button chat-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-md transition hover:qt-bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New Chat
          </Link>
        </div>
      </div>

      {visibleChats.length === 0 ? (
        <div className="chat-empty-state mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="mb-4 text-lg qt-text-small">No chats yet</p>
          <Link
            href="/salon/new"
            className="font-medium text-primary hover:text-primary/80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="chat-card-stack space-y-4">
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={transformChatToCardData(chat)}
              showAvatars={true}
              showProject={true}
              actionType="delete"
              onDelete={deleteChat}
              highlighted={highlightedChatId === chat.id}
              cardRef={highlightedChatId === chat.id ? importedChatRef : undefined}
            />
          ))}
        </div>
      )}

      {/* Import Wizard */}
      {importDialogOpen && (
        <ImportWizard
          characters={characters}
          profiles={profiles}
          onClose={() => setImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
        />
      )}
    </div>
  )
}
